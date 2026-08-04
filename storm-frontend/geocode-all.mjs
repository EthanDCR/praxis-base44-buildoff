/**
 * Geocode every target missing lat/lng using geocode.maps.co.
 * Free tier: 25,000 req/month at 5 req/sec.
 * Writes lat + lng back to each target in Base44 (open RLS, no auth needed).
 *
 * Usage:
 *   node geocode-all.mjs            # geocode all missing
 *   node geocode-all.mjs --dry-run  # count only, no writes
 */

import { createClient } from '@base44/sdk'

const DRY_RUN = process.argv.includes('--dry-run')

const GEO_KEY = '6a715e188444a732330082oaz8bde4d'
const APP_ID  = '6a63d2fd81d77a46ed96593f'
const RPS     = 5    // geocode.maps.co free plan: 5 req/sec
const DELAY   = Math.ceil(1000 / RPS)  // ms between requests

const base44 = createClient({ appId: APP_ID })

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

// ── Base44 write with retry on 429 ───────────────────────────────

async function saveCoords(id, coords) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await base44.entities.Target.update(id, coords)
      return
    } catch (err) {
      const is429 = err?.response?.status === 429 || String(err).includes('429') || String(err?.message).includes('Rate limit')
      if (!is429 || attempt === 5) throw err
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
    }
  }
}

// ── Geocode one address ───────────────────────────────────────────

async function geocode(line1, line2) {
  const q = encodeURIComponent([line1, line2].filter(Boolean).join(', '))
  const url = `https://geocode.maps.co/search?q=${q}&api_key=${GEO_KEY}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) return null
  // take highest-importance result (first)
  const best = data[0]
  const lat = parseFloat(best.lat)
  const lon = parseFloat(best.lon)  // geocode.maps.co uses `lon` not `lng`
  if (isNaN(lat) || isNaN(lon)) return null
  return { lat, lng: lon }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('\n Geocoding Missing Coordinates — geocode.maps.co')
  if (DRY_RUN) console.log('   DRY RUN — no writes')
  console.log()

  const all = await loadAllTargets()
  const workList = all.filter(t => !t.lat || !t.lng)

  console.log(`${all.length.toLocaleString()} targets total`)
  console.log(`  ${(all.length - workList.length).toLocaleString()} already have coordinates — skipping`)
  console.log(`  ${workList.length.toLocaleString()} to geocode`)
  if (workList.length === 0) { console.log('\nNothing to do.'); return }

  const estMins = Math.ceil(workList.length / RPS / 60)
  console.log(`  Estimated time: ~${estMins} min at ${RPS} req/sec`)
  console.log()

  let ok = 0, noMatch = 0, errors = 0, done = 0
  const start = Date.now()

  for (const target of workList) {
    const before = Date.now()
    try {
      const coords = await geocode(target.line1, target.line2)
      if (!coords) {
        noMatch++
      } else {
        if (!DRY_RUN) await saveCoords(target.id, coords)
        ok++
      }
    } catch {
      errors++
    }

    done++
    const elapsed = (Date.now() - start) / 1000
    const rate = done / elapsed
    const eta = rate > 0 ? Math.round((workList.length - done) / rate) : 0
    const pct = Math.round((done / workList.length) * 100)
    process.stdout.write(
      `\r  [${String(pct).padStart(3)}%] ${done}/${workList.length}  ` +
      `ok:${ok}  no-match:${noMatch}  err:${errors}  ` +
      `ETA ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s   `
    )

    // Respect the 5 req/sec rate limit
    const took = Date.now() - before
    if (took < DELAY) await new Promise(r => setTimeout(r, DELAY - took))
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0)
  console.log(`\n\nDone in ${elapsed}s`)
  console.log(`  ${ok.toLocaleString()} geocoded`)
  console.log(`  ${noMatch.toLocaleString()} no match`)
  console.log(`  ${errors.toLocaleString()} errors`)
  if (errors > 0 || noMatch > 0) {
    console.log('\n  Re-run to retry — targets that already have coords are skipped.')
  }
  console.log('\nNext: node fetch-hail-all.mjs')
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1) })
