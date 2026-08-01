import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { base44 } from '../../lib/base44'
import { motion, AnimatePresence } from 'motion/react'
import { fetchHailReports } from '../../lib/xweather'
import type { XWHailReport } from '../../lib/xweather'
import styles from './HailMap.module.css'

const EASE = [0.22, 1, 0.36, 1] as const
const NOMINATIM = 'https://nominatim.openstreetmap.org'
const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string
const PLACES_AUTOCOMPLETE = 'https://places.googleapis.com/v1/places:autocomplete'
const PLACES_DETAILS      = 'https://places.googleapis.com/v1/places'

const DARK_TILES = [
  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
]
const SATELLITE_TILES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
]
const SATELLITE_LABEL_TILES = [
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
]

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


interface SelectedAddress { display: string; line1: string; line2: string; lat: number; lng: number }
interface HoverInfo { x: number; y: number; props: Record<string, any>; kind: 'mrms' | 'xw' }

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
  const containerRef  = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<maplibregl.Map | null>(null)
  const controllerRef = useRef<any>(null)
  const [mapLoaded, setMapLoaded] = useState(false)

  // ── Map UI state ────────────────────────────────────────
  const [tileMode, setTileMode]   = useState<'dark' | 'satellite'>('dark')
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)

  // ── Search ──────────────────────────────────────────────
  const [searchQuery, setSearchQuery]         = useState('')
  const [searching, setSearching]             = useState(false)
  const [suggestions, setSuggestions]         = useState<{ placeId: string; text: string }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchWrapperRef = useRef<HTMLDivElement>(null)

  // ── Filters ─────────────────────────────────────────────
  const [rangeDays, setRangeDays] = useState(7)
  const [minSize, setMinSize]     = useState(1.0)

  // ── MRMS data ────────────────────────────────────────────
  const [mrmsFeatures, setMrmsFeatures] = useState<any[]>([])
  useEffect(() => {
    base44.entities.HailSwath.filter({}, undefined, 500)
      .then((data: any) => {
        const arr = Array.isArray(data) ? data : (data?.data ?? [])
        console.log('[HailSwath] loaded', arr.length, 'records', arr[0])
        setMrmsFeatures(arr)
      })
      .catch(e => console.error('[HailSwath] fetch error', e))
  }, [])

  // ── XWeather reports ─────────────────────────────────────
  const [xwReports, setXwReports] = useState<XWHailReport[]>([])
  useEffect(() => {
    fetchHailReports(rangeDays, minSize)
      .then(r => { console.log('[XWeather] loaded', r.length, 'reports'); setXwReports(r) })
      .catch(e => console.error('[XWeather] fetch error', e))
  }, [rangeDays, minSize])

  // ── Property / list state ────────────────────────────────
  const [selectedAddress, setSelectedAddress] = useState<SelectedAddress | null>(null)
  const [lists, setLists]               = useState<{ id: string; name: string }[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [showNewList, setShowNewList]   = useState(false)
  const [newListName, setNewListName]   = useState('')
  const [creatingList, setCreatingList] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [addingTarget, setAddingTarget] = useState(false)
  const [addedFeedback, setAddedFeedback] = useState(false)

  useEffect(() => {
    base44.entities.CallList.list().then((data: any) => setLists(data)).catch(console.error)
  }, [])

  // ── GeoJSON memos ────────────────────────────────────────
  const mrmsGeoJSON = useMemo(() => {
    const cutoff = new Date(Date.now() - rangeDays * 86400000)
    let skippedSize = 0, skippedDate = 0, skippedParse = 0
    const features = mrmsFeatures.flatMap(f => {
      if ((f.min_size_inches ?? 0) < minSize) { skippedSize++; return [] }
      if (f.event_date && new Date(f.event_date) < cutoff) { skippedDate++; return [] }
      try {
        const geom = typeof f.geometry === 'string' ? JSON.parse(f.geometry) : f.geometry
        return [{
          type: 'Feature' as const,
          geometry: geom,
          properties: { min_size_inches: f.min_size_inches ?? 0, event_date: f.event_date ?? '' },
        }]
      } catch { skippedParse++; return [] }
    })
    console.log(`[mrmsGeoJSON] ${features.length} features (skipped: size=${skippedSize} date=${skippedDate} parse=${skippedParse})`)
    return { type: 'FeatureCollection' as const, features }
  }, [mrmsFeatures, minSize, rangeDays])

  const xwReportsGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: xwReports
      .filter(r => r.hailIN >= minSize)
      .map(r => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [r.lon, r.lat] },
        properties: { id: r.id, hailIN: r.hailIN, dateISO: r.dateISO, location: r.location, state: r.state },
      })),
  }), [xwReports, minSize])

  // ── Map init (once on mount) ─────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          'base-tiles': {
            type: 'raster',
            tiles: DARK_TILES,
            tileSize: 256,
            attribution: '© OpenStreetMap contributors © CARTO',
          },
        },
        layers: [{ id: 'base', type: 'raster', source: 'base-tiles' }],
      },
      center: [-96, 37.5],
      zoom: 4.5,
      minZoom: 3,
      maxZoom: 20,
    })

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')

    map.on('load', async () => {
      // Satellite label overlay (hidden by default)
      map.addSource('sat-labels', { type: 'raster', tiles: SATELLITE_LABEL_TILES, tileSize: 256 })
      map.addLayer({ id: 'sat-labels', type: 'raster', source: 'sat-labels', layout: { visibility: 'none' } })

      // MRMS polygons
      map.addSource('mrms', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const hailColorExpr: any = ['step', ['get', 'min_size_inches'],
        '#22d3ee', 0.75,
        '#84cc16', 1.0,
        '#eab308', 1.25,
        '#f59e0b', 1.5,
        '#f97316', 1.75,
        '#ea580c', 2.0,
        '#dc2626',
      ]
      map.addLayer({
        id: 'mrms-fill', type: 'fill', source: 'mrms',
        paint: { 'fill-color': hailColorExpr, 'fill-opacity': 0.4 },
      })
      map.addLayer({
        id: 'mrms-outline', type: 'line', source: 'mrms',
        paint: { 'line-color': hailColorExpr, 'line-width': 1.5, 'line-opacity': 0.85 },
      })

      // XWeather confirmed hail reports
      map.addSource('xw-reports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'xw-reports-circle', type: 'circle', source: 'xw-reports',
        paint: {
          'circle-color': ['step', ['get', 'hailIN'],
            '#22d3ee', 0.75, '#84cc16', 1.0, '#eab308', 1.25,
            '#f59e0b', 1.5, '#f97316', 1.75, '#ea580c', 2.0, '#dc2626',
          ] as any,
          'circle-radius': 5,
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.2)',
        },
      })

      setMapLoaded(true)
    })

    // Hover tooltip
    map.on('mousemove', (e: any) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['mrms-fill', 'xw-reports-circle'] })
      if (features.length) {
        const f = features[0]
        const kind = f.layer.id === 'mrms-fill' ? 'mrms' : 'xw'
        setHoverInfo({ x: e.point.x, y: e.point.y, props: f.properties as Record<string, any>, kind })
        map.getCanvas().style.cursor = 'crosshair'
      } else {
        setHoverInfo(null)
        map.getCanvas().style.cursor = ''
      }
    })

    map.on('mouseleave' as any, () => {
      setHoverInfo(null)
      map.getCanvas().style.cursor = ''
    })

    // Click → reverse geocode
    map.on('click', async (e: any) => {
      const { lng, lat } = e.lngLat
      try {
        const res  = await fetch(
          `${NOMINATIM}/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        )
        const data = await res.json()
        const a    = data.address ?? {}
        const line1 = [a.house_number, a.road].filter(Boolean).join(' ') || data.display_name?.split(',')[0]
        const line2 = [a.city || a.town || a.village, a.state].filter(Boolean).join(', ')
        setSelectedAddress({ display: data.display_name, line1, line2, lat, lng })
      } catch {}
    })

    mapRef.current = map

    return () => {
      try { controllerRef.current?.dispose?.() } catch {}
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ── Sync GeoJSON sources when data changes ───────────────
  useEffect(() => {
    const src = mapRef.current?.getSource('mrms') as maplibregl.GeoJSONSource | undefined
    console.log('[mrms setData] source found:', !!src, 'features:', mrmsGeoJSON.features.length, 'mapLoaded:', mapLoaded)
    src?.setData(mrmsGeoJSON as any)
  }, [mrmsGeoJSON, mapLoaded])

  useEffect(() => {
    const src = mapRef.current?.getSource('xw-reports') as maplibregl.GeoJSONSource | undefined
    console.log('[xw setData] source found:', !!src, 'features:', xwReportsGeoJSON.features.length, 'mapLoaded:', mapLoaded)
    src?.setData(xwReportsGeoJSON as any)
  }, [xwReportsGeoJSON, mapLoaded])

  // ── Tile toggle ──────────────────────────────────────────
  useEffect(() => {
    if (!mapLoaded) return
    const map = mapRef.current
    if (!map) return
    try {
      (map.getSource('base-tiles') as any)?.setTiles(tileMode === 'satellite' ? SATELLITE_TILES : DARK_TILES)
      if (map.getLayer('sat-labels')) {
        map.setLayoutProperty('sat-labels', 'visibility', tileMode === 'satellite' ? 'visible' : 'none')
      }
    } catch {}
  }, [tileMode, mapLoaded])

  // ── Search ───────────────────────────────────────────────
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
        const res = await fetch(PLACES_AUTOCOMPLETE, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
            'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
          },
          body: JSON.stringify({ input: q, includedRegionCodes: ['us'] }),
        })
        const data = await res.json()
        const items = (data.suggestions ?? []).map((s: any) => ({
          placeId: s.placePrediction.placeId,
          text:    s.placePrediction.text.text,
        }))
        setSuggestions(items)
        setShowSuggestions(items.length > 0)
      } catch {}
    }, 250)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const flyToPlace = useCallback(async (placeId: string, label: string) => {
    setSearching(true); setSuggestions([]); setShowSuggestions(false)
    try {
      const res  = await fetch(`${PLACES_DETAILS}/${placeId}`, {
        headers: {
          'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
          'X-Goog-FieldMask': 'location',
        },
      })
      const data = await res.json()
      const { latitude, longitude } = data.location
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 11, duration: 1500 })
      setSearchQuery(label.split(',')[0])
    } catch {} finally { setSearching(false) }
  }, [])

  const handleSearch = useCallback(async () => {
    if (suggestions.length > 0) {
      flyToPlace(suggestions[0].placeId, suggestions[0].text)
    }
  }, [suggestions, flyToPlace])

  const handleSelectSuggestion = (s: { placeId: string; text: string }) => {
    flyToPlace(s.placeId, s.text)
  }

  // ── List management ──────────────────────────────────────
  const handleCreateList = async () => {
    if (!newListName.trim() || creatingList) return
    setCreatingList(true)
    try {
      const list = await base44.entities.CallList.create({ name: newListName.trim() }) as any
      setLists(prev => [...prev, list])
      setActiveListId(list.id)
      setNewListName('')
      setShowNewList(false)
    } catch (e) { console.error('Failed to create list', e) }
    finally { setCreatingList(false) }
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
    } catch (e) { console.error('Failed to add target', e) }
    finally { setAddingTarget(false) }
  }

  // ── Tooltip renderer ─────────────────────────────────────
  function renderTooltip(info: HoverInfo) {
    if (info.kind === 'mrms') {
      const size  = info.props.min_size_inches as number
      const color = hailColor(size)
      const dateLabel = info.props.event_date
        ? new Date(info.props.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Unknown date'
      return (
        <div className={styles.tipCard}>
          <div className={styles.tipSourceBadge} style={{ color }}>NOAA · MRMS</div>
          <div className={styles.tipRow}>
            <span className={styles.tipKey}>DATE</span>
            <span className={styles.tipVal}>{dateLabel}</span>
          </div>
          <div className={styles.tipRow}>
            <span className={styles.tipKey}>HAIL SIZE</span>
            <span className={styles.tipVal} style={{ color }}>
              {size >= 1 ? `≥ ${size.toFixed(2)} in` : `≥ ${(size * 25.4).toFixed(0)} mm`}
            </span>
          </div>
        </div>
      )
    }
    const size  = info.props.hailIN as number
    const color = hailColor(size)
    const dateLabel = info.props.dateISO
      ? new Date(info.props.dateISO).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—'
    return (
      <div className={styles.tipCard}>
        <div className={styles.tipSourceBadge} style={{ color: '#f59e0b' }}>XWeather · Confirmed</div>
        <div className={styles.tipRow}>
          <span className={styles.tipKey}>DATE</span>
          <span className={styles.tipVal}>{dateLabel}</span>
        </div>
        <div className={styles.tipRow}>
          <span className={styles.tipKey}>HAIL SIZE</span>
          <span className={styles.tipVal} style={{ color }}>{size.toFixed(2)} in</span>
        </div>
        {info.props.location && (
          <div className={styles.tipRow}>
            <span className={styles.tipKey}>LOCATION</span>
            <span className={styles.tipVal}>{info.props.location}, {info.props.state}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.page}>

      {/* ── Top bar ──────────────────────────────────── */}
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
                  const parts = s.text.split(',')
                  return (
                    <button
                      key={s.placeId}
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

      {/* ── Sidebar ──────────────────────────────────── */}
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

      {/* ── Map ──────────────────────────────────────── */}
      <motion.div
        className={styles.mapWrapper}
        initial={{ opacity: 0, filter: 'blur(14px)' }}
        animate={{ opacity: 1, filter: 'blur(0px)' }}
        transition={{ duration: 1.05, ease: EASE, delay: 0.1 }}
      >
        <div ref={containerRef} className={styles.map} />

        {hoverInfo && (
          <div className={styles.hoverTip}>
            {renderTooltip(hoverInfo)}
          </div>
        )}
      </motion.div>

    </div>
  )
}
