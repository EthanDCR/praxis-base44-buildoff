#!/usr/bin/env python3
"""
Merge skiptrace_8497_results.csv + SalesMastery priority export.
- Deduplicates on normalized (street, zip)
- Scores phones by how many sources they appear in
- Drops addresses with zero contacts
- Outputs: week_targets.csv + week_contacts.csv
"""

import csv
import re
import sys
from pathlib import Path

SKIPTRACE = Path(__file__).parent / "skiptrace_8497_results.csv"
SALESMASTERY = Path(__file__).parent.parent / "Master Export - Property Fields and Prioritized Qualified Owners.csv"
OUT_DIR = Path(__file__).parent

STREET_ABBREVS = {
    r'\bstreet\b': 'st', r'\broad\b': 'rd', r'\bboulevard\b': 'blvd',
    r'\bavenue\b': 'ave', r'\bdrive\b': 'dr', r'\bcourt\b': 'ct',
    r'\blane\b': 'ln', r'\bplace\b': 'pl', r'\bcircle\b': 'cir',
    r'\btrail\b': 'trl', r'\bparkway\b': 'pkwy', r'\bway\b': 'wy',
    r'\bnorth\b': 'n', r'\bsouth\b': 's', r'\beast\b': 'e', r'\bwest\b': 'w',
    r'\bnortheast\b': 'ne', r'\bnorthwest\b': 'nw',
    r'\bsoutheast\b': 'se', r'\bsouthwest\b': 'sw',
}

def norm_street(s):
    s = str(s or '').lower().strip()
    for pat, rep in STREET_ABBREVS.items():
        s = re.sub(pat, rep, s)
    s = re.sub(r'[^a-z0-9\s]', '', s)
    return re.sub(r'\s+', ' ', s).strip()

def norm_zip(z):
    return str(z or '').strip().split('-')[0].zfill(5)

def addr_key(street, zip_code):
    return (norm_street(street), norm_zip(zip_code))

def norm_phone(p):
    digits = re.sub(r'\D', '', str(p or ''))
    if len(digits) == 11 and digits.startswith('1'):
        digits = digits[1:]
    return digits if len(digits) == 10 else None

def norm_email(e):
    e = str(e or '').strip().lower()
    return e if '@' in e and '.' in e.split('@')[-1] else None

def s(v):
    return str(v).strip() if v is not None else ''

def num(v):
    try:
        val = float(str(v).replace(',', '').strip())
        return val if val == val else None
    except (ValueError, TypeError):
        return None


class Property:
    def __init__(self):
        self.street = ''
        self.city = ''
        self.state = ''
        self.zip = ''
        self.lat = None
        self.lng = None
        self.business_name = ''
        self.building_type = ''
        self.property_type = ''
        self.year_built = ''
        self.roof_types = ''
        self.roof_size_sq = None
        self.building_sqft = None
        self.stories = None
        self.hail_score_tier = ''
        self.hail_score_value = None
        self.largest_hail_inches = None
        self.largest_hail_date = ''
        self.most_recent_event_date = ''
        self.total_events_10yr = None
        self.data_sources = set()
        # {norm_phone: {name, phone_type, tcpa, sources: set()}}
        self.phones = {}
        # {norm_email: {name, sources: set()}}
        self.emails = {}

    def fill(self, **kwargs):
        for k, v in kwargs.items():
            if v is None or v == '':
                continue
            if not getattr(self, k, None) and getattr(self, k, None) != 0:
                setattr(self, k, v)

    def add_phone(self, raw, name='', phone_type='', tcpa=False, source=''):
        p = norm_phone(raw)
        if not p:
            return
        if p not in self.phones:
            self.phones[p] = {'name': name, 'phone_type': phone_type, 'tcpa': tcpa, 'sources': set()}
        if name and not self.phones[p]['name']:
            self.phones[p]['name'] = name
        if phone_type and not self.phones[p]['phone_type']:
            self.phones[p]['phone_type'] = phone_type
        if tcpa:
            self.phones[p]['tcpa'] = True
        if source:
            self.phones[p]['sources'].add(source)

    def add_email(self, raw, name='', source=''):
        e = norm_email(raw)
        if not e:
            return
        if e not in self.emails:
            self.emails[e] = {'name': name, 'sources': set()}
        if name and not self.emails[e]['name']:
            self.emails[e]['name'] = name
        if source:
            self.emails[e]['sources'].add(source)


targets = {}  # addr_key -> Property

