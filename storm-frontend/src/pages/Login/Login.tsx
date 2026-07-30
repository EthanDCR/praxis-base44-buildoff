import { useState, type FormEvent } from 'react'
import styles from './Login.module.css'
import { base44 } from '../../lib/base44'
import type { AppUser } from '../../lib/user-context'

interface LoginProps {
  onLogin: (user: AppUser) => void
}

type Step = 'login' | 'otp'

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
    } catch (err: any) {
      if (err?.response?.status === 400) {
        // Account exists but email not verified yet — switch to OTP step
        setStep('otp')
      } else {
        triggerShake('Invalid email or password.')
      }
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
      triggerShake('Invalid or expired code.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={`${styles.card} ${shake ? styles.shake : ''}`}>
        <div className={styles.logo}>PRAXIS</div>
        <div className={styles.sub}>Storm Intelligence Platform</div>

        {step === 'login' ? (
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
        ) : (
          <form className={styles.form} onSubmit={handleOtp}>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 4px', textAlign: 'center' }}>
              Check {email} for a verification code.
            </p>
            <input
              className={`${styles.input} ${error ? styles.inputError : ''}`}
              type="text" placeholder="6-digit code" value={otp}
              onChange={e => setOtp(e.target.value)}
              required autoFocus autoComplete="one-time-code"
            />
            {error && <p className={styles.errorMsg}>{error}</p>}
            <button className={styles.btn} type="submit" disabled={loading}>
              {loading ? 'Verifying…' : 'Verify & Sign In'}
            </button>
            <button className={styles.switchMode} type="button" onClick={() => { setStep('login'); setError('') }}>
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
