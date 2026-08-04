import { describe, it, expect } from 'vitest'
import {
  extractState,
  filterTargets,
  isRepUser,
  resolveProfileRole,
  type FilterOptions,
} from '../lib/target-filters'

// ── Helpers ────────────────────────────────────────────────────────────────

function blank(): FilterOptions {
  return {
    search: '',
    contactSearch: '',
    statusFilter: new Set(),
    listFilter: null,
    repFilter: new Set(),
    stateFilter: new Set(),
    roofMaterialFilter: new Set(),
    hasPhoneFilter: 'all',
    hasEmailFilter: 'all',
    propertyTypeSearch: '',
    sqftMin: '',
    sqftMax: '',
    hailSizeMin: '',
    hailSizeMax: '',
    hailDateFrom: '',
    hailDateTo: '',
  }
}

function target(overrides: Record<string, any> = {}) {
  return {
    id: 'tgt-1',
    list_id: 'list-1',
    line1: '123 Main St',
    line2: 'Springfield, IL 62701',
    status: 'new',
    contacts: [],
    hail_size: 1.0,
    hail_date: '2024-06-01T00:00:00Z',
    square_footage: 2000,
    roof_material: 'Asphalt Shingle',
    property_type: 'Residential',
    assigned_to: null,
    ...overrides,
  }
}

// ── extractState ───────────────────────────────────────────────────────────

