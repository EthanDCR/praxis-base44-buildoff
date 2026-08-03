/**
 * Delete all targets that were imported from the old app.
 * Identifies them by matching list names from old-data-clean.json.
 *
 * Run via:
 *   NEW_TOKEN=<token> node delete-imported-targets.mjs
 */

import { createClient } from '@base44/sdk'
import { readFileSync } from 'fs'

const NEW_APP_ID = '6a63d2fd81d77a46ed96593f'
const NEW_TOKEN = process.env.NEW_TOKEN
if (!NEW_TOKEN) { console.error('Missing NEW_TOKEN env var'); process.exit(1) }

const app = createClient({ appId: NEW_APP_ID, token: NEW_TOKEN })

const delay = ms => new Promise(r => setTimeout(r, ms))

async function deleteWithRetry(id) {
  let retries = 0
  while (true) {
    try {
      await app.entities.Target.delete(id)
      return
    } catch (e) {
      if (!e.message?.includes('429') && !e.message?.includes('Rate limit')) throw e
      if (retries++ >= 5) throw e
      await delay(10000 * retries)
    }
  }
}

// Identify imported lists by name
const { lists } = JSON.parse(readFileSync('./old-data-clean.json', 'utf8'))
const importedNames = new Set([...lists.map(l => l.name), 'Imported – No List'])
console.log(`Looking for ${importedNames.size} imported list names...`)

const allLists = await app.entities.CallList.list()
const importedLists = allLists.filter(l => importedNames.has(l.name))
const importedListIds = new Set(importedLists.map(l => l.id))
console.log(`Matched ${importedLists.length} lists in the new app`)

if (importedLists.length === 0) {
  console.log('No matching lists found — nothing to delete.')
  process.exit(0)
}

// Scan all targets and collect those in imported lists
console.log('\nScanning targets...')
const PAGE = 500
let skip = 0
const toDelete = []
while (true) {
  const page = await app.entities.Target.filter({}, undefined, PAGE, skip)
  toDelete.push(...page.filter(t => importedListIds.has(t.list_id)))
  process.stdout.write(`\r  Scanned ${skip + page.length} — found ${toDelete.length} to delete...`)
  if (page.length < PAGE) break
  skip += PAGE
}

console.log(`\n\nDeleting ${toDelete.length} targets...`)

let deleted = 0
for (const t of toDelete) {
  await deleteWithRetry(t.id)
  deleted++
  if (deleted % 100 === 0) {
    process.stdout.write(`\r  ${deleted}/${toDelete.length} (${((deleted / toDelete.length) * 100).toFixed(1)}%)`)
  }
  await delay(150)
}

console.log(`\n\nDone! Deleted ${deleted} targets.`)
console.log('The imported lists are still in place — delete them manually if needed.')
