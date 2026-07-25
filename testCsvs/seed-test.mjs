const APP_ID = '6a63d2fd81d77a46ed96593f'
const BASE_URL = `https://base44.app/api/apps/${APP_ID}/entities`
const HEADERS = { 'Content-Type': 'application/json', 'X-App-Id': APP_ID }

const TEST_PHONE = '(262) 366-7738'
const LIST_NAME = 'TEST'

async function req(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers: HEADERS,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

// Clean up existing TEST list
const existing = await req('GET', `/CallList?q=${encodeURIComponent(JSON.stringify({ name: LIST_NAME }))}`)
for (const list of existing ?? []) {
  await req('DELETE', `/Target`, { list_id: list.id }).catch(() => {})
  await req('DELETE', `/CallList/${list.id}`)
  console.log(`Removed existing "${LIST_NAME}" list`)
}

const list = await req('POST', '/CallList', { name: LIST_NAME })
console.log(`Created list: ${list.id}`)

const targets = [
  {
    list_id: list.id, line1: '4821 Commerce Dr', line2: 'Kansas City, MO 64120',
    property_type: 'Industrial', property_subtype: 'Warehouse', year_built: '1998',
    contacts: [{ name: 'Ethan Clinton', company: 'Test Co', title: 'Owner', phones: [TEST_PHONE], emails: ['ethan@test.com'] }],
    status: 'new',
  },
  {
    list_id: list.id, line1: '1130 W 47th St', line2: 'Kansas City, MO 64112',
    property_type: 'Retail', property_subtype: 'Strip Center', year_built: '2003',
    contacts: [
      { name: 'Jake Morrow', company: 'Morrow Properties', title: 'Property Manager', phones: [TEST_PHONE], emails: [] },
      { name: 'Sandra Morrow', company: 'Morrow Properties', title: 'Owner', phones: [TEST_PHONE], emails: ['sandra@test.com'] },
    ],
    status: 'new',
  },
  {
    list_id: list.id, line1: '2200 Grand Blvd', line2: 'Kansas City, MO 64108',
    property_type: 'Office', property_subtype: 'Medical Office', year_built: '1987',
    contacts: [{ name: 'Dr. Alan Patel', company: 'Patel Medical Group', title: 'Principal', phones: [TEST_PHONE, TEST_PHONE], emails: ['apatel@test.com'] }],
    status: 'new',
  },
  {
    list_id: list.id, line1: '8900 State Line Rd', line2: 'Leawood, KS 66206',
    property_type: 'Multifamily', property_subtype: 'Apartment Complex', year_built: '2012',
    contacts: [{ name: 'Tyler Nguyen', company: 'TN Capital Group', title: 'Managing Partner', phones: [TEST_PHONE], emails: [] }],
    status: 'new',
  },
  {
    list_id: list.id, line1: '350 E 9th St', line2: 'Kansas City, MO 64106',
    property_type: 'Industrial', property_subtype: 'Flex Space', year_built: '1975',
    contacts: [
      { name: 'Gloria Ramos', company: 'Ramos Ventures', title: 'Owner', phones: [TEST_PHONE], emails: ['gloria@test.com'] },
      { name: 'Marco Ramos', company: 'Ramos Ventures', title: 'Operations', phones: [TEST_PHONE], emails: [] },
      { name: 'Benny Castillo', company: 'Ramos Ventures', title: 'Site Manager', phones: [TEST_PHONE], emails: [] },
    ],
    status: 'new',
  },
]

const result = await req('POST', '/Target/bulk', targets)
const count = Array.isArray(result) ? result.length : result?.count ?? '?'
console.log(`Created ${count} test targets — all phones set to ${TEST_PHONE}`)
