export interface FilterOptions {
  search: string
  contactSearch: string
  statusFilter: Set<string>
  listFilter: string | null
  repFilter: Set<string>
  stateFilter: Set<string>
  roofMaterialFilter: Set<string>
  hasPhoneFilter: 'all' | 'yes' | 'no'
  hasEmailFilter: 'all' | 'yes' | 'no'
  propertyTypeSearch: string
  sqftMin: string
  sqftMax: string
  hailSizeMin: string
  hailSizeMax: string
  hailDateFrom: string
  hailDateTo: string
}

export function extractState(line2: string): string {
  const m = /,\s*([A-Z]{2})\s+\d{5}/.exec(line2 ?? '')
  return m ? m[1] : ''
}

export function filterTargets(targets: any[], f: FilterOptions): any[] {
  let out = targets

  if (f.search.trim()) {
    const q = f.search.toLowerCase()
    out = out.filter(t =>
      (t.line1 ?? '').toLowerCase().includes(q) ||
      (t.line2 ?? '').toLowerCase().includes(q) ||
      (t.contacts ?? []).some((c: any) => (c.company ?? '').toLowerCase().includes(q))
    )
  }

  if (f.contactSearch.trim()) {
    const q = f.contactSearch.toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    out = out.filter(t =>
      (t.contacts ?? []).some((c: any) =>
        (c.name ?? '').toLowerCase().includes(q) ||
        (c.phones ?? []).some((p: any) =>
          qDigits && (p.number ?? '').replace(/\D/g, '').includes(qDigits)
        )
      )
    )
  }

  if (f.statusFilter.size > 0) {
    out = out.filter(t => f.statusFilter.has(t.status))
  }

  if (f.listFilter) {
    out = out.filter(t => t.list_id === f.listFilter)
  }

  if (f.repFilter.size > 0) {
    out = out.filter(t => {
      if (!t.assigned_to) return f.repFilter.has('__unassigned__')
      return f.repFilter.has(t.assigned_to)
    })
  }

  if (f.stateFilter.size > 0) {
    out = out.filter(t => f.stateFilter.has(extractState(t.line2 ?? '')))
  }

  if (f.hasPhoneFilter === 'yes') {
    out = out.filter(t => (t.contacts ?? []).some((c: any) => (c.phones ?? []).length > 0))
  } else if (f.hasPhoneFilter === 'no') {
    out = out.filter(t => !(t.contacts ?? []).some((c: any) => (c.phones ?? []).length > 0))
  }

  if (f.hasEmailFilter === 'yes') {
    out = out.filter(t => (t.contacts ?? []).some((c: any) => (c.emails ?? []).length > 0))
  } else if (f.hasEmailFilter === 'no') {
    out = out.filter(t => !(t.contacts ?? []).some((c: any) => (c.emails ?? []).length > 0))
  }

  if (f.propertyTypeSearch.trim()) {
    const q = f.propertyTypeSearch.toLowerCase()
    out = out.filter(t =>
      (t.property_type ?? '').toLowerCase().includes(q) ||
      (t.property_subtype ?? '').toLowerCase().includes(q)
    )
  }

  if (f.roofMaterialFilter.size > 0) {
    out = out.filter(t => f.roofMaterialFilter.has(t.roof_material))
  }

  if (f.sqftMin) {
    const n = parseFloat(f.sqftMin)
    if (!isNaN(n)) out = out.filter(t => (t.square_footage ?? 0) >= n)
  }
  if (f.sqftMax) {
    const n = parseFloat(f.sqftMax)
    if (!isNaN(n)) out = out.filter(t => (t.square_footage ?? Infinity) <= n)
  }

  if (f.hailSizeMin) {
    const n = parseFloat(f.hailSizeMin)
    if (!isNaN(n)) out = out.filter(t => (t.hail_size ?? 0) >= n)
  }
  if (f.hailSizeMax) {
    const n = parseFloat(f.hailSizeMax)
    if (!isNaN(n)) out = out.filter(t => (t.hail_size ?? Infinity) <= n)
  }

  if (f.hailDateFrom) {
    const from = new Date(f.hailDateFrom).getTime()
    out = out.filter(t => t.hail_date && new Date(t.hail_date).getTime() >= from)
  }
  if (f.hailDateTo) {
    const to = new Date(f.hailDateTo).getTime()
    out = out.filter(t => t.hail_date && new Date(t.hail_date).getTime() <= to)
  }

  return out
}

export function isRepUser(user: { email?: string; role?: string } | null): boolean {
  return !!user?.email && user.role !== 'admin'
}

export function resolveProfileRole(
  profiles: Array<{ email?: string; role?: string }>,
  email: string
): string | null {
  const match = profiles.find(p => p.email?.toLowerCase() === email.toLowerCase())
  return match?.role ?? null
}
