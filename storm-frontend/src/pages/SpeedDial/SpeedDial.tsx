import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Device, Call } from '@twilio/voice-sdk'
import { base44 } from '../../lib/base44'
import styles from './SpeedDial.module.css'

const EASE = [0.22, 1, 0.36, 1] as const

interface Contact {
  name: string
  company?: string
  title?: string
  phones: string[]
  emails: string[]
}

interface Target {
  id: string
  list_id: string
  line1: string
  line2?: string
  property_type?: string
  property_subtype?: string
  year_built?: string
  contacts?: Contact[]
  status: 'new' | 'called' | 'callback' | 'not_interested' | 'sold'
  notes?: string
}

interface CallList { id: string; name: string }
interface Utterance { speaker: 'agent' | 'contact'; text: string; ts: number }

type Filter       = 'all' | 'new' | 'callback'
type CallState    = 'idle' | 'active'
type OutcomeOption =
  | 'lead_set'
  | 'scheduled_callback'
  | 'told_no'
  | 'gate_keeper'
  | 'voicemail'
  | 'no_answer'
  | 'wrong_person'
  | 'wrong_person_same_name'
  | 'dead_number'

const OUTCOME_LABEL: Record<OutcomeOption, string> = {
  lead_set:               'Inspection Set',
  scheduled_callback:     'Scheduled Callback',
  told_no:                'Told No',
  gate_keeper:            'Gate Keeper',
  voicemail:              'Voicemail',
  no_answer:              'No Answer',
  wrong_person:           'Wrong Person',
  wrong_person_same_name: 'Wrong Person / Same Name',
  dead_number:            'Dead Number',
}

const OUTCOME_TO_STATUS: Record<OutcomeOption, Target['status']> = {
  lead_set:               'sold',
  scheduled_callback:     'callback',
  told_no:                'not_interested',
  gate_keeper:            'called',
  voicemail:              'called',
  no_answer:              'called',
  wrong_person:           'called',
  wrong_person_same_name: 'called',
  dead_number:            'called',
}

interface DailyStats { date: string; calls: number; dms: number; leads: number }

function todayStr() { return new Date().toISOString().slice(0, 10) }

function loadDailyStats(): DailyStats {
  try {
    const raw = localStorage.getItem('storm_daily_stats')
    if (!raw) return { date: todayStr(), calls: 0, dms: 0, leads: 0 }
    const parsed = JSON.parse(raw) as DailyStats
    return parsed.date === todayStr() ? parsed : { date: todayStr(), calls: 0, dms: 0, leads: 0 }
  } catch { return { date: todayStr(), calls: 0, dms: 0, leads: 0 } }
}

function saveDailyStats(s: DailyStats) {
  localStorage.setItem('storm_daily_stats', JSON.stringify(s))
}

const STATUS_LABEL: Record<string, string> = {
  new: 'New', called: 'Called', callback: 'Callback',
  not_interested: 'Not Interested', sold: 'Inspection Set',
}

