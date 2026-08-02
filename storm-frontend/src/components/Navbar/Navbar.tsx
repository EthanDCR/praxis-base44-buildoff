import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { useLottie } from 'lottie-react'
import animationData from '../../assets/praxis-animation-lottie.json'
import styles from './Navbar.module.css'
import { useUser } from '../../lib/user-context'
import { base44 } from '../../lib/base44'

const EASE = [0.22, 1, 0.36, 1] as const

function LogoAnimation() {
  const { View } = useLottie({ animationData, loop: false, autoplay: true, className: styles.logoLottie })
  return <>{View}</>
}

export default function Navbar() {
  const location = useLocation()
  const user = useUser()
  return (
    <nav className={styles.nav}>
      <div className={styles.brand}>
        <LogoAnimation key={location.pathname} />
        <div className={styles.brandText}>
          <motion.span
            key={location.pathname + '-name'}
            className={styles.brandName}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 1.9, ease: 'easeOut' }}
          >
            RAXIS
          </motion.span>
          <motion.span
            key={location.pathname + '-tag'}
            className={styles.brandTagline}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.8, duration: 0.65, ease: EASE }}
          >
            from vision to reality
          </motion.span>
        </div>
      </div>

      <ul className={styles.links}>
        {[
          { to: '/',               label: 'Storm Map'     },
          { to: '/speed-dial',     label: 'Targets'       },
          { to: '/leads',          label: 'Leads'         },
          { to: '/overwatch',      label: 'Overwatch'     },
          ...(user?.role === 'admin'
            ? [{ to: '/bulk-targets', label: 'Bulk Targets' }]
            : []),
        ].map(({ to, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.active}` : styles.link
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>

      {user && (
        <div className={styles.userSection}>
          <span className={styles.userEmail}>{user.full_name ?? user.email}</span>
          <button className={styles.logoutBtn} onClick={() => base44.auth.logout()}>
            Sign out
          </button>
        </div>
      )}
    </nav>
  )
}
