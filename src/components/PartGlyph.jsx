import { refPrefix } from '../lib/bom/refs.js'
import { packageExtent, markDirection } from '../lib/bom/packages.js'

// Draws a part from its package geometry, in mm, screen orientation (y down).
// Used at board scale in the board view and large in the part panel.

const METAL = '#cfd3d8'
const GOLD = '#e0b552'

function bodyStyle(part, g) {
  const p = refPrefix(part.ref)
  const m = part.polarity?.marking
  if (g.family === 'header') return { fill: '#141416', stroke: '#2b2b30' }
  if (g.style === 'usb') return { fill: '#aab0b8', stroke: '#7d838b' }
  if (g.style === 'fpc') return { fill: '#dccba4', stroke: '#b3a27c' }
  if (g.style === 'elec' || g.style === 'film') return { fill: '#3a4a66', stroke: '#26324a' }
  if (g.family === 'switch') return { fill: '#8d939b', stroke: '#5d636b' }
  if (m === 'tantalum') return { fill: '#d6a22a', stroke: '#a77c18' }
  if (m === 'electrolytic') return { fill: '#3a4a66', stroke: '#26324a' }
  if (p === 'LED' || /LED/i.test(part.footprint)) return { fill: '#f1efe6', stroke: '#c9c6ba' }
  if (p === 'C') return { fill: '#b58a5c', stroke: '#8c6741' }
  return { fill: '#1b1c20', stroke: '#33353c' }
}

function markColor(part) {
  const m = part.polarity?.marking
  if (m === 'tantalum') return '#6e4b0e'
  if (/LED/i.test(part.footprint)) return '#33c46a'
  return '#d8dade'
}

/** The part's shapes in its own frame (origin = placement point). */
export function PartBody({ part, g, highlight = false, scale = 1 }) {
  const style = bodyStyle(part, g)
  const { w, h, cx, cy } = g.body
  const mk = g.mark
  const hi = highlight ? 'var(--mark)' : null
  const sw = 0.06 * scale
  return (
    <g>
      {g.pads.map((pad, i) => (
        <rect
          key={i}
          x={pad.x - (pad.w * 0.82) / 2}
          y={-pad.y - (pad.h * 0.82) / 2}
          width={pad.w * 0.82}
          height={pad.h * 0.82}
          rx={pad.shape === 'circle' ? (pad.w * 0.82) / 2 : Math.min(pad.w, pad.h) * 0.12}
          fill={g.family === 'header' ? GOLD : METAL}
        />
      ))}
      <rect x={cx - w / 2} y={-cy - h / 2} width={w} height={h} rx={Math.min(w, h) * (g.family === 'chip2' ? 0.12 : 0.06)} fill={style.fill} stroke={style.stroke} strokeWidth={sw} />
      {g.family === 'switch' && <circle cx={cx} cy={-cy} r={Math.min(w, h) * 0.3} fill="#141416" />}
      {mk?.type === 'pin1' && g.family !== 'header' && (
        <circle cx={mk.x} cy={-mk.y} r={Math.max(0.18, Math.min(w, h) * 0.1)} fill={hi ?? '#4a4c55'} className={highlight ? 'lit' : undefined} />
      )}
      {mk?.type === 'pin1' && g.family === 'header' && hi && (
        <rect x={mk.x - 0.9} y={-mk.y - 0.9} width={1.8} height={1.8} fill="none" stroke={hi} strokeWidth={0.25} className="lit" />
      )}
      {(mk?.type === 'cathode' || mk?.type === 'plus' || mk?.type === 'minus') && (
        <rect x={mk.x - w * 0.07} y={-cy - h / 2} width={w * 0.14} height={h} fill={hi ?? markColor(part)} className={highlight ? 'lit' : undefined} />
      )}
    </g>
  )
}

const ARROWS = { top: '↑', 'top-right': '↗', right: '→', 'bottom-right': '↘', bottom: '↓', 'bottom-left': '↙', left: '←', 'top-left': '↖', centre: '•' }
const MARK_NAMES = { pin1: 'Pin 1', cathode: 'Cathode', plus: 'Plus +', minus: 'Minus −' }

/**
 * Mark name + arrow for the part as it appears on screen (part rotation + view rotation).
 * A back-side part is seen with the board flipped over, which turns its rotation around.
 */
export function orientationLabel(g, rot, viewRotation, side = 'top') {
  if (!g.mark) return null
  const dir = markDirection(g, (side === 'bottom' ? -rot : rot) - viewRotation)
  return { name: MARK_NAMES[g.mark.type], arrow: ARROWS[dir] ?? '', dir }
}

/** Standalone drawing for the part panel, rotated as it will sit on the board. */
export function PartGlyph({ part, g, rot, viewRotation, side = 'top' }) {
  const e = packageExtent(g)
  const r = Math.hypot(e.w, e.h) * 0.62
  const turn = side === 'bottom' ? viewRotation + rot : viewRotation - rot
  return (
    <svg viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`} role="img" aria-label={`${part.ref} package`}>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={r * 0.02} />
        </filter>
      </defs>
      <circle cx={0} cy={0} r={r * 0.97} fill="none" stroke="var(--separator)" strokeWidth={r * 0.01} />
      <g transform={`rotate(${turn}) translate(${-e.cx} ${e.cy})`}>
        <PartBody part={part} g={g} highlight scale={r / 4} />
      </g>
    </svg>
  )
}