function formatDuration(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function SpeedDial() {
  const [lists, setLists]               = useState<CallList[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [targets, setTargets]           = useState<Target[]>([])
  const [activeId, setActiveId]         = useState<string | null>(null)
  const [filter, setFilter]             = useState<Filter>('all')
  const [loadingTargets, setLoadingTargets] = useState(false)
  const [saving, setSaving]             = useState(false)
  const [showListDrop, setShowListDrop] = useState(false)

  // Outcome modal
  const [showOutcomeModal, setShowOutcomeModal] = useState(false)
  const [outcomeSelection, setOutcomeSelection] = useState<OutcomeOption | null>(null)

  // Notes on the target card (independent from outcome logging)
  const [notesDraft, setNotesDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  // Phone index tracker for multi-phone targets
  const [activePhoneIdx, setActivePhoneIdx] = useState(0)

  // Daily call tracker (persisted in localStorage, resets at midnight)
  const [dailyStats, setDailyStats] = useState<DailyStats>(loadDailyStats)

  // Dialer
  const [twilioReady, setTwilioReady]     = useState(false)
  const [dialerPhone, setDialerPhone]     = useState<string | null>(null)
  const [dialerContact, setDialerContact] = useState<string | null>(null)
  const [callState, setCallState]         = useState<CallState>('idle')
  const [callSeconds, setCallSeconds]     = useState(0)
  const [autoDialing, setAutoDialing]     = useState(false)

  // Transcript (wired to Twilio when connected)
  const [transcript, setTranscript] = useState<Utterance[]>([])

  const listDropRef      = useRef<HTMLDivElement>(null)
  const activeItemRef    = useRef<HTMLButtonElement | null>(null)
  const activePhoneRef   = useRef<HTMLDivElement | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null)
  const deviceRef        = useRef<Device | null>(null)
  const activeCallRef    = useRef<Call | null>(null)

  useEffect(() => {
    base44.entities.CallList.list().then((d: any) => setLists(d)).catch(console.error)
  }, [])

  // Initialize Twilio Device
  useEffect(() => {
    const tokenUrl = import.meta.env.VITE_TWILIO_TOKEN_URL
    if (!tokenUrl) return

    let device: Device

    async function setup() {
      try {
        const res = await fetch(tokenUrl)
        if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`)
        const { token } = await res.json()

        device = new Device(token, { logLevel: 'silent' as any })
        deviceRef.current = device

        device.on('registered',   () => setTwilioReady(true))
        device.on('unregistered', () => setTwilioReady(false))
        device.on('error',        (err) => { console.error('Twilio:', err); setTwilioReady(false) })

        await device.register()
      } catch (err) {
        console.error('Twilio setup failed:', err)
      }
    }

    setup()
    return () => { device?.destroy() }
  }, [])

  const [allTargets, setAllTargets] = useState<Target[]>([])

  // Load everything once on mount
  useEffect(() => {
    setLoadingTargets(true)
    base44.entities.Target.list()
      .then((d: any) => {
        setAllTargets(d)
        const pool = d.filter((t: Target) => t.status === 'new' || t.status === 'callback')
        if (pool[0]) setActiveId(pool[0].id)
      })
      .catch(console.error)
      .finally(() => setLoadingTargets(false))
  }, [])

  // List filter is client-side
  useEffect(() => {
    const pool = activeListId
      ? allTargets.filter(t => t.list_id === activeListId)
      : allTargets
    setTargets(pool)
    setActiveId(null)
    setAutoDialing(false)
    const first = pool.find(t => t.status === 'new' || t.status === 'callback')
    if (first) setActiveId(first.id)
  }, [activeListId, allTargets])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (listDropRef.current && !listDropRef.current.contains(e.target as Node))
        setShowListDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  useEffect(() => {
    activePhoneRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [dialerPhone])

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  useEffect(() => {
    if (callState === 'active') {
      setCallSeconds(0)
      timerRef.current = setInterval(() => setCallSeconds(s => s + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [callState])

  const activeTarget = targets.find(t => t.id === activeId) ?? null
  const activeList   = lists.find(l => l.id === activeListId)

  // Sync notes draft whenever we switch to a different target
  useEffect(() => {
    setNotesDraft(activeTarget?.notes ?? '')
  }, [activeId])

  const visibleTargets = filter === 'all' ? targets : targets.filter(t => t.status === filter)

  const stats = {
    total:    targets.length,
    new:      targets.filter(t => t.status === 'new').length,
    callback: targets.filter(t => t.status === 'callback').length,
    sold:     targets.filter(t => t.status === 'sold').length,
  }

  function findNext(fromId: string): Target | null {
    const idx  = targets.findIndex(t => t.id === fromId)
    const pool = [...targets.slice(idx + 1), ...targets.slice(0, idx)]
    return pool.find(t => t.status === 'new' || t.status === 'callback') ?? null
  }

  function resetCall() {
    setCallState('idle')
    setCallSeconds(0)
  }

  function onCallDisconnected() {
    activeCallRef.current = null
    resetCall()
    setOutcomeSelection(null)
    setShowOutcomeModal(true)
  }

  async function initiateCall(phone: string, contactName: string) {
    if (!twilioReady || !deviceRef.current) return
    setDialerPhone(phone)
    setDialerContact(contactName)
    setTranscript([])
    try {
      const call = await deviceRef.current.connect({ params: { To: phone } })
      activeCallRef.current = call
      setCallState('active')
      call.on('disconnect', onCallDisconnected)
      call.on('error', (err: unknown) => { console.error('Call error:', err); onCallDisconnected() })
    } catch (err) {
      console.error('Failed to connect:', err)
    }
  }

  function hangUp() {
    if (activeCallRef.current) {
      activeCallRef.current.disconnect()
      // onCallDisconnected fires via the 'disconnect' event on the call
    } else {
      onCallDisconnected()
    }
  }

  function loadDialer(phone: string, contactName: string) {
    if (callState === 'active') resetCall()
    setDialerPhone(phone)
    setDialerContact(contactName)
  }

  function startAutoDialing() {
    setAutoDialing(true)
    setActivePhoneIdx(0)
    const phone = activeTarget?.contacts?.[0]?.phones?.[0]
    const name  = activeTarget?.contacts?.[0]?.name ?? ''
    if (phone) initiateCall(phone, name)
  }

  async function saveNote() {
    if (!activeId || noteSaving) return
    setNoteSaving(true)
    try {
      await base44.entities.Target.update(activeId, { notes: notesDraft })
      setTargets(prev => prev.map(t => t.id === activeId ? { ...t, notes: notesDraft } : t))
      setAllTargets(prev => prev.map(t => t.id === activeId ? { ...t, notes: notesDraft } : t))
    } catch (e) {
      console.error(e)
    } finally {
      setNoteSaving(false)
    }
  }

  function stopAutoDialing() {
    setAutoDialing(false)
    if (callState === 'active') {
      hangUp()
    } else {
      resetCall()
    }
  }

  async function logOutcome(outcome: OutcomeOption) {
    if (!activeId) return
    const id     = activeId
    const status = OUTCOME_TO_STATUS[outcome]

    // Multi-phone: try next number on same target before moving on
    const currentTarget  = targets.find(t => t.id === id)
    const allPhones      = currentTarget?.contacts?.[0]?.phones ?? []
    const nextPhoneIdx   = activePhoneIdx + 1
    const shouldTryNextPhone =
      (outcome === 'voicemail' || outcome === 'no_answer' || outcome === 'dead_number') &&
      nextPhoneIdx < allPhones.length

    setSaving(true)
    try {
      await base44.entities.Target.update(id, { status })
      setTargets(prev => prev.map(t => t.id === id ? { ...t, status } : t))
      setAllTargets(prev => prev.map(t => t.id === id ? { ...t, status } : t))
      setShowOutcomeModal(false)
      setOutcomeSelection(null)

      // Update daily counters
      const isDM   = outcome === 'told_no' || outcome === 'lead_set' || outcome === 'scheduled_callback'
      const isLead = outcome === 'lead_set'
      setDailyStats(prev => {
        const next = { ...prev, calls: prev.calls + 1, dms: prev.dms + (isDM ? 1 : 0), leads: prev.leads + (isLead ? 1 : 0) }
        saveDailyStats(next)
        return next
      })

      if (shouldTryNextPhone) {
        // Stay on same target, dial the next phone number
        setActivePhoneIdx(nextPhoneIdx)
        if (autoDialing) {
          const phone = allPhones[nextPhoneIdx]
          const name  = currentTarget?.contacts?.[0]?.name ?? ''
          setTimeout(() => initiateCall(phone, name), 600)
        }
      } else {
        // Advance to the next target
        setActivePhoneIdx(0)
        const next = findNext(id)
        setActiveId(next?.id ?? null)
        if (autoDialing && next) {
          const phone = next.contacts?.[0]?.phones?.[0]
          const name  = next.contacts?.[0]?.name ?? ''
          if (phone) setTimeout(() => initiateCall(phone, name), 600)
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  function stepTarget(dir: 1 | -1) {
    const idx = targets.findIndex(t => t.id === activeId)
    const next = targets[idx + dir]
    if (next) setActiveId(next.id)
  }

  const canStartDialing = !!activeTarget && !loadingTargets && twilioReady

  return (
    <div className={styles.page}>

      {/* ── Outcome modal — blocks until logged ─────────────────────── */}
      <AnimatePresence>
        {showOutcomeModal && (
          <motion.div
            className={styles.modalOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              className={styles.modalPanel}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              <div className={styles.modalHeader}>
                <span className={styles.modalTitle}>Log Outcome</span>
                {(dialerContact || dialerPhone) && (
                  <span className={styles.modalContext}>
                    {[dialerContact, dialerPhone].filter(Boolean).join('  ·  ')}
                  </span>
                )}
              </div>

              <div className={styles.outcomeGrid}>
                {(Object.keys(OUTCOME_LABEL) as OutcomeOption[]).map(opt => (
                  <button
                    key={opt}
                    className={[
                      styles.outcomeOption,
                      outcomeSelection === opt ? styles.outcomeOptionSelected : '',
                      opt === 'dead_number' ? styles.outcomeOptionWide : '',
                    ].join(' ')}
                    onClick={() => setOutcomeSelection(opt)}
                  >
                    {OUTCOME_LABEL[opt]}
                  </button>
                ))}
              </div>

              <div className={styles.modalFooter}>
                <button
                  className={styles.modalSubmit}
                  disabled={!outcomeSelection || saving}
                  onClick={() => outcomeSelection && logOutcome(outcomeSelection)}
                >
                  {saving ? 'Saving…' : 'Log & Continue'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <motion.div
        className={styles.topBar}
        initial={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <div className={styles.topLeft}>
          <span className={styles.pageTitle}>TARGETS</span>

          <div className={styles.listWrap} ref={listDropRef}>
            <button className={styles.listTrigger} onClick={() => setShowListDrop(d => !d)}>
              <span className={activeList ? styles.listVal : styles.listPlaceholder}>
                {activeList ? activeList.name : 'All Targets'}
              </span>
              <span className={`${styles.chevron} ${showListDrop ? styles.chevronOpen : ''}`}>▾</span>
            </button>
            <AnimatePresence>
              {showListDrop && (
                <motion.div
                  className={styles.listDrop}
                  initial={{ opacity: 0, y: -6, scaleY: 0.92 }}
                  animate={{ opacity: 1, y: 0, scaleY: 1 }}
                  exit={{ opacity: 0, y: -4, scaleY: 0.94 }}
                  transition={{ duration: 0.18, ease: EASE }}
                  style={{ transformOrigin: 'top' }}
                >
                  <button
                    className={`${styles.listOpt} ${!activeListId ? styles.listOptActive : ''}`}
                    onClick={() => { setActiveListId(null); setShowListDrop(false) }}
                  >
                    {!activeListId && <span className={styles.listOptDot} />}
                    All Targets
                  </button>
                  {lists.map(l => (
                    <button
                      key={l.id}
                      className={`${styles.listOpt} ${l.id === activeListId ? styles.listOptActive : ''}`}
                      onClick={() => { setActiveListId(l.id); setShowListDrop(false) }}
                    >
                      {l.id === activeListId && <span className={styles.listOptDot} />}
                      {l.name}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>

        <div className={styles.dailyTracker}>
          <span className={styles.stat}><span className={styles.statNum}>{dailyStats.calls}</span> calls</span>
          <span className={styles.statDiv} />
          <span className={styles.stat}><span className={styles.statNum}>{dailyStats.dms}</span> dm</span>
          <span className={styles.statDiv} />
          <span className={styles.stat}><span className={styles.statNum}>{dailyStats.leads}</span> leads</span>
        </div>

        {autoDialing ? (
          <button className={styles.stopBtn} onClick={stopAutoDialing}>
            Stop Dialing
          </button>
        ) : (
          <button
            className={styles.startBtn}
            disabled={!canStartDialing}
            onClick={startAutoDialing}
          >
            Start Dialing
          </button>
        )}
      </motion.div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className={styles.body}>

        {/* Queue */}
        <motion.div
          className={styles.queue}
          initial={{ opacity: 0, x: -16, filter: 'blur(6px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          transition={{ delay: 0.1, duration: 0.6, ease: EASE }}
        >
          <div className={styles.filterWrap}>
            <div className={styles.filterRow}>
              {(['all', 'new', 'callback'] as Filter[]).map(f => (
                <button
                  key={f}
                  className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'new' ? 'New' : 'Callback'}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.queueList}>
            {loadingTargets && <div className={styles.queueEmpty}>Loading…</div>}
            {!loadingTargets && visibleTargets.length === 0 && (
              <div className={styles.queueEmpty}>No targets in this filter</div>
            )}
            {!loadingTargets && visibleTargets.map(t => (
              <button
                key={t.id}
                ref={t.id === activeId ? (el => { activeItemRef.current = el }) : null}
                className={[
                  styles.queueItem,
                  t.id === activeId ? styles.queueItemActive : '',
                  ['not_interested', 'sold', 'called'].includes(t.status) ? styles.queueItemDone : '',
                  t.status === 'new'          ? styles.queueItemStatusNew      : '',
                  t.status === 'callback'     ? styles.queueItemStatusCallback  : '',
                  t.status === 'called'       ? styles.queueItemStatusCalled    : '',
                ].join(' ')}
                onClick={() => setActiveId(t.id)}
              >
                <span className={styles.qAddr}>{t.line1}</span>
                {t.contacts?.[0]?.name && (
                  <span className={styles.qContact}>{t.contacts[0].name}</span>
                )}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Workspace */}
        <motion.div
          className={styles.workspace}
          initial={{ opacity: 0, filter: 'blur(6px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ delay: 0.15, duration: 0.6, ease: EASE }}
        >

          {/* Target info */}
          <div className={styles.targetInfo}>
            <AnimatePresence mode="wait">
              {loadingTargets ? (
                <motion.div key="loading" className={styles.emptyState}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  Loading…
                </motion.div>
              ) : !activeTarget ? (
                <motion.div key="done" className={styles.emptyState}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  All targets worked — {stats.sold} inspections set
                </motion.div>
              ) : (
                <motion.div
                  key={activeTarget.id}
                  className={styles.target}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.3, ease: EASE }}
                >
                  <div className={styles.targetHead}>
                    <div>
                      <div className={styles.address}>{activeTarget.line1}</div>
                      {activeTarget.line2 && <div className={styles.addressSub}>{activeTarget.line2}</div>}
                    </div>
                    <div className={styles.headRight}>
                      <span className={[
                        styles.statusLabel,
                        activeTarget.status === 'new'          ? styles.statusNew          : '',
                        activeTarget.status === 'callback'     ? styles.statusCallback     : '',
                        activeTarget.status === 'called'       ? styles.statusCalled       : '',
                        activeTarget.status === 'not_interested'? styles.statusNotInterested: '',
                        activeTarget.status === 'sold'         ? styles.statusSold         : '',
                      ].join(' ')}>{STATUS_LABEL[activeTarget.status]}</span>
                      <div className={styles.navBtns}>
                        <button className={styles.navBtn} onClick={() => stepTarget(-1)}>← Prev</button>
                        <button className={styles.navBtn} onClick={() => stepTarget(1)}>Next →</button>
                      </div>
                    </div>
                  </div>

                  {(activeTarget.property_type || activeTarget.year_built) && (
                    <div className={styles.propMeta}>
                      {[
                        activeTarget.property_type,
                        activeTarget.property_subtype,
                        activeTarget.year_built ? `Built ${activeTarget.year_built}` : null,
                      ].filter(Boolean).join('  ·  ')}
                    </div>
                  )}

                  <div className={styles.contacts}>
                    {(!activeTarget.contacts || activeTarget.contacts.length === 0) ? (
                      <p className={styles.noContacts}>No contact data</p>
                    ) : (
                      activeTarget.contacts.map((c, i) => (
                        <div key={i} className={styles.contact}>
                          <div className={styles.contactHeader}>
                            <div className={styles.contactName}>{c.name}</div>
                            {(c.title || c.company) && (
                              <div className={styles.contactRole}>
                                {[c.title, c.company].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                          {c.phones.length > 0 && (
                            <div className={styles.contactSection}>
                              <div className={styles.contactSectionLabel}>Phones</div>
                              {c.phones.map((p, j) => {
                                const isActive = dialerPhone === p
                                return (
                                  <div
                                    key={j}
                                    ref={isActive ? activePhoneRef : null}
                                    className={`${styles.phoneRow} ${isActive ? styles.phoneRowActive : ''}`}
                                  >
                                    <span className={`${styles.phone} ${isActive ? styles.phoneActive : ''}`}>{p}</span>
                                    <button
                                      className={`${styles.dialLoadBtn} ${isActive ? styles.dialLoadBtnActive : ''}`}
                                      onClick={() => loadDialer(p, c.name)}
                                      title={isActive ? 'Loaded' : 'Dial'}
                                    >
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
                                      </svg>
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          {c.emails.length > 0 && (
                            <div className={styles.contactSection}>
                              <div className={styles.contactSectionLabel}>Email</div>
                              <div className={styles.emailList}>
                                {c.emails.map((e, j) => (
                                  <div key={j} className={styles.emailRow}>{e}</div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <div className={styles.notesSection}>
                    <div className={styles.notesSectionLabel}>Notes</div>
                    <textarea
                      className={styles.notesTextarea}
                      placeholder="Add notes while prospecting…"
                      rows={3}
                      value={notesDraft}
                      onChange={e => setNotesDraft(e.target.value)}
                    />
                    <button
                      className={styles.notesSaveBtn}
                      onClick={saveNote}
                      disabled={noteSaving || notesDraft === (activeTarget.notes ?? '')}
                    >
                      {noteSaving ? 'Saving…' : 'Save Note'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Right panel: dialer + transcript ──────────────────── */}
          <div className={styles.rightPanel}>

            {/* Dialer */}
            <div className={styles.dialerSection}>
              <div className={styles.panelLabel}>Dialer</div>
              <div className={styles.dialerBody}>
                <AnimatePresence mode="wait">
                  {callState === 'active' ? (
                    <motion.div key="active" className={styles.dialerActive}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <span className={styles.dialerStatusTag}>In call</span>
                      <span className={styles.dialerTimer}>{formatDuration(callSeconds)}</span>
                      <span className={styles.dialerActiveNum}>{dialerPhone}</span>
                      {dialerContact && <span className={styles.dialerActiveName}>{dialerContact}</span>}
                      <button className={styles.hangUpBtn} onClick={hangUp}>End Call</button>
                    </motion.div>
                  ) : dialerPhone ? (
                    <motion.div key="loaded" className={styles.dialerLoaded}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <span className={styles.dialerNum}>{dialerPhone}</span>
                      {dialerContact && <span className={styles.dialerName}>{dialerContact}</span>}
                      <button className={styles.callBtn}
                        disabled={!twilioReady}
                        onClick={() => dialerPhone && dialerContact && initiateCall(dialerPhone, dialerContact)}>
                        {twilioReady ? 'Call' : 'Not Connected'}
                      </button>
                      <button className={styles.dialerClear}
                        onClick={() => { setDialerPhone(null); setDialerContact(null) }}>
                        Clear
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div key="idle" className={styles.dialerIdle}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <span className={styles.dialerIdleText}>
                        {autoDialing ? 'Starting…' : 'Click Dial next to a number'}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className={styles.dialerFooter}>
                <span className={twilioReady ? styles.twilioStatusOk : styles.twilioStatus}>
                  {twilioReady ? 'Twilio — connected' : 'Twilio — not connected'}
                </span>
              </div>
            </div>

            {/* Transcript */}
            <div className={styles.transcriptSection}>
              <div className={styles.panelLabel}>Live Transcript</div>
              <div className={styles.transcriptBody}>
                {transcript.length === 0 ? (
                  <span className={styles.transcriptEmpty}>
                    {callState === 'active'
                      ? 'Waiting for speech…'
                      : 'Transcript appears here during calls'}
                  </span>
                ) : (
                  transcript.map((u, i) => (
                    <div key={i} className={`${styles.utterance} ${u.speaker === 'agent' ? styles.utteranceAgent : ''}`}>
                      <span className={styles.utteranceLabel}>{u.speaker === 'agent' ? 'You' : 'Contact'}</span>
                      <span className={styles.utteranceText}>{u.text}</span>
                    </div>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>

          </div>
        </motion.div>
      </div>
    </div>
  )
}
