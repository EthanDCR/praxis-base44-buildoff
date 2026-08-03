/**
 * Import targets from testCsvs/ into the new app.
 * Each CSV file becomes its own CallList.
 * Captures full phone metadata: bad_number, dnc, reachable, tcpa, rating, notes.
 *
 * Run via:
 *   NEW_TOKEN=<token> node import-csv.mjs
 */

import { createClient } from '@base44/sdk'
import { readFileSync, readdirSync } from 'fs'
import { join, basename } from 'path'

const NEW_APP_ID = '6a63d2fd81d77a46ed96593f'
const NEW_TOKEN = process.env.NEW_TOKEN
if (!NEW_TOKEN) { console.error('Missing NEW_TOKEN env var'); process.exit(1) }

const CSV_DIR = '../testCsvs'
const app = createClient({ appId: NEW_APP_ID, token: NEW_TOKEN })
const delay = ms => new Promise(r => setTimeout(r, ms))
let currentDelay = 300

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseRow(line) {
  const fields = []
  let field = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { field += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) {
      fields.push(field.trim()); field = ''
    } else {
      field += ch
    }
  }
  fields.push(field.trim())
  return fields
}

function parseCSV(content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  const headers = parseRow(lines[0])
  return lines.slice(1).map(line => {
    const vals = parseRow(line)
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseBool(val) {
  if (typeof val === 'boolean') return val
  const v = (val ?? '').toString().trim().toLowerCase()
  return v === 'true' || v === 'yes' || v === '1' ? true : v === 'false' || v === 'no' || v === '0' ? false : null
}

function toIso(dateStr) {
  if (!dateStr?.trim()) return null
  const d = new Date(dateStr.trim())
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function mapStatus(csvStatus, isOverwatch) {
  if (parseBool(isOverwatch)) return 'overwatch'
  const s = (csvStatus ?? '').toLowerCase().trim()
  if (s === 'callback')                              return 'callback'
  if (s === 'called' || s === 'no_answer')           return 'called'
  if (s === 'not_interested' || s === 'do_not_call') return 'not_interested'
  if (s === 'sold' || s === 'inspection_set' || s === 'lead_set') return 'sold'
  if (s === 'overwatch')                             return 'overwatch'
  if (s === 'crm_sent')                              return 'crm_sent'
  return 'new'
}

function ratingToQuality(rating, badNumber) {
  if (parseBool(badNumber)) return 'bad'
  const r = (rating ?? '').toLowerCase().trim()
  if (r === 'good' || r === 'excellent' || r === 'high') return 'good'
  if (r === 'bad' || r === 'poor' || r === 'low')        return 'bad'
  if (r === 'average' || r === 'medium' || r === 'unsure' || r === 'fair') return 'unsure'
  return null
}

function extractContacts(row) {
  const contacts = []
  for (let o = 1; o <= 17; o++) {
    const name = row[`O${o}_Name`]?.trim()
    if (!name) continue

    const phones = []
    for (let p = 1; p <= 13; p++) {
      const num = row[`O${o}_P${p}_Number`]?.trim()
      if (!num) continue
      phones.push({
        number:     num,
        type:       row[`O${o}_P${p}_Type`]?.trim()   || null,
        rating:     row[`O${o}_P${p}_Rating`]?.trim()  || null,
        source:     row[`O${o}_P${p}_Source`]?.trim()  || null,
        bad_number: parseBool(row[`O${o}_P${p}_Bad_Number`]),
        dnc:        parseBool(row[`O${o}_P${p}_DNC`]),
        reachable:  parseBool(row[`O${o}_P${p}_Reachable`]),
        tcpa:       parseBool(row[`O${o}_P${p}_TCPA`]),
        notes:      row[`O${o}_P${p}_Notes`]?.trim()  || null,
      })
    }

    // Personal phone at front if not already listed
    const personal = row[`O${o}_Personal_Phone`]?.trim()
    if (personal && !phones.find(p => p.number === personal)) {
      phones.unshift({ number: personal, type: 'personal', bad_number: null, dnc: null, reachable: null, tcpa: null, rating: null, source: null, notes: null })
    }

    const emails = []
    for (let e = 1; e <= 24; e++) {
      const email = row[`O${o}_E${e}_Email`]?.trim()
      if (email) emails.push(email)
    }
    const personalEmail = row[`O${o}_Personal_Email`]?.trim()
    if (personalEmail && !emails.includes(personalEmail)) emails.unshift(personalEmail)

    contacts.push({
      name,
      title:   row[`O${o}_Role`]?.trim()    || null,
      company: row[`O${o}_Company`]?.trim() || null,
      phones,
      emails,
    })
  }
  return contacts
}

// Build phone_qualities map for the target (pre-populates quality indicators)
function buildPhoneQualities(contacts) {
  const q = {}
  contacts.forEach((c, ci) => {
    c.phones.forEach((p, pi) => {
      const quality = ratingToQuality(p.rating, p.bad_number)
      if (quality) q[`${ci}_${pi}`] = quality
    })
  })
  return Object.keys(q).length > 0 ? q : null
}

// ── Rate-limit-aware create ───────────────────────────────────────────────────
async function createWithRetry(fn) {
  let retries = 0
  while (true) {
    try {
      const result = await fn()
      if (currentDelay > 300) currentDelay = Math.max(300, currentDelay - 20)
      return result
    } catch (e) {
      const msg = e.message ?? ''
      const isTransient = msg.includes('429') || msg.includes('Rate limit') ||
                          msg.includes('502') || msg.includes('503') ||
                          msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')
      if (!isTransient || retries++ >= 8) throw e
      currentDelay = Math.min(currentDelay * 1.5, 3000)
      const wait = 10000 * retries
      process.stdout.write(`\r  [${msg.includes('429') ? '429' : 'err'}] waiting ${wait / 1000}s (delay → ${currentDelay.toFixed(0)}ms)...    `)
      await delay(wait)
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
// Skip lists that were already fully imported in a prior run
const SKIP_LISTS = new Set([
  '3-10-26 - OKC',
  'AR 4_28_26',
  'MO 4-28-26',
])

const csvFiles = readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'))
console.log(`Found ${csvFiles.length} CSV files in ${CSV_DIR}`)

// Fetch existing lists so we can reuse any that were partially created
console.log('Fetching existing CallLists...')
const existingLists = await app.entities.CallList.list()
const existingByName = new Map(existingLists.map(l => [l.name, l.id]))

let grandTotal = 0

for (const file of csvFiles) {
  const listName = basename(file, '.csv')
  if (SKIP_LISTS.has(listName)) {
    console.log(`\nSkipping "${listName}" (already imported)`)
    continue
  }
  const rows = parseCSV(readFileSync(join(CSV_DIR, file), 'utf8'))
  console.log(`\n── ${file} (${rows.length} rows) → list: "${listName}"`)

  let listId = existingByName.get(listName)
  let resumeOffset = 0
  if (listId) {
    // Count how many targets already exist so we can resume from that row
    let countSkip = 0, existingCount = 0
    while (true) {
      const page = await app.entities.Target.filter({ list_id: listId }, undefined, 500, countSkip)
      existingCount += page.length
      if (page.length < 500) break
      countSkip += 500
    }
    if (existingCount > 0) {
      console.log(`  Resuming from row ${existingCount} (${existingCount} already imported)`)
      resumeOffset = existingCount
    } else {
      console.log(`  Existing list is empty, importing fresh`)
    }
  } else {
    const list = await createWithRetry(() =>
      app.entities.CallList.create({ name: listName, list_status: 'not_started' })
    )
    listId = list.id
    await delay(200)
  }

  const rowsToImport = rows.slice(resumeOffset)
  if (resumeOffset > 0) console.log(`  Skipping ${resumeOffset} already-imported rows`)
  let imported = resumeOffset
  for (const row of rowsToImport) {
    const city  = row['City']?.trim()  ?? ''
    const state = row['State']?.trim() ?? ''
    const zip   = row['Zip']?.trim()   ?? ''
    const lineParts = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean)
    const contacts = extractContacts(row)
    const phone_qualities = buildPhoneQualities(contacts)

    // Merge Notes + Description
    const notesBase = row['Notes']?.trim() || ''
    const desc      = row['Description']?.trim() || ''
    const mergedNotes = [notesBase, desc].filter(Boolean).join('\n\n') || null

    // Additional storm dates — split comma-separated dates into array
    const addlStorm = row['Additional Storm Dates']?.trim()
    const additional_storm_dates = addlStorm
      ? addlStorm.split(',').map(d => d.trim()).filter(Boolean)
      : null

    // Business Name: fallback contact if no owners found
    const bizName = row['Business Name']?.trim() || null
    if (bizName && contacts.length === 0) {
      contacts.push({ name: bizName, company: bizName, title: null, phones: [], emails: [] })
    }

    await createWithRetry(() =>
      app.entities.Target.create({
        list_id:          listId,
        line1:            row['Street']?.trim() || '(unknown address)',
        line2:            lineParts.join(', ') || null,
        hail_date:        toIso(row['Hail Date']),
        hail_size:        row['Hail Size (in)']?.trim() ? parseFloat(row['Hail Size (in)']) : null,
        ...(additional_storm_dates ? { additional_storm_dates } : {}),
        property_type:    row['Property Type']?.trim()        || null,
        property_subtype: row['Building Type']?.trim()        || null,
        square_footage:   row['Building Area (sqft)']?.trim() ? parseInt(row['Building Area (sqft)']) : null,
        year_built:       row['Year Built']?.trim()           || null,
        roof_material:    row['Roof Types']?.trim()           || null,
        notes:            mergedNotes,
        status:           mapStatus(row['Status'], row['Is Overwatch']),
        contacts,
        ...(phone_qualities ? { phone_qualities } : {}),
      })
    )

    imported++
    if (imported % 100 === 0) {
      process.stdout.write(`\r  ${imported}/${rows.length} (${((imported / rows.length) * 100).toFixed(1)}%) — delay: ${currentDelay.toFixed(0)}ms      `)
    }

    await delay(currentDelay)
  }

  console.log(`\n  Done: ${imported} targets`)
  grandTotal += imported
}

console.log(`\n\nAll done! ${grandTotal} targets across ${csvFiles.length} lists.`)
