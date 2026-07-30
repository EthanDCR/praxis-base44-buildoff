import { useState, useEffect, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { base44 } from '../../lib/base44'
import { useUser } from '../../lib/user-context'
import styles from './Admin.module.css'

const EASE = [0.22, 1, 0.36, 1] as const

interface UserProfile {
  id: string
  email: string
  full_name?: string
  twilio_number?: string
  twilio_identity?: string
  role?: 'admin' | 'rep'
  active?: boolean
}

type Panel = 'new' | { profile: UserProfile }

export default function Admin() {
  const currentUser = useUser()
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)

  useEffect(() => {
    if (!currentUser?.email) return
    // Check if the logged-in user has admin role in UserProfile
    base44.entities.UserProfile.filter({ email: currentUser.email }, undefined, 1)
      .then((d: any) => {
        const profile = d[0]
        setIsAdmin(profile?.role === 'admin')
      })
      .catch(() => setIsAdmin(false))
  }, [currentUser?.email])

  useEffect(() => {
    if (!isAdmin) return
    base44.entities.UserProfile.list()
      .then((d: any) => setProfiles(d))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [isAdmin])

  function openNew() { setPanel('new') }
  function openEdit(p: UserProfile) { setPanel({ profile: p }) }
  function closePanel() { setPanel(null) }

  function onCreated(profile: UserProfile) {
    setProfiles(prev => [profile, ...prev])
    setPanel({ profile })
  }

  function onUpdated(profile: UserProfile) {
    setProfiles(prev => prev.map(p => p.id === profile.id ? profile : p))
    setPanel({ profile })
  }

  function onDeleted(id: string) {
    setProfiles(prev => prev.filter(p => p.id !== id))
    setPanel(null)
  }

  const activeId = panel && panel !== 'new' ? panel.profile.id : null

  if (isAdmin === null) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - var(--nav-height))', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Checking access…</div>
  }

  if (isAdmin === false) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - var(--nav-height))', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Access denied.</div>
  }

  return (
    <div className={styles.page}>
      <motion.div
        className={styles.topBar}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <span className={styles.pageTitle}>TEAM MANAGEMENT</span>
      </motion.div>

      <div className={styles.body}>
        {/* ── User list ── */}
        <motion.div
          className={styles.listPanel}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08, duration: 0.5, ease: EASE }}
        >
          <div className={styles.listHeader}>
            <span className={styles.listLabel}>REPS</span>
            <button className={styles.addBtn} onClick={openNew}>+ Add Rep</button>
          </div>
          <div className={styles.listScroll}>
            {loading && <div className={styles.emptyList}>Loading…</div>}
            {!loading && profiles.length === 0 && (
              <div className={styles.emptyList}>No reps yet. Add the first one.</div>
            )}
            {profiles.map(p => (
              <button
                key={p.id}
                className={`${styles.userRow} ${p.id === activeId ? styles.userRowActive : ''}`}
                onClick={() => openEdit(p)}
              >
                <div className={styles.userAvatar}>
                  {(p.full_name ?? p.email).charAt(0).toUpperCase()}
                </div>
                <div className={styles.userInfo}>
                  <div className={styles.userName}>{p.full_name ?? p.email}</div>
                  <div className={styles.userEmail}>{p.email}</div>
                  {p.twilio_number && (
                    <div className={styles.twilioTag}>{p.twilio_number}</div>
                  )}
                </div>
                <span className={styles.userBadge}>{p.role ?? 'rep'}</span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* ── Detail panel ── */}
        <motion.div
          className={styles.detailPanel}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.12, duration: 0.5, ease: EASE }}
        >
          {!panel && (
            <div className={styles.emptyDetail}>Select a rep or add a new one</div>
          )}
          {panel === 'new' && (
            <NewUserForm onCreated={onCreated} onCancel={closePanel} />
          )}
          {panel && panel !== 'new' && (
            <EditUserForm
              key={panel.profile.id}
              profile={panel.profile}
              onUpdated={onUpdated}
              onDeleted={onDeleted}
              onCancel={closePanel}
            />
          )}
        </motion.div>
      </div>
    </div>
  )
}

/* ── New user form ─────────────────────────────────────────────── */

