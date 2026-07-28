import { useState, FormEvent } from 'react'
import styles from './Login.module.css'

const VALID_USER = import.meta.env.VITE_AUTH_USERNAME as string
const VALID_PASS = import.meta.env.VITE_AUTH_PASSWORD as string

interface Props { onAuth: () => void }

export default function Login({ onAuth }: Props) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [shaking, setShaking]   = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    if (email === VALID_USER && password === VALID_PASS) {
      localStorage.setItem('praxis_auth', '1')
      onAuth()
    } else {
      setError('Invalid email or password')
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
