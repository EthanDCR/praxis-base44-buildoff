import { useState, useEffect, useCallback, useRef } from 'react'
import { base44 } from '../../lib/base44'
import { MapContainer, TileLayer, useMap, useMapEvent, GeoJSON as GeoJSONLayer, Tooltip } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type * as GeoJSON from 'geojson'
import { motion, AnimatePresence } from 'motion/react'
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

  // ── MRMS swath data (from hail pipeline → Base44) ─────────────────
  const [mrmsFeatures, setMrmsFeatures] = useState<any[]>([])

  useEffect(() => {
    base44.entities.HailSwath.list()
      .then((data: any) => setMrmsFeatures(Array.isArray(data) ? data : (data?.data ?? [])))
      .catch(console.error)
  }, [])

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

  // ── Load lists ────────────────────────────────────────────────────
  useEffect(() => {
    base44.entities.CallList.list().then((data: any) => setLists(data)).catch(console.error)
  }, [])

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

  const handleView = useCallback((v: ViewState) => setViewState(v), [])

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

          {/* MRMS hail swath polygons from the hail pipeline */}
          {mrmsFeatures
            .filter(f => {
              if ((f.min_size_inches ?? 0) < minSize) return false
              if (f.event_date) {
                const cutoff = new Date(Date.now() - rangeDays * 86400000)
                const evDate = new Date(f.event_date)
                if (evDate < cutoff) return false
              }
              return true
            })
            .map((f, i) => {
              try {
                const geometry = JSON.parse(f.geometry)
                const color    = hailColor(f.min_size_inches)
                const dateLabel = f.event_date
                  ? new Date(f.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : 'Unknown date'
                return (
                  <GeoJSONLayer
                    key={`mrms-${f.id ?? i}`}
                    data={{ type: 'Feature', geometry, properties: {} } as GeoJSON.GeoJsonObject}
                    style={{
                      color,
                      fillColor:   color,
                      fillOpacity: 0.28,
                      weight:      1.5,
                      opacity:     0.85,
                    }}
                  >
                    <Tooltip sticky className={styles.swathTooltip}>
                      <span className={styles.swathTipRow}>
                        <span className={styles.swathTipKey}>DATE</span>
                        <span className={styles.swathTipVal}>{dateLabel}</span>
                      </span>
                      <span className={styles.swathTipRow}>
                        <span className={styles.swathTipKey}>HAIL SIZE</span>
                        <span className={styles.swathTipVal} style={{ color }}>
                          {f.min_size_inches >= 1
                            ? `≥ ${f.min_size_inches.toFixed(2)} in`
                            : `≥ ${(f.min_size_inches * 25.4).toFixed(0)} mm`}
                        </span>
                      </span>
                    </Tooltip>
                  </GeoJSONLayer>
                )
              } catch { return null }
            })
          }
        </MapContainer>

      </motion.div>

    </div>
  )
}
