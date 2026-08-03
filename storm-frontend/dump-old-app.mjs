/**
 * Dump targets + storm lists from the old app.
 * Run via:
 *   npx base44 exec --app-id 68f06c2e48bd0698045595b0 < dump-old-app.mjs > old-data.json
 *
 * Progress lines go to stderr so they don't pollute the JSON output.
 */

const BATCH = 500

process.stderr.write('Fetching storm lists...\n')
const allLists = await base44.entities.StormList.filter({}, undefined, 500)
const activeLists = allLists.filter(l => !l.is_deleted)
process.stderr.write(`  ${activeLists.length} active storm lists found\n`)

process.stderr.write('Fetching targets (this will take a minute)...\n')
let skip = 0
const targets = []
while (true) {
  const batch = await base44.entities.Target.filter({}, undefined, BATCH, skip)
  const usable = batch.filter(t => !t.is_deleted && !t.is_archived)
  targets.push(...usable.map(t => ({
    id:               t.id,
    property_address: t.property_address,
    city:             t.city,
    state:            t.state,
    zip:              t.zip,
    lat:              t.latitude,
    lng:              t.longitude,
    hail_size:        t.hail_size,
    hail_date:        t.hail_date,
    property_type:    t.property_type,
    building_type:    t.building_type,
    building_area:    t.building_area,
    year_built:       t.year_built,
    notes:            t.notes,
    storm_list_id:    t.storm_list_id,
  })))
  process.stderr.write(`  Page ${Math.floor(skip / BATCH) + 1}: ${batch.length} records, ${usable.length} usable — total so far: ${targets.length}\n`)
  if (batch.length < BATCH) break
  skip += BATCH
}

process.stderr.write(`\nDump complete: ${targets.length} targets, ${activeLists.length} lists\n`)

console.log(JSON.stringify({
  targets,
  lists: activeLists.map(l => ({ id: l.id, name: l.list_name })),
}, null, 2))
