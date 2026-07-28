"""
reset_list.py
-------------
Resets all Targets in a named CallList back to status='new'.
Clears notes and number_quality too so it's a clean slate.

Usage:
    python reset_list.py --list "TEST"
    python reset_list.py --list "TEST" --dry-run
    python reset_list.py --list "Appleton WI July 2026"
"""

import argparse
import json
import logging
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

APP_ID  = os.getenv("BASE44_APP_ID")
API_KEY = os.getenv("BASE44_API_KEY")

if not APP_ID or not API_KEY:
    sys.exit("BASE44_APP_ID and BASE44_API_KEY must be set in .env")

BASE = f"https://base44.app/api/apps/{APP_ID}/entities"
HEADERS = {"Content-Type": "application/json", "api_key": API_KEY}


def get(entity, filters=None):
    url = f"{BASE}/{entity}"
    if filters:
        import urllib.parse
        url += f"?filters={urllib.parse.quote(json.dumps(filters))}"
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else data.get("data", [])


def patch(entity, record_id, payload):
    r = requests.put(f"{BASE}/{entity}/{record_id}", headers=HEADERS, json=payload, timeout=15)
    r.raise_for_status()
    return r.json()


def main():
    parser = argparse.ArgumentParser(description="Reset all Targets in a CallList to status=new")
    parser.add_argument("--list",    required=True, help="Exact name of the CallList to reset")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be reset without changing anything")
    args = parser.parse_args()

    # Find the list by name
    log.info(f"Looking up CallList '{args.list}' …")
    lists = get("CallList")
    match = next((l for l in lists if l.get("name") == args.list), None)
    if not match:
        available = [l.get("name") for l in lists]
        sys.exit(f"No list named '{args.list}'. Available lists: {available}")

    list_id = match["id"]
    log.info(f"Found list: '{args.list}' (id={list_id})")

    # Fetch all targets in that list
    log.info("Fetching targets …")
    targets = get("Target", filters={"list_id": list_id})
    log.info(f"Found {len(targets)} targets")

    if not targets:
        log.info("Nothing to reset.")
        return

    # Show what we're about to do
    statuses = {}
    for t in targets:
        s = t.get("status", "unknown")
        statuses[s] = statuses.get(s, 0) + 1
    log.info(f"Current statuses: {statuses}")

    if args.dry_run:
        log.info("DRY RUN — no changes made. Remove --dry-run to apply.")
        return

    # Reset each target
    reset_payload = {"status": "new", "notes": "", "number_quality": ""}
    success = 0
    failure = 0

    for i, t in enumerate(targets):
        try:
            patch("Target", t["id"], reset_payload)
            success += 1
            if (i + 1) % 10 == 0:
                log.info(f"  {i + 1}/{len(targets)} reset …")
        except Exception as e:
            log.error(f"  Failed to reset {t.get('line1', t['id'])}: {e}")
            failure += 1

    log.info(f"Done — {success} reset, {failure} failed")


if __name__ == "__main__":
    main()
