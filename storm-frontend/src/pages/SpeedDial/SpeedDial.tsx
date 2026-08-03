import { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Device, Call } from '@twilio/voice-sdk'
import { base44 } from '../../lib/base44'
import { useDataStore } from '../../lib/data-store'
import { useUser } from '../../lib/user-context'
import styles from './SpeedDial.module.css'

const EASE = [0.22, 1, 0.36, 1] as const

interface Phone {
  number: string
  type?: string | null
}

interface Contact {
  name: string
  company?: string
  title?: string
  phones: Phone[]
  emails: string[]
}

type NumberQuality = 'good' | 'bad' | 'unsure'

interface Target {
  id: string
  list_id: string
  line1: string
  line2?: string
  lat?: number
  lng?: number
  hail_size?: number
  hail_date?: string
  property_type?: string
  property_subtype?: string
  year_built?: string
  square_footage?: number
  roof_age?: number
  roof_material?: string
  estimated_value?: number
  equity_percent?: number
  dm_property_id?: string
  contacts?: Contact[]
  status: 'new' | 'called' | 'callback' | 'not_interested' | 'sold'
  phone_qualities?: Record<string, NumberQuality>
  notes?: string
}

interface Utterance { speaker: 'agent' | 'contact'; text: string; ts: number }

type Filter = 'all' | 'new' | 'callback' | 'called' | 'not_interested'
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

interface HailEvent {
  ImpactDate?: string; impact_date?: string; date?: string
  MaxSize?: number; max_size?: number; HailSize?: number; size?: number
  [key: string]: any
}

interface DailyStats { date: string; calls: number; dms: number; leads: number }

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

function googleMapsEmbedUrl(target: Target): string {
  const addr = encodeURIComponent([target.line1, target.line2].filter(Boolean).join(', '))
  return `https://www.google.com/maps?q=${addr}&t=k&z=18&output=embed`
}

