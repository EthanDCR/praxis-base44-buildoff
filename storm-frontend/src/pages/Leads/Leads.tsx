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
  status: 'new' | 'called' | 'callback' | 'not_interested' | 'sold'
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

  // Leads page only shows appointments that have been set (sold = inspection set)
  const soldTargets = allTargets.filter(t => t.status === 'sold')
  const targets = selectedListId
    ? soldTargets.filter(t => t.list_id === selectedListId)
    : soldTargets

  const selectedList = lists.find(l => l.id === selectedListId)
  const listName     = selectedList?.name ?? 'All Leads'

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <>
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
              <span>{targets.length} inspection{targets.length !== 1 ? 's' : ''} set</span>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={selectedListId ?? 'all'}
              className={styles.cards}
              initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0,  filter: 'blur(0px)' }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              {loading && <div className={styles.loadingState}>Loading…</div>}
              {!loading && targets.length === 0 && (
                <div className={styles.emptyState}>
                  <div className={styles.emptyText}>No inspections set yet</div>
                </div>
              )}
              {!loading && targets.map((t, i) => {
                const c     = t.contacts?.[0]
                const phone = c?.phones?.[0]
                return (
                  <motion.div
                    key={t.id}
                    className={styles.card}
                    initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }}
                    animate={{ opacity: 1, y: 0,  filter: 'blur(0px)' }}
                    transition={{ delay: Math.min(i * 0.04, 0.35), duration: 0.45, ease: EASE }}
                  >
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
                )
              })}
            </motion.div>
          </AnimatePresence>
        </>
      </div>
    </div>
  )
}
