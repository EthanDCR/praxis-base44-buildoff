import { useId } from 'react'

interface Props {
  size?: number
  className?: string
}

// Logo #10 — "P" with pyramid/step lines carved inside the bowl.
// The three horizontal bars decrease in width from bottom to top,
// creating a mountain silhouette cut into the letterform.
export default function Logo({ size = 32, className }: Props) {
  const uid = useId()
  const mid = `pm${uid.replace(/:/g, '')}`
  const h   = Math.round(size * 44 / 36)

  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 36 44"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <mask id={mid}>
          <rect width="36" height="44" fill="white" />
          {/* pyramid cutouts — widest at bottom, narrowest at top */}
          <rect x="9"    y="16" width="18" height="3" fill="black" />
          <rect x="12.5" y="12" width="11" height="3" fill="black" />
          <rect x="16"   y="8"  width="4"  height="3" fill="black" />
        </mask>
      </defs>
      <g fill="currentColor" mask={`url(#${mid})`}>
        {/* stem */}
        <rect x="0"  y="0"  width="8"  height="44" />
        {/* bowl top */}
        <rect x="8"  y="0"  width="28" height="7"  />
        {/* bowl right column */}
        <rect x="28" y="7"  width="8"  height="20" />
        {/* bowl bottom */}
        <rect x="8"  y="20" width="28" height="7"  />
      </g>
    </svg>
  )
}
