import { refPrefix, compareRefs } from '../bom/refs.js'
import { packageGeometry } from '../bom/packages.js'

// The build order: categories of parts, each draggable as a unit, parts draggable within
// and between them. The default comes from fixed rules (never labeled AI).

const RULES = [
  { id: 'chips', name: 'Chips', reason: 'Fine-pitch parts first, while nothing tall is in the way.', test: (p) => ['U', 'IC'].includes(refPrefix(p.ref)) },
  { id: 'transistors', name: 'Transistors', reason: 'Small three-pin parts next to the chips.', test: (p) => refPrefix(p.ref) === 'Q' },
  { id: 'capacitors', name: 'Capacitors', reason: 'Low, flat parts, grouped by value.', test: (p) => ['C', 'CP'].includes(refPrefix(p.ref)) },
  { id: 'resistors', name: 'Resistors', reason: 'Low, flat parts, grouped by value.', test: (p) => ['R', 'RN'].includes(refPrefix(p.ref)) },
  { id: 'inductors', name: 'Inductors', reason: 'Larger passives after the small ones.', test: (p) => ['L', 'FB'].includes(refPrefix(p.ref)) },
  { id: 'diodes', name: 'Diodes & LEDs', reason: 'Polarized parts together for one orientation pass.', test: (p) => ['D', 'LED'].includes(refPrefix(p.ref)) },
  { id: 'connectors', name: 'Connectors', reason: 'Tall through-hole parts last.', test: (p) => ['J', 'P', 'CN', 'CON', 'USB'].includes(refPrefix(p.ref)) || /PinHeader|Conn/i.test(p.footprint), priority: true },
  { id: 'other', name: 'Other', reason: 'Switches and the rest before the connectors.', test: () => true },
]
// "Other" is matched last but placed before connectors.
const ORDER = ['chips', 'transistors', 'capacitors', 'resistors', 'inductors', 'diodes', 'other', 'connectors']

/** Sort refs so identical parts (same value group) stay together, in board group order. */
export function orderWithinCategory(board, refs) {
  const groupOrder = new Map(board.groups.map((g, i) => [g.id, i]))
  const firstSeen = new Map()
  refs.forEach((r, i) => {
    const g = board.parts[r]?.group
    if (!firstSeen.has(g)) firstSeen.set(g, i)
  })
  return [...refs].sort((a, b) => {
    const ga = board.parts[a]?.group
    const gb = board.parts[b]?.group
    if (ga !== gb) return firstSeen.get(ga) - firstSeen.get(gb) || groupOrder.get(ga) - groupOrder.get(gb)
    return compareRefs(a, b)
  })
}

export const sideOf = (board, ref) => (board.parts[ref]?.loc?.side === 'bottom' ? 'bottom' : 'top')
export const SIDE_NAME = { top: 'Front', bottom: 'Back' }

/**
 * Which side to build first. The back goes first only when it holds nothing but low SMD
 * parts and the front has something tall, so the board lies flat while the back is done.
 */
export function defaultSideOrder(board) {
  const parts = Object.values(board.parts)
  const back = parts.filter((p) => p.loc?.side === 'bottom')
  if (!back.length) return ['top', 'bottom']
  const tall = (p) => {
    const g = packageGeometry(p)
    return g.tht || g.height > 2
  }
  const front = parts.filter((p) => p.loc?.side !== 'bottom')
  return !back.some(tall) && front.some(tall) ? ['bottom', 'top'] : ['top', 'bottom']
}

export function defaultPlan(board) {
  const sides = defaultSideOrder(board)
  const categories = []
  for (const side of sides) {
    const buckets = new Map(RULES.map((r) => [r.id, []]))
    for (const group of board.groups) {
      for (const ref of group.refs) {
        if (sideOf(board, ref) !== side) continue
        const part = board.parts[ref]
        const rule = RULES.find((r) => r.priority && r.test(part)) ?? RULES.find((r) => r.test(part))
        buckets.get(rule.id).push(ref)
      }
    }
    ORDER.map((id) => RULES.find((r) => r.id === id))
      .filter((r) => buckets.get(r.id).length)
      .forEach((r) => categories.push({ id: `cat_${side}_${r.id}`, name: r.name, reason: r.reason, refs: orderWithinCategory(board, buckets.get(r.id)), side }))
  }
  return { source: 'default', sides, categories }
}

