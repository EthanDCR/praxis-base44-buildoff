import { createClient } from '@base44/sdk'

const OLD_APP_ID  = '68f06c2e48bd0698045595b0'
const OUTER_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjbGludGV0aC5kZXZAZ21haWwuY29tIiwiZXhwIjoxNzkzMjEyMjk1LCJpYXQiOjE3ODU0MzYyOTUsInNzb193b3Jrc3BhY2VzIjpbXSwiYXBwX3VzZXJfYXV0aF9wcm9vZiI6IjU4MmJjYjI2OGRkY2ZhOTRhZDQ1MzBmYmYzM2JiMjc3YzA5YmU2NjYxZWQ3YjU3YzRjYTA5ZDgyYjM2OTU1OGEiLCJhcHBfdXNlcl9qd3RfdjIiOiJleUpoYkdjaU9pSklVekkxTmlJc0luUjVjQ0k2SWtwWFZDSjkuZXlKemRXSWlPaUpqYkdsdWRHVjBhQzVrWlhaQVoyMWhhV3d1WTI5dElpd2laWGh3SWpveE56a3pNakV5TWprMUxDSnBZWFFpT2pFM09EVTBNell5T1RVc0luTnpiMTkzYjNKcmMzQmhZMlZ6SWpwYlhTd2lZWEJ3WDNWelpYSmZZWFYwYUY5d2NtOXZaaUk2SWpVNE1tSmpZakkyT0dSa1kyWmhPVFJoWkRRMU16Qm1ZbVl6TTJKaU1qYzNZekE1WW1VMk5qWXhaV1EzWWpVM1l6UmpZVEE1WkRneVlqTTJPVFUxT0dFaWZRLnBmbzFtbHo0cnBTOFNIMTV5YWpKZGkyNDdKZzhtQkFGSFZOZlRDdXJQQ0kifQ.MBsWugLbVQVORGq_x_7eyScfdzravwE5tozRP4l9H44'

const payload     = JSON.parse(Buffer.from(OUTER_TOKEN.split('.')[1], 'base64').toString())
const INNER_TOKEN = payload.app_user_jwt_v2

// Try both the SDK approach and raw fetch with correct base URL
async function tryFetch(token, label) {
  const url = `https://base44.app/api/apps/${OLD_APP_ID}/entities/Target/query`
  const res  = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ filters: [], limit: 3, skip: 0 }),
  })
  console.log(`[${label}] ${res.status} ${res.statusText}`)
  const text = await res.text()
  try { console.log(JSON.stringify(JSON.parse(text)).slice(0, 600)) }
  catch { console.log(text.slice(0, 300)) }
}

async function trySdk(token, label) {
  try {
    const client = createClient({ appId: OLD_APP_ID, token })
    const rows   = await client.entities.Target.filter({}, undefined, 3)
    console.log(`\n[SDK ${label}] success — ${rows.length} rows`)
    console.log(JSON.stringify(rows[0], null, 2))
  } catch (e) {
    console.log(`\n[SDK ${label}] error: ${e.message}`)
  }
}

async function main() {
  console.log('=== Raw fetch — outer token ===')
  await tryFetch(OUTER_TOKEN, 'outer')
  console.log('\n=== Raw fetch — inner token ===')
  await tryFetch(INNER_TOKEN, 'inner')
  console.log('\n=== SDK — outer token ===')
  await trySdk(OUTER_TOKEN, 'outer')
  console.log('\n=== SDK — inner token ===')
  await trySdk(INNER_TOKEN, 'inner')
}

main().catch(err => { console.error('Failed:', err.message) })
