import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import * as maplibregl from 'maplibre-gl'
// @ts-ignore — Vite ?raw import embeds worker source in the bundle as a string
import workerSrc from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw'

// Inline the worker as a blob URL so no .mjs file needs to be served by the host
const workerBlob = new Blob([workerSrc], { type: 'application/javascript' })
maplibregl.setWorkerUrl(URL.createObjectURL(workerBlob))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
