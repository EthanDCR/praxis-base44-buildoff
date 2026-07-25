import { useState, useEffect, useCallback, useRef } from 'react'
import { base44 } from '../../lib/base44'
import { MapContainer, TileLayer, useMap, useMapEvent } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import { motion, AnimatePresence } from 'motion/react'
import HeatmapLayer from '../../components/HeatmapLayer/HeatmapLayer'
import 'leaflet/dist/leaflet.css'
import styles from './HailMap.module.css'

const EASE = [0.22, 1, 0.36, 1] as const
const US_BOUNDS: LatLngBoundsExpression = [[15, -135], [58, -55]]
const SWDI_BASE   = 'https://www.ncei.noaa.gov/swdiws/json/nx3hail'
const IEM_BASE    = 'https://mesonet.agron.iastate.edu/geojson/lsr.php'
const MIN_ZOOM_TO_FETCH = 7

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
// NOAA SWDI — NEXRAD Level-3 Hail Signatures
// SHAPE: WKT "POINT (lon lat)", MAXSIZE: inches, PROB/SEVPROB: 0-100, ZTIME: ISO-8601
// Max date range: 744 hours (~31 days). Fetched per map viewport.
// ---------------------------------------------------------------------------

interface SwdiRecord {
  SHAPE:   string
  MAXSIZE: string
  PROB:    string
  SEVPROB: string
  ZTIME:   string
  WSR_ID:  string
  CELL_ID: string
}

interface IemFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { magnitude: number; valid: string; city: string; county: string; state: string; remark: string }
}

// Unified pool entry used for heatmap + hover
interface PoolEntry {
  lat:      number
  lon:      number
  size:     number   // hail size in inches
  time:     string   // ISO-8601
  source:   'swdi' | 'iem'
  sevprob?: number   // swdi only
  radar?:   string   // swdi only
  label?:   string   // iem only
}

type HoverInfo = { entry: PoolEntry }

interface ViewState {
  north: number
  south: number
  east:  number
  west:  number
  zoom:  number
}

interface SelectedAddress {
  display: string
  line1:   string
  line2:   string
  lat:     number
  lng:     number
}

// Parse WKT POINT — returns [lat, lon]
function parsePoint(shape: string): [number, number] | null {
  const m = shape.match(/POINT \(([^ ]+) ([^)]+)\)/)
  if (!m) return null
  return [parseFloat(m[2]), parseFloat(m[1])]
}

function swdiDate(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function iemDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
}

function buildSwdiUrl(days: number, view: ViewState) {
  const now   = new Date()
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const bbox  = `${view.west.toFixed(3)},${view.south.toFixed(3)},${view.east.toFixed(3)},${view.north.toFixed(3)}`
  return `${SWDI_BASE}/${swdiDate(start)}:${swdiDate(now)}?bbox=${bbox}`
}

function buildIemUrl(days: number) {
  const now   = new Date()
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return `${IEM_BASE}?sts=${iemDate(start)}&ets=${iemDate(now)}&type=H`
}

// IEM magnitudes are sometimes encoded as hundredths (75 → 0.75"). Cap at 2.5" to suppress bad reports.
function normalizeIemSize(raw: number): number {
  const n = raw > 10 ? raw / 100 : raw
  return Math.min(n, 2.5)
}

function iemToEntry(f: IemFeature): PoolEntry | null {
  const [lon, lat] = f.geometry.coordinates
  const size = normalizeIemSize(f.properties.magnitude ?? 0)
  if (!size) return null
  const { valid, city, county, state } = f.properties
  return { lat, lon, size, time: valid, source: 'iem', label: [city, county, state].filter(Boolean).join(', ') }
}

function swdiToEntry(r: SwdiRecord): PoolEntry | null {
  const coord = parsePoint(r.SHAPE)
  if (!coord) return null
  return {
    lat: coord[0], lon: coord[1],
    size: parseFloat(r.MAXSIZE),
    time: r.ZTIME,
    source: 'swdi',
    sevprob: parseInt(r.SEVPROB),
    radar: r.WSR_ID,
  }
}

