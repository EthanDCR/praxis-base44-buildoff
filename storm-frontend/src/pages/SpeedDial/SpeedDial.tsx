import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
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

interface CallList {
  id: string
  name: string
}

type Filter = 'all' | 'new' | 'callback'

const STATUS_LABEL: Record<string, string> = {
  new:            'New',
  called:         'Called',
  callback:       'Callback',
  not_interested: 'Not Interested',
  sold:           'Sold',
}

export default function SpeedDial() {
  const [lists, setLists]               = useState<CallList[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [targets, setTargets]           = useState<Target[]>([])
  const [activeId, setActiveId]         = useState<string | null>(null)
  const [filter, setFilter]             = useState<Filter>('all')
  const [loadingTargets, setLoadingTargets] = useState(false)
  const [saving, setSaving]             = useState(false)
  const [pendingOutcome, setPendingOutcome] = useState<'callback' | 'sold' | null>(null)
  const [noteText, setNoteText]         = useState('')
  const [calling, setCalling]           = useState<{ phone: string; name: string } | null>(null)
  const [showListDrop, setShowListDrop] = useState(false)

  const listDropRef   = useRef<HTMLDivElement>(null)
  const activeItemRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    base44.entities.CallList.list().then((d: any) => setLists(d)).catch(console.error)
  }, [])

  useEffect(() => {
    if (!activeListId) return
    setLoadingTargets(true)
    setActiveId(null)
    setTargets([])
    base44.entities.Target.filter({ list_id: activeListId })
      .then((d: any) => {
        setTargets(d)
        const first = d.find((t: Target) => t.status === 'new' || t.status === 'callback')
        if (first) setActiveId(first.id)
      })
      .catch(console.error)
      .finally(() => setLoadingTargets(false))
  }, [activeListId])

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

  const activeTarget = targets.find(t => t.id === activeId) ?? null
  const activeList   = lists.find(l => l.id === activeListId)

  const visibleTargets = filter === 'all'
    ? targets
    : targets.filter(t => t.status === filter)

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

  async function logOutcome(status: Target['status'], note: string) {
    if (!activeId) return
    const id = activeId
    setSaving(true)
    try {
      await base44.entities.Target.update(id, { status, ...(note ? { notes: note } : {}) })
      setTargets(prev => prev.map(t => t.id === id ? { ...t, status, notes: note || t.notes } : t))
      const next = findNext(id)
      setActiveId(next?.id ?? null)
      setPendingOutcome(null)
      setNoteText('')
      setCalling(null)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  function handleCall(phone: string, name: string) {
    setCalling({ phone, name })
    window.open(`tel:${phone.replace(/[^\d+]/g, '')}`)
  }

  function stepTarget(dir: 1 | -1) {
    const idx = targets.findIndex(t => t.id === activeId)
    const next = targets[idx + dir]
    if (next) setActiveId(next.id)
  }

  return (
    <div className={styles.page}>

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
                {activeList ? activeList.name : 'Select list…'}
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

        <AnimatePresence>
          {activeListId && !loadingTargets && (
            <motion.div
              className={styles.statRow}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              <span className={styles.stat}><span className={styles.statNum}>{stats.total}</span> total</span>
              <span className={styles.statDiv} />
              <span className={styles.stat}><span className={styles.statNum}>{stats.new}</span> new</span>
              <span className={styles.statDiv} />
              <span className={styles.stat}><span className={styles.statNum}>{stats.callback}</span> callback</span>
              <span className={styles.statDiv} />
              <span className={styles.stat}><span className={styles.statNum}>{stats.sold}</span> sold</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {calling && (
            <motion.div
              className={styles.inCallBadge}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <span className={styles.inCallDot} />
              In call · {calling.name}
              <button className={styles.inCallEnd} onClick={() => setCalling(null)}>✕</button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Body (queue + workspace) ────────────────────────────────── */}
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
            {!loadingTargets && !activeListId && <div className={styles.queueEmpty}>Select a list above</div>}
            {!loadingTargets && activeListId && visibleTargets.length === 0 && (
              <div className={styles.queueEmpty}>No targets in this filter</div>
            )}
            {!loadingTargets && visibleTargets.map(t => (
              <button
                key={t.id}
                ref={t.id === activeId ? (el => { activeItemRef.current = el }) : null}
                className={[
                  styles.queueItem,
                  t.id === activeId ? styles.queueItemActive : '',
                  (t.status === 'not_interested' || t.status === 'sold' || t.status === 'called')
                    ? styles.queueItemDone : '',
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
          <AnimatePresence mode="wait">
            {!activeListId ? (
              <motion.div key="no-list" className={styles.emptyState}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                Select a list to start calling
              </motion.div>
            ) : loadingTargets ? (
              <motion.div key="loading" className={styles.emptyState}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                Loading…
              </motion.div>
            ) : !activeTarget ? (
              <motion.div key="done" className={styles.emptyState}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                All targets worked — {stats.sold} sold
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
                {/* Address */}
                <div className={styles.targetHead}>
                  <div>
                    <div className={styles.address}>{activeTarget.line1}</div>
                    {activeTarget.line2 && (
                      <div className={styles.addressSub}>{activeTarget.line2}</div>
                    )}
                  </div>
                  <div className={styles.headRight}>
                    <span className={styles.statusLabel}>{STATUS_LABEL[activeTarget.status]}</span>
                    <div className={styles.navBtns}>
                      <button className={styles.navBtn} onClick={() => stepTarget(-1)}>← Prev</button>
                      <button className={styles.navBtn} onClick={() => stepTarget(1)}>Next →</button>
                    </div>
                  </div>
                </div>

                {/* Property meta */}
                {(activeTarget.property_type || activeTarget.year_built) && (
                  <div className={styles.propMeta}>
                    {[
                      activeTarget.property_type,
                      activeTarget.property_subtype,
                      activeTarget.year_built ? `Built ${activeTarget.year_built}` : null,
                    ].filter(Boolean).join('  ·  ')}
                  </div>
                )}

                {/* Contacts */}
                <div className={styles.contacts}>
                  {(!activeTarget.contacts || activeTarget.contacts.length === 0) ? (
                    <p className={styles.noContacts}>No contact data</p>
                  ) : (
                    activeTarget.contacts.map((c, i) => (
                      <div key={i} className={styles.contact}>
                        <div className={styles.contactName}>{c.name}</div>
                        {(c.title || c.company) && (
                          <div className={styles.contactRole}>
                            {[c.title, c.company].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        {c.phones.map((p, j) => (
                          <div key={j} className={styles.phoneRow}>
                            <span className={styles.phone}>{p}</span>
                            <button className={styles.callBtn} onClick={() => handleCall(p, c.name)}>
                              Call
                            </button>
                          </div>
                        ))}
                        {c.emails.length > 0 && (
                          <div className={styles.emailRow}>
                            {c.emails.join('  ·  ')}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Outcome */}
                <div className={styles.outcome}>
                  <AnimatePresence mode="wait">
                    {pendingOutcome ? (
                      <motion.div key="notes" className={styles.notesBox}
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }}
                      >
                        <span className={styles.notesLabel}>
                          {pendingOutcome === 'sold' ? 'Confirm sale' : 'Schedule callback'} — add a note
                        </span>
                        <textarea
                          className={styles.notesInput}
                          placeholder="Optional notes…"
                          rows={2}
                          value={noteText}
                          onChange={e => setNoteText(e.target.value)}
                          autoFocus
                        />
                        <div className={styles.notesActions}>
                          <button className={styles.cancelBtn}
                            onClick={() => { setPendingOutcome(null); setNoteText('') }}>
                            Cancel
                          </button>
                          <button className={styles.confirmBtn} disabled={saving}
                            onClick={() => logOutcome(pendingOutcome, noteText)}>
                            {saving ? 'Saving…'
                              : pendingOutcome === 'sold' ? 'Confirm Sale'
                              : 'Log Callback'}
                          </button>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div key="btns" className={styles.outcomeBtns}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                      >
                        <button className={styles.outcomeBtn} disabled={saving}
                          onClick={() => logOutcome('called', 'No answer')}>No Answer</button>
                        <button className={styles.outcomeBtn} disabled={saving}
                          onClick={() => logOutcome('called', 'Left voicemail')}>Voicemail</button>
                        <button className={styles.outcomeBtn} disabled={saving}
                          onClick={() => setPendingOutcome('callback')}>Callback</button>
                        <button className={styles.outcomeBtn} disabled={saving}
                          onClick={() => logOutcome('not_interested', '')}>Not Interested</button>
                        <button className={`${styles.outcomeBtn} ${styles.outcomeSold}`} disabled={saving}
                          onClick={() => setPendingOutcome('sold')}>Sold</button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}
