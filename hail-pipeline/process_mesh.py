"""
process_mesh.py
---------------
Loads MRMS MESH GRIB2 files, converts hail sizes to inches, bins them into
configurable size categories, extracts polygons for each bin, and outputs a
GeoJSON FeatureCollection.

If multiple files are given (e.g. an hour's worth of scans), they are
composited into a single "storm total" swath by taking the max hail size
per grid cell across all time steps.

Usage:
    python process_mesh.py --files data/raw/MRMS_MESH_20240615-180000.grib2
    python process_mesh.py --files data/raw/*.grib2 --output output/swath.geojson
    python process_mesh.py --files data/raw/*.grib2 --bins 0.5 1.0 1.5 2.0
"""

import argparse
import json
import logging
from pathlib import Path

import numpy as np
import rasterio.features
import xarray as xr
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ── Defaults ─────────────────────────────────────────────────────────────────

# Hail size bins in inches. Polygons are extracted for each threshold — a
# polygon in the "1.0" bin means hail was >= 1.0" at that location.
DEFAULT_BINS = [0.5, 1.0, 1.5, 2.0]

OUTPUT_DIR = Path(__file__).parent / "data" / "output"

# ── GRIB2 loading ─────────────────────────────────────────────────────────────

# Variable names that NOAA uses for MESH in their GRIB2 files.
# cfgrib may surface the field under any of these — we try each in order.
MESH_VAR_CANDIDATES = ["unknown", "MESH", "mesh", "mh", "paramId_92"]


def load_grib2(filepath):
    """
    Load a single GRIB2 file and return the MESH data as a 2D numpy array
    along with the latitude and longitude 1D arrays.

    Values in the returned array are in millimeters (NOAA native unit).
    Returns (mesh_mm_2d, lats_1d, lons_1d).
    """
    log.info(f"Loading {Path(filepath).name} …")

    # cfgrib reads GRIB2 files via xarray. filter_by_keys narrows to a single
    # message so we don't accidentally load multiple variables at once.
    try:
        ds = xr.open_dataset(
            str(filepath),
            engine="cfgrib",
            backend_kwargs={"indexpath": ""},  # don't write .idx files everywhere
        )
    except Exception as e:
        raise RuntimeError(
            f"Failed to open {filepath} with cfgrib.\n"
            "Make sure eccodes is installed: sudo apt install libeccodes-dev  "
            "or  brew install eccodes\n"
            f"Original error: {e}"
        )

    # Find the MESH variable — try each candidate name
    mesh_var = None
    for name in MESH_VAR_CANDIDATES:
        if name in ds.data_vars:
            mesh_var = name
            break

    if mesh_var is None:
        available = list(ds.data_vars)
        raise ValueError(
            f"Could not find MESH variable in {filepath}.\n"
            f"Available variables: {available}\n"
            "Add the correct name to MESH_VAR_CANDIDATES at the top of process_mesh.py."
        )

    log.info(f"  Using variable '{mesh_var}'")

    mesh_data = ds[mesh_var].values  # 2D numpy array, values in mm

    # Pull lat/lon arrays — MRMS GRIB2 uses these standard coordinate names
    lats = ds["latitude"].values   # 1D array, degrees North
    lons = ds["longitude"].values  # 1D array, degrees East

    # MRMS longitudes are sometimes 0–360 instead of -180–180; fix that
    lons = np.where(lons > 180, lons - 360, lons)

    # Replace any fill/missing values with 0
    mesh_data = np.where(np.isfinite(mesh_data), mesh_data, 0.0)
    mesh_data = np.maximum(mesh_data, 0.0)  # no negative hail sizes

    log.info(f"  Grid shape: {mesh_data.shape}, max MESH: {mesh_data.max():.1f} mm")
    return mesh_data, lats, lons


# ── Compositing ───────────────────────────────────────────────────────────────

def composite_files(filepaths):
    """
    Load multiple GRIB2 files and return the per-cell maximum MESH value
    across all time steps. This gives you the storm-total swath — the worst
    hail at each location during the event.

    Returns (composite_mm_2d, lats_1d, lons_1d).
    """
    if len(filepaths) == 1:
        return load_grib2(filepaths[0])

    log.info(f"Compositing {len(filepaths)} files (taking max per cell) …")

    composite = None
    lats = lons = None

    for fp in filepaths:
        mesh, lats, lons = load_grib2(fp)
        if composite is None:
            composite = mesh
        else:
            # Element-wise max — keeps the biggest hail size at each cell
            composite = np.maximum(composite, mesh)

    log.info(f"Composite max MESH: {composite.max():.1f} mm  ({composite.max() / 25.4:.2f} inches)")
    return composite, lats, lons


# ── Polygon extraction ────────────────────────────────────────────────────────

def build_affine_transform(lats, lons):
    """
    Build a rasterio-compatible Affine transform from lat/lon arrays.
    Assumes a regular grid (equal spacing between cells).
    The transform maps pixel (col, row) -> (longitude, latitude).
    """
    from rasterio.transform import from_bounds

    # from_bounds expects (west, south, east, north, width, height)
    transform = from_bounds(
        west=float(lons.min()),
        south=float(lats.min()),
        east=float(lons.max()),
        north=float(lats.max()),
        width=len(lons),
        height=len(lats),
    )
    return transform


