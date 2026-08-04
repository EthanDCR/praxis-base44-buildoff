import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { base44 } from '../../lib/base44'
import { useUser } from '../../lib/user-context'
import { useDataStore } from '../../lib/data-store'
import { extractState, filterTargets } from '../../lib/target-filters'
import EditTargetModal from '../../components/EditTargetModal/EditTargetModal'
import styles from './BulkTargets.module.css'

const EASE = [0.22, 1, 0.36, 1] as const

interface RepProfile {
  id: string
  email: string
  full_name?: string
  role?: string
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'called', label: 'Called' },
  { value: 'callback', label: 'Callback' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'sold', label: 'Inspection Set' },
  { value: 'overwatch', label: 'Overwatch' },
  { value: 'crm_sent', label: 'CRM Sent' },
]

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map(o => [o.value, o.label])
)

/* ── MultiSelect dropdown ──────────────────────────────────── */

function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  openUp = false,
}: {
  options: { value: string; label: string }[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  placeholder: string
  openUp?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  const selectedLabels = options.filter(o => selected.has(o.value)).map(o => o.label)
  const displayText =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
      ? selectedLabels.join(', ')
      : `${selectedLabels.slice(0, 2).join(', ')} +${selectedLabels.length - 2}`

  return (
    <div ref={ref} className={styles.multiSelectWrap}>
      <button
        type="button"
        className={`${styles.multiSelectTrigger} ${selected.size > 0 ? styles.multiSelectTriggerActive : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className={styles.multiSelectLabel}>{displayText}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ flexShrink: 0 }}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className={`${styles.multiSelectDropdown}${openUp ? ' ' + styles.multiSelectDropdownUp : ''}`}>
          {options.map(o => (
            <label key={o.value} className={styles.multiSelectOption}>
              <input
                type="checkbox"
                className={styles.multiSelectCheckbox}
                checked={selected.has(o.value)}
                onChange={() => toggle(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Main component ────────────────────────────────────────── */

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

  // ── Multi-select filters ──
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set())
  const [repFilter, setRepFilter] = useState<Set<string>>(new Set())
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set())
  const [roofMaterialFilter, setRoofMaterialFilter] = useState<Set<string>>(new Set())

  // ── Single-select / range filters ──
  const [listFilter, setListFilter] = useState<string | null>(null)
  const [hasPhoneFilter, setHasPhoneFilter] = useState('all')
  const [hasEmailFilter, setHasEmailFilter] = useState('all')
  const [propertyTypeSearch, setPropertyTypeSearch] = useState('')
  const [sqftMin, setSqftMin] = useState('')
  const [sqftMax, setSqftMax] = useState('')
  const [hailSizeMin, setHailSizeMin] = useState('')
  const [hailSizeMax, setHailSizeMax] = useState('')
  const [hailDateFrom, setHailDateFrom] = useState('')
  const [hailDateTo, setHailDateTo] = useState('')

  const [filtersOpen, setFiltersOpen] = useState(false)

  // ── Bulk action ──
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedReps, setSelectedReps] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)
  const [assignProgress, setAssignProgress] = useState<{ done: number; total: number } | null>(null)
  const [assignError, setAssignError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [editingTarget, setEditingTarget] = useState<any | null>(null)

  useEffect(() => {
    if (!currentUser?.email) return
    base44.entities.UserProfile.filter({ email: currentUser.email }, undefined, 1)
      .then((d: any) => setIsAdmin(d[0]?.role === 'admin'))
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
    const s = new Set<string>()
    for (const t of storeTargets as any[]) {
      const st = extractState(t.line2 ?? '')
      if (st) s.add(st)
    }
    return [...s].sort().map(v => ({ value: v, label: v }))
  }, [storeTargets])

  const uniqueRoofMaterials = useMemo(() => {
    const s = new Set<string>()
    for (const t of storeTargets as any[]) {
      if (t.roof_material) s.add(t.roof_material)
    }
    return [...s].sort().map(v => ({ value: v, label: v }))
  }, [storeTargets])

  const reps = profiles.filter(p => p.role === 'rep' || p.role === 'admin')

  const repOptions = useMemo(() => [
    { value: '__unassigned__', label: 'Unassigned' },
    ...reps.map(p => ({ value: p.email, label: p.full_name ?? p.email })),
  ], [reps])

  const assignRepOptions = useMemo(() =>
    reps.map(p => ({ value: p.email, label: p.full_name ?? p.email }))
  , [reps])

  // ── Filtering ──
  const filteredTargets = useMemo(() => filterTargets(storeTargets as any[], {
    search, contactSearch,
    statusFilter, listFilter, repFilter, stateFilter,
    hasPhoneFilter: hasPhoneFilter as 'all' | 'yes' | 'no',
    hasEmailFilter: hasEmailFilter as 'all' | 'yes' | 'no',
    propertyTypeSearch, roofMaterialFilter,
    sqftMin, sqftMax, hailSizeMin, hailSizeMax, hailDateFrom, hailDateTo,
  }), [
    storeTargets, search, contactSearch,
    statusFilter, listFilter, repFilter, stateFilter,
    hasPhoneFilter, hasEmailFilter, propertyTypeSearch, roofMaterialFilter,
    sqftMin, sqftMax, hailSizeMin, hailSizeMax, hailDateFrom, hailDateTo,
  ])

  useEffect(() => { setPage(0) }, [
    search, contactSearch,
    statusFilter, listFilter, repFilter, stateFilter,
    hasPhoneFilter, hasEmailFilter, propertyTypeSearch, roofMaterialFilter,
    sqftMin, sqftMax, hailSizeMin, hailSizeMax, hailDateFrom, hailDateTo,
  ])

  const pageCount = Math.max(1, Math.ceil(filteredTargets.length / PAGE_SIZE))
  const visibleTargets = filteredTargets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const allSelected = filteredTargets.length > 0 && filteredTargets.every(t => selected.has(t.id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filteredTargets.map((t: any) => t.id)))
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const hasActiveFilters =
    !!search || !!contactSearch ||
    statusFilter.size > 0 || !!listFilter || repFilter.size > 0 ||
    stateFilter.size > 0 || hasPhoneFilter !== 'all' || hasEmailFilter !== 'all' ||
    !!propertyTypeSearch || roofMaterialFilter.size > 0 ||
    !!sqftMin || !!sqftMax || !!hailSizeMin || !!hailSizeMax ||
    !!hailDateFrom || !!hailDateTo

  function clearFilters() {
    setSearch(''); setContactSearch('')
    setStatusFilter(new Set()); setListFilter(null)
    setRepFilter(new Set()); setStateFilter(new Set())
    setHasPhoneFilter('all'); setHasEmailFilter('all')
    setPropertyTypeSearch(''); setRoofMaterialFilter(new Set())
    setSqftMin(''); setSqftMax('')
    setHailSizeMin(''); setHailSizeMax('')
    setHailDateFrom(''); setHailDateTo('')
  }

  async function handleDelete() {
    if (selected.size === 0 || deleting) return
    if (!confirm(`Permanently delete ${selected.size.toLocaleString()} target${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    setDeleting(true); setDeleteError('')
    const ids = [...selected]
    setDeleteProgress({ done: 0, total: ids.length })
    try {
      for (let i = 0; i < ids.length; i++) {
        let retries = 0
        while (true) {
          try { await base44.entities.Target.delete(ids[i]); break }
          catch (e: any) {
            if (retries++ >= 4) throw e
            await new Promise(r => setTimeout(r, 1500 * retries))
          }
        }
        setDeleteProgress({ done: i + 1, total: ids.length })
      }
      setSelected(new Set()); await refresh()
    } catch {
      setDeleteError('Failed partway through. Some targets may not have been deleted.')
    } finally {
      setDeleting(false); setDeleteProgress(null)
    }
  }

  async function handleAssign() {
    if (selectedReps.size === 0 || selected.size === 0 || assigning) return
    setAssigning(true); setAssignError('')
    const ids = [...selected]
    const repsArr = [...selectedReps]
    setAssignProgress({ done: 0, total: ids.length })
    try {
      const chunkSize = Math.ceil(ids.length / repsArr.length)
      let doneCount = 0
      for (let ri = 0; ri < repsArr.length; ri++) {
        const slice = ids.slice(ri * chunkSize, (ri + 1) * chunkSize)
        for (const id of slice) {
          let retries = 0
          while (true) {
            try { await base44.entities.Target.update(id, { assigned_to: repsArr[ri] }); break }
            catch (e: any) {
              if (retries++ >= 4) throw e
              await new Promise(r => setTimeout(r, 1500 * retries))
            }
          }
          doneCount++
          setAssignProgress({ done: doneCount, total: ids.length })
        }
      }
      setSelected(new Set()); setSelectedReps(new Set()); await refresh()
    } catch {
      setAssignError('Failed partway through. Some targets may not have been assigned.')
    } finally {
      setAssigning(false); setAssignProgress(null)
    }
  }

  const listName = (listId: string) => (lists as any[]).find(l => l.id === listId)?.name ?? '—'
  const repName = (email: string) => profiles.find(p => p.email === email)?.full_name ?? email

  if (isAdmin === null) return <div className={styles.accessMsg}>Checking access…</div>
  if (!isAdmin) return <div className={styles.accessMsg}>Access denied.</div>

  return (
    <div className={styles.page}>
      {editingTarget && (
        <EditTargetModal
          target={editingTarget}
          onClose={() => setEditingTarget(null)}
          onSaved={() => {
            setEditingTarget(null)
            refresh()
          }}
        />
      )}
      <motion.div
        className={styles.topBar}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <span className={styles.pageTitle}>BULK TARGETS</span>
        <span className={styles.totalCount}>
          {filteredTargets.length.toLocaleString()} targets
          {!allTargetsLoaded && <span className={styles.loadingBadge}> · loading…</span>}
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
            className={styles.listSelect}
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
            <button className={styles.clearFiltersBtn} onClick={clearFilters}>Clear all</button>
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
                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>REP</label>
                  <MultiSelect
                    options={repOptions}
                    selected={repFilter}
                    onChange={setRepFilter}
                    placeholder="All Reps"
                  />
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>STATUS</label>
                  <MultiSelect
                    options={STATUS_OPTIONS}
                    selected={statusFilter}
                    onChange={setStatusFilter}
                    placeholder="All Statuses"
                  />
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>STATE</label>
                  <MultiSelect
                    options={uniqueStates}
                    selected={stateFilter}
                    onChange={setStateFilter}
                    placeholder="All States"
                  />
                </div>

                <div className={styles.filterCell}>
                  <label className={styles.filterLabel}>ROOF MATERIAL</label>
                  <MultiSelect
                    options={uniqueRoofMaterials}
                    selected={roofMaterialFilter}
                    onChange={setRoofMaterialFilter}
                    placeholder="All Materials"
                  />
                </div>

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
                  <input type="checkbox" className={styles.checkbox} checked={allSelected} onChange={toggleAll} />
                </th>
                <th className={styles.th}>Address</th>
                <th className={styles.th}>List</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Hail</th>
                <th className={styles.th}>Assigned To</th>
                <th className={styles.th}></th>
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
                    <input type="checkbox" className={styles.checkbox} checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} />
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
                      : <span className={styles.dash}>—</span>}
                  </td>
                  <td className={styles.td} onClick={e => e.stopPropagation()}>
                    <button
                      className={styles.editRowBtn}
                      onClick={() => setEditingTarget(t)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pageCount > 1 && (
        <div className={styles.pagination}>
          <button className={styles.pageBtn} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className={styles.pageLabel}>
            {page + 1} / {pageCount}
            <span className={styles.pageSubLabel}> ({filteredTargets.length.toLocaleString()} total)</span>
          </span>
          <button className={styles.pageBtn} disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {selected.size > 0 && (
        <motion.div
          className={styles.actionBar}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          <span className={styles.selectedCount}>{selected.size.toLocaleString()} selected</span>
          <div style={{ width: 220, flexShrink: 0, opacity: (assigning || deleting) ? 0.4 : 1, pointerEvents: (assigning || deleting) ? 'none' : 'auto' }}>
            <MultiSelect
              options={assignRepOptions}
              selected={selectedReps}
              onChange={setSelectedReps}
              placeholder="Assign to rep(s)…"
              openUp
            />
          </div>
          <button className={styles.assignBtn} disabled={selectedReps.size === 0 || assigning || deleting} onClick={handleAssign}>
            {assigning && assignProgress
              ? `${assignProgress.done}/${assignProgress.total}…`
              : assigning ? 'Assigning…'
              : selectedReps.size > 1 ? 'Split & Assign' : 'Assign'}
          </button>
          <button className={styles.clearBtn} disabled={assigning || deleting} onClick={() => { setSelected(new Set()); setSelectedReps(new Set()) }}>
            Clear
          </button>
          <button className={styles.deleteBtn} disabled={assigning || deleting} onClick={handleDelete}>
            {deleting && deleteProgress ? `Deleting ${deleteProgress.done}/${deleteProgress.total}…` : deleting ? 'Deleting…' : 'Delete Selected'}
          </button>
          {assignError && <span className={styles.assignError}>{assignError}</span>}
          {deleteError && <span className={styles.assignError}>{deleteError}</span>}
        </motion.div>
      )}
    </div>
  )
}
