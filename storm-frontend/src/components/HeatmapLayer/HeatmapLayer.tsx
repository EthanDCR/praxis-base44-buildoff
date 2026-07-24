import { useEffect, useRef, useCallback } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'

interface Props {
  points: [number, number, number][] // [lat, lng, intensity 0–1]
  geoRadiusM?: number                // geographic radius to represent, in meters
}

// Convert a geographic radius (meters) to screen pixels at the current zoom/lat
function metersToPixels(map: L.Map, meters: number): number {
  const zoom = map.getZoom()
  const lat  = map.getCenter().lat
  const metersPerPx =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
  return Math.max(6, meters / metersPerPx)
}

export default function HeatmapLayer({ points, geoRadiusM = 5000 }: Props) {
  const map      = useMap()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<any>(null)

  const rebuild = useCallback(() => {
    if (layerRef.current) map.removeLayer(layerRef.current)
    if (!points.length) return

    const r = metersToPixels(map, geoRadiusM)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layerRef.current = (L as any).heatLayer(points, {
      radius:     r,
      blur:       r * 0.65,
      minOpacity: 0.4,
      max:        1.0,
      gradient: {
        0.0:  '#22c55e',
        0.45: '#f59e0b',
        0.75: '#c00021',
        1.0:  '#ff002b',
      },
    }).addTo(map)
  }, [map, points, geoRadiusM])

  useEffect(() => {
    rebuild()
    map.on('zoomend moveend', rebuild)
    return () => {
      map.off('zoomend moveend', rebuild)
      if (layerRef.current) map.removeLayer(layerRef.current)
    }
  }, [map, rebuild])

  return null
}