def extract_polygons_for_bin(mesh_inches, transform, threshold_inches):
    """
    For a single hail size threshold, find all grid cells where MESH >= threshold
    and convert those cells into shapely Polygon objects.

    Returns a list of shapely geometry objects.
    """
    # Create a binary mask: 1 where hail >= threshold, 0 elsewhere
    mask = (mesh_inches >= threshold_inches).astype(np.uint8)

    if mask.sum() == 0:
        # No hail at this threshold
        return []

    # rasterio.features.shapes() traces the boundary of each connected group
    # of 1-valued cells and returns (geojson_geometry_dict, pixel_value) pairs.
    # connectivity=8 means diagonal neighbors count as connected.
    raw_shapes = list(
        rasterio.features.shapes(mask, transform=transform, connectivity=8)
    )

    polygons = []
    for geom_dict, value in raw_shapes:
        if value != 1:
            continue  # skip the background (0-value) shapes

        polygon = shape(geom_dict)  # convert dict to shapely geometry

        # Skip tiny slivers (likely noise) — min 0.005 sq degrees (~60 km²)
        if not polygon.is_valid or polygon.area < 0.005:
            continue

        # Fix any self-intersections
        if not polygon.is_valid:
            polygon = polygon.buffer(0)

        polygons.append(polygon)

    return polygons


def smooth_geometry(geom, simplify_tol=0.06, buffer_dist=0.12, resolution=32):
    """
    Remove grid-artifact right angles from a raster-traced polygon.

    Step 1 — simplify: collapses the pixel-level stairstep vertices that
    rasterio produces when tracing axis-aligned grid cell boundaries.

    Step 2 — buffer round-trip: expands by buffer_dist with round joins,
    then contracts by the same amount. The round join style replaces every
    remaining sharp corner with a smooth curve, and the larger buffer_dist
    merges nearby fragmented cells into cohesive storm-swath blobs.
    """
    geom = geom.simplify(simplify_tol, preserve_topology=True)
    geom = (geom
            .buffer( buffer_dist, resolution=resolution, join_style=1)
            .buffer(-buffer_dist, resolution=resolution, join_style=1))
    if not geom.is_valid:
        geom = geom.buffer(0)
    return geom


def extract_all_bins(mesh_mm, lats, lons, bins):
    """
    Run polygon extraction for every size bin and return a GeoJSON
    FeatureCollection dict.

    Each feature has:
        hail_size_bin  - human-readable label, e.g. "1.0\""
        min_size_inches - numeric threshold, e.g. 1.0
    """
    # Convert mm -> inches (1 mm = 0.03937 inches)
    mesh_inches = mesh_mm / 25.4

    transform = build_affine_transform(lats, lons)

    features = []

    # Process bins from largest to smallest so bigger polygons don't get
    # visually buried under smaller-threshold polygons on the map.
    for threshold in sorted(bins, reverse=True):
        log.info(f"Extracting polygons for >= {threshold}\" …")
        polygons = extract_polygons_for_bin(mesh_inches, transform, threshold)

        if not polygons:
            continue

        # Merge overlapping polygons within the same bin into clean shapes
        merged = unary_union(polygons)

        # Smooth out the raster stairsteps and right-angle grid artifacts
        merged = smooth_geometry(merged)

        # Normalize to a flat list (unary_union returns Polygon or MultiPolygon)
        if hasattr(merged, "geoms"):
            merged_list = [g for g in merged.geoms if g.area >= 0.005]
        else:
            merged_list = [merged] if merged.area >= 0.005 else []

        log.info(f"  -> {len(merged_list)} polygon(s)")

        for poly in merged_list:
            features.append({
                "type": "Feature",
                "geometry": mapping(poly),
                "properties": {
                    "hail_size_bin":   f'{threshold}"',
                    "min_size_inches": threshold,
                },
            })

    return {"type": "FeatureCollection", "features": features}


# ── Main ─────────────────────────────────────────────────────────────────────

def process(filepaths, bins=None, output_path=None):
    """
    Main entry point.
    filepaths: list of Path objects pointing to local .grib2 files
    bins: list of float thresholds in inches (defaults to DEFAULT_BINS)
    output_path: where to write the GeoJSON file (optional)
    Returns the GeoJSON dict.
    """
    if not filepaths:
        raise ValueError("No files to process.")

    bins = bins or DEFAULT_BINS

    # Load and composite all files
    mesh_mm, lats, lons = composite_files(filepaths)

    # Extract polygons for each hail size bin
    geojson = extract_all_bins(mesh_mm, lats, lons, bins)

    total_features = len(geojson["features"])
    log.info(f"Extraction complete: {total_features} total features across {len(bins)} bins")

    # Write to disk if an output path was given
    if output_path:
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(geojson, f, indent=2)
        log.info(f"GeoJSON written to {output_path}")

    return geojson


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process MRMS MESH GRIB2 files into hail swath GeoJSON")
    parser.add_argument("--files",  required=True, nargs="+", help="Path(s) to .grib2 file(s)")
    parser.add_argument("--bins",   type=float, nargs="+", default=DEFAULT_BINS,
                        help=f"Hail size thresholds in inches (default: {DEFAULT_BINS})")
    parser.add_argument("--output", default=None, help="Output GeoJSON file path")
    args = parser.parse_args()

    filepaths = [Path(f) for f in args.files]
    out = args.output or str(OUTPUT_DIR / "swath.geojson")

    process(filepaths, bins=args.bins, output_path=out)
