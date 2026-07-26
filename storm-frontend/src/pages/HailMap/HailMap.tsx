import { useState, useEffect, useCallback, useRef } from 'react'
import { base44 } from '../../lib/base44'
import { MapContainer, TileLayer, useMap, useMapEvent, Rectangle, GeoJSON as GeoJSONLayer } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import { motion, AnimatePresence } from 'motion/react'
import { fetchStorms, fetchSwathGeometry } from '../../lib/swath'
import type { SwathStorm, SwathGeometry } from '../../lib/swath'
import 'leaflet/dist/leaflet.css'
import styles from './HailMap.module.css'

const EASE = [0.22, 1, 0.36, 1] as const
const US_BOUNDS: LatLngBoundsExpression = [[15, -135], [58, -55]]
const NOMINATIM = 'https://nominatim.openstreetmap.org'

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

const DATE_RANGES = [
  { label: 'Today',   days: 1  },
  { label: '3 Days',  days: 3  },
  { label: '7 Days',  days: 7  },
  { label: '30 Days', days: 30 },
]

function hailColor(size: number): string {
  if (size >= 2.0)  return '#dc2626'
  if (size >= 1.75) return '#ea580c'
  if (size >= 1.5)  return '#f97316'
  if (size >= 1.25) return '#f59e0b'
  if (size >= 1.0)  return '#eab308'
  if (size >= 0.75) return '#84cc16'
  return '#22d3ee'
}

function hailLabel(size: number): string {
  if (size >= 2.5)  return 'Baseball'
  if (size >= 1.75) return 'Golf Ball'
  if (size >= 1.5)  return 'Walnut'
  if (size >= 1.0)  return 'Quarter'
  if (size >= 0.75) return 'Penny'
  return 'Marble'
}

interface ViewState { north: number; south: number; east: number; west: number; zoom: number }
interface SelectedAddress { display: string; line1: string; line2: string; lat: number; lng: number }

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
    } catch { }
  })
  return null
}

