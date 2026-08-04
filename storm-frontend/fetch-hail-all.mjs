/**
 * Pull 5-year hail history for every target that has coordinates.
 * Calls IHM directly — no IP restrictions, runs from your local machine.
 * Writes hail_history, hail_size, hail_date back to Base44 (open RLS, no login needed).
 *
 * Usage:
 *   node fetch-hail-all.mjs          # fetch all targets with coords not yet fetched
 *   node fetch-hail-all.mjs --force  # re-fetch even already-fetched targets
 *
 * Set IHM_API_KEY and IHM_API_SECRET in .env.
 */

import { createClient } from '@base44/sdk'
import { readFileSync } from 'fs'

const FORCE = process.argv.includes('--force')
const CONC  = 5   // parallel IHM requests

function parseEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8').split('\n')
        .map(l => /^([A-Z0-9_]+)=(.+)$/.exec(l.trim()))
        .filter(Boolean)
        .map(m => [m[1], m[2].trim()])
    )
  } catch { return {} }
}

const env = parseEnv('.env')
const IHM_KEY    = process.env.IHM_API_KEY    ?? env.IHM_API_KEY
const IHM_SECRET = process.env.IHM_API_SECRET ?? env.IHM_API_SECRET

if (!IHM_KEY || !IHM_SECRET) {
  console.error('Add IHM_API_KEY and IHM_API_SECRET to .env')
  process.exit(1)
}

const IHM_AUTH = 'Basic ' + Buffer.from(`${IHM_KEY}:${IHM_SECRET}`).toString('base64')
const MONTHS   = 60  // 5 years
const APP_ID   = '6a63d2fd81d77a46ed96593f'
const base44   = createClient({ appId: APP_ID })

// ── Load all targets ──────────────────────────────────────────────

async function loadAllTargets() {
  const PAGE = 500
  let skip = 0
  const all = []
  process.stdout.write('Loading targets')
  while (true) {
    const page = await base44.entities.Target.filter({}, undefined, PAGE, skip)
    all.push(...page)
    process.stdout.write('.')
    if (page.length < PAGE) break
    skip += PAGE
  }
  console.log(` ${all.length.toLocaleString()} total`)
  return all
}

// ── Fetch hail history for one location ──────────────────────────

async function fetchHailHistory(lat, lng) {
  const url = `https://maps.interactivehailmaps.com/ExternalApi/ImpactDatesForLatLong?Lat=${lat}&Long=${lng}&Months=${MONTHS}`
  const res = await fetch(url, {
    headers: { Authorization: IHM_AUTH },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`IHM ${res.status}`)

  const data = await res.json()
  const raw = Array.isArray(data)
    ? data
    : (data.ImpactDates ?? data.impactDates ?? data.results ?? data.data ?? [])

  return raw
    .map(e => ({
      date: (e.ImpactDate ?? e.impact_date ?? e.date ?? '').slice(0, 10),
      size: Number(e.MaxSize ?? e.max_size ?? e.HailSize ?? e.hail_size ?? e.size ?? 0),
    }))
    .filter(e => e.date && e.size > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('\n Hail History Backfill — 5 years via IHM')
  if (FORCE) console.log('   --force: re-fetching already-fetched targets')
  console.log()

  const all = await loadAllTargets()
  const workList = all.filter(t => t.lat && t.lng && (FORCE || !t.hail_history_fetched_at))
  const noCoords = all.filter(t => !t.lat || !t.lng).length

  console.log(`${all.length.toLocaleString()} targets total`)
  console.log(`  ${noCoords.toLocaleString()} have no coordinates — skipping (run geocode-all.mjs first)`)
  console.log(`  ${(all.length - workList.length - noCoords).toLocaleString()} already fetched — skipping`)
  console.log(`  ${workList.length.toLocaleString()} to fetch now`)
  if (workList.length === 0) { console.log('\nNothing to do.'); return }
  console.log()

  let updated = 0, noEvents = 0, errors = 0, done = 0
  const start = Date.now()

  for (let i = 0; i < workList.length; i += CONC) {
    const batch = workList.slice(i, i + CONC)
    await Promise.allSettled(batch.map(async target => {
      try {
        const history = await fetchHailHistory(target.lat, target.lng)
        const patch = {
          hail_history: history,
          hail_history_fetched_at: new Date().toISOString(),
        }
        if (history.length > 0) {
          patch.hail_size = history[0].size
          patch.hail_date = new Date(history[0].date).toISOString()
        }
        await base44.entities.Target.update(target.id, patch)
        if (history.length === 0) noEvents++
        else updated++
      } catch {
        errors++
      } finally {
        done++
        const elapsed = (Date.now() - start) / 1000
        const rate = done / elapsed
        const eta = rate > 0 ? Math.round((workList.length - done) / rate) : 0
        const pct = Math.round((done / workList.length) * 100)
        process.stdout.write(
          `\r  [${String(pct).padStart(3)}%] ${done}/${workList.length}  ` +
          `updated:${updated}  no-events:${noEvents}  err:${errors}  ` +
          `ETA ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s   `
        )
      }
    }))
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0)
  console.log(`\n\nDone in ${elapsed}s`)
  console.log(`  ${updated.toLocaleString()} updated with hail history`)
  console.log(`  ${noEvents.toLocaleString()} had no hail events in 5 years`)
  console.log(`  ${errors.toLocaleString()} errors`)
  if (errors > 0) console.log('\n  Re-run to retry errors — already-fetched targets are skipped.')
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1) })
