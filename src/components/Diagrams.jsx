import { MARKINGS } from '../lib/bom/polarity.js'
import { refPrefix } from '../lib/bom/refs.js'
import { boardBounds } from '../lib/geometry/board.js'
import { STATUS } from '../state/session.js'

// Drawn from board data only (footprint family + pick-and-place rotation). No AI involved.

function family(part) {
  const fp = part.footprint
  const code = part.size.code
  if (/PinHeader|Conn/i.test(fp)) return 'header'
  if (/SOT-?223/i.test(fp)) return 'sot223'
  if (/SOT-?23/i.test(fp)) return 'sot23'
  if (/SOIC|TSSOP|MSOP|DIP|SO-?\d|QFN|QFP/i.test(fp) || ['U', 'IC'].includes(refPrefix(part.ref))) return 'ic'
  if (code) return 'chip2'
  return 'generic'
}

const MARK = '#ffd23f'

function PartShape({ part }) {
  const f = family(part)
  const marking = part.polarity.marking
  const body = { fill: '#2b3440', stroke: '#e8edf2', strokeWidth: 2 }
  const metal = { fill: '#b9c2cc' }

  if (f === 'chip2') {
    return (
      <g>
        <rect x={-70} y={-35} width={140} height={70} rx={6} {...body} />
        <rect x={-70} y={-35} width={26} height={70} {...metal} />
        <rect x={44} y={-35} width={26} height={70} {...metal} />
        {marking === 'cathode' && <rect x={-40} y={-35} width={14} height={70} fill={MARK} />}
        {marking === 'tantalum' && (
          <>
            <rect x={-40} y={-35} width={14} height={70} fill={MARK} />
            <text x={-95} y={12} className="diag-mark">+</text>
          </>
        )}
        {marking === 'electrolytic' && (
          <>
            <rect x={26} y={-35} width={14} height={70} fill={MARK} />
            <text x={-95} y={12} className="diag-mark">+</text>
            <text x={78} y={12} className="diag-mark">−</text>
          </>
        )}
        {marking === 'pin1' && <circle cx={-30} cy={-18} r={9} fill={MARK} />}
      </g>
    )
  }
  if (f === 'ic' || f === 'sot23' || f === 'sot223') {
    const left = f === 'ic' ? 4 : f === 'sot23' ? 2 : 3
    const right = f === 'ic' ? 4 : 1
    const pins = []
    const pitch = 30
    for (let i = 0; i < left; i++) {
      const y = -((left - 1) * pitch) / 2 + i * pitch
      pins.push(<rect key={`l${i}`} x={-78} y={y - 7} width={26} height={14} {...metal} />)
      if (i === 0) pins.push(<text key="n1" x={-112} y={y + 7} className="diag-pin">1</text>)
    }
    for (let i = 0; i < right; i++) {
      const y = right === 1 ? 0 : -((right - 1) * pitch) / 2 + i * pitch
      const h = f === 'sot223' ? 60 : 14
      pins.push(<rect key={`r${i}`} x={52} y={y - h / 2} width={26} height={h} {...metal} />)
    }
    const hh = Math.max(left, right) * pitch + 10
    return (
      <g>
        {pins}
        <rect x={-52} y={-hh / 2} width={104} height={hh} rx={4} {...body} />
        <circle cx={-32} cy={-hh / 2 + 18} r={10} fill={MARK} />
      </g>
    )
  }
  if (f === 'header') {
    const m = /PinHeader_(\d+)x(\d+)/i.exec(part.footprint)
    const rows = m ? Number(m[1]) : 1
    const cols = m ? Number(m[2]) : 2
    const pitch = 34
    const cells = []
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++) {
        const x = -((rows - 1) * pitch) / 2 + r * pitch
        const y = -((cols - 1) * pitch) / 2 + c * pitch
        cells.push(
          c === 0 && r === 0 ? (
            <rect key={`${r}-${c}`} x={x - 11} y={y - 11} width={22} height={22} fill={MARK} />
          ) : (
            <circle key={`${r}-${c}`} cx={x} cy={y} r={11} {...metal} />
          ),
        )
      }
    const w = rows * pitch + 10
    const h = cols * pitch + 10
    return (
      <g>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} {...body} />
        {cells}
      </g>
    )
  }
  return <rect x={-60} y={-40} width={120} height={80} rx={6} {...body} />
}

