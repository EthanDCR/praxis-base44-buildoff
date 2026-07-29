import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { base44 } from '../../lib/base44'
import styles from './Leads.module.css'

const ChevronDown = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3.5L5 6.5L8 3.5"/>
  </svg>
)

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
  contacts?: Contact[]
  status: 'new' | 'called' | 'callback' | 'not_interested' | 'sold' | 'overwatch' | 'crm_sent'
  notes?: string
  created_at?: string
}

interface CallList {
  id: string
  name: string
  list_status?: ListStatus
}

type ListStatus = 'not_started' | 'in_progress' | 'completed' | 'on_hold'

export default function Leads() {
  const [lists, setLists]                   = useState<CallList[]>([])
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [allTargets, setAllTargets]         = useState<Target[]>([])
  const [loading, setLoading]               = useState(false)
  const [listPickerOpen, setListPickerOpen] = useState(false)
  const [sending, setSending]               = useState<Record<string, 'damage' | 'no_damage'>>({})
  const [dismissedWith, setDismissedWith]   = useState<Record<string, 'damage' | 'no_damage'>>({})
  const [dismissed, setDismissed]           = useState<Set<string>>(new Set())
  const listPickerRef                       = useRef<HTMLDivElement>(null)

  useEffect(() => {
    base44.entities.CallList.list().then((d: any) => setLists(d)).catch(console.error)
  }, [])

  useEffect(() => {
    setLoading(true)
    base44.entities.Target.list()
      .then((d: any) => {
        const sorted = [...d].sort((a: Target, b: Target) =>
          (b.created_at ?? '').localeCompare(a.created_at ?? '')
        )
        setAllTargets(sorted)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (listPickerRef.current && !listPickerRef.current.contains(e.target as Node))
        setListPickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleResult(id: string, result: 'damage' | 'no_damage') {
    setSending(s => ({ ...s, [id]: result }))
    const newStatus = result === 'damage' ? 'crm_sent' : 'overwatch'
    base44.entities.Target.update(id, { status: newStatus }).catch(console.error)
    setTimeout(() => {
      setDismissedWith(s => ({ ...s, [id]: result }))
      setDismissed(s => new Set([...s, id]))
      setSending(s => { const n = { ...s }; delete n[id]; return n })
    }, 1500)
  }

  const soldTargets = allTargets.filter(t => t.status === 'sold')
  const targets = selectedListId
    ? soldTargets.filter(t => t.list_id === selectedListId)
    : soldTargets

  const visibleCount = targets.filter(t => !dismissed.has(t.id)).length

  const selectedList = lists.find(l => l.id === selectedListId)
  const listName     = selectedList?.name ?? 'All Leads'

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <div className={styles.listHeader}>
          <div className={styles.listHeaderTop}>
            <span className={styles.listTitle}>{listName}</span>

            <div className={styles.listPicker} ref={listPickerRef}>
              <button
                className={styles.listPickerBtn}
                onClick={() => setListPickerOpen(v => !v)}
              >
                Switch List
                <ChevronDown />
              </button>

              {listPickerOpen && (
                <div className={styles.listPickerDrop}>
                  <button
                    className={`${styles.listPickerOpt} ${!selectedListId ? styles.listPickerOptActive : ''}`}
                    onClick={() => { setSelectedListId(null); setListPickerOpen(false) }}
                  >
                    <span className={styles.listPickerOptName}>All Lists</span>
                    <span className={styles.listPickerOptCount}>{soldTargets.length}</span>
                  </button>
                  {lists.map(l => {
                    const ls    = l.list_status ?? 'not_started'
                    const count = soldTargets.filter(t => t.list_id === l.id).length
                    return (
                      <button
                        key={l.id}
                        className={`${styles.listPickerOpt} ${l.id === selectedListId ? styles.listPickerOptActive : ''}`}
                        onClick={() => { setSelectedListId(l.id); setListPickerOpen(false) }}
                      >
                        <span className={`${styles.listStatusDot} ${styles[`dot_${ls}`]}`} />
                        <span className={styles.listPickerOptName}>{l.name}</span>
                        <span className={styles.listPickerOptCount}>{count}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          <div className={styles.listSummary}>
            <span>{visibleCount} inspection{visibleCount !== 1 ? 's' : ''} pending evaluation</span>
          </div>
        </div>

        <div className={styles.cards}>
          {loading && <div className={styles.loadingState}>Loading…</div>}
          {!loading && visibleCount === 0 && Object.keys(sending).length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyText}>No inspections pending evaluation</div>
            </div>
          )}
          <AnimatePresence mode="popLayout">
            {!loading && targets.filter(t => !dismissed.has(t.id)).map((t, i) => {
              const c        = t.contacts?.[0]
              const phone    = c?.phones?.[0]
              const isSending = !!sending[t.id]
              const sentType  = sending[t.id]
              return (
                <motion.div
                  key={t.id}
                  className={styles.card}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={
                    dismissedWith[t.id] === 'damage'
                      ? { opacity: 0, y: -50, scale: 0.88 }
                      : { opacity: 0, y: 50, scale: 0.88 }
                  }
                  transition={{ delay: dismissed.size === 0 ? Math.min(i * 0.04, 0.3) : 0, duration: 0.4, ease: EASE }}
                  style={{ position: 'relative', overflow: 'hidden' }}
                >
                  {/* Sending overlay */}
                  <AnimatePresence>
                    {isSending && (
                      <motion.div
                        className={sentType === 'damage' ? styles.overlayCRM : styles.overlayOW}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <motion.div
                          className={styles.overlayContent}
                          initial={{ scale: 0.82, opacity: 0, y: 10 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          transition={{ delay: 0.08, duration: 0.32, ease: EASE }}
                        >
                          {sentType === 'damage' ? (
                            <>
                              <motion.div
                                className={`${styles.overlayIcon} ${styles.overlayIconGreen}`}
                                initial={{ scale: 0, rotate: -15 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ delay: 0.12, type: 'spring', stiffness: 300, damping: 20 }}
                              >✓</motion.div>
                              <div className={styles.overlayTitle}>DAMAGE CONFIRMED</div>
                              <motion.div
                                className={styles.overlaySub}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.38, duration: 0.28 }}
                              >Sending to CRM →</motion.div>
                            </>
                          ) : (
                            <>
                              <motion.div
                                className={`${styles.overlayIcon} ${styles.overlayIconBlue}`}
                                initial={{ scale: 0, rotate: 15 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ delay: 0.12, type: 'spring', stiffness: 300, damping: 20 }}
                              >◎</motion.div>
                              <div className={styles.overlayTitle}>NO DAMAGE</div>
                              <motion.div
                                className={styles.overlaySub}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.38, duration: 0.28 }}
                              >Routing to Overwatch →</motion.div>
                            </>
                          )}
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Card content */}
                  <motion.div animate={{ opacity: isSending ? 0.1 : 1 }} transition={{ duration: 0.18 }}>
                    <div className={styles.cardHead}>
                      <div className={styles.cardAddress}>
                        <div className={styles.cardLine1}>{t.line1}</div>
                        {t.line2 && <div className={styles.cardLine2}>{t.line2}</div>}
                      </div>
                      <span className={`${styles.statusPill} ${styles.pill_sold}`}>
                        Inspection Set
                      </span>
                    </div>

                    {c && (
                      <div className={styles.cardContact}>
                        <span className={styles.contactName}>{c.name}</span>
                        {(c.title || c.company) && (
                          <span className={styles.contactRole}>
                            {[c.title, c.company].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                    )}

                    {t.notes && <div className={styles.cardNote}>{t.notes}</div>}

                    <div className={styles.cardFoot}>
                      {phone && <span className={styles.cardPhone}>{phone}</span>}
                    </div>
                  </motion.div>

                  {/* Damage evaluation buttons */}
                  <AnimatePresence>
                    {!isSending && (
                      <motion.div
                        className={styles.damageActions}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <button
                          className={styles.damageYes}
                          onClick={() => handleResult(t.id, 'damage')}
                        >
                          DAMAGE FOUND
                        </button>
                        <button
                          className={styles.damageNo}
                          onClick={() => handleResult(t.id, 'no_damage')}
                        >
                        	NO DAMAGE
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
