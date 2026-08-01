import { base44 } from './base44'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface XWHailReport {
  id:        string
  lat:       number
  lon:       number
  dateISO:   string
  hailIN:    number
  location:  string
  state:     string
}

export interface XWStormCell {
  id:          string
  lat:         number
  lon:         number
  maxSizeIN:   number
  probSevere:  number
  cone?:       number[][][] // polygon ring coordinates [lon, lat][]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function xwFetch(path: string): Promise<any> {
  const res = await base44.functions.invoke('xweather-proxy', { path }) as any
  return res?.data ?? res
}

// ── Storm Reports (confirmed hail) ────────────────────────────────────────────

export async function fetchHailReports(rangeDays: number, minSizeIN = 0.75): Promise<XWHailReport[]> {
  const from = `-${rangeDays}days`
  const data = await xwFetch(
    `/stormreports/search?query=type:HAIL,report.detail.hailIN:${minSizeIN}&from=${from}&to=now&limit=500`
  )

  if (!data.success || !data.response) return []

  const reports: any[] = Array.isArray(data.response) ? data.response : [data.response]

  return reports.map((r: any): XWHailReport => ({
    id:       r.id ?? `${r.loc?.lat}-${r.loc?.long}-${r.report?.timestamp}`,
    lat:      r.loc?.lat ?? 0,
    lon:      r.loc?.long ?? 0,
    dateISO:  r.report?.dateTimeISO ?? '',
    hailIN:   r.report?.detail?.hailIN ?? 0,
    location: r.place?.name ?? '',
    state:    r.place?.state ?? '',
  }))
}

// ── Storm Cells (live active cells with cone polygons) ────────────────────────

export async function fetchStormCells(minProbSevere = 10): Promise<XWStormCell[]> {
  const data = await xwFetch(
    `/stormcells/search?query=ob.hail.probSevere:${minProbSevere}&limit=150&format=json`
  )

  if (!data.success || !data.response) return []

  const cells: any[] = Array.isArray(data.response) ? data.response : [data.response]

  return cells.map((c: any): XWStormCell => ({
    id:         c.id ?? `cell-${c.loc?.lat}-${c.loc?.long}`,
    lat:        c.loc?.lat ?? 0,
    lon:        c.loc?.long ?? 0,
    maxSizeIN:  c.ob?.hail?.maxSizeIN ?? 0,
    probSevere: c.ob?.hail?.probSevere ?? 0,
    cone:       c.forecast?.cone?.narrow?.coordinates?.[0] ?? undefined,
  }))
}
