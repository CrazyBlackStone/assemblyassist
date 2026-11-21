// Facts derived from the pick-and-place file. Used for "where is C8?", the board
// map, and the neighbor list sent as context to the vision check.

export function boardBounds(board) {
  const locs = Object.values(board.parts).map((p) => p.loc).filter(Boolean)
  if (!locs.length) return null
  const xs = locs.map((l) => l.x)
  const ys = locs.map((l) => l.y)
  const pad = 3
  return {
    minX: Math.min(...xs) - pad,
    maxX: Math.max(...xs) + pad,
    minY: Math.min(...ys) - pad,
    maxY: Math.max(...ys) + pad,
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** Parts within `radius` mm on the same side, nearest first. */
export function neighbors(board, ref, radius = 6, limit = 6) {
  const me = board.parts[ref]?.loc
  if (!me) return []
  return Object.values(board.parts)
    .filter((p) => p.ref !== ref && p.loc && p.loc.side === me.side)
    .map((p) => ({ ref: p.ref, value: p.value, d: dist(me, p.loc) }))
    .filter((n) => n.d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
}

/** "top-left", "middle", ... from the board bounds. Assumes +Y is up (KiCad .pos convention). */
export function regionName(board, ref) {
  const loc = board.parts[ref]?.loc
  const b = boardBounds(board)
  if (!loc || !b) return null
  const fx = (loc.x - b.minX) / (b.maxX - b.minX || 1)
  const fy = (loc.y - b.minY) / (b.maxY - b.minY || 1)
  const h = fx < 0.34 ? 'left' : fx > 0.66 ? 'right' : 'middle'
  const v = fy > 0.66 ? 'top' : fy < 0.34 ? 'bottom' : 'middle'
  if (h === 'middle' && v === 'middle') return 'centre'
  if (v === 'middle') return `middle ${h}`
  if (h === 'middle') return `${v} middle`
  return `${v} ${h}`
}

/** Sentence for "where is C8?". Every fact comes from the loaded files. */
export function describeLocation(board, ref, compartment) {
  const parts = []
  const region = regionName(board, ref)
  const loc = board.parts[ref]?.loc
  if (region) {
    const near = neighbors(board, ref, 8, 1)[0]
    parts.push(`${ref} is at the ${region} of the ${loc.side} side${near ? `, next to ${near.ref}` : ''}`)
  } else {
    parts.push(`No location for ${ref}: load a pick-and-place file to get one`)
  }
  if (compartment) parts.push(`its parts are in tray compartment ${compartment}`)
  return parts.join('; ') + '.'
}

// ---------- camera calibration (board mm -> normalized image coords) ----------
// Two taps on known parts give a similarity transform (scale, rotation, offset),
// using complex numbers: img = a * board + b. "mirror" handles bottom-side views.

const c = (x, y) => ({ re: x, im: y })
const sub = (p, q) => c(p.re - q.re, p.im - q.im)
const mul = (p, q) => c(p.re * q.re - p.im * q.im, p.re * q.im + p.im * q.re)
const div = (p, q) => {
  const d = q.re * q.re + q.im * q.im
  return c((p.re * q.re + p.im * q.im) / d, (p.im * q.re - p.re * q.im) / d)
}

/**
 * @param {{board:{x,y}, image:{x,y}}[]} pairs exactly two correspondences; image coords normalized 0..1
 * @param {number} aspect video width / height, so the fit is done in undistorted space
 */
export function solveCalibration(pairs, aspect, mirror = false) {
  if (pairs.length < 2) return null
  // Board Y is up, image Y is down: flip board Y (and X too when mirrored).
  const bz = (p) => c(mirror ? -p.x : p.x, -p.y)
  const iz = (p) => c(p.x * aspect, p.y)
  const [p1, p2] = pairs
  const db = sub(bz(p2.board), bz(p1.board))
  if (Math.hypot(db.re, db.im) < 1e-6) return null
  const a = div(sub(iz(p2.image), iz(p1.image)), db)
  const b = sub(iz(p1.image), mul(a, bz(p1.board)))
  return { a, b, aspect, mirror, scale: Math.hypot(a.re, a.im) }
}

export function boardToImage(cal, pt) {
  const z = mul(cal.a, c(cal.mirror ? -pt.x : pt.x, -pt.y))
  return { x: (z.re + cal.b.re) / cal.aspect, y: z.im + cal.b.im }
}
