import { useState, useEffect, useCallback } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import HeatmapLayer from '../../components/HeatmapLayer/HeatmapLayer'
import type { LatLngBoundsExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import styles from './HailMap.module.css'

// Restrict pan/zoom to continental US + Alaska/Hawaii buffer
const US_BOUNDS: LatLngBoundsExpression = [[15, -135], [58, -55]]

const TILES = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    subdomains: '',
  },
}

// ---------------------------------------------------------------------------
// Iowa Environmental Mesonet — Local Storm Reports (hail only)
// Docs: https://mesonet.agron.iastate.edu/geojson/lsr.php
//
// Query params:
//   sts  — start time UTC, format YYYYMMDDHHmm
//   ets  — end time UTC, format YYYYMMDDHHmm
//   type — H = hail only
//
// Feature properties:
//   magnitude — hail diameter in inches (float)
//   city      — nearest city/location name
//   county    — county name
//   state     — two-letter state abbreviation
//   valid     — ISO-8601 UTC timestamp of the event
//   remark    — storm spotter free-text notes
// Geometry: GeoJSON Point [longitude, latitude]
// ---------------------------------------------------------------------------
const IEM_BASE = 'https://mesonet.agron.iastate.edu/geojson/lsr.php'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=json&q='

// Format a Date to YYYYMMDDHHmm for IEM API
function iemDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
}

function buildUrl(days: number) {
  const now = new Date()
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return `${IEM_BASE}?sts=${iemDate(start)}&ets=${iemDate(now)}&type=H`
}

const DATE_RANGES = [
  { label: 'Today',   days: 1  },
  { label: '3 Days',  days: 3  },
  { label: '7 Days',  days: 7  },
  { label: '30 Days', days: 30 },
]

const PRESETS: { label: string; coords: [number, number] }[] = [
  { label: 'Oklahoma City, OK', coords: [35.4676, -97.5164]  },
  { label: 'Amarillo, TX',      coords: [35.2220, -101.8313] },
  { label: 'Wichita, KS',       coords: [37.6872, -97.3301]  },
  { label: 'Dallas, TX',        coords: [32.7767, -96.7970]  },
  { label: 'Denver, CO',        coords: [39.7392, -104.9903] },
]

interface HailProps {
  magnitude: number
  city: string
  county: string
  state: string
  valid: string
  remark: string
}

interface HailFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: HailProps
}

// Normalize magnitude to 0–1 intensity for the heatmap
// 0.75" = low end (min size), 3.0"+ = max intensity
function hailIntensity(size: number) {
  return Math.min((size - 0.75) / 2.25, 1.0)
}


function MapController({ center }: { center: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.flyTo(center, 10, { duration: 1.5 })
  }, [center, map])
  return null
}

export default function HailMap() {
  const [reports, setReports]       = useState<HailFeature[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [rangeDays, setRangeDays]   = useState(7)
  const [mapCenter, setMapCenter]   = useState<[number, number] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching]   = useState(false)
  const [tileMode, setTileMode]     = useState<'dark' | 'satellite'>('dark')
  const [minSize, setMinSize]       = useState(1.0)

  // Fetch hail reports from IEM whenever the date range changes
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(buildUrl(rangeDays))
        if (!res.ok) throw new Error(`IEM responded with ${res.status}`)
        const geojson = await res.json()
        const features: HailFeature[] = (geojson.features ?? []).filter(
          (f: HailFeature) => f.geometry?.coordinates?.length === 2
        )
        if (!cancelled) {
          console.log(`[IEM] loaded ${features.length} hail reports (last ${rangeDays}d)`)
          setReports(features)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [rangeDays])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`${NOMINATIM}${encodeURIComponent(searchQuery)}`, {
        headers: { 'Accept-Language': 'en' },
      })
      const results = await res.json()
      if (results.length > 0)
        setMapCenter([parseFloat(results[0].lat), parseFloat(results[0].lon)])
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  const pool = reports.filter(f => (f.properties.magnitude ?? 0) >= minSize)

  const heatPoints: [number, number, number][] = pool.map(f => {
    const [lng, lat] = f.geometry.coordinates
    return [lat, lng, hailIntensity(f.properties.magnitude ?? 0)]
  })

  return (
    <div className={styles.page}>

      {/* ── Top bar ────────────────────────────────────────────── */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <span className={styles.pageTitle}>Storm Map</span>
          {loading   && <span className={`${styles.badge} ${styles.badgeLoading}`}>Loading…</span>}
          {!loading && !error && <span className={`${styles.badge} ${styles.badgeLive}`}>● Live</span>}
          {error     && <span className={`${styles.badge} ${styles.badgeError}`}>⚠ {error}</span>}
        </div>
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search address or ZIP…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <button className={styles.searchBtn} onClick={handleSearch} disabled={searching}>
            {searching ? '…' : 'Go'}
          </button>
          <button
            className={`${styles.tileToggle} ${tileMode === 'satellite' ? styles.tileToggleActive : ''}`}
            onClick={() => setTileMode(m => m === 'dark' ? 'satellite' : 'dark')}
            title="Toggle satellite view"
          >
            {tileMode === 'dark' ? '🛰 Satellite' : '🗺 Dark'}
          </button>
        </div>
      </div>

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <div className={styles.sidebar}>

        <div className={styles.sidebarSection}>
          <h3 className={styles.sectionLabel}>Date Range</h3>
          <div className={styles.rangeGrid}>
            {DATE_RANGES.map(r => (
              <button
                key={r.days}
                className={`${styles.rangeBtn} ${rangeDays === r.days ? styles.rangeBtnActive : ''}`}
                onClick={() => setRangeDays(r.days)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.sidebarSection}>
          <h3 className={styles.sectionLabel}>Min Size</h3>
          <div className={styles.rangeGrid}>
            {([0.75, 1.0, 1.5, 2.0] as const).map(s => (
              <button
                key={s}
                className={`${styles.rangeBtn} ${minSize === s ? styles.rangeBtnActive : ''}`}
                onClick={() => setMinSize(s)}
              >
                {s}"
              </button>
            ))}
          </div>
        </div>


        <div className={styles.sidebarSection}>
          <h3 className={styles.sectionLabel}>Jump To</h3>
          {PRESETS.map(p => (
            <button key={p.label} className={styles.presetBtn} onClick={() => setMapCenter(p.coords)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className={styles.sidebarSection}>
          <h3 className={styles.sectionLabel}>Reports</h3>
          <div className={styles.metricBig}>
            <span className={styles.metricNumber}>{loading ? '—' : pool.length}</span>
            <span className={styles.metricSub}>strikes · last {rangeDays}d</span>
          </div>
        </div>


      </div>

      {/* ── Map card ───────────────────────────────────────────── */}
      <div className={styles.mapWrapper}>
      <MapContainer
        className={styles.map}
        center={[37.5, -96]}
        zoom={5}
        minZoom={4}
        maxZoom={18}
        maxBounds={US_BOUNDS}
        maxBoundsViscosity={1.0}
        zoomControl={false}
      >
        <TileLayer
          key={tileMode}
          url={TILES[tileMode].url}
          attribution={TILES[tileMode].attribution}
          subdomains={TILES[tileMode].subdomains}
          maxZoom={18}
        />
        {tileMode === 'satellite' && (
          <TileLayer
            url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            attribution=""
            maxZoom={18}
          />
        )}
        <MapController center={mapCenter} />
        <HeatmapLayer points={heatPoints} />
      </MapContainer>
      </div>

    </div>
  )
}
