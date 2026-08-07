// Run from storm-backend: cat ../testCsvs/import_week.ts | npx base44 exec

declare const base44: any;

const TARGETS_CSV = "/home/ethan/Projects/base44BuildOff/testCsvs/week_targets.csv";
const CONTACTS_CSV = "/home/ethan/Projects/base44BuildOff/testCsvs/week_contacts.csv";
const PROGRESS_FILE = "/home/ethan/Projects/base44BuildOff/testCsvs/import_week_progress.json";

const fs = await import("node:fs");
const readline = await import("node:readline");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function readCsv(path: string): Promise<Record<string, string>[]> {
  const rl = readline.createInterface({ input: fs.createReadStream(path) });
  const rows: Record<string, string>[] = [];
  let headers: string[] = [];
  for await (const line of rl) {
    if (!headers.length) { headers = parseLine(line); continue; }
    const vals = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => row[h] = vals[i] ?? "");
    rows.push(row);
  }
  return rows;
}

function parseLine(line: string): string[] {
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

async function withRetry(fn: () => Promise<any>): Promise<any> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (e?.status === 429) {
        const wait = 3000 * (attempt + 1);
        console.log(`Rate limited, waiting ${wait}ms...`);
        await sleep(wait);
      } else throw e;
    }
  }
}

// Load progress
let progress: { importKeyToId: Record<string, string>; contactsStarted: boolean } = { importKeyToId: {}, contactsStarted: false };
if (fs.existsSync(PROGRESS_FILE)) {
  progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  console.log(`Resuming: ${Object.keys(progress.importKeyToId).length} targets already imported.`);
}

const saveProgress = () => fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));

// ── Phase 1: Import Targets ───────────────────────────────────────────────────
if (!progress.contactsStarted) {
  console.log("Reading targets...");
  const targetRows = await readCsv(TARGETS_CSV);
  console.log(`${targetRows.length} targets total, ${Object.keys(progress.importKeyToId).length} already done.`);

  let created = 0;
  for (const row of targetRows) {
    if (progress.importKeyToId[row.import_key]) continue;

    const data: Record<string, any> = {
      street:                 row.street || undefined,
      city:                   row.city || undefined,
      state:                  row.state || undefined,
      zip:                    row.zip || undefined,
      lat:                    row.lat ? parseFloat(row.lat) : undefined,
      lng:                    row.lng ? parseFloat(row.lng) : undefined,
      business_name:          row.business_name || undefined,
      building_type:          row.building_type || undefined,
      property_type:          row.property_type || undefined,
      year_built:             row.year_built || undefined,
      roof_type:              row.roof_types || undefined,
      roof_size_sq:           row.roof_size_sq ? parseFloat(row.roof_size_sq) : undefined,
      building_sqft:          row.building_sqft ? parseFloat(row.building_sqft) : undefined,
      stories:                row.stories ? parseFloat(row.stories) : undefined,
      hail_score_tier:        row.hail_score_tier || undefined,
      hail_score_value:       row.hail_score_value ? parseFloat(row.hail_score_value) : undefined,
      largest_hail_inches:    row.largest_hail_inches ? parseFloat(row.largest_hail_inches) : undefined,
      largest_hail_date:      row.largest_hail_date || undefined,
      most_recent_event_date: row.most_recent_event_date || undefined,
      total_events_10yr:      row.total_events_10yr ? parseFloat(row.total_events_10yr) : undefined,
      data_sources:           row.data_sources ? row.data_sources.split("|") : undefined,
      pipeline:               "unassigned",
      status:                 "new",
    };

    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

    const record = await withRetry(() => base44.entities.Target.create(data));
    progress.importKeyToId[row.import_key] = record.id;
    created++;
    await sleep(50);

    if (created % 100 === 0) {
      saveProgress();
      console.log(`Targets: ${created} new / ${Object.keys(progress.importKeyToId).length} total`);
    }
  }

  saveProgress();
  console.log(`✓ Targets done. ${Object.keys(progress.importKeyToId).length} total in DB.`);
  progress.contactsStarted = true;
  saveProgress();
}

// ── Phase 2: Import Contacts ──────────────────────────────────────────────────
console.log("Reading contacts...");
const contactRows = await readCsv(CONTACTS_CSV);
console.log(`${contactRows.length} contacts to import.`);

let cCreated = 0, cSkipped = 0;

for (const row of contactRows) {
  const targetId = progress.importKeyToId[row.import_key];
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

  await withRetry(() => base44.entities.Contact.create(data));
  cCreated++;
  await sleep(50);

  if (cCreated % 500 === 0) {
    console.log(`Contacts: ${cCreated} / ${contactRows.length} (skipped: ${cSkipped})`);
  }
}

console.log(`✓ Done. ${Object.keys(progress.importKeyToId).length} targets, ${cCreated} contacts imported.`);
