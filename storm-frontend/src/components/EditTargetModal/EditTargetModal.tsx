import { useState, type FormEvent } from 'react'
import { base44 } from '../../lib/base44'
import styles from './EditTargetModal.module.css'

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'called', label: 'Called' },
  { value: 'callback', label: 'Callback' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'sold', label: 'Inspection Set' },
  { value: 'overwatch', label: 'Overwatch' },
  { value: 'crm_sent', label: 'CRM Sent' },
]

interface Phone { number: string; type: string }
interface Contact { name: string; title: string; company: string; phones: Phone[]; emails: string[] }

interface Props {
  target: any
  onClose: () => void
  onSaved: (updated: any) => void
}

function normalizeContacts(raw: any[]): Contact[] {
  return (raw ?? []).map(c => ({
    name: c.name ?? '',
    title: c.title ?? '',
    company: c.company ?? '',
    phones: (c.phones ?? []).map((p: any) =>
      typeof p === 'string' ? { number: p, type: '' } : { number: p.number ?? '', type: p.type ?? '' }
    ),
    emails: (c.emails ?? []).map(String),
  }))
}

export default function EditTargetModal({ target, onClose, onSaved }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [line1, setLine1] = useState(target.line1 ?? '')
  const [line2, setLine2] = useState(target.line2 ?? '')
  const [status, setStatus] = useState(target.status ?? 'new')
  const [notes, setNotes] = useState(target.notes ?? '')
  const [hailSize, setHailSize] = useState(target.hail_size != null ? String(target.hail_size) : '')
  const [hailDate, setHailDate] = useState(target.hail_date ? target.hail_date.slice(0, 10) : '')
  const [propertyType, setPropertyType] = useState(target.property_type ?? '')
  const [yearBuilt, setYearBuilt] = useState(target.year_built ?? '')
  const [squareFootage, setSquareFootage] = useState(target.square_footage != null ? String(target.square_footage) : '')
  const [roofMaterial, setRoofMaterial] = useState(target.roof_material ?? '')
  const [estimatedValue, setEstimatedValue] = useState(target.estimated_value != null ? String(target.estimated_value) : '')
  const [equityPercent, setEquityPercent] = useState(target.equity_percent != null ? String(target.equity_percent) : '')
  const [contacts, setContacts] = useState<Contact[]>(() => normalizeContacts(target.contacts))

  function updateContact(idx: number, patch: Partial<Contact>) {
    setContacts(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }

  function addContact() {
    setContacts(prev => [...prev, { name: '', title: '', company: '', phones: [], emails: [] }])
  }

  function removeContact(idx: number) {
    setContacts(prev => prev.filter((_, i) => i !== idx))
  }

  function addPhone(ci: number) {
    updateContact(ci, { phones: [...contacts[ci].phones, { number: '', type: '' }] })
  }

  function updatePhone(ci: number, pi: number, patch: Partial<Phone>) {
    updateContact(ci, { phones: contacts[ci].phones.map((p, i) => i === pi ? { ...p, ...patch } : p) })
  }

  function removePhone(ci: number, pi: number) {
    updateContact(ci, { phones: contacts[ci].phones.filter((_, i) => i !== pi) })
  }

  function addEmail(ci: number) {
    updateContact(ci, { emails: [...contacts[ci].emails, ''] })
  }

  function updateEmail(ci: number, ei: number, val: string) {
    updateContact(ci, { emails: contacts[ci].emails.map((e, i) => i === ei ? val : e) })
  }

  function removeEmail(ci: number, ei: number) {
    updateContact(ci, { emails: contacts[ci].emails.filter((_, i) => i !== ei) })
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const patch: Record<string, any> = {
        line1: line1.trim(),
        line2: line2.trim(),
        status,
        notes: notes.trim(),
        contacts: contacts.map(c => ({
          name: c.name.trim(),
          title: c.title.trim() || undefined,
          company: c.company.trim() || undefined,
          phones: c.phones
            .map(p => ({ number: p.number.trim(), type: p.type.trim() || undefined }))
            .filter(p => p.number),
          emails: c.emails.map(e => e.trim()).filter(Boolean),
        })),
      }
      if (hailSize) patch.hail_size = parseFloat(hailSize)
      if (hailDate) patch.hail_date = new Date(hailDate).toISOString()
      if (propertyType.trim()) patch.property_type = propertyType.trim()
      if (yearBuilt.trim()) patch.year_built = yearBuilt.trim()
      if (squareFootage) patch.square_footage = parseFloat(squareFootage)
      if (roofMaterial.trim()) patch.roof_material = roofMaterial.trim()
      if (estimatedValue) patch.estimated_value = parseFloat(estimatedValue)
      if (equityPercent) patch.equity_percent = parseFloat(equityPercent)

      await base44.entities.Target.update(target.id, patch)
      onSaved({ ...target, ...patch })
    } catch {
      setError('Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <div className={styles.headerTitle}>Edit Target</div>
            <div className={styles.headerSub}>{target.line1}{target.line2 ? ` · ${target.line2}` : ''}</div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} type="button">✕</button>
        </div>

        <form className={styles.body} onSubmit={handleSave}>

          {/* ── Address ─────────────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>ADDRESS</div>
            <div className={styles.row2}>
              <div className={styles.field}>
                <label className={styles.label}>Street</label>
                <input className={styles.input} value={line1} onChange={e => setLine1(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>City, State ZIP</label>
                <input className={styles.input} value={line2} onChange={e => setLine2(e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── Status & Notes ───────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>STATUS & NOTES</div>
            <div className={styles.field} style={{ maxWidth: 220 }}>
              <label className={styles.label}>Status</label>
              <select className={styles.select} value={status} onChange={e => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Notes</label>
              <textarea className={styles.textarea} rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes…" />
            </div>
          </div>

          {/* ── Contacts ─────────────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>CONTACTS</div>
            {contacts.map((c, ci) => (
              <div key={ci} className={styles.contactBlock}>
                <div className={styles.contactBlockHeader}>
                  <span className={styles.contactIdx}>Contact {ci + 1}</span>
                  <button type="button" className={styles.removeContactBtn} onClick={() => removeContact(ci)}>Remove</button>
                </div>
                <div className={styles.row3}>
                  <div className={styles.field}>
                    <label className={styles.label}>Name</label>
                    <input className={styles.input} placeholder="Full name" value={c.name} onChange={e => updateContact(ci, { name: e.target.value })} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Title</label>
                    <input className={styles.input} placeholder="Job title" value={c.title} onChange={e => updateContact(ci, { title: e.target.value })} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Company</label>
                    <input className={styles.input} placeholder="Company" value={c.company} onChange={e => updateContact(ci, { company: e.target.value })} />
                  </div>
                </div>

                <div className={styles.subSection}>
                  <span className={styles.subLabel}>Phones</span>
                  {c.phones.map((p, pi) => (
                    <div key={pi} className={styles.subRow}>
                      <input className={styles.inputFlex} placeholder="Number" value={p.number} onChange={e => updatePhone(ci, pi, { number: e.target.value })} />
                      <select className={styles.typeSelect} value={p.type} onChange={e => updatePhone(ci, pi, { type: e.target.value })}>
                        <option value="">Type</option>
                        <option value="mobile">Mobile</option>
                        <option value="wireless">Wireless</option>
                        <option value="landline">Landline</option>
                        <option value="voip">VoIP</option>
                      </select>
                      <button type="button" className={styles.iconBtn} onClick={() => removePhone(ci, pi)}>✕</button>
                    </div>
                  ))}
                  <button type="button" className={styles.addBtn} onClick={() => addPhone(ci)}>+ Add Phone</button>
                </div>

                <div className={styles.subSection}>
                  <span className={styles.subLabel}>Emails</span>
                  {c.emails.map((email, ei) => (
                    <div key={ei} className={styles.subRow}>
                      <input className={styles.inputFlex} type="email" placeholder="email@example.com" value={email} onChange={ev => updateEmail(ci, ei, ev.target.value)} />
                      <button type="button" className={styles.iconBtn} onClick={() => removeEmail(ci, ei)}>✕</button>
                    </div>
                  ))}
                  <button type="button" className={styles.addBtn} onClick={() => addEmail(ci)}>+ Add Email</button>
                </div>
              </div>
            ))}
            <button type="button" className={styles.addContactBtn} onClick={addContact}>+ Add Contact</button>
          </div>

          {/* ── Hail Data ────────────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>HAIL DATA</div>
            <div className={styles.row2}>
              <div className={styles.field}>
                <label className={styles.label}>Hail Size (in)</label>
                <input className={styles.input} type="number" step="0.25" min="0" placeholder="e.g. 1.75" value={hailSize} onChange={e => setHailSize(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Hail Date</label>
                <input className={styles.input} type="date" value={hailDate} onChange={e => setHailDate(e.target.value)} style={{ colorScheme: 'dark' }} />
              </div>
            </div>
          </div>

          {/* ── Property Data ─────────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>PROPERTY DATA</div>
            <div className={styles.row3}>
              <div className={styles.field}>
                <label className={styles.label}>Property Type</label>
                <input className={styles.input} placeholder="e.g. Retail" value={propertyType} onChange={e => setPropertyType(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Year Built</label>
                <input className={styles.input} placeholder="e.g. 1998" value={yearBuilt} onChange={e => setYearBuilt(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Square Footage</label>
                <input className={styles.input} type="number" min="0" value={squareFootage} onChange={e => setSquareFootage(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Roof Material</label>
                <input className={styles.input} placeholder="e.g. Metal" value={roofMaterial} onChange={e => setRoofMaterial(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Est. Value ($)</label>
                <input className={styles.input} type="number" min="0" value={estimatedValue} onChange={e => setEstimatedValue(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Equity (%)</label>
                <input className={styles.input} type="number" min="0" max="100" value={equityPercent} onChange={e => setEquityPercent(e.target.value)} />
              </div>
            </div>
          </div>

          {error && <div className={styles.errorMsg}>{error}</div>}

          <div className={styles.footer}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className={styles.saveBtn} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