function formatDate(ztime: string) {
  try {
    return new Date(ztime).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    })
  } catch { return ztime }
}

const DATE_RANGES = [
  { label: 'Today',   days: 1  },
  { label: '3 Days',  days: 3  },
  { label: '7 Days',  days: 7  },
  { label: '30 Days', days: 30 },
]

const NOMINATIM = 'https://nominatim.openstreetmap.org'

function MapController({ center }: { center: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.flyTo(center, 10, { duration: 1.5 })
  }, [center, map])
  return null
}

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
    } catch { /* ignore */ }
  })
  return null
}

function HoverTracker({ pool, onHover }: { pool: PoolEntry[]; onHover: (info: HoverInfo | null) => void }) {
  const map = useMap()

  useMapEvent('mousemove', (e) => {
    if (pool.length === 0) { onHover(null); return }
    const thresholdM = 40000 / Math.pow(2, map.getZoom() - 7)
    let nearest: PoolEntry | null = null
    let minDist = thresholdM
    for (const entry of pool) {
      const dist = e.latlng.distanceTo([entry.lat, entry.lon])
      if (dist < minDist) { minDist = dist; nearest = entry }
    }
    onHover(nearest ? { entry: nearest } : null)
  })

  useMapEvent('mouseout', () => onHover(null))
  return null
}

function BoundsTracker({ onView }: { onView: (v: ViewState) => void }) {
  const map = useMap()

  const report = useCallback(() => {
    const b = map.getBounds()
    onView({
      north: b.getNorth(), south: b.getSouth(),
      east:  b.getEast(),  west:  b.getWest(),
      zoom:  map.getZoom(),
    })
  }, [map, onView])

  useEffect(() => { report() }, [report])
  useMapEvent('moveend', report)
  useMapEvent('zoomend', report)
  return null
}

