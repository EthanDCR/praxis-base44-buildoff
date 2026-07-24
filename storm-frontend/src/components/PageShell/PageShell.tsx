import { motion } from 'motion/react'
import styles from './PageShell.module.css'
import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  actions?: ReactNode
  children?: ReactNode
}

export default function PageShell({ title, subtitle, actions, children }: Props) {
  return (
    <motion.main
      className={styles.page}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className={styles.header}>
        <div className={styles.headerText}>
          <motion.h1
            initial={{ opacity: 0, y: 32, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay: 0.1, duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
          >
            {title}
          </motion.h1>
          {subtitle && (
            <motion.p
              className={styles.subtitle}
              initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.3, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            >
              {subtitle}
            </motion.p>
          )}
        </div>
        {actions && (
          <motion.div
            className={styles.actions}
            initial={{ opacity: 0, scale: 0.92, filter: 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ delay: 0.35, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            {actions}
          </motion.div>
        )}
      </div>
      <motion.div
        className={styles.divider}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        style={{ transformOrigin: 'left' }}
        transition={{ delay: 0.4, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
      {children}
    </motion.main>
  )
}
