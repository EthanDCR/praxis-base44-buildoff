# Hail Pipeline

Pulls NOAA MRMS MESH (Maximum Estimated Size of Hail) grid data, extracts
hail-size polygons for a given date, and pushes clean GeoJSON to Base44.

---

## How it works

```
NOAA S3 (public)
  └─ MRMS MESH GRIB2 files
       │  fetch_mrms.py  (downloads + caches)
       ▼
  data/raw/*.grib2
       │  process_mesh.py  (composite + bin + extract polygons)
       ▼
  GeoJSON FeatureCollection
       │  push_to_base44.py  (POST each feature)
       ▼
  Base44 entity (read by React frontend)
```

---

## Setup

### 1. Prerequisites

You need the `eccodes` C library installed before the Python packages will work:

```bash
# macOS
brew install eccodes

# Ubuntu / Debian
sudo apt install libeccodes-dev

# Arch Linux
sudo pacman -S eccodes
```

### 2. Create and activate a virtual environment

```bash
cd hail-pipeline

# Create the venv (only needed once)
python3 -m venv .venv

# Activate it — you must do this each session
source .venv/bin/activate      # macOS / Linux
# .venv\Scripts\activate       # Windows

# Install dependencies
pip install -r requirements.txt
```

### 3. Configure credentials

```bash
cp .env.example .env
# Edit .env and fill in your BASE44_APP_ID and BASE44_API_KEY
```

---

## Running the pipeline

```bash
# Full run for a date (fetch + process + push)
python run.py --date 2024-06-15

# Fetch + process only — skip the Base44 push (good for testing)
python run.py --date 2024-06-15 --skip-push

# Narrow to a time window (e.g. afternoon convection only)
python run.py --date 2024-06-15 --start-time 17:00 --end-time 23:00 --skip-push

# Crop output to a region (lon_min,lat_min,lon_max,lat_max)
# Texas example:
python run.py --date 2024-06-15 --region "-106,25,-93,37" --skip-push

# Custom hail size bins (inches)
python run.py --date 2024-06-15 --bins 0.75 1.0 1.5 2.0 2.5 --skip-push
```

Output GeoJSON is saved to `data/output/swath_{YYYYMMDD}.geojson`.

---

## Test against a known hail event

A good event to sanity-check against:

**April 28, 2021 — North Texas / DFW supercells**
- Large hail (2–4"+) reported across the Metroplex
- Time window: ~20:00–23:59 UTC

```bash
python run.py \
  --date 2021-04-28 \
  --start-time 20:00 \
  --end-time 23:59 \
  --region "-100,30,-94,34" \
  --skip-push
```

Open `data/output/swath_20210428.geojson` in [geojson.io](https://geojson.io)
to visually verify the polygons look right — you should see concentrated large-hail
polygons over the DFW area.

---

## Troubleshooting

**"No MESH files found"**
The S3 path may be slightly different for your date. Run:
```bash
python fetch_mrms.py --date 2021-04-28 --list-files
```
If that returns nothing, browse the bucket structure:
```bash
aws s3 ls s3://noaa-mrms-pds/CONUS/ --no-sign-request
```
Then update `S3_PREFIX_TEMPLATE` in `fetch_mrms.py` to match.

**"Could not find MESH variable"**
cfgrib found the file but the variable name is different. The error message
will show available variable names — add the right one to `MESH_VAR_CANDIDATES`
in `process_mesh.py`.

**"eccodes not found"**
Install the C library first (see Prerequisites above), then reinstall cfgrib:
```bash
pip install --force-reinstall cfgrib
```

---

## File layout

```
hail-pipeline/
├── fetch_mrms.py      # S3 download + caching
├── process_mesh.py    # GRIB2 -> GeoJSON conversion
├── push_to_base44.py  # Base44 REST push (stubbed — wire in entity name)
├── run.py             # CLI orchestrator
├── requirements.txt
├── .env.example
├── README.md
└── data/
    ├── raw/           # cached GRIB2 files (auto-created)
    └── output/        # GeoJSON output (auto-created)
```