function SidebarSection({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <motion.div
      className={styles.sidebarSection}
      initial={{ x: -20, opacity: 0, filter: 'blur(8px)' }}
      animate={{ x: 0,   opacity: 1, filter: 'blur(0px)' }}
      transition={{ delay, duration: 0.65, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

export default function HailMap() {
  const [iemReports, setIemReports]     = useState<IemFeature[]>([])
  const [swdiRecords, setSwdiRecords]   = useState<SwdiRecord[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [rangeDays, setRangeDays]       = useState(7)
  const [viewState, setViewState]       = useState<ViewState | null>(null)
  const [mapCenter, setMapCenter]       = useState<[number, number] | null>(null)
  const [searchQuery, setSearchQuery]   = useState('')
  const [searching, setSearching]       = useState(false)
  const [suggestions, setSuggestions]   = useState<{ place_id: number; display_name: string; lat: string; lon: string }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchWrapperRef = useRef<HTMLDivElement>(null)
  const [tileMode, setTileMode]         = useState<'dark' | 'satellite'>('dark')
  const [minSize, setMinSize]           = useState(1.0)
  const [selectedAddress, setSelectedAddress] = useState<SelectedAddress | null>(null)
  const [lists, setLists]                     = useState<{ id: string; name: string }[]>([])
  const [activeListId, setActiveListId]       = useState<string | null>(null)
  const [showNewList, setShowNewList]         = useState(false)
  const [newListName, setNewListName]         = useState('')
  const [creatingList, setCreatingList]       = useState(false)
  const [showDropdown, setShowDropdown]       = useState(false)
  const [addingTarget, setAddingTarget]       = useState(false)
  const [addedFeedback, setAddedFeedback]     = useState(false)
  const [hoveredInfo, setHoveredInfo]         = useState<HoverInfo | null>(null)

  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // IEM nationwide overview — re-fetch when date range changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(buildIemUrl(rangeDays))
      .then(r => { if (!r.ok) throw new Error(`IEM ${r.status}`); return r.json() })
      .then(json => { if (!cancelled) setIemReports(json.features ?? []) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [rangeDays])

  // SWDI radar — fetch viewport when zoomed in
  useEffect(() => {
    if (!viewState || viewState.zoom < MIN_ZOOM_TO_FETCH) {
      setSwdiRecords([])
      return
    }
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    fetchTimerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res  = await fetch(buildSwdiUrl(rangeDays, viewState))
        if (!res.ok) throw new Error(`SWDI ${res.status}`)
        const data = await res.json()
        setSwdiRecords(data.result ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load radar data')
      } finally {
        setLoading(false)
      }
    }, 400)
    return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current) }
  }, [rangeDays, viewState])

  useEffect(() => {
    base44.entities.CallList.list().then((data: any) => setLists(data)).catch(console.error)
  }, [])

  const handleCreateList = async () => {
    if (!newListName.trim() || creatingList) return
    setCreatingList(true)
    try {
      const list = await base44.entities.CallList.create({ name: newListName.trim() }) as any
      setLists(prev => [...prev, list])
      setActiveListId(list.id)
      setNewListName('')
      setShowNewList(false)
    } catch (e) {
      console.error('Failed to create list', e)
    } finally {
      setCreatingList(false)
    }
  }

  const handleAddTarget = async () => {
    if (!selectedAddress || !activeListId || addingTarget) return
    setAddingTarget(true)
    try {
      await base44.entities.Target.create({
        list_id: activeListId,
        line1:   selectedAddress.line1,
        line2:   selectedAddress.line2,
        lat:     selectedAddress.lat,
        lng:     selectedAddress.lng,
      })
      setAddedFeedback(true)
      setTimeout(() => setAddedFeedback(false), 2000)
    } catch (e) {
      console.error('Failed to add target', e)
    } finally {
      setAddingTarget(false)
    }
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node))
        setShowSuggestions(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) { setSuggestions([]); return }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${NOMINATIM}/search?format=json&q=${encodeURIComponent(q)}&limit=5&countrycodes=us`,
          { headers: { 'Accept-Language': 'en' } }
        )
        setSuggestions(await res.json())
        setShowSuggestions(true)
      } catch { /* ignore */ }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSuggestions([])
    setShowSuggestions(false)
    try {
      const res     = await fetch(
        `${NOMINATIM}/search?format=json&q=${encodeURIComponent(searchQuery)}&countrycodes=us`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const results = await res.json()
      if (results.length > 0)
        setMapCenter([parseFloat(results[0].lat), parseFloat(results[0].lon)])
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  const handleSelectSuggestion = (s: { lat: string; lon: string; display_name: string }) => {
    setMapCenter([parseFloat(s.lat), parseFloat(s.lon)])
    setSearchQuery(s.display_name.split(',')[0])
    setSuggestions([])
    setShowSuggestions(false)
  }

  const handleView = useCallback((v: ViewState) => setViewState(v), [])

  const isHighZoom = viewState !== null && viewState.zoom >= MIN_ZOOM_TO_FETCH

  // Build unified pool — use SWDI when zoomed in AND data has arrived, else IEM as fallback
  const pool: PoolEntry[] = (isHighZoom && swdiRecords.length > 0)
    ? swdiRecords.map(swdiToEntry).filter((e): e is PoolEntry => e !== null && e.size >= minSize)
    : iemReports.map(iemToEntry).filter((e): e is PoolEntry => e !== null && e.size >= minSize)

  const heatPoints = pool.map<[number, number, number]>(e => [
    e.lat, e.lon, Math.min((e.size - 0.5) / 2.5, 1.0),
  ])

  const maxSize = pool.length > 0 ? Math.max(...pool.map(e => e.size)) : 0

  const needsZoomIn = false // always show something — IEM at low zoom, SWDI at high

  return (
    <div className={styles.page}>

      {/* ── Top bar ──────────────────────────────────────── */}
      <motion.div
        className={styles.topBar}
        initial={{ y: -16, opacity: 0, filter: 'blur(8px)' }}
        animate={{ y: 0,   opacity: 1, filter: 'blur(0px)' }}
        transition={{ duration: 0.75, ease: EASE, delay: 0.02 }}
      >
        <div className={styles.topBarLeft}>
          <span className={styles.pageTitle}>Storm Map</span>
          {needsZoomIn && <span className={`${styles.badge} ${styles.badgeLoading}`}>Zoom in to load</span>}
          {loading && <span className={`${styles.badge} ${styles.badgeLoading}`}>Loading…</span>}
          {!loading && !error && (
            <span className={`${styles.badge} ${styles.badgeLive}`}>
              ● {isHighZoom && swdiRecords.length > 0 ? 'Radar' : 'Overview'}
            </span>
          )}
          {error && <span className={`${styles.badge} ${styles.badgeError}`}>⚠ {error}</span>}
          {!loading && !error && pool.length > 0 && (
            <span className={styles.strikeCount}>
              <span className={styles.strikeNum}>{pool.length.toLocaleString()}</span>
              <span className={styles.strikeSub}>
                {isHighZoom ? 'radar sigs' : 'reports'} · last {rangeDays}d · max {maxSize.toFixed(2)}"
              </span>
            </span>
          )}
          {!isHighZoom && !loading && (
            <span className={styles.strikeSub} style={{ marginLeft: 8 }}>Zoom in for radar precision</span>
          )}
        </div>
        <div className={styles.searchRow}>
          <div className={styles.searchWrapper} ref={searchWrapperRef}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search address or ZIP…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className={styles.suggestions}>
                {suggestions.map(s => {
                  const parts = s.display_name.split(',')
                  return (
                    <button
                      key={s.place_id}
                      className={styles.suggestion}
                      onMouseDown={() => handleSelectSuggestion(s)}
                    >
                      <span className={styles.suggestionPrimary}>{parts[0]}</span>
                      {parts.length > 1 && (
                        <span className={styles.suggestionSub}>{parts.slice(1, 3).join(',').trim()}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
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
      </motion.div>

      {/* ── Sidebar ──────────────────────────────────────── */}
      <div className={styles.sidebar}>

        <SidebarSection delay={0.08}>
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
        </SidebarSection>

        <SidebarSection delay={0.15}>
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
        </SidebarSection>

        <SidebarSection delay={0.22}>
          <h3 className={styles.sectionLabel}>Active List</h3>
          {showNewList ? (
            <div className={styles.newListRow}>
              <input
                className={styles.newListInput}
                placeholder="List name…"
                value={newListName}
                onChange={e => setNewListName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateList()}
                autoFocus
              />
              <button className={styles.newListAction} onClick={handleCreateList} disabled={creatingList}>✓</button>
              <button className={styles.newListAction} onClick={() => { setShowNewList(false); setNewListName('') }}>✕</button>
            </div>
          ) : (
            <>
              <button
                className={styles.listTrigger}
                onClick={() => lists.length > 0 && setShowDropdown(d => !d)}
              >
                <span className={activeListId ? styles.listTriggerValue : styles.listTriggerPlaceholder}>
                  {activeListId ? (lists.find(l => l.id === activeListId)?.name ?? 'Select a list…') : lists.length > 0 ? 'Select a list…' : 'No lists yet'}
                </span>
                {lists.length > 0 && (
                  <span className={`${styles.listChevron} ${showDropdown ? styles.listChevronOpen : ''}`}>▾</span>
                )}
              </button>

              <AnimatePresence>
                {showDropdown && (
                  <motion.div
                    className={styles.listDropdown}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    {lists.map(l => (
                      <button
                        key={l.id}
                        className={`${styles.listOption} ${l.id === activeListId ? styles.listOptionActive : ''}`}
                        onClick={() => { setActiveListId(l.id); setShowDropdown(false) }}
                      >
                        {l.name}
                        {l.id === activeListId && <span className={styles.listOptionDot} />}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <button className={styles.newListBtn} onClick={() => { setShowDropdown(false); setShowNewList(true) }}>
                + New list
              </button>
            </>
          )}
        </SidebarSection>

        <SidebarSection delay={0.29}>
          <h3 className={styles.sectionLabel}>Selected Property</h3>
          {selectedAddress ? (
            <>
              <p className={styles.addrLine1}>{selectedAddress.line1}</p>
              <p className={styles.addrLine2}>{selectedAddress.line2}</p>
              <button
                className={`${styles.addBtn} ${!activeListId ? styles.addBtnDisabled : ''}`}
                onClick={handleAddTarget}
                disabled={!activeListId || addingTarget}
              >
                {addingTarget ? 'Adding…' : addedFeedback ? '✓ Added' : '+ Add to List'}
              </button>
            </>
          ) : (
            <p className={styles.noSelection}>Click a location on the map</p>
          )}
        </SidebarSection>

      </div>

      {/* ── Map ──────────────────────────────────────────── */}
      <motion.div
        className={styles.mapWrapper}
        initial={{ opacity: 0, scale: 0.985, filter: 'blur(14px)' }}
        animate={{ opacity: 1, scale: 1,     filter: 'blur(0px)'  }}
        transition={{ duration: 1.05, ease: EASE, delay: 0.1 }}
      >
        <MapContainer
          className={styles.map}
          center={[37.5, -96]}
          zoom={5}
          minZoom={4}
          maxZoom={20}
          maxBounds={US_BOUNDS}
          maxBoundsViscosity={1.0}
          zoomControl={false}
        >
          <TileLayer
            key={tileMode}
            url={TILES[tileMode].url}
            attribution={TILES[tileMode].attribution}
            subdomains={TILES[tileMode].subdomains}
            maxNativeZoom={19}
            maxZoom={20}
          />
          {tileMode === 'satellite' && (
            <TileLayer
              url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              attribution=""
              maxNativeZoom={19}
              maxZoom={20}
            />
          )}

          <MapController center={mapCenter} />
          <MapClickHandler onAddress={setSelectedAddress} />
          <BoundsTracker onView={handleView} />
          <HoverTracker pool={pool} onHover={setHoveredInfo} />
          <HeatmapLayer points={heatPoints} />
        </MapContainer>

        {!isHighZoom && pool.length > 0 && (
          <div className={styles.zoomPrompt}>
            Zoom in for radar-quality hail data
          </div>
        )}

        <AnimatePresence>
          {hoveredInfo && (
            <motion.div
              key="hover"
              className={styles.swathInfo}
              initial={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0,  filter: 'blur(0px)' }}
              exit={{    opacity: 0, y: -4,  filter: 'blur(4px)' }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              <p className={styles.swathDate}>{formatDate(hoveredInfo.entry.time)}</p>
              <div className={styles.swathSizeRow}>
                <span className={styles.swathSize}>{hoveredInfo.entry.size.toFixed(2)}"</span>
                <span className={styles.swathSizeLabel}>
                  {hoveredInfo.entry.source === 'swdi' ? 'radar hail size' : 'reported hail size'}
                </span>
              </div>
              {hoveredInfo.entry.source === 'swdi' && hoveredInfo.entry.sevprob !== undefined && (
                <div className={styles.swathSizeRow}>
                  <span className={styles.swathSize}>{hoveredInfo.entry.sevprob}%</span>
                  <span className={styles.swathSizeLabel}>severe probability</span>
                </div>
              )}
              {hoveredInfo.entry.radar && (
                <p className={styles.swathLocation}>Radar: {hoveredInfo.entry.radar}</p>
              )}
              {hoveredInfo.entry.label && (
                <p className={styles.swathLocation}>{hoveredInfo.entry.label}</p>
              )}
              {hoveredInfo.entry.source === 'iem' && (
                <p className={styles.swathLocation} style={{ opacity: 0.5, fontSize: '0.7rem' }}>
                  User-reported · zoom in for radar
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

    </div>
  )
}
