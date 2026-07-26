import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { base44 } from '../../lib/base44'
import styles from './Leads.module.css'

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

type ListStatus   = 'not_started' | 'in_progress' | 'completed' | 'on_hold'
type StatusFilter =
  | 'all' | 'callback' | 'new' | 'sold' | 'not_interested'
  | 'no_answer' | 'voicemail' | 'wrong_person' | 'dead_number' | 'told_no'

const LIST_STATUSES: { value: ListStatus; label: string }[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',   label: 'Completed'   },
  { value: 'on_hold',     label: 'On Hold'     },
]

const TARGET_STATUS_LABEL: Record<string, string> = {
  new:            'New',
  called:         'Called',
  callback:       'Callback',
  not_interested: 'Not Interested',
  sold:           'Inspection Set',
}

const STATUS_ORDER: Target['status'][] = ['callback', 'new', 'sold', 'called', 'not_interested']

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all',           label: 'All'           },
  { key: 'callback',      label: 'Callback'      },
  { key: 'new',           label: 'New'           },
  { key: 'sold',          label: 'Inspection Set'},
  { key: 'no_answer',     label: 'No Answer'     },
  { key: 'voicemail',     label: 'Voicemail'     },
  { key: 'told_no',       label: 'Told No'       },
  { key: 'wrong_person',  label: 'Wrong Person'  },
  { key: 'dead_number',   label: 'Dead Number'   },
  { key: 'not_interested',label: 'Not Interested'},
]

function noteStartsWith(notes: string | undefined, prefix: string) {
  return notes?.startsWith(prefix) ?? false
}