export function OrientationDiagram({ part }) {
  const pol = part.polarity
  const rot = part.loc?.rot ?? 0
  const known = Boolean(part.loc)
  const marking = pol.polarized ? MARKINGS[pol.marking] : null
  const isHeader = family(part) === 'header'
  return (
    <figure className="orientation">
      <svg viewBox="-150 -130 300 260" role="img" aria-label={`Orientation of ${part.ref}`}>
        <rect x={-148} y={-128} width={296} height={256} rx={10} fill="#11161c" stroke="#3a4552" />
        <text x={-138} y={-108} className="diag-note">
          ↑ board top (as in the CAD view)
        </text>
        <g transform={`rotate(${-rot})`}>
          <PartShape part={part} />
        </g>
        <text x={138} y={118} textAnchor="end" className="diag-note">
          {known ? `${Math.round(rot)}°` : 'rotation unknown'}
        </text>
      </svg>
      <figcaption>
        {marking ? (
          <>
            <div className="orient-title">
              <span className="mark-swatch" /> {marking.label} mark
            </div>
            <p>{marking.howTo}</p>
          </>
        ) : isHeader ? (
          <p>The square pad (highlighted) is pin 1.</p>
        ) : (
          <p>Not polarized: either way round works.</p>
        )}
        <p className="muted small">
          {known
            ? 'Drawn from the pick-and-place rotation (KiCad convention: pin 1 at the left at 0°, counter-clockwise). The board’s silkscreen is the final authority.'
            : 'No pick-and-place data: match the marking to the board’s silkscreen.'}{' '}
          Polarity rule: {pol.reason}.
        </p>
      </figcaption>
    </figure>
  )
}

export function BoardMap({ board, status, current, highlight, onPick }) {
  const b = boardBounds(board)
  if (!b) return null
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const parts = Object.values(board.parts).filter((p) => p.loc)
  const showLabels = parts.length <= 80
  const cur = board.parts[current]?.loc
  return (
    <figure className="board-map">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Board map">
        <rect x={0} y={0} width={w} height={h} rx={1.5} className="map-board" />
        {parts.map((p) => {
          const x = p.loc.x - b.minX
          const y = b.maxY - p.loc.y
          const st = status[p.ref]
          const cls = p.ref === current ? 'cur' : st === STATUS.placed ? 'placed' : st === STATUS.skipped ? 'skipped' : st === STATUS.dropped ? 'dropped' : 'todo'
          return (
            <g key={p.ref} transform={`translate(${x} ${y}) rotate(${-p.loc.rot})`} onClick={() => onPick?.(p.ref)} className={`map-part ${cls} ${p.loc.side}`}>
              <rect x={-1.2} y={-0.7} width={2.4} height={1.4} rx={0.2} />
            </g>
          )
        })}
        {showLabels &&
          parts.map((p) => (
            <text key={`t${p.ref}`} x={p.loc.x - b.minX} y={b.maxY - p.loc.y - 1.3} className={`map-label ${p.ref === current ? 'cur' : ''}`} textAnchor="middle">
              {p.ref}
            </text>
          ))}
        {cur && <circle cx={cur.x - b.minX} cy={b.maxY - cur.y} r={3} className="map-ring" />}
        {highlight && board.parts[highlight]?.loc && (
          <circle cx={board.parts[highlight].loc.x - b.minX} cy={b.maxY - board.parts[highlight].loc.y} r={3.6} className="map-ring hl" />
        )}
      </svg>
      <figcaption className="muted small">Board map from your pick-and-place file (top view). Tap a part to jump to it.</figcaption>
    </figure>
  )
}
