import { useState, useEffect, useCallback } from 'react'
import { MapContainer, TileLayer, Circle, Tooltip, useMap, useMapEvent } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import HeatmapLayer from '../../components/HeatmapLayer/HeatmapLayer'
import 'leaflet/dist/leaflet.css'
import styles from './HailMap.module.css'

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
// Properties: magnitude (inches), city, county, state, valid (ISO-8601), remark
// Geometry: GeoJSON Point [longitude, latitude]
// ---------------------------------------------------------------------------
const IEM_BASE  = 'https://mesonet.agron.iastate.edu/geojson/lsr.php'
const NOMINATIM = 'https://nominatim.openstreetmap.org'

function iemDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
}

function buildUrl(days: number) {
  const now   = new Date()
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return `${IEM_BASE}?sts=${iemDate(start)}&ets=${iemDate(now)}&type=H`
}

function formatDate(valid: string) {
  try {
    return new Date(valid).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    })
  } catch { return valid }
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

interface SelectedAddress {
  display: string
  line1: string
  line2: string
  lat: number
  lng: number
}

function hailIntensity(size: number) {
  return Math.min((size - 0.75) / 2.25, 1.0)
}

// Flies map to a new center
function MapController({ center }: { center: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.flyTo(center, 10, { duration: 1.5 })
  }, [center, map])
  return null
}

// Reverse-geocodes every map click via Nominatim and calls onAddress
function MapClickHandler({ onAddress }: { onAddress: (addr: SelectedAddress) => void }) {
  useMapEvent('click', async (e) => {
    const { lat, lng } = e.latlng
    try {
      const res  = await fetch(
        `${NOMINATIM}/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const data = await res.json()
      const a    = data.address ?? {}
      const line1 = [a.house_number, a.road].filter(Boolean).join(' ') || data.display_name?.split(',')[0]
      const line2 = [a.city || a.town || a.village, a.state].filter(Boolean).join(', ')
      onAddress({ display: data.display_name, line1, line2, lat, lng })
    } catch { /* silently ignore */ }
  })
  return null
}

export default function HailMap() {
  const [reports, setReports]           = useState<HailFeature[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [rangeDays, setRangeDays]       = useState(7)
  const [mapCenter, setMapCenter]       = useState<[number, number] | null>(null)
  const [searchQuery, setSearchQuery]   = useState('')
  const [searching, setSearching]       = useState(false)
  const [tileMode, setTileMode]         = useState<'dark' | 'satellite'>('dark')
  const [minSize, setMinSize]           = useState(1.0)
  const [selectedAddress, setSelectedAddress] = useState<SelectedAddress | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res      = await fetch(buildUrl(rangeDays))
        if (!res.ok) throw new Error(`IEM responded with ${res.status}`)
        const geojson  = await res.json()
        const features = (geojson.features ?? []).filter(
          (f: HailFeature) => f.geometry?.coordinates?.length === 2
        )
        if (!cancelled) setReports(features)
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
      const res     = await fetch(`${NOMINATIM}/search?format=json&q=${encodeURIComponent(searchQuery)}`, {
        headers: { 'Accept-Language': 'en' },
      })
      const results = await res.json()
      if (results.length > 0)
        setMapCenter([parseFloat(results[0].lat), parseFloat(results[0].lon)])
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  const pool       = reports.filter(f => (f.properties.magnitude ?? 0) >= minSize)
  const heatPoints = pool.map<[number, number, number]>(f => {
    const [lng, lat] = f.geometry.coordinates
    return [lat, lng, hailIntensity(f.properties.magnitude ?? 0)]
  })

  return (
    <div className={styles.page}>

      {/* ── Top bar ────────────────────────────────────────── */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <span className={styles.pageTitle}>Storm Map</span>
          {loading            && <span className={`${styles.badge} ${styles.badgeLoading}`}>Loading…</span>}
          {!loading && !error && <span className={`${styles.badge} ${styles.badgeLive}`}>● Live</span>}
          {error              && <span className={`${styles.badge} ${styles.badgeError}`}>⚠ {error}</span>}
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
          >
            {tileMode === 'dark' ? '🛰 Satellite' : '🗺 Dark'}
          </button>
        </div>
      </div>

      {/* ── Sidebar ────────────────────────────────────────── */}
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

        {selectedAddress && (
          <div className={styles.sidebarSection}>
            <h3 className={styles.sectionLabel}>Selected Property</h3>
            <p className={styles.addrLine1}>{selectedAddress.line1}</p>
            <p className={styles.addrLine2}>{selectedAddress.line2}</p>
            <button className={styles.addBtn}>+ Add to List</button>
          </div>
        )}

      </div>

      {/* ── Map card ───────────────────────────────────────── */}
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
          <MapClickHandler onAddress={setSelectedAddress} />
          <HeatmapLayer points={heatPoints} />

          {/* Invisible geographic circles for hover tooltips — match heatmap radius */}
          {pool.map((f, i) => {
            const [lng, lat] = f.geometry.coordinates
            const { magnitude, city, county, state, valid, remark } = f.properties
            const label = [city, county, state].filter(Boolean).join(', ')
            return (
              <Circle
                key={i}
                center={[lat, lng]}
                radius={5000}
                pathOptions={{ fillOpacity: 0.01, opacity: 0, weight: 0, interactive: true }}
              >
                <Tooltip sticky className={styles.hailTooltip}>
                  <span className={styles.ttDate}>{formatDate(valid)}</span>
                  <span className={styles.ttSize}>{magnitude}"</span>
                  {label && <span className={styles.ttLocation}>{label}</span>}
                  {remark && <span className={styles.ttRemark}>{remark}</span>}
                </Tooltip>
              </Circle>
            )
          })}

        </MapContainer>
      </div>

    </div>
  )
}
