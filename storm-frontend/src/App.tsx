import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useLottie } from 'lottie-react'
import animationData from './assets/praxis-animation-lottie.json'
import Navbar from './components/Navbar/Navbar'
import HailMap from './pages/HailMap/HailMap'
import SpeedDial from './pages/SpeedDial/SpeedDial'
import Leads from './pages/Leads/Leads'
import Overwatch from './pages/Overwatch/Overwatch'
import Admin from './pages/Admin/Admin'
import BulkTargets from './pages/BulkTargets/BulkTargets'
import Login from './pages/Login/Login'
import { base44 } from './lib/base44'
import { UserProvider, type AppUser } from './lib/user-context'
import { DataStoreProvider } from './lib/data-store'

type Phase = 'splash' | 'login' | 'app'

function Splash({ onDone }: { onDone: () => void }) {
  const { View, setSpeed } = useLottie({
    animationData,
    loop: false,
    autoplay: true,
    style: { width: '650px', maxWidth: '80vw' },
    onComplete: onDone,
  })
  setSpeed(0.75)

  return (
    <motion.div
      style={{
        position: 'fixed', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)',
      }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {View}
    </motion.div>
  )
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('splash')
  const [user, setUser] = useState<AppUser | null>(null)

  async function resolveUser(me: AppUser): Promise<AppUser> {
    try {
      const profiles = await base44.entities.UserProfile.filter({ email: me.email }, undefined, 1) as any[]
      const profile = profiles[0]
      if (profile?.role) return { ...me, role: profile.role }
    } catch {}
    return me
  }

  async function onSplashDone() {
    if (import.meta.env.DEV) { setPhase('app'); return }
    try {
      const me = await base44.auth.me() as AppUser
      setUser(await resolveUser(me))
      setPhase('app')
    } catch {
      setPhase('login')
    }
  }

  async function onLogin(user: AppUser) {
    setUser(await resolveUser(user))
    setPhase('app')
  }

  return (
    <UserProvider value={user}>
      <AnimatePresence mode="wait">
        {phase === 'splash' && (
          <Splash key="splash" onDone={onSplashDone} />
        )}
        {phase === 'login' && (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <Login onLogin={onLogin} />
          </motion.div>
        )}
        {phase === 'app' && (
          <DataStoreProvider>
            <motion.div
              key="app"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35 }}
              style={{ height: '100%' }}
            >
              <BrowserRouter>
                <Navbar />
                <Routes>
                  <Route path="/" element={<HailMap />} />
                  <Route path="/speed-dial" element={<SpeedDial />} />
                  <Route path="/leads" element={<Leads />} />
                  <Route path="/overwatch" element={<Overwatch />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/bulk-targets" element={<BulkTargets />} />
                </Routes>
              </BrowserRouter>
            </motion.div>
          </DataStoreProvider>
        )}
      </AnimatePresence>
    </UserProvider>
  )
}
