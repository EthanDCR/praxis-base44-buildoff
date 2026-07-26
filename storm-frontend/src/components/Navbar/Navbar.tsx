import { NavLink, useLocation } from 'react-router-dom'
import { useLottie } from 'lottie-react'
import animationData from '../../assets/praxis-animation-lottie.json'
import styles from './Navbar.module.css'

function LogoAnimation() {
  const { View } = useLottie({ animationData, loop: false, autoplay: true, className: styles.logoLottie })
  return <>{View}</>
}

export default function Navbar() {
  const location = useLocation()
  return (
    <nav className={styles.nav}>
      <div className={styles.brand}>
        <LogoAnimation key={location.pathname} />
        <div className={styles.brandText}>
          <span className={styles.brandName}>Praxis</span>
          <span className={styles.brandTagline}>from vision to reality</span>
        </div>
      </div>

      <ul className={styles.links}>
        {[
          { to: '/',           label: 'Storm Map' },
          { to: '/speed-dial', label: 'Targets'   },
          { to: '/leads',      label: 'Leads'     },
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
    </nav>
  )
}
