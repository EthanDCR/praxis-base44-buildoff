const KEY = import.meta.env.VITE_SWATH_API_KEY as string

function headers() {
  return { Authorization: `Bearer ${KEY}` }
}

export interface SwathStorm {
  storm_id:     string
  swath_id:     string
  type:         'hail' | 'wind'
  started_at:   string
  mesh_max_in:  number | null
  area_km2:     number | null
  centroid_lat?: number
  centroid_lon?: number
}

export interface SwathGeometry {
  type: 'Feature'
  properties: { swath_id: string; storm_id: string; mesh_max_in: number | null }
  geometry:   { type: string; coordinates: unknown }
}

export async function fetchStorms(since: string): Promise<SwathStorm[]> {
  const q = new URLSearchParams({ since, type: 'hail', limit: '500' })
  const res = await fetch(`/swath-api/v1/storms?${q}`, { headers: headers() })
  if (!res.ok) throw new Error(`Swath ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.data ?? []
}

export async function fetchSwathGeometry(swathId: string): Promise<SwathGeometry> {
  const res = await fetch(`/swath-api/v1/swaths/${encodeURIComponent(swathId)}/geometry`, { headers: headers() })
  if (!res.ok) throw new Error(`Swath ${res.status}: ${await res.text()}`)
  return res.json()
}
