import { useState, type FormEvent } from 'react'
import styles from './Login.module.css'
import { base44 } from '../../lib/base44'
import type { AppUser } from '../../lib/user-context'

interface Props { onAuth: (user: AppUser) => void }

export default function Login({ onAuth }: Props) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [shaking, setShaking]   = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { user } = await base44.auth.loginViaEmailPassword(email, password)
      onAuth(user as AppUser)
    } catch (err: any) {
      const msg = err?.status === 403
        ? 'Account not verified — contact your admin.'
        : 'Invalid email or password.'
      setError(msg)
      setShaking(true)
      setTimeout(() => setShaking(false), 500)
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={`${styles.card} ${shaking ? styles.shake : ''}`}>
        <div className={styles.logo}>PRAXIS</div>
        <div className={styles.sub}>Storm Intelligence Platform</div>
        <form className={styles.form} onSubmit={submit}>
          <input
            className={`${styles.input} ${error ? styles.inputError : ''}`}
            type="email"
            placeholder="Email"
            value={email}
            autoComplete="email"
            onChange={e => { setEmail(e.target.value); setError('') }}
          />
          <input
            className={`${styles.input} ${error ? styles.inputError : ''}`}
            type="password"
            placeholder="Password"
            value={password}
            autoComplete="current-password"
            onChange={e => { setPassword(e.target.value); setError('') }}
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
