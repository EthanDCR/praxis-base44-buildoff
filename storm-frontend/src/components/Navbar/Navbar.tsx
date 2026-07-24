import { NavLink } from 'react-router-dom'
import { motion } from 'motion/react'
import styles from './Navbar.module.css'

export default function Navbar() {
  return (
    <motion.nav
      className={styles.nav}
      initial={{ y: -64, opacity: 0, filter: 'blur(10px)' }}
      animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        className={styles.brand}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.4, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={styles.brandIcon}>⚡</div>
        Praxis
      </motion.div>
      <ul className={styles.links}>
        {[
          { to: '/', label: 'Storm Map' },
          { to: '/speed-dial', label: 'Targets' },
          { to: '/leads', label: 'Leads' },
        ].map(({ to, label }, i) => (
          <motion.li
            key={to}
            initial={{ opacity: 0, y: -16, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay: 0.5 + i * 0.12, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
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
