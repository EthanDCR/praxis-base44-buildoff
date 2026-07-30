/**
 * Base44 → Supabase one-time migration script
 * Run from the storm-frontend directory:
 *
 *   BASE44_TOKEN=<your-token> SUPABASE_SERVICE_KEY=<service-role-key> node migrate.mjs
 *
 * Get BASE44_TOKEN: open storm-ed96593f.base44.app in browser, devtools console:
 *   for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i),v=localStorage.getItem(k);if(v&&v.includes('access_token')){try{console.log('TOKEN:',JSON.parse(v).access_token)}catch{}}}
 *
 * Get SUPABASE_SERVICE_KEY: Supabase dashboard → Settings → API → service_role key
 */

import { createClient } from '@base44/sdk'
import { randomUUID } from 'crypto'

const BASE44_APP_ID      = '6a63d2fd81d77a46ed96593f'
const BASE44_TOKEN       = process.env.BASE44_TOKEN
const SUPABASE_URL       = 'https://bqyfairryyhkphiyxqqq.supabase.co'
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY

if (!BASE44_TOKEN)  { console.error('Missing BASE44_TOKEN env var');       process.exit(1) }
if (!SUPABASE_KEY)  { console.error('Missing SUPABASE_SERVICE_KEY env var'); process.exit(1) }

const base44 = createClient({ appId: BASE44_APP_ID, token: BASE44_TOKEN })

async function sbInsert(table, rows) {
  if (rows.length === 0) return
  // Insert in batches of 200 to stay within Supabase payload limits
  const BATCH = 200
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(chunk),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Insert to ${table} failed: ${res.status} ${text}`)
    }
  }
}

async function fetchAll(entity) {
  const LIMIT = 500
  let skip = 0
  let all = []
  while (true) {
    const batch = await base44.entities[entity].filter({}, undefined, LIMIT, skip)
    all = all.concat(batch)
    if (batch.length < LIMIT) break
    skip += LIMIT
    console.log(`  fetched ${all.length} so far...`)
  }
  return all
}

async function main() {
  // ── 1. call_lists ───────────────────────────────────────────────────────────
  console.log('\n[1/3] Fetching call_lists from Base44...')
  const lists = await fetchAll('CallList')
  console.log(`  Found ${lists.length} lists`)

  const listIdMap = new Map() // base44 id → new UUID
  const listRows = lists.map(l => {
    const newId = randomUUID()
    listIdMap.set(l.id, newId)
    return {
      id:          newId,
      name:        l.name,
      list_status: l.list_status ?? 'not_started',
      created_at:  l.created_date ?? new Date().toISOString(),
    }
  })

  await sbInsert('call_lists', listRows)
  console.log(`  Inserted ${listRows.length} call_lists ✓`)

  // ── 2. targets ──────────────────────────────────────────────────────────────
  console.log('\n[2/3] Fetching targets from Base44...')
  const targets = await fetchAll('Target')
  console.log(`  Found ${targets.length} targets`)

  const targetRows = targets.map(t => ({
    id:               randomUUID(),
    list_id:          t.list_id ? (listIdMap.get(t.list_id) ?? null) : null,
    line1:            t.line1,
    line2:            t.line2            ?? null,
    lat:              t.lat              ?? null,
    lng:              t.lng              ?? null,
    hail_size:        t.hail_size        ?? null,
    hail_date:        t.hail_date        ?? null,
    property_type:    t.property_type    ?? null,
    property_subtype: t.property_subtype ?? null,
    year_built:       t.year_built       ?? null,
    contacts:         t.contacts         ?? [],
    status:           t.status           ?? 'new',
    phone_qualities:  t.phone_qualities  ?? {},
    damage_signal:    t.damage_signal    ?? null,
    notes:            t.notes            ?? null,
    created_at:       t.created_date     ?? new Date().toISOString(),
  }))

  await sbInsert('targets', targetRows)
  console.log(`  Inserted ${targetRows.length} targets ✓`)

  // ── 3. hail_swaths ──────────────────────────────────────────────────────────
  console.log('\n[3/3] Fetching hail_swaths from Base44...')
  const swaths = await fetchAll('HailSwath')
  console.log(`  Found ${swaths.length} hail swaths`)

  const swathRows = swaths.map(s => {
    let geometry = s.geometry
    if (typeof geometry === 'string') {
      try { geometry = JSON.parse(geometry) } catch { geometry = null }
    }
    return {
      id:              randomUUID(),
      event_date:      s.event_date      ?? null,
      min_size_inches: s.min_size_inches ?? null,
      geometry,
      created_at:      s.created_date    ?? new Date().toISOString(),
    }
  })

  await sbInsert('hail_swaths', swathRows)
  console.log(`  Inserted ${swathRows.length} hail swaths ✓`)

  console.log('\n✓ Migration complete!')
  console.log(`  call_lists:  ${listRows.length}`)
  console.log(`  targets:     ${targetRows.length}`)
  console.log(`  hail_swaths: ${swathRows.length}`)
}

main().catch(err => { console.error('\nMigration failed:', err.message); process.exit(1) })
