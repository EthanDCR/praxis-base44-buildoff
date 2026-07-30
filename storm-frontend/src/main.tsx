import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import maplibregl from 'maplibre-gl'
// @ts-ignore — Vite inline worker: bundles worker into JS so no .mjs file needs to be served
import MapWorker from 'maplibre-gl/dist/maplibre-gl-csp-worker?worker&inline'
maplibregl.workerClass = MapWorker

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