export default function SpeedDial() {
  const location = useLocation()
  const navState = (location.state ?? {}) as { targetId?: string; listId?: string }

  const user = useUser()
  const { lists, targets: storeTargets, loading: loadingTargets, updateTarget, refresh } = useDataStore()

  useEffect(() => { refresh() }, [])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [activeId, setActiveId]         = useState<string | null>(null)
  const [filter, setFilter]             = useState<Filter>('all')

  const isRepMode = !!user && user.role !== 'admin'

  // Derive targets for the selected list, excluding sold.
  // Normalize contacts.phones — old targets stored phones as plain strings;
  // new targets store them as {number, type} objects.
  const targets = useMemo((): Target[] => {
    const byList = activeListId
      ? (storeTargets as any[]).filter(t => t.list_id === activeListId)
      : (storeTargets as any[])
    const byAssignment = !isRepMode
      ? byList
      : byList.filter(t => t.assigned_to === user!.email)
    return byAssignment
      .filter(t => t.status !== 'sold')
      .sort((a: any, b: any) => (b.created_date ?? '').localeCompare(a.created_date ?? ''))
      .map(t => ({
        ...t,
        contacts: (t.contacts ?? []).map((c: any) => ({
          ...c,
          phones: (c.phones ?? []).map((p: any) =>
            typeof p === 'string' ? { number: p, type: null } : p
          ),
        })),
      }))
  }, [storeTargets, activeListId, user, isRepMode])
  const [saving, setSaving]             = useState(false)
  const [showListDrop, setShowListDrop]     = useState(false)
  const [showFilterDrop, setShowFilterDrop] = useState(false)

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

  // Hail data for active property
  const [hailData, setHailData]       = useState<HailEvent[] | null>(null)
  const [hailLoading, setHailLoading] = useState(false)

  // Rep's assigned Twilio profile
  const [repTwilioIdentity, setRepTwilioIdentity] = useState<string | null>(null)
  const [repTwilioNumber, setRepTwilioNumber]     = useState<string | null>(null)

  useEffect(() => {
    if (!user?.email) return
    base44.entities.UserProfile.filter({ email: user.email }, undefined, 1)
      .then((d: any) => {
        const p = d[0]
        if (p?.twilio_identity) setRepTwilioIdentity(p.twilio_identity)
        if (p?.twilio_number)   setRepTwilioNumber(p.twilio_number)
      })
      .catch(console.error)
  }, [user?.email])

  // Dialer
  const [twilioReady, setTwilioReady]     = useState(false)
  const [dialerPhone, setDialerPhone]     = useState<string | null>(null)
  const [dialerContact, setDialerContact] = useState<string | null>(null)
  const [callState, setCallState]         = useState<CallState>('idle')
  const [callSeconds, setCallSeconds]     = useState(0)
  const [autoDialing, setAutoDialing]     = useState(false)

  // Incoming callback call
  const [incomingCall, setIncomingCall]     = useState<Call | null>(null)
  const [incomingFrom, setIncomingFrom]     = useState<string>('')
  const [incomingTarget, setIncomingTarget] = useState<Target | null>(null)

  // Transcript (wired to Twilio when connected)
  const [transcript, setTranscript] = useState<Utterance[]>([])

  const listDropRef      = useRef<HTMLDivElement>(null)
  const filterDropRef    = useRef<HTMLDivElement>(null)
  const activeItemRef    = useRef<HTMLButtonElement | null>(null)
  const activePhoneRef   = useRef<HTMLDivElement | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null)
  const deviceRef        = useRef<Device | null>(null)
  const activeCallRef    = useRef<Call | null>(null)

  // Restore nav state list selection once lists are loaded
  useEffect(() => {
    if (navState.listId && lists.length > 0) setActiveListId(navState.listId)
  }, [lists])

  // Reset selection when list changes, then auto-select the first workable target
  const prevListIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevListIdRef.current !== activeListId) {
      prevListIdRef.current = activeListId
      setActiveId(null)
      setAutoDialing(false)
    }
  }, [activeListId])

  useEffect(() => {
    setActiveId(prev => {
      if (prev) return prev
      if (navState.targetId && targets.find((t: Target) => t.id === navState.targetId)) return navState.targetId
      const first = targets.find((t: Target) => t.status === 'new' || t.status === 'callback')
      return first?.id ?? null
    })
  }, [targets])

  // Initialize Twilio Device — wait until we know the rep's identity
  useEffect(() => {
    // Only set up once we have a user; for reps, wait for their profile to load
    if (!user) return
    if (isRepMode && !repTwilioIdentity) return

    const baseUrl = import.meta.env.VITE_TWILIO_TOKEN_URL || '/twilio-token'
    const identity = repTwilioIdentity ?? user.email.replace(/[^a-zA-Z0-9_-]/g, '_')
    const tokenUrl = `${baseUrl}?identity=${encodeURIComponent(identity)}`

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

        device.on('incoming', (call: Call) => {
          const from = call.parameters.From ?? ''
          setIncomingCall(call)
          setIncomingFrom(from)
          call.on('cancel', () => setIncomingCall(null))
        })

        await device.register()
      } catch (err) {
        console.error('Twilio setup failed:', err)
      }
    }

    setup()
    return () => { device?.destroy() }
  }, [user, isRepMode, repTwilioIdentity])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (listDropRef.current && !listDropRef.current.contains(e.target as Node))
        setShowListDrop(false)
      if (filterDropRef.current && !filterDropRef.current.contains(e.target as Node))
        setShowFilterDrop(false)
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

  // Fetch hail history when active target changes — depends on the resolved lat/lng
  useEffect(() => {
    if (!activeTarget?.lat || !activeTarget?.lng) { setHailData(null); return }
    setHailLoading(true)
    setHailData(null)
    base44.functions.invoke('ihm-proxy', { lat: activeTarget.lat, lng: activeTarget.lng, months: 36 })
      .then((res: any) => {
        const data = res.data
        const events: HailEvent[] = Array.isArray(data) ? data : (data.ImpactDates ?? data.impactDates ?? data.results ?? [])
        setHailData(events)
      })
      .catch(err => { console.error('IHM error:', err); setHailData([]) })
      .finally(() => setHailLoading(false))
  }, [activeTarget?.lat, activeTarget?.lng, activeTarget?.id])

  function hailEventDate(e: HailEvent): string {
    const raw = e.ImpactDate ?? e.impact_date ?? e.date ?? ''
    if (!raw) return '—'
    try { return new Date(raw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
    catch { return raw }
  }

  function hailEventSize(e: HailEvent): string {
    const s = e.MaxSize ?? e.max_size ?? e.HailSize ?? e.hail_size ?? e.size ?? null
    return s != null ? `${s}"` : '—'
  }

  // Sync notes draft whenever we switch to a different target
  useEffect(() => {
    setNotesDraft(activeTarget?.notes ?? '')
  }, [activeId])

  const visibleTargets = filter === 'all' ? targets : targets.filter(t => t.status === filter)

  const stats = {
    total:          targets.length,
    new:            targets.filter(t => t.status === 'new').length,
    callback:       targets.filter(t => t.status === 'callback').length,
    called:         targets.filter(t => t.status === 'called').length,
    not_interested: targets.filter(t => t.status === 'not_interested').length,
  }

  const FILTERS: { key: Filter; label: string; countKey?: keyof typeof stats }[] = [
    { key: 'all',            label: 'All',          countKey: 'total'          },
    { key: 'new',            label: 'New',          countKey: 'new'            },
    { key: 'callback',       label: 'Callback',     countKey: 'callback'       },
    { key: 'called',         label: 'Called',       countKey: 'called'         },
    { key: 'not_interested', label: 'Not Interested', countKey: 'not_interested' },
  ]

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

    const allPhones = activeTarget?.contacts?.flatMap(c =>
      c.phones.map(p => ({ phone: p.number, name: c.name }))
    ) ?? []

    if (allPhones[0]) {
      initiateCall(allPhones[0].phone, allPhones[0].name)
    } else {
      // Active target has no phones — advance to the first one that does
      const idx  = activeTarget ? targets.findIndex(t => t.id === activeTarget.id) : -1
      const pool = [...targets.slice(idx + 1), ...targets.slice(0, idx + 1)]
      const next = pool.find(t =>
        (t.status === 'new' || t.status === 'callback') &&
        t.contacts?.some(c => c.phones.length > 0)
      )
      if (next) {
        setActiveId(next.id)
        const phones = next.contacts!.flatMap(c => c.phones.map(p => ({ phone: p.number, name: c.name })))
        if (phones[0]) initiateCall(phones[0].phone, phones[0].name)
      }
    }
  }

  async function saveNote() {
    if (!activeId || noteSaving) return
    setNoteSaving(true)
    try {
      await updateTarget(activeId, { notes: notesDraft })
    } catch (e) {
      console.error(e)
    } finally {
      setNoteSaving(false)
    }
  }

  async function setPhoneQuality(contactIdx: number, phoneIdx: number, quality: NumberQuality | null) {
    if (!activeId) return
    const id = activeId
    const key = `${contactIdx}_${phoneIdx}`
    const current = activeTarget?.phone_qualities ?? {}
    const updated: Record<string, NumberQuality> = { ...current }
    if (quality === null) delete updated[key]
    else updated[key] = quality
    try {
      await updateTarget(id, { phone_qualities: updated })
    } catch (e) { console.error(e) }
  }

  // Look up which target is calling back whenever an inbound call arrives
  useEffect(() => {
    if (!incomingCall) { setIncomingTarget(null); return }
    const norm = incomingFrom.replace(/\D/g, '').replace(/^1/, '')
    const found = targets.find(t =>
      t.contacts?.some(c =>
        c.phones.some(p => p.number.replace(/\D/g, '').replace(/^1/, '') === norm)
      )
    ) ?? null
    setIncomingTarget(found)
  }, [incomingCall, incomingFrom, targets])

  function acceptIncoming() {
    if (!incomingCall) return
    if (callState === 'active') hangUp()
    incomingCall.accept()
    activeCallRef.current = incomingCall
    setCallState('active')
    setDialerPhone(incomingFrom)
    setDialerContact(incomingTarget?.contacts?.[0]?.name ?? 'Callback')
    if (incomingTarget) setActiveId(incomingTarget.id)
    incomingCall.on('disconnect', onCallDisconnected)
    incomingCall.on('error', () => onCallDisconnected())
    setIncomingCall(null)
  }

  function declineIncoming() {
    incomingCall?.reject()
    setIncomingCall(null)
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

    // Multi-phone: exhaust every number across all contacts before moving to next target
    const currentTarget = targets.find(t => t.id === id)
    const allPhones = currentTarget?.contacts?.flatMap(c =>
      c.phones.map(p => ({ phone: p.number, name: c.name }))
    ) ?? []
    const nextPhoneIdx      = activePhoneIdx + 1
    const shouldTryNextPhone = nextPhoneIdx < allPhones.length

    setSaving(true)
    try {
      await updateTarget(id, { status })
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
          const { phone, name } = allPhones[nextPhoneIdx]
          setTimeout(() => initiateCall(phone, name), 600)
        }
      } else {
        // Advance to the next target
        setActivePhoneIdx(0)
        const next = findNext(id)
        setActiveId(next?.id ?? null)
        if (autoDialing && next) {
          const phone = next.contacts?.[0]?.phones?.[0]?.number
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

      {/* ── Incoming call overlay ───────────────────────────────────── */}
      <AnimatePresence>
        {incomingCall && (
          <motion.div
            className={styles.incomingOverlay}
            initial={{ opacity: 0, y: -20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            <div className={styles.incomingPulse} />
            <div className={styles.incomingHeader}>
              <span className={styles.incomingIcon}>📞</span>
              <span className={styles.incomingTitle}>Incoming Callback</span>
              <span className={styles.incomingNum}>{incomingFrom}</span>
            </div>

            {incomingTarget ? (
              <div className={styles.incomingInfo}>
                <div className={styles.incomingName}>{incomingTarget.contacts?.[0]?.name ?? '—'}</div>
                <div className={styles.incomingAddr}>{incomingTarget.line1}</div>
                <div className={styles.incomingAddr2}>{incomingTarget.line2}</div>
                <div className={styles.incomingMeta}>
                  {incomingTarget.hail_size && <span>{incomingTarget.hail_size}" hail</span>}
                  {incomingTarget.hail_date && <span>{new Date(incomingTarget.hail_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                  <span className={styles.incomingStatus}>{STATUS_LABEL[incomingTarget.status]}</span>
                </div>
                {incomingTarget.notes && (
                  <div className={styles.incomingNote}>"{incomingTarget.notes}"</div>
                )}
              </div>
            ) : (
              <div className={styles.incomingUnknown}>Unknown caller — not in your lists</div>
            )}

            <div className={styles.incomingActions}>
              <button className={styles.incomingDecline} onClick={declineIncoming}>Decline</button>
              <button className={styles.incomingAccept} onClick={acceptIncoming}>Answer</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
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
          <span className={styles.statDate}>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          <span className={styles.statDiv} />
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
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, duration: 0.6, ease: EASE }}
        >
          {isRepMode && !loadingTargets && (
            <div className={styles.repQueue}>
              {stats.callback > 0 && (
                <span className={styles.repQueueCallback}>
                  {stats.callback} callback{stats.callback !== 1 ? 's' : ''}
                </span>
              )}
              <span className={styles.repQueueNew}>{stats.new} new</span>
              <span className={styles.repQueueSep}>·</span>
              <span className={styles.repQueueWorked}>{stats.called + stats.not_interested} worked</span>
              <span className={styles.repQueueSep}>·</span>
              <span className={styles.repQueueTotal}>{targets.length} total</span>
            </div>
          )}
          <div className={styles.filterWrap} ref={filterDropRef}>
            <button
              className={styles.filterTrigger}
              onClick={() => setShowFilterDrop(d => !d)}
            >
              <span className={styles.filterTriggerLabel}>
                {FILTERS.find(f => f.key === filter)?.label ?? 'All'}
              </span>
              {(() => { const f = FILTERS.find(f => f.key === filter); return f?.countKey && stats[f.countKey] > 0 ? <span className={styles.filterTriggerCount}>{stats[f.countKey]}</span> : null })()}
              <span className={`${styles.filterChevron} ${showFilterDrop ? styles.filterChevronOpen : ''}`}>▾</span>
            </button>
            <AnimatePresence>
              {showFilterDrop && (
                <motion.div
                  className={styles.filterDrop}
                  initial={{ opacity: 0, y: -6, scaleY: 0.92 }}
                  animate={{ opacity: 1, y: 0, scaleY: 1 }}
                  exit={{ opacity: 0, y: -4, scaleY: 0.94 }}
                  transition={{ duration: 0.15, ease: EASE }}
                  style={{ transformOrigin: 'top' }}
                >
                  {FILTERS.map(({ key, label, countKey }) => (
                    <button
                      key={key}
                      className={`${styles.filterOpt} ${filter === key ? styles.filterOptActive : ''}`}
                      onClick={() => { setFilter(key); setShowFilterDrop(false) }}
                    >
                      <span className={styles.filterOptLabel}>{label}</span>
                      {countKey && stats[countKey] > 0 && (
                        <span className={styles.filterOptCount}>{stats[countKey]}</span>
                      )}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
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
                  {targets.length === 0
                    ? isRepMode ? 'No targets assigned to you yet — check with your manager' : 'No targets in this list'
                    : 'All done — no targets left to work'
                  }
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
                      <div className={styles.hailLine}>
                        {hailLoading && <span className={styles.hailLineText}>Loading hail data…</span>}
                        {!hailLoading && hailData && hailData.length === 0 && !activeTarget.hail_size && (
                          <span className={styles.hailLineText}>No hail events on record</span>
                        )}
                        {!hailLoading && hailData && hailData.length === 0 && activeTarget.hail_size && (
                          <>
                            <span className={styles.hailLineLabel}>Last hit</span>
                            <span className={styles.hailLineDate}>
                              {activeTarget.hail_date
                                ? new Date(activeTarget.hail_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                : '—'}
                            </span>
                            <span className={styles.hailLineDot} />
                            <span className={styles.hailLineSize}>{activeTarget.hail_size}"</span>
                          </>
                        )}
                        {!hailLoading && hailData && hailData.length > 0 && (
                          <>
                            <span className={styles.hailLineLabel}>Last hit</span>
                            <span className={styles.hailLineDate}>{hailEventDate(hailData[0])}</span>
                            <span className={styles.hailLineDot} />
                            <span className={styles.hailLineSize}>{hailEventSize(hailData[0])}</span>
                            {hailData.length > 1 && (
                              <span className={styles.hailLineMore}>{hailData.length} events</span>
                            )}
                          </>
                        )}
                      </div>
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
                                const isActive = dialerPhone === p.number
                                return (
                                  <div
                                    key={j}
                                    ref={isActive ? activePhoneRef : null}
                                    className={`${styles.phoneRow} ${isActive ? styles.phoneRowActive : ''}`}
                                  >
                                    <span className={`${styles.phone} ${isActive ? styles.phoneActive : ''}`}>{p.number}</span>
                                    {p.type && (
                                      <span className={styles.phoneTypeBadge}>
                                        {p.type === 'wireless' ? 'mobile' : p.type}
                                      </span>
                                    )}
                                    <div className={styles.phoneQuality}>
                                      {(['good', 'unsure', 'bad'] as NumberQuality[]).map(q => {
                                        const key = `${i}_${j}`
                                        const active = activeTarget.phone_qualities?.[key] === q
                                        return (
                                          <button
                                            key={q}
                                            className={`${styles.pqBtn} ${active ? styles[`pq_${q}`] : ''}`}
                                            onClick={() => setPhoneQuality(i, j, active ? null : q)}
                                            title={q}
                                          >
                                            <img
                                              src="/svgs/thumbsup.png"
                                              alt={q}
                                              style={{
                                                width: 13, height: 13,
                                                transform: q === 'bad' ? 'rotate(180deg)' : q === 'unsure' ? 'rotate(90deg)' : 'none',
                                                filter: active ? 'none' : 'grayscale(1) brightness(2)',
                                                transition: 'filter 0.15s',
                                              }}
                                            />
                                          </button>
                                        )
                                      })}
                                    </div>
                                    <button
                                      className={`${styles.dialLoadBtn} ${isActive ? styles.dialLoadBtnActive : ''}`}
                                      onClick={() => loadDialer(p.number, c.name)}
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

                    {/* Notes — inside the scroll so it doesn't shrink the contacts area */}
                    <div className={styles.notesSection}>
                      <div className={styles.notesSectionHeader}>
                        <span className={styles.notesSectionLabel}>Notes</span>
                        <button
                          className={styles.notesSaveBtn}
                          onClick={saveNote}
                          disabled={noteSaving || notesDraft === (activeTarget.notes ?? '')}
                        >
                          {noteSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                      <textarea
                        className={styles.notesTextarea}
                        placeholder="Add notes while prospecting…"
                        rows={2}
                        value={notesDraft}
                        onChange={e => setNotesDraft(e.target.value)}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Property panel: satellite + data ─────────────────── */}
          <div className={styles.propPanel}>
            {/* Satellite map — Google Maps iframe, no API key needed */}
            <div className={styles.propMapWrap}>
              {activeTarget ? (
                <iframe
                  key={activeId}
                  src={googleMapsEmbedUrl(activeTarget)}
                  className={styles.propMap}
                  loading="lazy"
                  title="Property satellite view"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className={styles.propMapPlaceholder} />
              )}
            </div>

            {/* Property data */}
            <div className={styles.propDataSection}>
              <div className={styles.panelLabel}>Property Data</div>
              <div className={styles.propDataGrid}>
                <div className={styles.propDataRow}>
                  <span className={styles.propDataKey}>Year Built</span>
                  <span className={styles.propDataVal}>{activeTarget?.year_built ?? '—'}</span>
                </div>
                <div className={styles.propDataRow}>
                  <span className={styles.propDataKey}>Est. Value</span>
                  <span className={styles.propDataVal}>
                    {activeTarget?.estimated_value ? '$' + activeTarget.estimated_value.toLocaleString() : '—'}
                  </span>
                </div>

                <div className={`${styles.propDataRow} ${styles.propDataRowFull}`}>
                  <span className={styles.propDataKey}>Sq Footage</span>
                  <span className={styles.propDataVal}>
                    {activeTarget?.square_footage ? activeTarget.square_footage.toLocaleString() + ' sq ft' : '—'}
                  </span>
                </div>

                <div className={`${styles.propDataRow} ${styles.propDataRowFull}`}>
                  <span className={styles.propDataKey}>Equity</span>
                  <span className={styles.propDataVal}>
                    {activeTarget?.equity_percent != null ? `${activeTarget.equity_percent}%` : '—'}
                  </span>
                </div>
              </div>

            </div>
          </div>

          {/* ── Right panel: dialer + extra property fields ───────── */}
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
                {repTwilioNumber && (
                  <span className={styles.twilioStatus} style={{ marginLeft: 8 }}>
                    calling from {repTwilioNumber}
                  </span>
                )}
              </div>
            </div>



          </div>
        </motion.div>
      </div>
    </div>
  )
}
