import { useState, useEffect, useRef } from 'react'
import styles from './MultiSelect.module.css'

export function MultiSelect({
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
    <div ref={ref} className={styles.wrap}>
      <button
        type="button"
        className={`${styles.trigger} ${selected.size > 0 ? styles.triggerActive : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className={styles.label}>{displayText}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ flexShrink: 0 }}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className={`${styles.dropdown}${openUp ? ' ' + styles.dropdownUp : ''}`}>
          {options.map(o => (
            <label key={o.value} className={styles.option}>
              <input
                type="checkbox"
                className={styles.checkbox}
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
