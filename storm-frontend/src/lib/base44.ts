import { createClient } from '@base44/sdk'

// appId is injected automatically by `npx base44 dev` via VITE_BASE44_APP_ID
export const base44 = createClient({
  appId: import.meta.env.VITE_BASE44_APP_ID as string,
})
