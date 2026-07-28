import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useLottie } from 'lottie-react'
import animationData from './assets/praxis-animation-lottie.json'
import Navbar from './components/Navbar/Navbar'
import HailMap from './pages/HailMap/HailMap'
import SpeedDial from './pages/SpeedDial/SpeedDial'
import Leads from './pages/Leads/Leads'
import Login from './pages/Login/Login'

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
  const alreadyAuthed = localStorage.getItem('praxis_auth') === '1'
  const [phase, setPhase] = useState<Phase>(alreadyAuthed ? 'app' : 'splash')
  const [authed, setAuthed] = useState(alreadyAuthed)

  function onAuth() {
    setAuthed(true)
    setPhase('app')
  }

  return (
    <AnimatePresence mode="wait">
      {phase === 'splash' && (
        <Splash key="splash" onDone={() => setPhase('login')} />
      )}
      {phase === 'login' && !authed && (
        <motion.div
          key="login"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <Login onAuth={onAuth} />
        </motion.div>
      )}
      {phase === 'app' && authed && (
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
            </Routes>
          </BrowserRouter>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
