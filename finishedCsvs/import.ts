// Run from storm-backend: cat ../finishedCsvs/import.ts | npx base44 exec
// Reads targets_import.csv then contacts_import.csv and bulk-inserts into Base44.

declare const base44: any;

const TARGETS_CSV = "/home/ethan/Projects/base44BuildOff/finishedCsvs/targets_import.csv";
const CONTACTS_CSV = "/home/ethan/Projects/base44BuildOff/finishedCsvs/contacts_import.csv";

const fs = await import("node:fs");
const readline = await import("node:readline");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function readCsv(path: string): Promise<Record<string, string>[]> {
  const rl = readline.createInterface({ input: fs.createReadStream(path) });
  const rows: Record<string, string>[] = [];
  let headers: string[] = [];
  for await (const line of rl) {
    if (!headers.length) { headers = parseCsvLine(line); continue; }
    const vals = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => row[h] = vals[i] ?? "");
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur); cur = "";
    } else cur += ch;
  }
  result.push(cur);
  return result;
}

async function createWithRetry(entity: any, data: any): Promise<any> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await entity.create(data);
    } catch (e: any) {
      if (e?.status === 429) {
        const wait = 3000 * (attempt + 1);
        await sleep(wait);
      } else throw e;
    }
  }
}

// ── Phase 1: Import Targets ───────────────────────────────────────────────────

console.log("Reading targets CSV...");
const targetRows = await readCsv(TARGETS_CSV);
console.log(`Found ${targetRows.length} targets to import.`);

const importKeyToId: Record<string, string> = {};
let tCreated = 0;

for (const row of targetRows) {
  const data: Record<string, any> = {
    street:                row.street || undefined,
    city:                  row.city || undefined,
    state:                 row.state || undefined,
    zip:                   row.zip || undefined,
    lat:                   row.lat ? parseFloat(row.lat) : undefined,
    lng:                   row.lng ? parseFloat(row.lng) : undefined,
    property_type:         row.property_type || undefined,
    year_built:            row.year_built || undefined,
    roof_type:             row.roof_type || undefined,
    roof_size_sq:          row.roof_size_sq ? parseFloat(row.roof_size_sq) : undefined,
    building_sqft:         row.building_sqft ? parseFloat(row.building_sqft) : undefined,
    stories:               row.stories ? parseFloat(row.stories) : undefined,
    hail_score_tier:       row.hail_score_tier || undefined,
    hail_score_value:      row.hail_score_value ? parseFloat(row.hail_score_value) : undefined,
    largest_hail_inches:   row.largest_hail_inches ? parseFloat(row.largest_hail_inches) : undefined,
    largest_hail_date:     row.largest_hail_date || undefined,
    most_recent_event_date: row.most_recent_event_date || undefined,
    total_events_10yr:     row.total_events_10yr ? parseFloat(row.total_events_10yr) : undefined,
    data_sources:          row.data_sources ? row.data_sources.split("|") : undefined,
    pipeline:              "unassigned",
    status:                "new",
  };

  // Strip undefined keys
  Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

  const record = await createWithRetry(base44.entities.Target, data);
  importKeyToId[row.import_key] = record.id;
  tCreated++;
  await sleep(150);

  if (tCreated % 100 === 0) console.log(`Targets: ${tCreated} / ${targetRows.length}`);
}

console.log(`✓ Targets done: ${tCreated} created.`);

// ── Phase 2: Import Contacts ──────────────────────────────────────────────────

console.log("Reading contacts CSV...");
const contactRows = await readCsv(CONTACTS_CSV);
console.log(`Found ${contactRows.length} contacts to import.`);

let cCreated = 0;
let cSkipped = 0;

for (const row of contactRows) {
  const targetId = importKeyToId[row.import_key];
  if (!targetId) { cSkipped++; continue; }

  const data: Record<string, any> = {
    target_id:    targetId,
    contact_name: row.contact_name || undefined,
    value:        row.value,
    contact_type: row.contact_type,
    phone_type:   row.phone_type || undefined,
    tcpa:         row.tcpa === "true" ? true : row.tcpa === "false" ? false : undefined,
    score:        row.score ? parseInt(row.score) : undefined,
    sources:      row.sources ? row.sources.split("|") : undefined,
  };

  Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

  await createWithRetry(base44.entities.Contact, data);
  cCreated++;
  await sleep(150);

  if (cCreated % 500 === 0) console.log(`Contacts: ${cCreated} / ${contactRows.length} (skipped: ${cSkipped})`);
}

console.log(`✓ Contacts done: ${cCreated} created, ${cSkipped} skipped (no matching target).`);
console.log(`\nImport complete. ${tCreated} targets, ${cCreated} contacts.`);
