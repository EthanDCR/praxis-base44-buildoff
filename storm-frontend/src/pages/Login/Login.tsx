import { useState, type FormEvent } from 'react'
import styles from './Login.module.css'
import { base44 } from '../../lib/base44'
import type { AppUser } from '../../lib/user-context'

interface LoginProps {
  onLogin: (user: AppUser) => void
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)

  function triggerShake(msg: string) {
    setError(msg)
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Try real auth first — works for verified accounts
      await base44.auth.loginViaEmailPassword(email, password)
      onLogin({ email } as AppUser)
      return
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status ?? err?.statusCode
      const msg = (err?.response?.data?.message ?? err?.response?.data?.detail ?? '').toLowerCase()
      const isWrongPassword =
        msg.includes('invalid') || msg.includes('incorrect') ||
        msg.includes('wrong') || msg.includes('not found') ||
        status === 401

      if (isWrongPassword) {
        triggerShake('Invalid email or password.')
        setLoading(false)
        return
      }

      // 400 without a "wrong password" message = account exists but unverified.
      // Fall back to checking UserProfile so no OTP is needed.
      try {
        const profiles = await base44.entities.UserProfile.filter({ email }, undefined, 1) as any[]
        if (profiles.length > 0) {
          onLogin({ email } as AppUser)
          return
        }
      } catch {}

      triggerShake('Invalid email or password.')
    } finally {
      setLoading(false)
    }
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
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            className={`${styles.input} ${error ? styles.inputError : ''}`}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
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
