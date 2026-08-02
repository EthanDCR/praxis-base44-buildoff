/**
 * One-time migration: convert contacts.phones from string[] to {number, type}[]
 * Run from storm-frontend/:
 *   BASE44_TOKEN=<token> node fix-phones.mjs
 *
 * Get token from browser devtools on the app:
 *   for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i),v=localStorage.getItem(k);if(v&&v.includes('access_token')){try{console.log('TOKEN:',JSON.parse(v).access_token)}catch{}}}
 */

import { createClient } from '@base44/sdk'

const BASE44_APP_ID = '6a63d2fd81d77a46ed96593f'
const BASE44_TOKEN  = process.env.BASE44_TOKEN

if (!BASE44_TOKEN) { console.error('Missing BASE44_TOKEN env var'); process.exit(1) }

const base44 = createClient({ appId: BASE44_APP_ID, token: BASE44_TOKEN })

async function main() {
  console.log('Fetching all targets...')
  const targets = await base44.entities.Target.filter({}, undefined, 2000)
  console.log(`Found ${targets.length} targets`)

  let fixed = 0
  for (const t of targets) {
    if (!t.contacts?.length) continue

    const needsFix = t.contacts.some(c =>
      (c.phones ?? []).some(p => typeof p === 'string')
    )
    if (!needsFix) continue

    const updatedContacts = t.contacts.map(c => ({
      ...c,
      phones: (c.phones ?? []).map(p =>
        typeof p === 'string' ? { number: p, type: null } : p
      ),
    }))

    let retries = 0
    while (true) {
      try {
        await base44.entities.Target.update(t.id, { contacts: updatedContacts })
        break
      } catch (e) {
        if (retries++ >= 5) throw e
        const wait = 2000 * retries
        console.log(`  Rate limited, waiting ${wait}ms...`)
        await new Promise(r => setTimeout(r, wait))
      }
    }
    console.log(`  Fixed: ${t.line1}`)
    fixed++
    await new Promise(r => setTimeout(r, 400))
  }

  console.log(`\nDone. Fixed ${fixed} of ${targets.length} targets.`)
}

main().catch(err => { console.error('Failed:', err.message); process.exit(1) })
