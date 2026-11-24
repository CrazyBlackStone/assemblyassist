import { shortFootprint } from '../../bom/footprint.js'
import { defaultPlan, validatePlan } from '../../plan/plan.js'

// Language task: propose a build order as categories, each with a one-line reason.
// Pure module: builds messages, validates output, simulates. No network here.

export const TASK = 'orderPlan'

export function inputSummary(board) {
  return `${board.name}: ${Object.keys(board.parts).length} parts in ${board.groups.length} value groups${board.hasLocations ? ', with locations' : ''}.`
}

export function buildMessages(board) {
  const lines = Object.values(board.parts).map((p) => {
    const loc = p.loc ? ` @(${p.loc.x.toFixed(1)},${p.loc.y.toFixed(1)}) ${p.loc.side}` : ''
    return `${p.ref} | ${p.value || '?'} | ${shortFootprint(p.footprint) || '?'}${p.polarity.polarized ? ' | polarized' : ''}${loc}`
  })
  const system = [
    'You plan the hand-soldering order for a small circuit board.',
    'Use ONLY the parts listed. Never invent parts, values or functions that are not supported by the list.',
    'Group parts into 3 to 7 categories that can each be tested on their own (for example: the main chip and its',
    'decoupling capacitors; the power regulator and its capacitors; LEDs and their resistors; connectors).',
    'Rules of thumb: place hard-to-reach and fine-pitch parts before parts that would block them;',
    'low, flat parts before tall ones; tall through-hole connectors last; keep each block testable.',
    'Every listed reference must appear in exactly one category. Category names: 1 to 3 words.',
    'Reply with JSON only, no prose: {"categories":[{"name":"short name","reason":"one line, max 15 words","refs":["U1","C3"]}]}',
  ].join(' ')
  const user = `Board: ${board.name}\nColumns: ref | value | footprint | polarized? | position in mm (x,y) side\n${lines.join('\n')}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function validate(board, value) {
  const { plan, issues } = validatePlan(board, value?.categories ?? value?.blocks, 'ai')
  if (!plan) throw new Error(`Plan unusable: ${issues.join(' ')}`)
  return { data: plan, issues }
}

/** Simulated output for keyless demo: the rule-based plan, phrased as a model would. */
export function simulate(board) {
  const base = defaultPlan(board)
  return JSON.stringify({
    categories: base.categories.map((c) => ({ name: c.name, reason: `${c.reason} (simulated)`, refs: c.refs })),
  })
}