# ── Read Skiptrace ────────────────────────────────────────────────────────────
print("Reading skiptrace...")
with open(SKIPTRACE, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        street = s(row.get('street'))
        zip_ = norm_zip(row.get('zip'))
        if not street:
            continue

        key = addr_key(street, zip_)
        if key not in targets:
            targets[key] = Property()
        t = targets[key]
        t.data_sources.add('BatchData')

        t.fill(
            street=street,
            city=s(row.get('city')),
            state=s(row.get('state')),
            zip=zip_,
            lat=num(row.get('lat')),
            lng=num(row.get('lon')),
            hail_score_tier=s(row.get('score_tier')),
            hail_score_value=num(row.get('score_value')),
            largest_hail_inches=num(row.get('largest_hail_inches')),
            largest_hail_date=s(row.get('largest_hail_date')),
            most_recent_event_date=s(row.get('most_recent_event_date')),
            total_events_10yr=num(row.get('total_events_10yr')),
        )

        for n in range(1, 4):
            name = s(row.get(f'p{n}_name'))
            for p in range(1, 6):
                phone = row.get(f'p{n}_phone{p}')
                ptype = s(row.get(f'p{n}_phone{p}_type'))
                tcpa_raw = s(row.get(f'p{n}_phone{p}_tcpa'))
                tcpa = tcpa_raw.lower() in ('true', '1', 'yes')
                t.add_phone(phone, name=name, phone_type=ptype, tcpa=tcpa, source='BatchData')
            for e in range(1, 4):
                email = row.get(f'p{n}_email{e}')
                t.add_email(email, name=name, source='BatchData')

print(f"  {len(targets)} unique addresses after skiptrace")

# ── Read SalesMastery ─────────────────────────────────────────────────────────
print("Reading SalesMastery...")
sm_new = 0
with open(SALESMASTERY, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        street = s(row.get('Street'))
        zip_ = norm_zip(row.get('Zip'))
        if not street:
            continue

        key = addr_key(street, zip_)
        if key not in targets:
            targets[key] = Property()
            sm_new += 1
        t = targets[key]
        t.data_sources.add('SalesMastery')

        t.fill(
            street=street,
            city=s(row.get('City')),
            state=s(row.get('State')),
            zip=zip_,
            business_name=s(row.get('Business Name')),
            building_type=s(row.get('Building Type')),
            property_type=s(row.get('Property Type')),
            year_built=s(row.get('Year Built')),
            roof_types=s(row.get('Roof Types')),
            roof_size_sq=num(row.get('Roof Size (Sq)')),
            building_sqft=num(row.get('Building Area (sqft)')),
            largest_hail_inches=num(row.get('Hail Size (in)')),
            largest_hail_date=s(row.get('Hail Date')),
            most_recent_event_date=s(row.get('Hail Date')),
        )

        for n in range(1, 4):
            name = s(row.get(f'O{n}_Name'))
            if not name:
                continue
            for p in range(1, 6):
                phone = row.get(f'O{n}_P{p}_Number')
                ptype = s(row.get(f'O{n}_P{p}_Type'))
                t.add_phone(phone, name=name, phone_type=ptype, source='SalesMastery')

print(f"  {sm_new} new addresses from SalesMastery, {len(targets)} total unique")

# ── Filter: must have at least one contact ────────────────────────────────────
before = len(targets)
targets = {k: v for k, v in targets.items() if v.phones or v.emails}
print(f"  Dropped {before - len(targets)} addresses with no contacts → {len(targets)} remaining")

# ── Write week_targets.csv ────────────────────────────────────────────────────
target_fields = [
    'street', 'city', 'state', 'zip', 'lat', 'lng',
    'business_name', 'building_type', 'property_type', 'year_built',
    'roof_types', 'roof_size_sq', 'building_sqft', 'stories',
    'hail_score_tier', 'hail_score_value', 'largest_hail_inches',
    'largest_hail_date', 'most_recent_event_date', 'total_events_10yr',
    'data_sources', 'import_key',
]

targets_path = OUT_DIR / 'week_targets.csv'
with open(targets_path, 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=target_fields)
    w.writeheader()
    for key, t in targets.items():
        w.writerow({
            'import_key':            f"{key[0]}|{key[1]}",
            'street':                t.street,
            'city':                  t.city,
            'state':                 t.state,
            'zip':                   t.zip,
            'lat':                   t.lat if t.lat is not None else '',
            'lng':                   t.lng if t.lng is not None else '',
            'business_name':         t.business_name,
            'building_type':         t.building_type,
            'property_type':         t.property_type,
            'year_built':            t.year_built,
            'roof_types':            t.roof_types,
            'roof_size_sq':          t.roof_size_sq if t.roof_size_sq is not None else '',
            'building_sqft':         t.building_sqft if t.building_sqft is not None else '',
            'stories':               t.stories if t.stories is not None else '',
            'hail_score_tier':       t.hail_score_tier,
            'hail_score_value':      t.hail_score_value if t.hail_score_value is not None else '',
            'largest_hail_inches':   t.largest_hail_inches if t.largest_hail_inches is not None else '',
            'largest_hail_date':     t.largest_hail_date,
            'most_recent_event_date': t.most_recent_event_date,
            'total_events_10yr':     t.total_events_10yr if t.total_events_10yr is not None else '',
            'data_sources':          '|'.join(sorted(t.data_sources)),
        })

print(f"Written: {targets_path} ({len(targets)} rows)")

# ── Write week_contacts.csv ───────────────────────────────────────────────────
contact_fields = [
    'import_key', 'contact_name', 'value', 'contact_type',
    'phone_type', 'tcpa', 'score', 'sources',
]

contacts_path = OUT_DIR / 'week_contacts.csv'
total_contacts = 0

with open(contacts_path, 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=contact_fields)
    w.writeheader()

    for key, t in targets.items():
        import_key = f"{key[0]}|{key[1]}"
        contacts = []

        for phone, meta in t.phones.items():
            contacts.append({
                'import_key':   import_key,
                'contact_name': meta['name'],
                'value':        phone,
                'contact_type': 'phone',
                'phone_type':   meta['phone_type'],
                'tcpa':         str(meta['tcpa']).lower(),
                'score':        len(meta['sources']),
                'sources':      '|'.join(sorted(meta['sources'])),
            })

        for email, meta in t.emails.items():
            contacts.append({
                'import_key':   import_key,
                'contact_name': meta['name'],
                'value':        email,
                'contact_type': 'email',
                'phone_type':   '',
                'tcpa':         '',
                'score':        len(meta['sources']),
                'sources':      '|'.join(sorted(meta['sources'])),
            })

        # Sort: score desc, phones before emails
        contacts.sort(key=lambda c: (-c['score'], c['contact_type'], c['value']))
        for c in contacts:
            w.writerow(c)
            total_contacts += 1

print(f"Written: {contacts_path} ({total_contacts} rows)")
print(f"\nDone. {len(targets)} targets, {total_contacts} contacts.")
print(f"Avg contacts per target: {total_contacts / len(targets):.1f}")