/** Split any category that mixes sides, and keep categories grouped in side order. */
export function enforceSides(board, plan) {
  const sides = plan.sides ?? defaultSideOrder(board)
  const split = []
  for (const c of plan.categories) {
    for (const side of ['top', 'bottom']) {
      const refs = c.refs.filter((r) => sideOf(board, r) === side)
      if (!refs.length) continue
      const whole = refs.length === c.refs.length
      split.push({ ...c, id: whole ? c.id : `${c.id}_${side}`, refs, side })
    }
  }
  const ordered = sides.flatMap((side) => split.filter((c) => c.side === side))
  return { ...plan, sides, categories: ordered }
}

export function swapSides(board, plan) {
  return enforceSides(board, { ...plan, sides: [...(plan.sides ?? defaultSideOrder(board))].reverse() })
}

const uid = () => Math.random().toString(36).slice(2, 7)

/**
 * Check a proposed plan against the board: every part exactly once. Unknown refs are
 * dropped, duplicates keep their first position, missing parts go into a final category.
 */
export function validatePlan(board, categories, source) {
  const issues = []
  if (!Array.isArray(categories) || categories.length === 0) return { plan: null, issues: ['The plan had no categories.'] }
  const seen = new Set()
  const clean = []
  categories.forEach((c, i) => {
    const refs = []
    for (const raw of Array.isArray(c?.refs) ? c.refs : []) {
      const ref = String(raw).trim().toUpperCase()
      if (!board.parts[ref]) {
        issues.push(`"${c?.name ?? i + 1}" listed ${ref}, which is not on this board. Removed.`)
        continue
      }
      if (seen.has(ref)) {
        issues.push(`${ref} appeared twice. Kept the first.`)
        continue
      }
      seen.add(ref)
      refs.push(ref)
    }
    if (refs.length) clean.push({ id: `cat_${i + 1}_${uid()}`, name: String(c?.name ?? `Group ${i + 1}`).slice(0, 40), reason: String(c?.reason ?? '').slice(0, 160), refs: orderWithinCategory(board, refs) })
  })
  const missing = board.groups.flatMap((g) => g.refs).filter((r) => !seen.has(r))
  if (missing.length) {
    issues.push(`The plan left out ${missing.join(', ')}. Added them at the end.`)
    clean.push({ id: `cat_rest_${uid()}`, name: 'Remaining', reason: '', refs: orderWithinCategory(board, missing), appAdded: true })
  }
  if (!clean.length) return { plan: null, issues }
  const mixed = clean.filter((c) => new Set(c.refs.map((r) => sideOf(board, r))).size > 1)
  if (mixed.length) issues.push(`Split ${mixed.map((c) => `"${c.name}"`).join(', ')} into front and back.`)
  return { plan: enforceSides(board, { source, categories: clean }), issues }
}

export const sequenceOf = (plan) => (plan ? plan.categories.flatMap((c) => c.refs) : [])
export const categoryOf = (plan, ref) => plan?.categories.find((c) => c.refs.includes(ref)) ?? null

/** Move refs to just after `afterRef` (or to the end), keeping them in the category of their new neighbour. */
export function moveRefs(plan, refs, afterRef) {
  const anchorSide = plan.categories.find((c) => c.refs.includes(afterRef))?.side
  if (anchorSide) refs = refs.filter((r) => (plan.categories.find((c) => c.refs.includes(r))?.side ?? anchorSide) === anchorSide)
  if (!refs.length) return plan
  const moving = new Set(refs)
  const cats = plan.categories.map((c) => ({ ...c, refs: c.refs.filter((r) => !moving.has(r)) }))
  if (afterRef && !moving.has(afterRef)) {
    const cat = cats.find((c) => c.refs.includes(afterRef))
    if (cat) {
      cat.refs.splice(cat.refs.indexOf(afterRef) + 1, 0, ...refs)
      return { ...plan, categories: cats.filter((c) => c.refs.length), reordered: true }
    }
  }
  const side = plan.categories.find((c) => c.refs.includes(refs[0]))?.side
  const last = [...cats].reverse().find((c) => !side || c.side === side) ?? cats[cats.length - 1]
  last.refs.push(...refs)
  return { ...plan, categories: cats.filter((c) => c.refs.length), reordered: true }
}

/** Move a whole category to just after the category holding `afterRef` (or to the end). */
export function moveCategory(plan, catId, afterRef) {
  const cats = [...plan.categories]
  const i = cats.findIndex((c) => c.id === catId)
  if (i < 0) return plan
  const [cat] = cats.splice(i, 1)
  const anchor = afterRef ? cats.find((c) => c.refs.includes(afterRef)) : null
  if (anchor && anchor.side && cat.side && anchor.side !== cat.side) return plan
  const j = anchor ? cats.indexOf(anchor) : -1
  cats.splice(j >= 0 ? j + 1 : cats.length, 0, cat)
  return { ...plan, categories: cats, reordered: true }
}
