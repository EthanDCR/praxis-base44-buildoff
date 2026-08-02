import { useState, useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import { base44 } from '../../lib/base44'
import { useUser } from '../../lib/user-context'
import { useDataStore } from '../../lib/data-store'
import styles from './BulkTargets.module.css'

const EASE = [0.22, 1, 0.36, 1] as const

type AssignedFilter = 'all' | 'assigned' | 'unassigned'

interface RepProfile {
  id: string
  email: string
  full_name?: string
  role?: string
}

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  called: 'Called',
  callback: 'Callback',
  not_interested: 'Not Interested',
  sold: 'Inspection Set',
  overwatch: 'Overwatch',
  crm_sent: 'CRM Sent',
}

export default function BulkTargets() {
  const currentUser = useUser()
  const { lists, targets: storeTargets, loading: loadingTargets, refresh } = useDataStore()

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [profiles, setProfiles] = useState<RepProfile[]>([])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [listFilter, setListFilter] = useState<string | null>(null)
  const [assignedFilter, setAssignedFilter] = useState<AssignedFilter>('all')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedRep, setSelectedRep] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignProgress, setAssignProgress] = useState<{ done: number; total: number } | null>(null)
  const [assignError, setAssignError] = useState('')

  useEffect(() => {
    if (!currentUser?.email) return
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
  }, [isAdmin])

  const filteredTargets = useMemo(() => {
    let targets = storeTargets as any[]

    if (search.trim()) {
      const q = search.toLowerCase()
      targets = targets.filter(t =>
        (t.line1 ?? '').toLowerCase().includes(q) ||
        (t.line2 ?? '').toLowerCase().includes(q)
      )
    }

    if (statusFilter !== 'all') {
      targets = targets.filter(t => t.status === statusFilter)
    }

    if (listFilter) {
      targets = targets.filter(t => t.list_id === listFilter)
    }

    if (assignedFilter === 'assigned') {
      targets = targets.filter(t => !!t.assigned_to)
    } else if (assignedFilter === 'unassigned') {
      targets = targets.filter(t => !t.assigned_to)
    }

    return targets
  }, [storeTargets, search, statusFilter, listFilter, assignedFilter])

  const allSelected = filteredTargets.length > 0 && filteredTargets.every(t => selected.has(t.id))

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredTargets.map((t: any) => t.id)))
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAssign() {
    if (!selectedRep || selected.size === 0 || assigning) return
    setAssigning(true)
    setAssignError('')
    const ids = [...selected]
    setAssignProgress({ done: 0, total: ids.length })

    try {
      for (let i = 0; i < ids.length; i++) {
        let retries = 0
        while (true) {
          try {
            await base44.entities.Target.update(ids[i], { assigned_to: selectedRep })
            break
          } catch (e: any) {
            if (retries++ >= 4) throw e
            await new Promise(r => setTimeout(r, 1500 * retries))
          }
        }
        setAssignProgress({ done: i + 1, total: ids.length })
      }
      setSelected(new Set())
      setSelectedRep('')
      await refresh()
    } catch (e: any) {
      setAssignError('Failed partway through. Some targets may not have been assigned.')
    } finally {
      setAssigning(false)
      setAssignProgress(null)
    }
  }

  const listName = (listId: string) => (lists as any[]).find(l => l.id === listId)?.name ?? '—'
  const repName = (email: string) => profiles.find(p => p.email === email)?.full_name ?? email
  const reps = profiles.filter(p => p.role === 'rep' || p.role === 'admin')

  if (isAdmin === null) {
    return (
      <div className={styles.accessMsg}>Checking access…</div>
    )
  }

  if (!isAdmin) {
    return (
      <div className={styles.accessMsg}>Access denied.</div>
    )
  }

  return (
    <div className={styles.page}>
      <motion.div
        className={styles.topBar}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <span className={styles.pageTitle}>BULK TARGETS</span>
        <span className={styles.totalCount}>
          {filteredTargets.length.toLocaleString()} targets
        </span>
      </motion.div>

      <motion.div
        className={styles.filterBar}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08, duration: 0.4 }}
      >
        <input
          className={styles.searchInput}
          placeholder="Search address…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="new">New</option>
          <option value="called">Called</option>
          <option value="callback">Callback</option>
          <option value="not_interested">Not Interested</option>
          <option value="sold">Inspection Set</option>
          <option value="overwatch">Overwatch</option>
          <option value="crm_sent">CRM Sent</option>
        </select>
        <select
          className={styles.filterSelect}
          value={listFilter ?? ''}
          onChange={e => setListFilter(e.target.value || null)}
        >
          <option value="">All Lists</option>
          {(lists as any[]).map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={assignedFilter}
          onChange={e => setAssignedFilter(e.target.value as AssignedFilter)}
        >
          <option value="all">All</option>
          <option value="unassigned">Unassigned</option>
          <option value="assigned">Assigned</option>
        </select>
      </motion.div>

      <div className={styles.tableWrap}>
        {loadingTargets ? (
          <div className={styles.emptyState}>Loading…</div>
        ) : filteredTargets.length === 0 ? (
          <div className={styles.emptyState}>No targets match your filters</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr className={styles.thead}>
                <th className={styles.thCheck}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th className={styles.th}>Address</th>
                <th className={styles.th}>List</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Hail</th>
                <th className={styles.th}>Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {filteredTargets.map((t: any) => (
                <tr
                  key={t.id}
                  className={`${styles.row} ${selected.has(t.id) ? styles.rowSelected : ''}`}
                  onClick={() => toggleOne(t.id)}
                >
                  <td className={styles.tdCheck} onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selected.has(t.id)}
                      onChange={() => toggleOne(t.id)}
                    />
                  </td>
                  <td className={styles.td}>
                    <div className={styles.addrLine1}>{t.line1}</div>
                    {t.line2 && <div className={styles.addrLine2}>{t.line2}</div>}
                  </td>
                  <td className={styles.td}>
                    <span className={styles.listTag}>{listName(t.list_id)}</span>
                  </td>
                  <td className={styles.td}>
                    <span className={`${styles.statusPill} ${styles[`status_${t.status}`] ?? ''}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </td>
                  <td className={styles.td}>
                    {t.hail_size ? (
                      <span className={styles.hailInfo}>
                        {t.hail_size}"
                        {t.hail_date && (
                          <span className={styles.hailDate}>
                            {' '}· {new Date(t.hail_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </span>
                    ) : <span className={styles.dash}>—</span>}
                  </td>
                  <td className={styles.td}>
                    {t.assigned_to
                      ? <span className={styles.assignedTo}>{repName(t.assigned_to)}</span>
                      : <span className={styles.dash}>—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected.size > 0 && (
        <motion.div
          className={styles.actionBar}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          <span className={styles.selectedCount}>
            {selected.size.toLocaleString()} selected
          </span>
          <select
            className={styles.repSelect}
            value={selectedRep}
            onChange={e => setSelectedRep(e.target.value)}
            disabled={assigning}
          >
            <option value="">Assign to rep…</option>
            {reps.map(p => (
              <option key={p.id} value={p.email}>
                {p.full_name ?? p.email}
              </option>
            ))}
          </select>
          <button
            className={styles.assignBtn}
            disabled={!selectedRep || assigning}
            onClick={handleAssign}
          >
            {assigning && assignProgress
              ? `${assignProgress.done}/${assignProgress.total}…`
              : assigning
              ? 'Assigning…'
              : 'Assign'}
          </button>
          <button
            className={styles.clearBtn}
            disabled={assigning}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
          {assignError && <span className={styles.assignError}>{assignError}</span>}
        </motion.div>
      )}
    </div>
  )
}