function BoundsTracker({ onView }: { onView: (v: ViewState) => void }) {
  const map = useMap()
  const report = useCallback(() => {
    const b = map.getBounds()
    onView({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest(), zoom: map.getZoom() })
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
  // ── Map state ─────────────────────────────────────────────────────
  const [viewState, setViewState]   = useState<ViewState | null>(null)
  const [mapCenter, setMapCenter]   = useState<[number, number] | null>(null)
  const [tileMode, setTileMode]     = useState<'dark' | 'satellite'>('dark')

  // ── Search ────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery]     = useState('')
  const [searching, setSearching]         = useState(false)
  const [suggestions, setSuggestions]     = useState<{ place_id: number; display_name: string; lat: string; lon: string }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchWrapperRef = useRef<HTMLDivElement>(null)

  // ── Filters ───────────────────────────────────────────────────────
  const [rangeDays, setRangeDays] = useState(7)
  const [minSize, setMinSize]     = useState(1.0)

  // ── Swath data ────────────────────────────────────────────────────
  const [swathStorms, setSwathStorms]     = useState<SwathStorm[]>([])
  const [swathGeoms, setSwathGeoms]       = useState<Record<string, SwathGeometry>>({})
  const swathGeomsRef                     = useRef<Record<string, SwathGeometry>>({})
  const [activeSwathId, setActiveSwathId] = useState<string | null>(null)
  const [swathLoading, setSwathLoading]   = useState(false)
  const [swathError, setSwathError]       = useState<string | null>(null)
  const [swathCredits, setSwathCredits]   = useState(0)

  // ── Property / list state ─────────────────────────────────────────
  const [selectedAddress, setSelectedAddress] = useState<SelectedAddress | null>(null)
  const [lists, setLists]               = useState<{ id: string; name: string }[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [showNewList, setShowNewList]   = useState(false)
  const [newListName, setNewListName]   = useState('')
  const [creatingList, setCreatingList] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [addingTarget, setAddingTarget] = useState(false)
  const [addedFeedback, setAddedFeedback] = useState(false)

  // Keep geom ref in sync with state so geometry handler can check cache without being in deps
  useEffect(() => { swathGeomsRef.current = swathGeoms }, [swathGeoms])

  // ── Load lists ────────────────────────────────────────────────────
  useEffect(() => {
    base44.entities.CallList.list().then((data: any) => setLists(data)).catch(console.error)
  }, [])

  // ── Fetch storms + all geometries once per date-range change ─────────
  useEffect(() => {
    let cancelled = false
    setSwathLoading(true)
    setSwathError(null)
    setSwathStorms([])
    setSwathGeoms({})
    swathGeomsRef.current = {}
    setActiveSwathId(null)
    setSwathCredits(0)

    const since = new Date(Date.now() - rangeDays * 86400000).toISOString()

    fetchStorms(since).then(storms => {
      if (cancelled) return
      setSwathStorms(storms)
      setSwathCredits(1)

      // Fire all geometry requests in parallel — draw polygons as each arrives
      storms.forEach(s => {
        if (!s.swath_id) return
        fetchSwathGeometry(s.swath_id)
          .then(geom => {
            if (cancelled) return
            setSwathGeoms(prev => ({ ...prev, [s.storm_id]: geom }))
            setSwathCredits(c => c + 1)
          })
          .catch(() => {}) // silently skip if one fails (e.g. rate limit)
      })
    })
    .catch(e => { if (!cancelled) setSwathError(e instanceof Error ? e.message : 'Failed') })
    .finally(() => { if (!cancelled) setSwathLoading(false) })

    return () => { cancelled = true }
  }, [rangeDays])

  // ── Search ────────────────────────────────────────────────────────
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
      } catch { }
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

  // ── List management ───────────────────────────────────────────────
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

  async function handleSelectStorm(stormId: string, swathId: string) {
    setActiveSwathId(prev => prev === stormId ? null : stormId)
    if (swathGeomsRef.current[stormId]) return
    try {
      const geom = await fetchSwathGeometry(swathId)
      setSwathGeoms(prev => ({ ...prev, [stormId]: geom }))
      setSwathCredits(c => c + 1)
    } catch (e) {
      console.error('Geometry load failed', e)
    }
  }

  const handleView = useCallback((v: ViewState) => setViewState(v), [])

  // Filter by min size + current viewport (so the sidebar only shows nearby storms)
  const filteredStorms = swathStorms.filter(s => {
    if ((s.mesh_max_in ?? 0) < minSize) return false
    if (!viewState || !s.centroid_lon || !s.centroid_lat) return true
    return (
      s.centroid_lon >= viewState.west  && s.centroid_lon <= viewState.east &&
      s.centroid_lat >= viewState.south && s.centroid_lat <= viewState.north
    )
  })
  const allFiltered  = swathStorms.filter(s => (s.mesh_max_in ?? 0) >= minSize)
  const activeStorm  = activeSwathId ? allFiltered.find(s => s.storm_id === activeSwathId) : null
  const maxHail      = allFiltered.length > 0 ? Math.max(...allFiltered.map(s => s.mesh_max_in ?? 0)) : 0
  const tooZoomedOut = false

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
          {swathLoading && <span className={`${styles.badge} ${styles.badgeLoading}`}>Loading…</span>}
          {!swathLoading && !swathError && filteredStorms.length > 0 && (
            <span className={`${styles.badge} ${styles.badgeLive}`}>● Live</span>
          )}
          {swathError && <span className={`${styles.badge} ${styles.badgeError}`}>⚠ {swathError}</span>}
          {!swathLoading && filteredStorms.length > 0 && (
            <span className={styles.strikeCount}>
              <span className={styles.strikeNum}>{filteredStorms.length}</span>
              <span className={styles.strikeSub}>
                storms · last {rangeDays}d · max {maxHail.toFixed(2)}"
              </span>
            </span>
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
          <h3 className={styles.sectionLabel}>Min Hail Size</h3>
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
          <h3 className={styles.sectionLabel}>Swaths</h3>
          {swathLoading && <p className={styles.swathHint}>Loading storms…</p>}
          {!swathLoading && swathStorms.length === 0 && (
            <p className={styles.swathHint}>No storms in this date range</p>
          )}
          {swathStorms.length > 0 && (
            <>
              <div className={styles.swathSummaryRow}>
                <span className={styles.swathSummaryNum}>{allFiltered.length}</span>
                <span className={styles.swathSummaryLabel}>storms loaded</span>
              </div>
              <div className={styles.swathSummaryRow}>
                <span className={styles.swathSummaryNum} style={{ color: hailColor(maxHail) }}>{maxHail.toFixed(2)}"</span>
                <span className={styles.swathSummaryLabel}>largest hail</span>
              </div>
              <div className={styles.swathSummaryRow}>
                <span className={styles.swathSummaryNum}>{Object.keys(swathGeoms).length}</span>
                <span className={styles.swathSummaryLabel}>polygons drawn</span>
              </div>
              <p className={styles.swathHint} style={{ marginTop: 4 }}>Click any swath on the map for details</p>
            </>
          )}
          {swathCredits > 0 && (
            <p className={styles.swathCreditNote}>{swathCredits} credit{swathCredits !== 1 ? 's' : ''} used</p>
          )}
        </SidebarSection>

        <SidebarSection delay={0.29}>
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
                  {activeListId
                    ? (lists.find(l => l.id === activeListId)?.name ?? 'Select a list…')
                    : lists.length > 0 ? 'Select a list…' : 'No lists yet'}
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

        <SidebarSection delay={0.36}>
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

          {filteredStorms.map(s => {
            const color   = hailColor(s.mesh_max_in ?? 0)
            const active  = s.storm_id === activeSwathId
            const geom    = swathGeoms[s.storm_id]
            const onClick = () => handleSelectStorm(s.storm_id, s.swath_id)

            if (geom) {
              return (
                <GeoJSONLayer
                  key={s.storm_id}
                  data={geom as GeoJSON.GeoJsonObject}
                  style={{
                    color,
                    fillColor:   color,
                    fillOpacity: active ? 0.38 : 0.2,
                    weight:      active ? 2.5 : 1.5,
                    opacity:     active ? 1.0 : 0.75,
                  }}
                  eventHandlers={{ click: onClick }}
                />
              )
            }

            return null
          })}
        </MapContainer>

        {/* Active storm detail panel */}
        <AnimatePresence>
          {activeStorm && (
            <motion.div
              key="swath-panel"
              className={styles.swathInfo}
              initial={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0,  filter: 'blur(0px)' }}
              exit={{    opacity: 0, y: -4,  filter: 'blur(4px)' }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              <p className={styles.swathDate}>
                {new Date(activeStorm.started_at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
                })}
              </p>
              <div className={styles.swathSizeRow}>
                <span className={styles.swathSize} style={{ color: hailColor(activeStorm.mesh_max_in ?? 0) }}>
                  {(activeStorm.mesh_max_in ?? 0).toFixed(2)}"
                </span>
                <span className={styles.swathSizeLabel}>{hailLabel(activeStorm.mesh_max_in ?? 0)}</span>
              </div>
              {activeStorm.area_km2 != null && (
                <div className={styles.swathSizeRow}>
                  <span className={styles.swathSize}>{Math.round(activeStorm.area_km2)}</span>
                  <span className={styles.swathSizeLabel}>km² affected</span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

    </div>
  )
}
