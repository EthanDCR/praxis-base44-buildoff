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
      const status = err?.response?.status ?? err?.status ?? err?.statusCode
      const msg = (err?.response?.data?.message ?? err?.response?.data?.detail ?? '').toLowerCase()
      const needsOtp = (status === 400 || status === 403)
        && !msg.includes('already verified')
        && !msg.includes('invalid')
        && !msg.includes('incorrect')
        && !msg.includes('wrong')
      if (needsOtp) {
        setStep('otp')
      } else {
        triggerShake('Invalid email or password.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setLoading(true)
    setError('')
    try {
      await base44.auth.loginWithProvider('google')
      const user = await base44.auth.me()
      onLogin(user as unknown as AppUser)
    } catch {
      triggerShake('Google sign-in failed.')
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
      const user = await base44.auth.me()
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
            {error && (
              <button className={styles.switchMode} type="button" onClick={() => { setStep('otp'); setError('') }}>
                Enter verification code instead
              </button>
            )}

            <div className={styles.divider}>or</div>
            <button className={styles.googleBtn} type="button" onClick={handleGoogle} disabled={loading}>
              <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
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
            <button className={styles.switchMode} type="button" disabled={loading}
              onClick={async () => { await base44.auth.resendOtp(email); setError(''); setOtp('') }}>
              Resend code
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
