import { NavLink } from 'react-router-dom'
import { motion } from 'motion/react'
import Logo from '../Logo/Logo'
import styles from './Navbar.module.css'

const EASE = [0.22, 1, 0.36, 1] as const

export default function Navbar() {
  return (
    <motion.nav
      className={styles.nav}
      initial={{ y: -64, opacity: 0, filter: 'blur(10px)' }}
      animate={{ y: 0,   opacity: 1, filter: 'blur(0px)'  }}
      transition={{ duration: 1.1, ease: EASE }}
    >
      <motion.div
        className={styles.brand}
        initial={{ opacity: 0, x: -16, filter: 'blur(6px)' }}
        animate={{ opacity: 1, x: 0,   filter: 'blur(0px)' }}
        transition={{ delay: 0.35, duration: 0.9, ease: EASE }}
      >
        <Logo size={22} className={styles.logoMark} />
        <span className={styles.brandName}>Praxis</span>
        <span className={styles.brandTagline}>from vision to reality</span>
      </motion.div>

      <ul className={styles.links}>
        {[
          { to: '/',           label: 'Storm Map' },
          { to: '/speed-dial', label: 'Targets'   },
          { to: '/leads',      label: 'Leads'     },
        ].map(({ to, label }, i) => (
          <motion.li
            key={to}
            initial={{ opacity: 0, y: -14, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0,   filter: 'blur(0px)' }}
            transition={{ delay: 0.5 + i * 0.11, duration: 0.7, ease: EASE }}
          >
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.active}` : styles.link
              }
            >
              {label}
            </NavLink>
          </motion.li>
        ))}
      </ul>
    </motion.nav>
  )
}
