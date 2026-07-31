import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useDataStore } from '../../lib/data-store'
import styles from './Overwatch.module.css'

const EASE = [0.22, 1, 0.36, 1] as const

interface Contact {
  name: string
  title?: string
  company?: string
  phones: string[]
  emails: string[]
}

interface Target {
  id: string
  list_id?: string
  line1: string
  line2?: string
  contacts?: Contact[]
  notes?: string
  hail_size?: number
  hail_date?: string
  damage_signal?: 'yes' | 'no'
  status: 'sold' | 'overwatch' | 'crm_sent' | string
}

export default function Overwatch() {
  const { targets: storeTargets, loading } = useDataStore()
  const navigate = useNavigate()

  const targets = useMemo(
    () => storeTargets.filter((t: Target) => t.status === 'overwatch'),
    [storeTargets]
  )

  return (
    <div className={styles.page}>
      {/* Header */}
      <motion.div
        className={styles.header}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <div className={styles.headerLeft}>
          <div className={styles.radarRing}>
            <motion.div
              className={styles.radarDot}
              animate={{ scale: [1, 1.6, 1], opacity: [1, 0.3, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
          <div>
            <div className={styles.headerTitle}>OVERWATCH</div>
            <div className={styles.headerSub}>No-damage properties routed from field inspection</div>
          </div>
        </div>
        <motion.div
          className={styles.headerCount}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <span className={styles.headerCountNum}>{targets.length}</span>
          <span className={styles.headerCountLabel}>properties</span>
        </motion.div>
        <div className={styles.scanBar}>
          <motion.div
            className={styles.scanLine}
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.5 }}
          />
        </div>
      </motion.div>

      {/* Cards */}
      <div className={styles.body}>
        {loading && (
          <div className={styles.empty}>
            <div className={styles.emptyText}>Scanning…</div>
          </div>
        )}
        {!loading && targets.length === 0 && (
          <motion.div
            className={styles.empty}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <div className={styles.emptyIcon}>◎</div>
            <div className={styles.emptyText}>No properties in Overwatch</div>
          </motion.div>
        )}

        <AnimatePresence>
          {!loading && (
            <motion.div
              className={styles.grid}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {targets.map((t, i) => {
                const c     = t.contacts?.[0]
                const phone = c?.phones?.[0]
                return (
                  <motion.div
                    key={t.id}
                    className={styles.card}
                    initial={{ opacity: 0, y: 14, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: Math.min(i * 0.05, 0.4), duration: 0.45, ease: EASE }}
                  >
                    <div className={styles.cardGlow} />

                    <div className={styles.cardTop}>
                      <div className={styles.cardAddr}>
                        <div className={styles.cardLine1}>{t.line1}</div>
                        {t.line2 && <div className={styles.cardLine2}>{t.line2}</div>}
                      </div>
                      <div className={styles.noDamageBadge}>NO DAMAGE</div>
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

                    {t.hail_size && (
                      <div className={styles.hailLine}>
                        <span className={styles.hailLabel}>LAST HIT</span>
                        {t.hail_date && (
                          <span className={styles.hailDate}>
                            {new Date(t.hail_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        )}
                        <span className={styles.hailDot} />
                        <span className={styles.hailSize}>{t.hail_size}"</span>
                      </div>
                    )}

                    {t.damage_signal === 'yes' ? (
                      <motion.div
                        className={styles.damageSignalHit}
                        initial={{ opacity: 0, scale: 0.92 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3, ease: EASE }}
                      >
                        <motion.span
                          className={styles.damageSignalDot}
                          animate={{ opacity: [1, 0.3, 1] }}
                          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        HIT DETECTED! Potential damage
                      </motion.div>
                    ) : t.damage_signal === 'no' ? (
                      <div className={styles.damageSignalClear}>No damage detected</div>
                    ) : null}

                    {t.notes && <div className={styles.cardNote}>{t.notes}</div>}

                    {phone && <div className={styles.cardPhone}>{phone}</div>}

                    <button
                      className={styles.callBtn}
                      onClick={() => navigate('/speed-dial', { state: { targetId: t.id, listId: t.list_id } })}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
                      </svg>
                      Call Target
                    </button>

                    <motion.div
                      className={styles.cardPulse}
                      animate={{ opacity: [0.4, 0.9, 0.4], scale: [1, 1.08, 1] }}
                      transition={{ duration: 3 + i * 0.3, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </motion.div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
