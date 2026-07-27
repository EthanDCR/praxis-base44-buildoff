import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const ihmAuth = `Basic ${Buffer.from(`${env.VITE_IHM_API_KEY}:${env.VITE_IHM_API_SECRET}`).toString('base64')}`
  const xwId     = env.VITE_XWEATHER_CLIENT_ID
  const xwSecret = env.VITE_XWEATHER_CLIENT_SECRET

  return {
    plugins: [react()],
    server: {
      allowedHosts: true,
      proxy: {
        '/xweather-api': {
          target: 'https://data.api.xweather.com',
          changeOrigin: true,
          rewrite: path => {
            // Strip prefix, inject auth creds as query params server-side
            const stripped = path.replace(/^\/xweather-api/, '')
            const sep = stripped.includes('?') ? '&' : '?'
            return `${stripped}${sep}client_id=${xwId}&client_secret=${xwSecret}`
          },
        },
        '/ihm-api': {
          target: 'https://maps.interactivehailmaps.com',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/ihm-api/, '/ExternalApi'),
          headers: { Authorization: ihmAuth },
        },
      },
    },
  }
})
