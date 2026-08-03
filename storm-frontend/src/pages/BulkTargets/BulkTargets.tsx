import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
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

function extractState(line2: string): string {
  const m = /,\s*([A-Z]{2})\s+\d{5}/.exec(line2 ?? '')
  return m ? m[1] : ''
}

export default function BulkTargets() {
  const currentUser = useUser()
  const { lists, targets: storeTargets, loading: loadingTargets, allTargetsLoaded, refresh } = useDataStore()

  const PAGE_SIZE = 200
  const [page, setPage] = useState(0)

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [profiles, setProfiles] = useState<RepProfile[]>([])

  // ── Search ──
  const [search, setSearch] = useState('')
  const [contactSearch, setContactSearch] = useState('')

  // ── Basic filters ──
  const [statusFilter, setStatusFilter] = useState('all')
  const [listFilter, setListFilter] = useState<string | null>(null)
  const [assignedFilter, setAssignedFilter] = useState<AssignedFilter>('all')

  // ── Advanced filters ──
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [stateFilter, setStateFilter] = useState('')
  const [hasPhoneFilter, setHasPhoneFilter] = useState('all')
  const [hasEmailFilter, setHasEmailFilter] = useState('all')
  const [propertyTypeSearch, setPropertyTypeSearch] = useState('')
  const [roofMaterialFilter, setRoofMaterialFilter] = useState('')
  const [sqftMin, setSqftMin] = useState('')
  const [sqftMax, setSqftMax] = useState('')
  const [hailSizeMin, setHailSizeMin] = useState('')
  const [hailSizeMax, setHailSizeMax] = useState('')
  const [hailDateFrom, setHailDateFrom] = useState('')
  const [hailDateTo, setHailDateTo] = useState('')

  // ── Bulk action ──
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedRep, setSelectedRep] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignProgress, setAssignProgress] = useState<{ done: number; total: number } | null>(null)
  const [assignError, setAssignError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null)
  const [deleteError, setDeleteError] = useState('')

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

  // ── Derived option lists ──
  const uniqueStates = useMemo(() => {
    const states = new Set<string>()
    for (const t of storeTargets as any[]) {
      const s = extractState(t.line2 ?? '')
      if (s) states.add(s)
    }
    return [...states].sort()
  }, [storeTargets])

  const uniqueRoofMaterials = useMemo(() => {
    const mats = new Set<string>()
    for (const t of storeTargets as any[]) {
      if (t.roof_material) mats.add(t.roof_material)
    }
    return [...mats].sort()
  }, [storeTargets])

  // ── Filtering ──
  const filteredTargets = useMemo(() => {
    let targets = storeTargets as any[]

    if (search.trim()) {
      const q = search.toLowerCase()
      targets = targets.filter(t =>
        (t.line1 ?? '').toLowerCase().includes(q) ||
        (t.line2 ?? '').toLowerCase().includes(q) ||
        (t.contacts ?? []).some((c: any) => (c.company ?? '').toLowerCase().includes(q))
      )
    }

    if (contactSearch.trim()) {
      const q = contactSearch.toLowerCase()
      targets = targets.filter(t =>
        (t.contacts ?? []).some((c: any) =>
          (c.name ?? '').toLowerCase().includes(q) ||
          (c.phones ?? []).some((p: any) => (p.number ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, '')))
        )
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

    if (stateFilter) {
      targets = targets.filter(t => extractState(t.line2 ?? '') === stateFilter)
    }

    if (hasPhoneFilter === 'yes') {
      targets = targets.filter(t => (t.contacts ?? []).some((c: any) => (c.phones ?? []).length > 0))
    } else if (hasPhoneFilter === 'no') {
      targets = targets.filter(t => !(t.contacts ?? []).some((c: any) => (c.phones ?? []).length > 0))
    }

    if (hasEmailFilter === 'yes') {
      targets = targets.filter(t => (t.contacts ?? []).some((c: any) => (c.emails ?? []).length > 0))
    } else if (hasEmailFilter === 'no') {
      targets = targets.filter(t => !(t.contacts ?? []).some((c: any) => (c.emails ?? []).length > 0))
    }

    if (propertyTypeSearch.trim()) {
      const q = propertyTypeSearch.toLowerCase()
      targets = targets.filter(t =>
        (t.property_type ?? '').toLowerCase().includes(q) ||
        (t.property_subtype ?? '').toLowerCase().includes(q)
      )
    }

    if (roofMaterialFilter) {
      targets = targets.filter(t => t.roof_material === roofMaterialFilter)
    }

    if (sqftMin) {
      const n = parseFloat(sqftMin)
      if (!isNaN(n)) targets = targets.filter(t => (t.square_footage ?? 0) >= n)
    }
    if (sqftMax) {
      const n = parseFloat(sqftMax)
      if (!isNaN(n)) targets = targets.filter(t => (t.square_footage ?? Infinity) <= n)
    }

    if (hailSizeMin) {
      const n = parseFloat(hailSizeMin)
      if (!isNaN(n)) targets = targets.filter(t => (t.hail_size ?? 0) >= n)
    }
    if (hailSizeMax) {
      const n = parseFloat(hailSizeMax)
      if (!isNaN(n)) targets = targets.filter(t => (t.hail_size ?? Infinity) <= n)
    }

    if (hailDateFrom) {
      const from = new Date(hailDateFrom).getTime()
      targets = targets.filter(t => t.hail_date && new Date(t.hail_date).getTime() >= from)
    }
    if (hailDateTo) {
      const to = new Date(hailDateTo).getTime()
      targets = targets.filter(t => t.hail_date && new Date(t.hail_date).getTime() <= to)
    }

    return targets
  }, [
    storeTargets, search, contactSearch, statusFilter, listFilter, assignedFilter,
    stateFilter, hasPhoneFilter, hasEmailFilter, propertyTypeSearch, roofMaterialFilter,
    sqftMin, sqftMax, hailSizeMin, hailSizeMax, hailDateFrom, hailDateTo,
  ])

  const allFilterDeps = [
    search, contactSearch, statusFilter, listFilter, assignedFilter,
    stateFilter, hasPhoneFilter, hasEmailFilter, propertyTypeSearch, roofMaterialFilter,
    sqftMin, sqftMax, hailSizeMin, hailSizeMax, hailDateFrom, hailDateTo,
  ]
  useEffect(() => { setPage(0) }, allFilterDeps)

  const pageCount = Math.max(1, Math.ceil(filteredTargets.length / PAGE_SIZE))
  const visibleTargets = filteredTargets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

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

  function clearFilters() {
    setSearch('')
    setContactSearch('')
    setStatusFilter('all')
    setListFilter(null)
    setAssignedFilter('all')
    setStateFilter('')
    setHasPhoneFilter('all')
    setHasEmailFilter('all')
    setPropertyTypeSearch('')
    setRoofMaterialFilter('')
    setSqftMin('')
    setSqftMax('')
    setHailSizeMin('')
    setHailSizeMax('')
    setHailDateFrom('')
    setHailDateTo('')
  }

  const hasActiveFilters =
    search || contactSearch || statusFilter !== 'all' || listFilter ||
    assignedFilter !== 'all' || stateFilter || hasPhoneFilter !== 'all' ||
    hasEmailFilter !== 'all' || propertyTypeSearch || roofMaterialFilter ||
    sqftMin || sqftMax || hailSizeMin || hailSizeMax || hailDateFrom || hailDateTo

  async function handleDelete() {
    if (selected.size === 0 || deleting) return
    if (!confirm(`Permanently delete ${selected.size.toLocaleString()} target${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    setDeleting(true)
    setDeleteError('')
    const ids = [...selected]
    setDeleteProgress({ done: 0, total: ids.length })

    try {
      for (let i = 0; i < ids.length; i++) {
        let retries = 0
        while (true) {
          try {
            await base44.entities.Target.delete(ids[i])
            break
          } catch (e: any) {
            if (retries++ >= 4) throw e
            await new Promise(r => setTimeout(r, 1500 * retries))
          }
        }
        setDeleteProgress({ done: i + 1, total: ids.length })
      }
      setSelected(new Set())
      await refresh()
    } catch {
      setDeleteError('Failed partway through. Some targets may not have been deleted.')
    } finally {
      setDeleting(false)
      setDeleteProgress(null)
    }
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
    return <div className={styles.accessMsg}>Checking access…</div>
  }

  if (!isAdmin) {
    return <div className={styles.accessMsg}>Access denied.</div>
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
          {!allTargetsLoaded && (
            <span className={styles.loadingBadge}> · loading…</span>
          )}
        </span>
      </motion.div>

      <motion.div
        className={styles.searchArea}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08, duration: 0.4 }}
      >
        {/* Row 1 – address search */}
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            placeholder="Address, city, state, zip, business…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Row 2 – contact search + list */}
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            placeholder="Contact name or phone…"
            value={contactSearch}
            onChange={e => setContactSearch(e.target.value)}
          />
          <select
            className={styles.filterSelect}
            value={listFilter ?? ''}
            onChange={e => setListFilter(e.target.value || null)}
          >
            <option value="">Select a storm list…</option>
            {(lists as any[]).map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>

        {/* Row 3 – filters toggle */}
        <div className={styles.filterToggleRow}>
          <button
            className={`${styles.filtersToggleBtn} ${filtersOpen ? styles.filtersToggleBtnActive : ''}`}
            onClick={() => setFiltersOpen(o => !o)}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1 2.5h11M3 6.5h7M5 10.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Filters
            {hasActiveFilters && <span className={styles.filterActiveDot} />}
          </button>
          {hasActiveFilters && (
            <button className={styles.clearFiltersBtn} onClick={clearFilters}>
              Clear all
            </button>
          )}
        </div>

        {/* Expandable filter panel */}
        <AnimatePresence>
          {filtersOpen && (
            <motion.div
              className={styles.filterPanel}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              <div className={styles.filterGrid}>
                {/* Row 1 */}
                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>REP</label>
                  <select
                    className={styles.filterSelect}
                    value={assignedFilter}
                    onChange={e => setAssignedFilter(e.target.value as AssignedFilter)}
                  >
                    <option value="all">All Reps</option>
                    <option value="unassigned">Unassigned</option>
                    <option value="assigned">Assigned</option>
                    {reps.map(p => (
                      <option key={p.id} value={p.email}>
                        {p.full_name ?? p.email}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>STATUS</label>
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
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>STATE</label>
                  <select
                    className={styles.filterSelect}
                    value={stateFilter}
                    onChange={e => setStateFilter(e.target.value)}
                  >
                    <option value="">All States</option>
                    {uniqueStates.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>ROOF MATERIAL</label>
                  <select
                    className={styles.filterSelect}
                    value={roofMaterialFilter}
                    onChange={e => setRoofMaterialFilter(e.target.value)}
                  >
                    <option value="">All Materials</option>
                    {uniqueRoofMaterials.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                {/* Row 2 */}
                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>HAS PHONE</label>
                  <select
                    className={styles.filterSelect}
                    value={hasPhoneFilter}
                    onChange={e => setHasPhoneFilter(e.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="yes">Has Phone</option>
                    <option value="no">No Phone</option>
                  </select>
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>HAS EMAIL</label>
                  <select
                    className={styles.filterSelect}
                    value={hasEmailFilter}
                    onChange={e => setHasEmailFilter(e.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="yes">Has Email</option>
                    <option value="no">No Email</option>
                  </select>
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>PROPERTY TYPE</label>
                  <input
                    className={styles.filterInput}
                    placeholder="e.g. Retail, Industrial…"
                    value={propertyTypeSearch}
                    onChange={e => setPropertyTypeSearch(e.target.value)}
                  />
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>SQFT MIN</label>
                  <input
                    className={styles.filterInput}
                    type="number"
                    placeholder="Min"
                    value={sqftMin}
                    onChange={e => setSqftMin(e.target.value)}
                  />
                </div>

                {/* Row 3 */}
                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>SQFT MAX</label>
                  <input
                    className={styles.filterInput}
                    type="number"
                    placeholder="Max"
                    value={sqftMax}
                    onChange={e => setSqftMax(e.target.value)}
                  />
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>HAIL SIZE MIN (in)</label>
                  <input
                    className={styles.filterInput}
                    type="number"
                    step="0.25"
                    placeholder="Min"
                    value={hailSizeMin}
                    onChange={e => setHailSizeMin(e.target.value)}
                  />
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>HAIL SIZE MAX (in)</label>
                  <input
                    className={styles.filterInput}
                    type="number"
                    step="0.25"
                    placeholder="Max"
                    value={hailSizeMax}
                    onChange={e => setHailSizeMax(e.target.value)}
                  />
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>HAIL DATE FROM</label>
                  <input
                    className={styles.filterInput}
                    type="date"
                    value={hailDateFrom}
                    onChange={e => setHailDateFrom(e.target.value)}
                  />
                </div>

                {/* Row 4 */}
                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>HAIL DATE TO</label>
                  <input
                    className={styles.filterInput}
                    type="date"
                    value={hailDateTo}
                    onChange={e => setHailDateTo(e.target.value)}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
              {visibleTargets.map((t: any) => (
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

      {pageCount > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >← Prev</button>
          <span className={styles.pageLabel}>
            {page + 1} / {pageCount}
            <span className={styles.pageSubLabel}> ({filteredTargets.length.toLocaleString()} total)</span>
          </span>
          <button
            className={styles.pageBtn}
            disabled={page >= pageCount - 1}
            onClick={() => setPage(p => p + 1)}
          >Next →</button>
        </div>
      )}

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
            disabled={assigning || deleting}
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
            disabled={!selectedRep || assigning || deleting}
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
            disabled={assigning || deleting}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
          <button
            className={styles.deleteBtn}
            disabled={assigning || deleting}
            onClick={handleDelete}
          >
            {deleting && deleteProgress
              ? `Deleting ${deleteProgress.done}/${deleteProgress.total}…`
              : deleting
              ? 'Deleting…'
              : 'Delete Selected'}
          </button>
          {assignError && <span className={styles.assignError}>{assignError}</span>}
          {deleteError && <span className={styles.assignError}>{deleteError}</span>}
        </motion.div>
      )}
    </div>
  )
}
