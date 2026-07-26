"""
fetch_mrms.py
-------------
Downloads MRMS MESH (Maximum Estimated Size of Hail) GRIB2 files from the
NOAA public AWS S3 bucket for a given date and time range.

Files are cached in data/raw/ so re-running the same date won't re-download.

Usage:
    python fetch_mrms.py --date 2024-06-15
    python fetch_mrms.py --date 2024-06-15 --start-time 18:00 --end-time 23:00
    python fetch_mrms.py --date 2024-06-15 --list-files   # just show what's available
"""

import argparse
import gzip
import logging
import os
import shutil
from datetime import datetime, time
from pathlib import Path

import boto3
from botocore import UNSIGNED
from botocore.config import Config

# ── Constants ────────────────────────────────────────────────────────────────

S3_BUCKET = "noaa-mrms-pds"

# NOAA organizes MRMS data as:
#   s3://noaa-mrms-pds/CONUS/MESH/{YYYYMMDD}/MRMS_MESH_{YYYYMMDD}-{HHMMSS}.grib2.gz
# If this prefix doesn't match, run with --list-files to see what's actually there.
S3_PREFIX_TEMPLATE = "CONUS/MESH_00.50/{date_str}/"

RAW_DIR = Path(__file__).parent / "data" / "raw"

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


# ── S3 helpers ───────────────────────────────────────────────────────────────

def get_s3_client():
    """Return a boto3 S3 client with anonymous access (no AWS credentials needed)."""
    return boto3.client(
        "s3",
        config=Config(signature_version=UNSIGNED),
        region_name="us-east-1",
    )


def list_mesh_files(s3, date_str):
    """
    List all MESH GRIB2 files available on S3 for a given date.
    date_str should be in YYYYMMDD format.
    Returns a list of S3 object keys.
    """
    prefix = S3_PREFIX_TEMPLATE.format(date_str=date_str)
    log.info(f"Listing files under s3://{S3_BUCKET}/{prefix}")

    keys = []
    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix)

    for page in pages:
        for obj in page.get("Contents", []):
            key = obj["Key"]
            # Only grab MESH GRIB2 files (skip index files etc.)
            if key.endswith(".grib2.gz") or key.endswith(".grib2"):
                keys.append(key)

    log.info(f"Found {len(keys)} MESH files for {date_str}")
    return keys


def parse_file_time(s3_key):
    """
    Extract the timestamp from an MRMS filename.
    Expected format: ...MRMS_MESH_{YYYYMMDD}-{HHMMSS}.grib2.gz
    Returns a datetime object, or None if parsing fails.
    """
    filename = os.path.basename(s3_key)
    try:
        # Split on underscores and grab the last part before the extension
        # e.g. "MRMS_MESH_20240615-180000.grib2.gz" -> "20240615-180000"
        parts = filename.replace(".grib2.gz", "").replace(".grib2", "").split("_")
        timestamp_str = parts[-1]  # "20240615-180000"
        return datetime.strptime(timestamp_str, "%Y%m%d-%H%M%S")
    except (IndexError, ValueError):
        log.warning(f"Could not parse timestamp from filename: {filename}")
        return None


def filter_by_time(keys, start_time, end_time, date_str):
    """
    Filter S3 keys to only include files within the given time window.
    start_time and end_time are datetime.time objects.
    """
    filtered = []
    for key in keys:
        file_dt = parse_file_time(key)
        if file_dt is None:
            continue
        file_time = file_dt.time()
        if start_time <= file_time <= end_time:
            filtered.append(key)
    log.info(f"After time filter ({start_time}–{end_time}): {len(filtered)} files")
    return filtered


def download_file(s3, key, dest_dir):
    """
    Download a single file from S3, decompress if .gz, and save to dest_dir.
    Returns the local path to the decompressed .grib2 file.
    Skips download if the file already exists in the cache.
    """
    filename_gz   = os.path.basename(key)
    filename_grib = filename_gz.replace(".gz", "")  # strip .gz for the cached name
    local_path    = dest_dir / filename_grib

    # Already cached — skip
    if local_path.exists():
        log.info(f"  [cached] {filename_grib}")
        return local_path

    # Download compressed file to a temp path
    tmp_gz = dest_dir / filename_gz
    log.info(f"  Downloading {filename_gz} …")
    s3.download_file(S3_BUCKET, key, str(tmp_gz))

    # Decompress .gz -> .grib2
    if filename_gz.endswith(".gz"):
        log.info(f"  Decompressing {filename_gz} …")
        with gzip.open(tmp_gz, "rb") as f_in, open(local_path, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
        tmp_gz.unlink()  # remove the compressed file
    else:
        # Not compressed — just rename
        tmp_gz.rename(local_path)

    log.info(f"  Saved -> {local_path.name}")
    return local_path


# ── Main ─────────────────────────────────────────────────────────────────────

def fetch(date_str, start_time=None, end_time=None, list_only=False, step=1):
    """
    Main entry point.
    date_str: YYYYMMDD string
    start_time / end_time: datetime.time objects (optional, defaults to full day)
    list_only: if True, just print available files without downloading
    step: use every Nth file (1 = all files every 2 min, 5 = every 10 min, etc.)
    Returns list of local .grib2 file paths.
    """
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    s3 = get_s3_client()

    # Get all available files for the date
    keys = list_mesh_files(s3, date_str)

    if not keys:
        log.warning(
            f"No MESH files found for {date_str}. "
            "The S3 path may differ — try listing the bucket manually:\n"
            f"  aws s3 ls s3://{S3_BUCKET}/CONUS/ --no-sign-request"
        )
        return []

    if list_only:
        for key in keys:
            print(key)
        return []

    # Apply time filter if provided
    if start_time or end_time:
        start_time = start_time or time(0, 0)
        end_time   = end_time   or time(23, 59, 59)
        keys = filter_by_time(keys, start_time, end_time, date_str)

    if not keys:
        log.warning("No files matched the time filter.")
        return []

    # Decimate to every Nth file to speed up processing
    if step > 1:
        keys = keys[::step]
        log.info(f"Decimated to every {step}th file: {len(keys)} files remaining")

    # Download each file (skips cached ones)
    local_paths = []
    for key in keys:
        path = download_file(s3, key, RAW_DIR)
        local_paths.append(path)

    log.info(f"Done. {len(local_paths)} files ready in {RAW_DIR}")
    return local_paths


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_time(s):
    """Parse HH:MM string into a datetime.time object."""
    try:
        return datetime.strptime(s, "%H:%M").time()
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid time format '{s}' — use HH:MM")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download MRMS MESH GRIB2 files from NOAA S3")
    parser.add_argument("--date",       required=True, help="Date to fetch (YYYY-MM-DD)")
    parser.add_argument("--start-time", type=parse_time, default=None, help="Start of time window (HH:MM)")
    parser.add_argument("--end-time",   type=parse_time, default=None, help="End of time window (HH:MM)")
    parser.add_argument("--list-files", action="store_true", help="List available files without downloading")
    args = parser.parse_args()

    # Convert YYYY-MM-DD to YYYYMMDD for S3 path
    date_obj = datetime.strptime(args.date, "%Y-%m-%d")
    date_str = date_obj.strftime("%Y%m%d")

    fetch(date_str, args.start_time, args.end_time, list_only=args.list_files)
