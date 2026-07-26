"""
push_to_base44.py
-----------------
Pushes processed hail swath GeoJSON features into a Base44 entity via REST API.

TODO: Wire this up once you've confirmed the entity name and schema in Base44.
      The function signatures below are ready — just fill in ENTITY_NAME and
      adjust the field mapping in build_payload() to match your entity fields.
"""

import json
import logging
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ── TODO: Set this to your Base44 entity name ────────────────────────────────
ENTITY_NAME = "HailSwath"

# ── Base44 connection ─────────────────────────────────────────────────────────

def get_base44_config():
    """Read Base44 credentials from .env file."""
    config = {
        "app_id":  os.getenv("BASE44_APP_ID"),
        "api_key": os.getenv("BASE44_API_KEY"),
    }
    if not config["app_id"] or not config["api_key"]:
        raise EnvironmentError(
            "BASE44_APP_ID and BASE44_API_KEY must be set in your .env file.\n"
            "Copy .env.example to .env and fill in your credentials."
        )
    return config


def build_headers(config):
    """Build the HTTP headers for Base44 API requests."""
    return {
        "Content-Type": "application/json",
        "api_key":      config["api_key"],
    }


def entity_url(config):
    """Construct the Base44 REST endpoint URL for the HailSwath entity."""
    return f"https://base44.app/api/apps/{config['app_id']}/entities/{ENTITY_NAME}"


# ── Payload builder ───────────────────────────────────────────────────────────

def build_payload(feature, event_date):
    """Convert a single GeoJSON Feature into the HailSwath entity payload."""
    return {
        "geometry":        json.dumps(feature["geometry"]),  # stored as JSON string, parsed on frontend
        "hail_size_bin":   feature["properties"]["hail_size_bin"],
        "min_size_inches": feature["properties"]["min_size_inches"],
        "event_date":      event_date,
    }


# ── Push logic ────────────────────────────────────────────────────────────────

def push_feature(config, headers, payload):
    """POST a single feature to Base44. Returns True on success."""
    url = entity_url(config)
    response = requests.post(url, headers=headers, json=payload, timeout=15)

    if response.status_code in (200, 201):
        return True
    else:
        log.error(f"  Base44 error {response.status_code}: {response.text[:200]}")
        return False


def date_has_records(event_date):
    """Return True if Base44 already has HailSwath records for this event_date."""
    config  = get_base44_config()
    headers = build_headers(config)
    url = entity_url(config)
    try:
        import urllib.parse
        filters = urllib.parse.quote(json.dumps({"event_date": event_date}))
        resp = requests.get(f"{url}?filters={filters}", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            records = data if isinstance(data, list) else data.get("data", [])
            return len(records) > 0
    except Exception as e:
        log.warning(f"Could not check existing records: {e}")
    return False


def push_geojson(geojson, event_date):
    """
    Push all features from a GeoJSON FeatureCollection to Base44.

    geojson: dict — the FeatureCollection returned by process_mesh.process()
    event_date: str — YYYY-MM-DD, stored on each record for filtering later

    Returns (success_count, failure_count).
    """
    config  = get_base44_config()
    headers = build_headers(config)
    features = geojson.get("features", [])

    log.info(f"Pushing {len(features)} features to Base44 entity '{ENTITY_NAME}' …")

    success = 0
    failure = 0

    for i, feature in enumerate(features):
        payload = build_payload(feature, event_date)
        ok = push_feature(config, headers, payload)
        if ok:
            success += 1
        else:
            failure += 1

        # Log progress every 10 features so you can see it moving
        if (i + 1) % 10 == 0:
            log.info(f"  {i + 1}/{len(features)} pushed …")

    log.info(f"Push complete: {success} succeeded, {failure} failed")
    return success, failure


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Push hail swath GeoJSON to Base44")
    parser.add_argument("--geojson", required=True, help="Path to GeoJSON file to push")
    parser.add_argument("--date",    required=True, help="Event date (YYYY-MM-DD)")
    args = parser.parse_args()

    with open(args.geojson) as f:
        geojson = json.load(f)

    push_geojson(geojson, event_date=args.date)