function applyFilter(targets: Target[], filter: StatusFilter): Target[] {
  switch (filter) {
    case 'all':
      return [...targets].sort((a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
    case 'callback':     return targets.filter(t => t.status === 'callback')
    case 'new':          return targets.filter(t => t.status === 'new')
    case 'sold':         return targets.filter(t => t.status === 'sold')
    case 'not_interested': return targets.filter(t => t.status === 'not_interested')
    case 'no_answer':    return targets.filter(t => noteStartsWith(t.notes, 'No Answer'))
    case 'voicemail':    return targets.filter(t => noteStartsWith(t.notes, 'Voicemail'))
    case 'told_no':      return targets.filter(t => noteStartsWith(t.notes, 'Told No'))
    case 'wrong_person': return targets.filter(t =>
      noteStartsWith(t.notes, 'Wrong Person'))
    case 'dead_number':  return targets.filter(t => noteStartsWith(t.notes, 'Dead Number'))
  }
}

export default function Leads() {
  const [lists, setLists]               = useState<CallList[]>([])
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [allTargets, setAllTargets]     = useState<Target[]>([])
  const [loading, setLoading]           = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const dropdownRef                     = useRef<HTMLDivElement>(null)

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

  // Client-side list filter
  const targets = selectedListId
    ? allTargets.filter(t => t.list_id === selectedListId)
    : allTargets

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setOpenDropdown(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function setListStatus(listId: string, status: ListStatus) {
    try {
      await base44.entities.CallList.update(listId, { list_status: status })
      setLists(prev => prev.map(l => l.id === listId ? { ...l, list_status: status } : l))
    } catch (e) {
      console.error(e)
    }
    setOpenDropdown(null)
  }

  const selectedList = lists.find(l => l.id === selectedListId)
  const listName     = selectedList?.name ?? 'All Leads'

  const stats = {
    total:          targets.length,
    new:            targets.filter(t => t.status === 'new').length,
    callback:       targets.filter(t => t.status === 'callback').length,
    sold:           targets.filter(t => t.status === 'sold').length,
    not_interested: targets.filter(t => t.status === 'not_interested').length,
    no_answer:      targets.filter(t => noteStartsWith(t.notes, 'No Answer')).length,
    voicemail:      targets.filter(t => noteStartsWith(t.notes, 'Voicemail')).length,
    told_no:        targets.filter(t => noteStartsWith(t.notes, 'Told No')).length,
    wrong_person:   targets.filter(t => noteStartsWith(t.notes, 'Wrong Person')).length,
    dead_number:    targets.filter(t => noteStartsWith(t.notes, 'Dead Number')).length,
  }

  const dialed = stats.total - stats.new
  const pct    = stats.total > 0 ? Math.round((dialed / stats.total) * 100) : 0

  const filtered = applyFilter(targets, statusFilter)

  return (
    <div className={styles.page}>

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>Filter by List</div>
        <div className={styles.listItems} ref={dropdownRef}>
          <motion.button
            className={`${styles.listCard} ${styles.listCardMain} ${!selectedListId ? styles.listCardActive : ''}`}
            onClick={() => { setSelectedListId(null); setStatusFilter('all') }}
            initial={{ opacity: 0, x: -14, filter: 'blur(4px)' }}
            animate={{ opacity: 1, x: 0,   filter: 'blur(0px)' }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            <span className={styles.listCardName}>All Lists</span>
            <span className={styles.listCardMeta}>{allTargets.length} leads</span>
          </motion.button>

          {lists.map((l, i) => {
            const ls         = l.list_status ?? 'not_started'
            const lsDef      = LIST_STATUSES.find(s => s.value === ls)!
            const isOpen     = openDropdown === l.id
            const isSelected = l.id === selectedListId
            const count      = allTargets.filter(t => t.list_id === l.id).length
            return (
              <motion.div
                key={l.id}
                initial={{ opacity: 0, x: -14, filter: 'blur(4px)' }}
                animate={{ opacity: 1, x: 0,   filter: 'blur(0px)' }}
                transition={{ delay: (i + 1) * 0.05, duration: 0.4, ease: EASE }}
                className={`${styles.listCard} ${isSelected ? styles.listCardActive : ''}`}
              >
                <button
                  className={styles.listCardMain}
                  onClick={() => { setSelectedListId(l.id); setStatusFilter('all') }}
                >
                  <span className={styles.listCardName}>{l.name}</span>
                  <span className={styles.listCardMeta}>{count} leads</span>
                </button>

                <div className={styles.listCardFooter} ref={isOpen ? dropdownRef : null}>
                  <button
                    className={`${styles.listStatusBtn} ${styles[`listStatus_${ls}`]}`}
                    onClick={e => { e.stopPropagation(); setOpenDropdown(isOpen ? null : l.id) }}
                  >
                    <span className={styles.listStatusDot} />
                    {lsDef.label}
                    <span className={styles.listStatusChevron}>▾</span>
                  </button>

                  {isOpen && (
                    <div className={styles.listStatusDrop}>
                      {LIST_STATUSES.map(s => (
                        <button
                          key={s.value}
                          className={`${styles.listStatusOpt} ${ls === s.value ? styles.listStatusOptActive : ''}`}
                          onClick={() => setListStatus(l.id, s.value)}
                        >
                          <span className={`${styles.listStatusDot} ${styles[`dot_${s.value}`]}`} />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────── */}
      <div className={styles.main}>
        <>
            <div className={styles.listHeader}>
              <div className={styles.listHeaderTop}>
                <span className={styles.listTitle}>{listName}</span>
              </div>
              <div className={styles.listSummary}>
                <span>{stats.total} total</span>
                <span className={styles.summaryDot}>·</span>
                <span>{pct}% dialed</span>
                <span className={styles.summaryDot}>·</span>
                <span>{stats.callback} callbacks</span>
                <span className={styles.summaryDot}>·</span>
                <span>{stats.sold} inspections</span>
              </div>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className={styles.filterBar}>
              {FILTERS.filter(({ key }) => {
                if (key === 'all') return true
                const count = (stats as Record<string, number>)[key]
                return count === undefined || count > 0 || statusFilter === key
              }).map(({ key, label }) => {
                const count = (stats as Record<string, number>)[key]
                return (
                  <button
                    key={key}
                    className={`${styles.filterTab} ${statusFilter === key ? styles.filterTabActive : ''}`}
                    onClick={() => setStatusFilter(key)}
                  >
                    {label}
                    {key !== 'all' && count !== undefined && (
                      <span className={styles.filterCount}>{count}</span>
                    )}
                  </button>
                )
              })}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={selectedListId + statusFilter}
                className={styles.cards}
                initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0,  filter: 'blur(0px)' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                {loading && <div className={styles.loadingState}>Loading…</div>}
                {!loading && filtered.length === 0 && (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyText}>No contacts in this filter</div>
                  </div>
                )}
                {!loading && filtered.map((t, i) => {
                  const c          = t.contacts?.[0]
                  const phone      = c?.phones?.[0]
                  const actionable = t.status === 'callback' || t.status === 'new'
                  return (
                    <motion.div
                      key={t.id}
                      className={`${styles.card} ${styles[`card_${t.status}`]}`}
                      initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }}
                      animate={{ opacity: 1, y: 0,  filter: 'blur(0px)' }}
                      transition={{ delay: Math.min(i * 0.04, 0.35), duration: 0.45, ease: EASE }}
                    >
                      <div className={styles.cardHead}>
                        <div className={styles.cardAddress}>
                          <div className={styles.cardLine1}>{t.line1}</div>
                          {t.line2 && <div className={styles.cardLine2}>{t.line2}</div>}
                        </div>
                        <span className={`${styles.statusPill} ${styles[`pill_${t.status}`]}`}>
                          {TARGET_STATUS_LABEL[t.status]}
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
                        {actionable && phone && (
                          <button className={styles.dialBtn}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
                            </svg>
                            Dial
                          </button>
                        )}
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
