/**
 * Import targets + lists from old-data-clean.json into the new app.
 * Run via:
 *   NEW_TOKEN=<token> node import-old-data.mjs
 */

import { createClient } from '@base44/sdk'
import { readFileSync } from 'fs'

const NEW_APP_ID = '6a63d2fd81d77a46ed96593f'
const NEW_TOKEN  = process.env.NEW_TOKEN

if (!NEW_TOKEN) { console.error('Missing NEW_TOKEN env var'); process.exit(1) }

const newApp = createClient({ appId: NEW_APP_ID, token: NEW_TOKEN })

const { targets, lists } = JSON.parse(readFileSync('./old-data-clean.json', 'utf8'))
console.log(`Loaded ${targets.length} targets and ${lists.length} storm lists`)

const delay = ms => new Promise(r => setTimeout(r, ms))

// Adaptive delay — starts at 300ms, backs off on rate limits
let currentDelay = 300

async function createWithRetry(fn) {
  let retries = 0
  while (true) {
    try {
      const result = await fn()
      // Slowly recover delay after success
      if (currentDelay > 300) currentDelay = Math.max(300, currentDelay - 50)
      return result
    } catch (e) {
      if (!e.message?.includes('429') && !e.message?.includes('Rate limit')) throw e
      if (retries++ >= 6) throw e
      // On rate limit: back off globally and wait longer
      currentDelay = Math.min(currentDelay * 1.5, 3000)
      const wait = 15000 * retries
      process.stdout.write(`\r  [429] waiting ${(wait/1000).toFixed(0)}s (delay now ${currentDelay.toFixed(0)}ms)...    `)
      await delay(wait)
    }
  }
}

// ── Step 1: Reuse existing CallLists (already created), build ID map ───────
console.log('\n[1/2] Fetching existing CallLists...')
const existingLists = await newApp.entities.CallList.filter({}, undefined, 200)
console.log(`  Found ${existingLists.length} existing lists`)

// Name → new ID (last one wins for duplicates)
const nameToNewId = new Map(existingLists.map(l => [l.name, l.id]))

const listIdMap = new Map()
for (const l of lists) {
  if (nameToNewId.has(l.name)) {
    listIdMap.set(l.id, nameToNewId.get(l.name))
  } else {
    // Create only if missing
    const created = await createWithRetry(() =>
      newApp.entities.CallList.create({ name: l.name, list_status: 'not_started' })
    )
    listIdMap.set(l.id, created.id)
    nameToNewId.set(l.name, created.id)
    console.log(`  Created missing list: "${l.name}"`)
    await delay(150)
  }
}

// Fallback list for targets with no storm_list_id
const noListTargets = targets.filter(t => !t.storm_list_id)
let fallbackListId = nameToNewId.get('Imported – No List') ?? null
if (!fallbackListId && noListTargets.length > 0) {
  const fb = await newApp.entities.CallList.create({ name: 'Imported – No List', list_status: 'not_started' })
  fallbackListId = fb.id
  console.log(`  Created fallback list for ${noListTargets.length} unassigned targets`)
}

console.log(`  ${listIdMap.size} storm lists mapped`)

// ── Step 2: Import targets ─────────────────────────────────────────────────
console.log('\n[2/2] Importing targets...')
let imported = 0, skipped = 0

function toIsoDateTime(d) {
  if (!d) return null
  if (d.includes('T')) return d
  return `${d}T00:00:00.000Z`
}

for (const t of targets) {
  const list_id = t.storm_list_id
    ? (listIdMap.get(t.storm_list_id) ?? fallbackListId)
    : fallbackListId

  if (!list_id) { skipped++; continue }

  const city  = (t.city  ?? '').trim()
  const state = (t.state ?? '').trim()
  const zip   = (t.zip   ?? '').trim()
  const line2Parts = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean)
  const line2 = line2Parts.join(', ') || null

  await createWithRetry(() =>
    newApp.entities.Target.create({
      list_id,
      line1:            t.property_address || '(unknown address)',
      line2,
      lat:              t.lat   ?? null,
      lng:              t.lng   ?? null,
      hail_size:        t.hail_size ?? null,
      hail_date:        toIsoDateTime(t.hail_date),
      property_type:    t.property_type  ?? null,
      property_subtype: t.building_type  ?? null,
      square_footage:   t.building_area  ?? null,
      year_built:       t.year_built ? String(t.year_built) : null,
      notes:            t.notes ?? null,
      contacts:         [],
      status:           'new',
    })
  )

  imported++
  if (imported % 100 === 0) {
    const pct = ((imported / targets.length) * 100).toFixed(1)
    process.stdout.write(`\r  ${imported}/${targets.length} (${pct}%) — delay: ${currentDelay.toFixed(0)}ms      `)
  }

  await delay(currentDelay)
}

console.log(`\n\nDone!`)
console.log(`  Imported: ${imported} targets`)
console.log(`  Skipped:  ${skipped} targets`)
