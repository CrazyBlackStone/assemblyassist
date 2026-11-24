import { useMemo } from 'react'
import { packageGeometry, packageExtent, toBoard } from '../lib/bom/packages.js'
import { PartBody } from './PartGlyph.jsx'
import { STATUS } from '../state/projects.js'

// Panel 2: the board as rendered from the Gerbers (or from the parts alone), with placed
// parts drawn on it and the current part hovering, pulsing, then landing when placed.
// Coordinates: mm, screen orientation (svgY = -boardY). The whole board can be turned in
// 90° steps so it matches how it sits on the bench.

export function BoardView({ project, highlightRef = null, activeRef = null, calibrateRef = null, reviewItems = null, onPick }) {
  const { board, render, settings, status, current, verifications } = project
  const rot = settings.viewRotation ?? 0
  const [vx, vy, vw, vh] = render.viewBox
  const cx = vx + vw / 2
  const cy = vy + vh / 2
  const turned = rot % 180 !== 0
  const pad = Math.max(vw, vh) * 0.04
  const vb = turned ? [cx - vh / 2 - pad, cy - vw / 2 - pad, vh + 2 * pad, vw + 2 * pad] : [vx - pad, vy - pad, vw + 2 * pad, vh + 2 * pad]
  const unit = Math.max(vw, vh) / 60 // label/ring size relative to board size

  const parts = useMemo(
    () =>
      Object.values(board.parts)
        .filter((p) => p.loc && p.loc.side !== 'bottom')
        .map((p) => {
          const g = packageGeometry(p)
          const e = packageExtent(g)
          const c = toBoard({ x: e.cx, y: e.cy }, p.loc)
          return { p, g, e, c, r: Math.max(Math.hypot(e.w, e.h) / 2, unit * 0.9) }
        }),
    [board, unit],
  )
  const gerberHref = useMemo(() => (render.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(render.svg)}` : null), [render.svg])

  // Screen position of a board point after the view rotation (for upright labels).
  const turn = (x, y) => {
    const a = (rot * Math.PI) / 180
    const dx = x - cx
    const dy = y - cy
    return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) }
  }

  const reviewState = Object.fromEntries((reviewItems ?? []).map((i) => [i.ref, i.status]))
  const ringColor = (ref) => {
    const s = reviewState[ref]
    if (s === 'ok') return 'var(--ok)'
    if (s === 'problem') return 'var(--bad)'
    if (s === 'unclear' || s === 'error') return 'var(--warn)'
    const v = verifications[ref]
    if (v?.verdict === 'problem' && v.user !== 'ok') return 'var(--bad)'
    return null
  }

  const cur = parts.find((x) => x.p.ref === current)
  const labelRefs = [current, highlightRef, activeRef, calibrateRef].filter(Boolean)

  return (
    <div className="boardview">
      <svg viewBox={vb.join(' ')} preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="lift" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy={unit * 0.25} stdDeviation={unit * 0.35} floodColor="#000" floodOpacity="0.6" />
          </filter>
        </defs>
        <g transform={`rotate(${rot} ${cx} ${cy})`}>
          {gerberHref ? (
            <image href={gerberHref} x={vx} y={vy} width={vw} height={vh} preserveAspectRatio="none" />
          ) : (
            <FallbackBoard parts={parts} viewBox={render.viewBox} />
          )}

          {parts.map(({ p, g }) => {
            const st = status[p.ref]
            if (st !== STATUS.placed || p.ref === current) return null
            return (
              <g key={`${p.ref}-placed`} transform={`translate(${p.loc.x} ${-p.loc.y}) rotate(${-p.loc.rot})`} onClick={() => onPick?.(p.ref)} style={{ cursor: 'pointer' }}>
                <g className="pl-land">
                  <PartBody part={p} g={g} />
                </g>
              </g>
            )
          })}

          {parts.map(({ p, e }) =>
            status[p.ref] === STATUS.skipped ? (
              <g key={`${p.ref}-skip`} transform={`translate(${p.loc.x} ${-p.loc.y}) rotate(${-p.loc.rot})`}>
                <rect x={e.minX - 0.3} y={-e.maxY - 0.3} width={e.w + 0.6} height={e.h + 0.6} rx={0.4} fill="none" stroke="var(--warn)" strokeWidth={unit * 0.12} strokeDasharray={`${unit * 0.4} ${unit * 0.3}`} />
              </g>
            ) : null,
          )}

          {parts.map(({ p, c, r }) => {
            const color = ringColor(p.ref)
            const lit = p.ref === activeRef
            if (!color && !lit) return null
            return <circle key={`${p.ref}-ring`} cx={c.x} cy={-c.y} r={r * 1.08} fill="none" stroke={lit ? 'var(--accent)' : color} strokeWidth={unit * (lit ? 0.35 : 0.2)} className={lit ? 'lit' : undefined} />
          })}

          {/* hit areas for every part, so any part can be tapped */}
          {parts.map(({ p, c, r }) => (
            <circle key={`${p.ref}-hit`} cx={c.x} cy={-c.y} r={r} fill="transparent" onClick={() => onPick?.(p.ref)} style={{ cursor: 'pointer' }} />
          ))}

          {cur && (
            <g key={`${cur.p.ref}-current`}>
              <circle cx={cur.c.x} cy={-cur.c.y} r={cur.r * 1.25} className="halo" strokeWidth={unit * 0.3} />
              <circle cx={cur.c.x} cy={-cur.c.y} r={cur.r * 1.25} fill="none" stroke="var(--accent)" strokeWidth={unit * 0.18} opacity="0.8" />
              <g transform={`translate(${cur.p.loc.x} ${-cur.p.loc.y}) rotate(${-cur.p.loc.rot})`} filter="url(#lift)">
                <g className="pl-current" opacity="0.92">
                  <PartBody part={cur.p} g={cur.g} highlight />
                </g>
              </g>
            </g>
          )}

          {[highlightRef, calibrateRef].filter(Boolean).map((ref) => {
            const x = parts.find((q) => q.p.ref === ref)
            return x ? <circle key={`${ref}-where`} cx={x.c.x} cy={-x.c.y} r={x.r * 1.4} className="halo where" strokeWidth={unit * 0.35} /> : null
          })}
        </g>

        {labelRefs.map((ref, i) => {
          const x = parts.find((q) => q.p.ref === ref)
          if (!x || labelRefs.indexOf(ref) !== i) return null
          const s = turn(x.c.x, -x.c.y)
          return (
            <text key={`${ref}-label`} x={s.x} y={s.y - x.r * 1.6 - unit * 0.4} textAnchor="middle" fontSize={unit * 1.6} strokeWidth={unit * 0.35} className="part-label">
              {ref}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function FallbackBoard({ parts, viewBox: [x, y, w, h] }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={1.2} fill="#0d3a2b" stroke="#1f5b45" strokeWidth={0.2} />
      {parts.map(({ p, g }) => (
        <g key={p.ref} transform={`translate(${p.loc.x} ${-p.loc.y}) rotate(${-p.loc.rot})`}>
          {g.pads.map((pad, i) => (
            <rect key={i} x={pad.x - pad.w / 2} y={-pad.y - pad.h / 2} width={pad.w} height={pad.h} rx={pad.shape === 'circle' ? pad.w / 2 : 0.1} fill="#d8b45a" />
          ))}
          <rect x={g.body.cx - g.body.w / 2 - 0.25} y={-g.body.cy - g.body.h / 2 - 0.25} width={g.body.w + 0.5} height={g.body.h + 0.5} fill="none" stroke="#e9ece4" strokeWidth={0.12} opacity={0.7} />
        </g>
      ))}
    </g>
  )
}
