import { useState, type FormEvent } from 'react'
import styles from './Login.module.css'
import { base44 } from '../../lib/base44'
import type { AppUser } from '../../lib/user-context'

interface LoginProps {
  onLogin: (user: AppUser) => void
}

type Step = 'login' | 'register' | 'otp'

export default function Login({ onLogin }: LoginProps) {
  const [step, setStep] = useState<Step>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)

  function triggerShake(msg: string) {
    setError(msg)
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const user = await base44.auth.loginViaEmailPassword(email, password)
      onLogin(user as unknown as AppUser)
    } catch {
      triggerShake('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) { triggerShake('Password must be at least 8 characters.'); return }
    setLoading(true)
    setError('')
    try {
      await base44.auth.register({ email, password })
      // Try direct login — if OTP is required this will fail and we show the OTP step
      try {
        const user = await base44.auth.loginViaEmailPassword(email, password)
        onLogin(user as unknown as AppUser)
      } catch {
        setStep('otp')
      }
    } catch (err: any) {
      triggerShake(err?.response?.data?.message ?? 'Registration failed. Email may already be in use.')
    } finally {
      setLoading(false)
    }
  }

  async function handleOtp(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await base44.auth.verifyOtp({ email, otpCode: otp })
      const user = await base44.auth.loginViaEmailPassword(email, password)
      onLogin(user as unknown as AppUser)
    } catch {
      triggerShake('Invalid or expired code. Check your email.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={`${styles.card} ${shake ? styles.shake : ''}`}>
        <div className={styles.logo}>PRAXIS</div>
        <div className={styles.sub}>Storm Intelligence Platform</div>

        {step === 'login' && (
          <form className={styles.form} onSubmit={handleLogin}>
            <input
              className={`${styles.input} ${error ? styles.inputError : ''}`}
              type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)}
              required autoComplete="email"
            />
            <input
              className={`${styles.input} ${error ? styles.inputError : ''}`}
              type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)}
              required autoComplete="current-password"
            />
            {error && <p className={styles.errorMsg}>{error}</p>}
            <button className={styles.btn} type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        {step === 'register' && (
          <form className={styles.form} onSubmit={handleRegister}>
            <input
              className={`${styles.input} ${error ? styles.inputError : ''}`}
              type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)}
              required autoComplete="email"
            />
            <input
              className={`${styles.input} ${error ? styles.inputError : ''}`}
              type="password" placeholder="Password (min 8 chars)" value={password}
              onChange={e => setPassword(e.target.value)}
              required autoComplete="new-password"
            />
            {error && <p className={styles.errorMsg}>{error}</p>}
            <button className={styles.btn} type="submit" disabled={loading}>
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form className={styles.form} onSubmit={handleOtp}>
            <p className={styles.errorMsg} style={{ color: 'var(--text-muted)' }}>
              Check your email for a verification code.
            </p>
            <input
              className={`${styles.input} ${error ? styles.inputError : ''}`}
              type="text" placeholder="6-digit code" value={otp}
              onChange={e => setOtp(e.target.value)}
              required autoComplete="one-time-code"
            />
            {error && <p className={styles.errorMsg}>{error}</p>}
            <button className={styles.btn} type="submit" disabled={loading}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        )}

        {step !== 'otp' && (
          <button className={styles.switchMode} onClick={() => { setStep(s => s === 'login' ? 'register' : 'login'); setError('') }}>
            {step === 'login' ? 'Create an account' : 'Back to sign in'}
          </button>
        )}
      </div>
    </div>
  )
}
