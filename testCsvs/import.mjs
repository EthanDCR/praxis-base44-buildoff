import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ID = '6a63d2fd81d77a46ed96593f'
const BASE_URL = `https://base44.app/api/apps/${APP_ID}/entities`
const HEADERS = { 'Content-Type': 'application/json', 'X-App-Id': APP_ID }

const DIR = path.dirname(fileURLToPath(import.meta.url))

// ── RFC 4180 CSV parser ───────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = []
  let field = '', row = [], inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQ = false
      else field += ch
    } else {
      if (ch === '"') inQ = true
      else if (ch === ',') { row.push(field); field = '' }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        row.push(field); field = ''
        if (row.some(c => c !== '')) lines.push(row)
        row = []
      } else field += ch
    }
  }
  row.push(field)
  if (row.some(c => c !== '')) lines.push(row)
  if (lines.length === 0) return []
  const headers = lines[0]
  return lines.slice(1).map(r => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim() })
    return obj
  })
}

function v(row, key) { return (row[key] ?? '').trim() }

function extractContacts(row) {
  const contacts = []
  for (const prefix of ['contact', 'contact_2', 'contact_3']) {
    const name = v(row, `${prefix}_name`)
    if (!name) continue
    const phones = [v(row, `${prefix}_phone_1`), v(row, `${prefix}_phone_2`), v(row, `${prefix}_phone_3`)].filter(Boolean)
    const emails = [v(row, `${prefix}_email_1`), v(row, `${prefix}_email_2`), v(row, `${prefix}_email_3`)].filter(Boolean)
    contacts.push({ name, company: v(row, `${prefix}_company_name`), title: v(row, `${prefix}_title`), phones, emails })
  }
  return contacts
}

function addressParts(full) {
  const idx = full.indexOf(',')
  if (idx === -1) return { line1: full, line2: '' }
  return { line1: full.slice(0, idx).trim(), line2: full.slice(idx + 1).trim() }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function request(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: HEADERS,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`${method} ${path} → ${res.status}: ${txt.slice(0, 200)}`)
  }
  return res.json()
}

const get    = (path)       => request('GET', path)
const post   = (path, body) => request('POST', path, body)
const del    = (path, body) => request('DELETE', path, body)

// ── Cleanup: delete existing list + its targets ───────────────────────────────
async function cleanupExisting(listName) {
  const existing = await get(`/CallList?q=${encodeURIComponent(JSON.stringify({ name: listName }))}`)
  if (!existing || existing.length === 0) return
  for (const list of existing) {
    console.log(`   Removing existing list "${list.name}" (${list.id})`)
    await del(`/Target`, { list_id: list.id }).catch(() => {})
    await del(`/CallList/${list.id}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
// Optional: pass filenames as args to only import specific files
//   node import.mjs "MO 4-28-26.csv" "NC GSO 3-16-25.csv"
const onlyFiles = process.argv.slice(2)

const csvFiles = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.csv'))
  .filter(f => onlyFiles.length === 0 || onlyFiles.includes(f))

console.log(`Importing ${csvFiles.length} file(s)\n`)

for (const file of csvFiles) {
  const listName = path.basename(file, '.csv')
  console.log(`▶  ${listName}`)

  const text = fs.readFileSync(path.join(DIR, file), 'utf8')
  const rows = parseCSV(text)
  console.log(`   ${rows.length} rows`)

  await cleanupExisting(listName)

  const list = await post('/CallList', { name: listName })
  const listId = list.id
  console.log(`   CallList created: ${listId}`)

  const targets = rows
    .filter(row => v(row, 'address_full'))
    .map(row => {
      const { line1, line2 } = addressParts(v(row, 'address_full'))
      const contacts = extractContacts(row)
      return {
        list_id:          listId,
        line1,
        line2,
        property_type:    v(row, 'property_type')    || undefined,
        property_subtype: v(row, 'property_subtype') || undefined,
        year_built:       v(row, 'year_built')       || undefined,
        contacts:         contacts.length ? contacts : undefined,
        status:           'new',
      }
    })

  const result = await post('/Target/bulk', targets)
  const count = Array.isArray(result) ? result.length : result?.count ?? '?'
  console.log(`   ${count} targets created\n`)
}

console.log('Import complete.')
