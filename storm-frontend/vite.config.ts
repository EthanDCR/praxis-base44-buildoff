import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const ihmAuth = `Basic ${Buffer.from(`${env.VITE_IHM_API_KEY}:${env.VITE_IHM_API_SECRET}`).toString('base64')}`

  return {
    plugins: [react()],
    server: {
      allowedHosts: true,
      proxy: {
        '/swath-api': {
          target: 'https://swathapi.com',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/swath-api/, ''),
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
