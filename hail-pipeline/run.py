"""
run.py
------
Orchestrates the full pipeline: fetch -> process -> push.

Single day:
    python run.py --date 2024-06-15
    python run.py --date 2024-06-15 --start-time 18:00 --end-time 23:59
    python run.py --date 2024-06-15 --skip-push

Backfill last N days (today = day 0, yesterday = day 1, etc.):
    python run.py --days-back 30
    python run.py --days-back 30 --step 5   # every 5th GRIB2 = 10-min intervals (5x faster)
    python run.py --days-back 30 --force    # re-push even if date already in Base44

Options:
    --region    Crop output: "lon_min,lat_min,lon_max,lat_max"
    --bins      Hail size thresholds in inches (default: 0.5 1.0 1.5 2.0)
    --step      Use every Nth GRIB2 file (default 5 for backfill, 1 for single day)
    --force     Ignore existing Base44 records and re-push
"""

import argparse
import json
import logging
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from fetch_mrms import fetch, parse_time
from process_mesh import process, DEFAULT_BINS
from push_to_base44 import push_geojson, date_has_records

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

OUTPUT_DIR = Path(__file__).parent / "data" / "output"


# ── Region filter ─────────────────────────────────────────────────────────────

def parse_bbox(region_str):
    if not region_str:
        return None
    parts = [float(x.strip()) for x in region_str.split(",")]
    if len(parts) != 4:
        raise ValueError("--region must be 'lon_min,lat_min,lon_max,lat_max'")
    return tuple(parts)


def crop_geojson_to_bbox(geojson, bbox):
    if bbox is None:
        return geojson

    from shapely.geometry import shape, box

    lon_min, lat_min, lon_max, lat_max = bbox
    region_box = box(lon_min, lat_min, lon_max, lat_max)

    kept = [
        f for f in geojson["features"]
        if region_box.intersects(shape(f["geometry"]))
    ]
    log.info(f"Region filter: kept {len(kept)} of {len(geojson['features'])} features")
    return {"type": "FeatureCollection", "features": kept}


# ── Single-day pipeline ───────────────────────────────────────────────────────

def run_day(date_str, start_time=None, end_time=None, bins=None, bbox=None,
            skip_push=False, step=1, force=False):
    """
    Full pipeline for one date. date_str is YYYYMMDD.
    Returns True if data was pushed (or skip_push), False if skipped/errored.
    """
    event_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
    bins = bins or DEFAULT_BINS

    log.info("=" * 60)
    log.info(f"HAIL PIPELINE — {event_date}")
    log.info("=" * 60)

    # ── Idempotency check ────────────────────────────────────────────────────
    if not skip_push and not force:
        if date_has_records(event_date):
            log.info(f"  Base44 already has records for {event_date} — skipping (use --force to override)")
            return False

    # ── Step 1: Fetch ────────────────────────────────────────────────────────
    log.info("[1/3] FETCHING MRMS MESH files from S3 …")
    local_files = fetch(date_str, start_time=start_time, end_time=end_time, step=step)

    if not local_files:
        log.warning(f"  No files found for {event_date} — skipping")
        return False

    log.info(f"      {len(local_files)} file(s) ready")

    # ── Step 2: Process ──────────────────────────────────────────────────────
    log.info("[2/3] PROCESSING GRIB2 -> GeoJSON …")
    output_path = OUTPUT_DIR / f"swath_{date_str}.geojson"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    geojson = process(local_files, bins=bins, output_path=output_path)

    feature_count = len(geojson["features"])
    log.info(f"      {feature_count} features extracted")

    if feature_count == 0:
        log.info(f"  No hail detected for {event_date} — skipping push")
        return False

    for f in geojson["features"]:
        label = f["properties"]["hail_size_bin"]
        log.info(f"      {label}: polygon")

    if bbox:
        geojson = crop_geojson_to_bbox(geojson, bbox)
        with open(output_path, "w") as f_out:
            json.dump(geojson, f_out, indent=2)

    # ── Step 3: Push ─────────────────────────────────────────────────────────
    if skip_push:
        log.info("[3/3] PUSH SKIPPED (--skip-push)")
        log.info(f"      GeoJSON saved to: {output_path}")
        return True

    log.info("[3/3] PUSHING to Base44 …")
    try:
        success, failure = push_geojson(geojson, event_date=event_date)
        if failure > 0:
            log.warning(f"      {failure} features failed to push")
        return success > 0
    except EnvironmentError as e:
        log.error(f"Push failed: {e}")
        return False


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Hail pipeline: fetch MRMS MESH -> process -> push to Base44"
    )

    # Date selection — one of --date or --days-back required
    date_group = parser.add_mutually_exclusive_group(required=True)
    date_group.add_argument("--date",      help="Single date to process (YYYY-MM-DD)")
    date_group.add_argument("--days-back", type=int,
                            help="Process the last N days (today - N + 1 through today)")

    parser.add_argument("--start-time", type=parse_time, default=None,
                        help="Start of time window (HH:MM, default 00:00)")
    parser.add_argument("--end-time",   type=parse_time, default=None,
                        help="End of time window (HH:MM, default 23:59)")
    parser.add_argument("--bins",       type=float, nargs="+", default=None,
                        help=f"Hail size bins in inches (default: {DEFAULT_BINS})")
    parser.add_argument("--region",     default=None,
                        help="Bounding box: 'lon_min,lat_min,lon_max,lat_max'")
    parser.add_argument("--step",       type=int, default=None,
                        help="Use every Nth GRIB2 file (default: 5 for --days-back, 1 for --date)")
    parser.add_argument("--skip-push",  action="store_true",
                        help="Fetch + process but don't push to Base44")
    parser.add_argument("--force",      action="store_true",
                        help="Re-push even if Base44 already has records for that date")

    args = parser.parse_args()
    bbox = parse_bbox(args.region)

    if args.date:
        # Single day
        date_obj = datetime.strptime(args.date, "%Y-%m-%d")
        date_str = date_obj.strftime("%Y%m%d")
        step = args.step if args.step is not None else 1
        run_day(date_str, args.start_time, args.end_time, args.bins, bbox,
                args.skip_push, step=step, force=args.force)

    else:
        # Multi-day backfill
        step = args.step if args.step is not None else 5
        today = date.today()
        dates = [today - timedelta(days=i) for i in range(args.days_back - 1, -1, -1)]

        log.info(f"Backfill: {len(dates)} days from {dates[0]} to {dates[-1]} (step={step})")

        pushed = 0
        skipped = 0
        for d in dates:
            date_str = d.strftime("%Y%m%d")
            result = run_day(date_str, args.start_time, args.end_time, args.bins, bbox,
                             args.skip_push, step=step, force=args.force)
            if result:
                pushed += 1
            else:
                skipped += 1

        log.info("=" * 60)
        log.info(f"BACKFILL COMPLETE: {pushed} days pushed, {skipped} days skipped/no-hail")
        log.info("=" * 60)