describe('extractState', () => {
  it('parses standard City, ST ZIP format', () => {
    expect(extractState('Springfield, IL 62701')).toBe('IL')
  })

  it('handles extra whitespace around comma', () => {
    expect(extractState('Denver,  CO 80202')).toBe('CO')
  })

  it('returns empty string when no state code found', () => {
    expect(extractState('no zip here')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(extractState('')).toBe('')
  })

  it('does not match lowercase state codes', () => {
    // Regex is uppercase only
    expect(extractState('Denver, co 80202')).toBe('')
  })

  it('handles undefined gracefully', () => {
    expect(extractState(undefined as any)).toBe('')
  })
})

// ── filterTargets — address search ────────────────────────────────────────

describe('filterTargets — address search', () => {
  const targets = [
    target({ id: '1', line1: '123 Oak Ave', line2: 'Dallas, TX 75201' }),
    target({ id: '2', line1: '456 Pine St', line2: 'Austin, TX 73301' }),
  ]

  it('matches by street', () => {
    const result = filterTargets(targets, { ...blank(), search: 'oak' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('matches by city', () => {
    const result = filterTargets(targets, { ...blank(), search: 'Austin' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })

  it('is case-insensitive', () => {
    expect(filterTargets(targets, { ...blank(), search: 'DALLAS' })).toHaveLength(1)
  })

  it('empty search returns all', () => {
    expect(filterTargets(targets, blank())).toHaveLength(2)
  })
})

// ── filterTargets — contact search ────────────────────────────────────────

describe('filterTargets — contact search', () => {
  const targets = [
    target({
      id: '1',
      contacts: [{ name: 'Alice Johnson', phones: [{ number: '555-111-2222' }], emails: [] }],
    }),
    target({
      id: '2',
      contacts: [{ name: 'Bob Smith', phones: [{ number: '555-333-4444' }], emails: [] }],
    }),
    target({ id: '3', contacts: [] }),
  ]

  it('matches by contact name', () => {
    const result = filterTargets(targets, { ...blank(), contactSearch: 'alice' })
    expect(result.map(t => t.id)).toEqual(['1'])
  })

  it('matches by phone digits (ignores formatting)', () => {
    const result = filterTargets(targets, { ...blank(), contactSearch: '5553334444' })
    expect(result.map(t => t.id)).toEqual(['2'])
  })

  it('partial phone match works', () => {
    const result = filterTargets(targets, { ...blank(), contactSearch: '1112' })
    expect(result.map(t => t.id)).toEqual(['1'])
  })
})

// ── filterTargets — status filter ─────────────────────────────────────────

describe('filterTargets — status filter', () => {
  const targets = [
    target({ id: '1', status: 'new' }),
    target({ id: '2', status: 'callback' }),
    target({ id: '3', status: 'sold' }),
    target({ id: '4', status: 'not_interested' }),
  ]

  it('filters to a single status', () => {
    const result = filterTargets(targets, { ...blank(), statusFilter: new Set(['new']) })
    expect(result.map(t => t.id)).toEqual(['1'])
  })

  it('filters to multiple statuses simultaneously', () => {
    const result = filterTargets(targets, { ...blank(), statusFilter: new Set(['new', 'callback']) })
    expect(result.map(t => t.id)).toEqual(['1', '2'])
  })

  it('empty set returns all', () => {
    expect(filterTargets(targets, blank())).toHaveLength(4)
  })
})

// ── filterTargets — rep filter ────────────────────────────────────────────

describe('filterTargets — rep filter', () => {
  const targets = [
    target({ id: '1', assigned_to: 'alice@co.com' }),
    target({ id: '2', assigned_to: 'bob@co.com' }),
    target({ id: '3', assigned_to: null }),
    target({ id: '4', assigned_to: undefined }),
  ]

  it('filters to a specific rep', () => {
    const result = filterTargets(targets, { ...blank(), repFilter: new Set(['alice@co.com']) })
    expect(result.map(t => t.id)).toEqual(['1'])
  })

  it('unassigned sentinel shows null/undefined assigned_to', () => {
    const result = filterTargets(targets, { ...blank(), repFilter: new Set(['__unassigned__']) })
    expect(result.map(t => t.id)).toEqual(['3', '4'])
  })

  it('multi-select rep works', () => {
    const result = filterTargets(targets, {
      ...blank(),
      repFilter: new Set(['alice@co.com', '__unassigned__']),
    })
    expect(result.map(t => t.id)).toEqual(['1', '3', '4'])
  })
})

// ── filterTargets — state filter ──────────────────────────────────────────

describe('filterTargets — state filter', () => {
  const targets = [
    target({ id: '1', line2: 'Dallas, TX 75201' }),
    target({ id: '2', line2: 'Denver, CO 80202' }),
    target({ id: '3', line2: 'no state here' }),
  ]

  it('filters by state code', () => {
    const result = filterTargets(targets, { ...blank(), stateFilter: new Set(['TX']) })
    expect(result.map(t => t.id)).toEqual(['1'])
  })

  it('multi-state selection works', () => {
    const result = filterTargets(targets, { ...blank(), stateFilter: new Set(['TX', 'CO']) })
    expect(result.map(t => t.id)).toEqual(['1', '2'])
  })

  it('excludes targets with no parseable state', () => {
    const result = filterTargets(targets, { ...blank(), stateFilter: new Set(['TX']) })
    expect(result.find(t => t.id === '3')).toBeUndefined()
  })
})

// ── filterTargets — has phone / has email ─────────────────────────────────

describe('filterTargets — has phone / has email', () => {
  const targets = [
    target({ id: '1', contacts: [{ name: 'A', phones: [{ number: '555-0001' }], emails: ['a@x.com'] }] }),
    target({ id: '2', contacts: [{ name: 'B', phones: [], emails: ['b@x.com'] }] }),
    target({ id: '3', contacts: [] }),
  ]

  it('hasPhoneFilter yes keeps only targets with phones', () => {
    const result = filterTargets(targets, { ...blank(), hasPhoneFilter: 'yes' })
    expect(result.map(t => t.id)).toEqual(['1'])
  })

  it('hasPhoneFilter no keeps targets without phones', () => {
    const result = filterTargets(targets, { ...blank(), hasPhoneFilter: 'no' })
    expect(result.map(t => t.id)).toEqual(['2', '3'])
  })

  it('hasEmailFilter yes keeps targets with emails', () => {
    const result = filterTargets(targets, { ...blank(), hasEmailFilter: 'yes' })
    expect(result.map(t => t.id)).toEqual(['1', '2'])
  })
})

// ── filterTargets — sqft range ────────────────────────────────────────────

describe('filterTargets — sqft range', () => {
  const targets = [
    target({ id: '1', square_footage: 1000 }),
    target({ id: '2', square_footage: 2500 }),
    target({ id: '3', square_footage: 5000 }),
    target({ id: '4', square_footage: undefined }),
  ]

  it('min only', () => {
    const result = filterTargets(targets, { ...blank(), sqftMin: '2000' })
    expect(result.map(t => t.id)).toEqual(['2', '3'])
  })

  it('max only', () => {
    const result = filterTargets(targets, { ...blank(), sqftMax: '2500' })
    expect(result.map(t => t.id)).toEqual(['1', '2'])
  })

  it('min + max range', () => {
    const result = filterTargets(targets, { ...blank(), sqftMin: '1500', sqftMax: '3000' })
    expect(result.map(t => t.id)).toEqual(['2'])
  })

  it('target with no sqft is excluded by min filter', () => {
    // undefined square_footage treated as 0, which is < 2000
    const result = filterTargets(targets, { ...blank(), sqftMin: '2000' })
    expect(result.find(t => t.id === '4')).toBeUndefined()
  })
})

// ── filterTargets — hail size range ───────────────────────────────────────

describe('filterTargets — hail size range', () => {
  const targets = [
    target({ id: '1', hail_size: 0.75 }),
    target({ id: '2', hail_size: 1.5 }),
    target({ id: '3', hail_size: 2.5 }),
  ]

  it('min only', () => {
    const result = filterTargets(targets, { ...blank(), hailSizeMin: '1.5' })
    expect(result.map(t => t.id)).toEqual(['2', '3'])
  })

  it('max only', () => {
    const result = filterTargets(targets, { ...blank(), hailSizeMax: '1.5' })
    expect(result.map(t => t.id)).toEqual(['1', '2'])
  })
})

// ── filterTargets — hail date range ───────────────────────────────────────

describe('filterTargets — hail date range', () => {
  const targets = [
    target({ id: '1', hail_date: '2024-01-01T00:00:00Z' }),
    target({ id: '2', hail_date: '2024-06-15T00:00:00Z' }),
    target({ id: '3', hail_date: '2024-12-01T00:00:00Z' }),
    target({ id: '4', hail_date: null }),
  ]

  it('from date excludes older events', () => {
    const result = filterTargets(targets, { ...blank(), hailDateFrom: '2024-06-01' })
    expect(result.map(t => t.id)).toEqual(['2', '3'])
  })

  it('to date excludes newer events', () => {
    const result = filterTargets(targets, { ...blank(), hailDateTo: '2024-06-30' })
    expect(result.map(t => t.id)).toEqual(['1', '2'])
  })

  it('targets with no hail_date are excluded when date filter is active', () => {
    const result = filterTargets(targets, { ...blank(), hailDateFrom: '2024-01-01' })
    expect(result.find(t => t.id === '4')).toBeUndefined()
  })
})

// ── filterTargets — combined filters ──────────────────────────────────────

describe('filterTargets — combined filters', () => {
  const targets = [
    target({ id: '1', status: 'new', line2: 'Dallas, TX 75201', assigned_to: 'rep@co.com', square_footage: 3000 }),
    target({ id: '2', status: 'called', line2: 'Denver, CO 80202', assigned_to: null, square_footage: 1000 }),
    target({ id: '3', status: 'new', line2: 'Dallas, TX 75201', assigned_to: null, square_footage: 500 }),
  ]

  it('AND logic: all filters must pass', () => {
    const result = filterTargets(targets, {
      ...blank(),
      statusFilter: new Set(['new']),
      stateFilter: new Set(['TX']),
      sqftMin: '1000',
    })
    expect(result.map(t => t.id)).toEqual(['1'])
  })
})

// ── isRepUser ──────────────────────────────────────────────────────────────

describe('isRepUser', () => {
  it('admin is not a rep', () => {
    expect(isRepUser({ email: 'a@b.com', role: 'admin' })).toBe(false)
  })

  it('rep role is a rep', () => {
    expect(isRepUser({ email: 'a@b.com', role: 'rep' })).toBe(true)
  })

  it('undefined role (no profile) is treated as rep', () => {
    expect(isRepUser({ email: 'a@b.com', role: undefined })).toBe(true)
  })

  it('null user is not a rep', () => {
    expect(isRepUser(null)).toBe(false)
  })

  it('user with no email is not a rep', () => {
    expect(isRepUser({ email: '', role: 'rep' })).toBe(false)
  })
})

// ── resolveProfileRole ────────────────────────────────────────────────────

describe('resolveProfileRole', () => {
  const profiles = [
    { email: 'admin@co.com', role: 'admin' },
    { email: 'rep@co.com', role: 'rep' },
    { email: 'Other@co.com', role: 'rep' },
  ]

  it('returns role for matching email', () => {
    expect(resolveProfileRole(profiles, 'rep@co.com')).toBe('rep')
  })

  it('is case-insensitive', () => {
    expect(resolveProfileRole(profiles, 'ADMIN@CO.COM')).toBe('admin')
    expect(resolveProfileRole(profiles, 'other@co.com')).toBe('rep')
  })

  it('returns null when email not found', () => {
    expect(resolveProfileRole(profiles, 'nobody@co.com')).toBeNull()
  })

  it('returns null when profiles list is empty', () => {
    expect(resolveProfileRole([], 'rep@co.com')).toBeNull()
  })

  it('does not return first profile when email mismatches', () => {
    // This guards against the [0] bug: if API returns all profiles,
    // resolveProfileRole must not give the first one to an unrelated user
    expect(resolveProfileRole(profiles, 'hacker@co.com')).toBeNull()
  })
})
