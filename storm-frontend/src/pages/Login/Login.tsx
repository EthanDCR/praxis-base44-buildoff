import { useState, type FormEvent } from 'react'
import styles from './Login.module.css'
import type { AppUser } from '../../lib/user-context'

// Shared team PIN — change this to whatever you want
const TEAM_PIN = 'praxis2025'

interface LoginProps {
  onLogin: (user: AppUser) => void
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const [loading, setLoading] = useState(false)

  function triggerShake(msg: string) {
    setError(msg)
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (pin !== TEAM_PIN) {
      triggerShake('Wrong PIN.')
      return
    }
    if (!email.trim()) {
      triggerShake('Enter your email.')
      return
    }
    setLoading(true)
    onLogin({ email: email.trim().toLowerCase() } as AppUser)
  }

  return (
    <div className={styles.page}>
      <div className={`${styles.card} ${shake ? styles.shake : ''}`}>
        <div className={styles.logo}>PRAXIS</div>
        <div className={styles.sub}>Storm Intelligence Platform</div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            className={`${styles.input} ${error ? styles.inputError : ''}`}
            type="email"
            placeholder="Your email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            className={`${styles.input} ${error ? styles.inputError : ''}`}
            type="password"
            placeholder="Team PIN"
            value={pin}
            onChange={e => setPin(e.target.value)}
            required
            autoComplete="off"
          />
          {error && <p className={styles.errorMsg}>{error}</p>}
          <button className={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
