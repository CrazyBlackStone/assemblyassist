import { refPrefix, compareRefs } from '../bom/refs.js'

// Rule-based build order used before (or instead of) the AI build plan.
// It is never labeled as AI: it is fixed logic the team can read.

const CATEGORIES = [
  {
    id: 'chips',
    name: 'Chips and transistors',
    reason: 'Fine-pitch parts first, while nothing tall blocks the iron.',
    test: (p) => ['U', 'IC', 'Q'].includes(refPrefix(p.ref)),
  },
  {
    id: 'passives',
    name: 'Small passives',
    reason: 'Low, flat parts next, grouped by value so each reel is handled once.',
    test: (p) => ['R', 'C', 'L', 'FB', 'RN', 'CP'].includes(refPrefix(p.ref)),
  },
  {
    id: 'diodes',
    name: 'Diodes and LEDs',
    reason: 'Polarized parts together, so orientation checks happen in one pass.',
    test: (p) => ['D', 'LED'].includes(refPrefix(p.ref)),
  },
  {
    id: 'other',
    name: 'Other parts',
    reason: 'Switches, crystals and anything else before the tall connectors.',
    test: () => true,
  },
  {
    id: 'connectors',
    name: 'Connectors',
    reason: 'Tall through-hole parts last so they do not block other joints.',
    test: (p) => ['J', 'P', 'CN', 'CON', 'USB'].includes(refPrefix(p.ref)) || /PinHeader|Conn/i.test(p.footprint),
    priority: true,
  },
]

/** Sort refs inside a block so identical parts (same group) stay together, in board group order. */
export function orderWithinBlock(board, refs) {
  const groupOrder = new Map(board.groups.map((g, i) => [g.id, i]))
  const firstSeen = new Map()
  refs.forEach((r, i) => {
    const g = board.parts[r]?.group
    if (!firstSeen.has(g)) firstSeen.set(g, i)
  })
  return [...refs].sort((a, b) => {
    const ga = board.parts[a]?.group
    const gb = board.parts[b]?.group
    if (ga !== gb) return (firstSeen.get(ga) - firstSeen.get(gb)) || (groupOrder.get(ga) - groupOrder.get(gb))
    return compareRefs(a, b)
  })
}

export function fallbackPlan(board) {
  const buckets = new Map(CATEGORIES.map((c) => [c.id, []]))
  for (const group of board.groups) {
    for (const ref of group.refs) {
      const part = board.parts[ref]
      const cat = CATEGORIES.find((c) => c.priority && c.test(part)) ?? CATEGORIES.find((c) => c.test(part))
      buckets.get(cat.id).push(ref)
    }
  }
  const blocks = CATEGORIES.filter((c) => buckets.get(c.id).length).map((c) => ({
    id: `blk_${c.id}`,
    name: c.name,
    reason: c.reason,
    refs: orderWithinBlock(board, buckets.get(c.id)),
  }))
  return { source: 'default', blocks }
}

/**
 * Check a proposed plan against the board. Every part must appear exactly once.
 * Unknown refs are dropped, duplicates keep their first position, and missing parts
 * are collected into an extra block. Returns { plan, issues }.
 */
export function validatePlan(board, blocks, source) {
  const issues = []
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { plan: null, issues: ['The plan had no blocks.'] }
  }
  const seen = new Set()
  const clean = []
  blocks.forEach((b, i) => {
    const refs = []
    for (const raw of Array.isArray(b?.refs) ? b.refs : []) {
      const ref = String(raw).trim().toUpperCase()
      if (!board.parts[ref]) {
        issues.push(`Block "${b?.name ?? i + 1}" listed ${ref}, which is not on this board. Removed.`)
        continue
      }
      if (seen.has(ref)) {
        issues.push(`${ref} appeared in more than one block. Kept the first.`)
        continue
      }
      seen.add(ref)
      refs.push(ref)
    }
    if (refs.length) {
      clean.push({
        id: `blk_${i + 1}_${Math.random().toString(36).slice(2, 6)}`,
        name: String(b?.name ?? `Block ${i + 1}`).slice(0, 80),
        reason: String(b?.reason ?? '').slice(0, 200),
        refs: orderWithinBlock(board, refs),
      })
    }
  })
  const missing = board.groups.flatMap((g) => g.refs).filter((r) => !seen.has(r))
  if (missing.length) {
    issues.push(`The plan left out ${missing.join(', ')}. Added them to a final block.`)
    clean.push({
      id: 'blk_unplanned',
      name: 'Not in the plan',
      reason: 'These parts were missing from the proposed plan (added by the app, not the AI).',
      refs: orderWithinBlock(board, missing),
      appAdded: true,
    })
  }
  if (clean.length === 0) return { plan: null, issues }
  return { plan: { source, blocks: clean }, issues }
}

export const planSequence = (plan) => plan.blocks.flatMap((b) => b.refs)

export function blockOf(plan, ref) {
  return plan.blocks.find((b) => b.refs.includes(ref)) ?? null
}