function NewUserForm({
  onCreated,
  onCancel,
}: {
  onCreated: (p: UserProfile) => void
  onCancel: () => void
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [twilioNumber, setTwilioNumber] = useState('')
  const [twilioIdentity, setTwilioIdentity] = useState('')
  const [role, setRole] = useState<'rep' | 'admin'>('rep')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      // 1. Create Base44 account (full_name set via UserProfile entity)
      await base44.auth.register({ email, password })

      // 2. Save UserProfile entity
      const profile = await base44.entities.UserProfile.create({
        email,
        full_name: fullName,
        twilio_number: twilioNumber || undefined,
        twilio_identity: twilioIdentity || undefined,
        role,
        active: true,
      })

      setSuccess(`Account created. Send ${fullName || email} their credentials to log in.`)
      onCreated(profile as UserProfile)
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to create account. Email may already be in use.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className={styles.formTitle}>ADD REP</div>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>FULL NAME</label>
          <input className={styles.input} type="text" placeholder="Jane Smith"
            value={fullName} onChange={e => setFullName(e.target.value)} required />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>EMAIL</label>
          <input className={styles.input} type="email" placeholder="jane@company.com"
            value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>INITIAL PASSWORD</label>
          <input className={styles.input} type="password" placeholder="Min 8 characters"
            value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>ROLE</label>
          <select className={styles.input} value={role}
            onChange={e => setRole(e.target.value as 'rep' | 'admin')}>
            <option value="rep">Rep</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div className={styles.divider} />
        <div className={styles.sectionLabel}>TWILIO</div>
        <p className={styles.twilioHint}>Assign a number now or update later.</p>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>PHONE NUMBER</label>
          <input className={styles.input} type="tel" placeholder="+15551234567"
            value={twilioNumber} onChange={e => setTwilioNumber(e.target.value)} />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>IDENTITY</label>
          <input className={styles.input} type="text" placeholder="e.g. jane_smith"
            value={twilioIdentity} onChange={e => setTwilioIdentity(e.target.value)} />
        </div>

        {error && <p className={styles.errorMsg}>{error}</p>}
        {success && <p className={styles.successMsg}>{success}</p>}

        <div className={styles.formActions}>
          <button className={styles.submitBtn} type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create Account'}
          </button>
          <button className={styles.cancelBtn} type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </>
  )
}

/* ── Edit user form ────────────────────────────────────────────── */

function EditUserForm({
  profile,
  onUpdated,
  onDeleted,
  onCancel,
}: {
  profile: UserProfile
  onUpdated: (p: UserProfile) => void
  onDeleted: (id: string) => void
  onCancel: () => void
}) {
  const [fullName, setFullName] = useState(profile.full_name ?? '')
  const [twilioNumber, setTwilioNumber] = useState(profile.twilio_number ?? '')
  const [twilioIdentity, setTwilioIdentity] = useState(profile.twilio_identity ?? '')
  const [role, setRole] = useState<'rep' | 'admin'>(profile.role ?? 'rep')
  const [active, setActive] = useState(profile.active ?? true)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const updated = await base44.entities.UserProfile.update(profile.id, {
        full_name: fullName,
        twilio_number: twilioNumber || undefined,
        twilio_identity: twilioIdentity || undefined,
        role,
        active,
      })
      setSuccess('Saved.')
      onUpdated(updated as UserProfile)
    } catch {
      setError('Failed to save changes.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove ${profile.full_name ?? profile.email} from the team? This only removes their profile — their Base44 account remains.`)) return
    setDeleting(true)
    try {
      await base44.entities.UserProfile.delete(profile.id)
      onDeleted(profile.id)
    } catch {
      setError('Failed to delete.')
      setDeleting(false)
    }
  }

  return (
    <>
      <div className={styles.formTitle}>EDIT REP</div>
      <form className={styles.form} onSubmit={handleSave}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>EMAIL</label>
          <input className={styles.input} type="text" value={profile.email} disabled />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>FULL NAME</label>
          <input className={styles.input} type="text" value={fullName}
            onChange={e => setFullName(e.target.value)} />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>ROLE</label>
          <select className={styles.input} value={role}
            onChange={e => setRole(e.target.value as 'rep' | 'admin')}>
            <option value="rep">Rep</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>STATUS</label>
          <select className={styles.input} value={active ? 'active' : 'inactive'}
            onChange={e => setActive(e.target.value === 'active')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className={styles.divider} />
        <div className={styles.sectionLabel}>TWILIO</div>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>PHONE NUMBER</label>
          <input className={styles.input} type="tel" placeholder="+15551234567"
            value={twilioNumber} onChange={e => setTwilioNumber(e.target.value)} />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>IDENTITY</label>
          <input className={styles.input} type="text" placeholder="e.g. jane_smith"
            value={twilioIdentity} onChange={e => setTwilioIdentity(e.target.value)} />
        </div>

        {error && <p className={styles.errorMsg}>{error}</p>}
        {success && <p className={styles.successMsg}>{success}</p>}

        <div className={styles.formActions}>
          <button className={styles.submitBtn} type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Save Changes'}
          </button>
          <button className={styles.cancelBtn} type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>

      <button className={styles.deleteBtn} onClick={handleDelete} disabled={deleting}>
        {deleting ? 'Removing…' : 'Remove from team'}
      </button>
    </>
  )
}
