import library from '../../../data/techniques.json'
import { shortFootprint } from '../../bom/footprint.js'
import { sequenceOf } from '../../plan/plan.js'

// Language task: interpret a spoken request the simple command grammar did not catch,
// and turn it into one app action, or answer a question about ordering or soldering.
// Every ref and category it names is checked against the board; soldering advice may
// only come from the technique library and must cite the entry.

export const TASK = 'assistant'
export const ACTIONS = ['next', 'skip', 'back', 'goto', 'move_next', 'category_next', 'where', 'answer', 'none']
export const entries = library.entries
export const entryById = (id) => entries.find((e) => e.id === id) ?? null

function stateSummary(p) {
  const seq = sequenceOf(p.plan)
  const pend = seq.filter((r) => !p.status[r])
  const cur = p.current ? p.board.parts[p.current] : null
  const describe = (r) => `${r} ${p.board.parts[r].value}`
  return [
    cur ? `Current part: ${describe(p.current)} (${shortFootprint(cur.footprint)}).` : 'All parts are handled.',
    `Next in order: ${pend.filter((r) => r !== p.current).slice(0, 6).map(describe).join(', ') || 'none'}.`,
    `Placed ${seq.length - pend.length} of ${seq.length}. Soldering check ${p.settings.verifySoldering ? 'on' : 'off (solder paste)'}.`,
    'Categories in order (✓ = placed, - = skipped):',
    ...p.plan.categories.map((c) => `- ${c.name}: ${c.refs.map((r) => `${r}${p.status[r] === 'placed' ? '✓' : p.status[r] === 'skipped' ? '-' : ''}`).join(' ')}`),
    'Values: ' + Object.values(p.board.parts).map((x) => `${x.ref}=${x.value}`).join(', '),
  ].join('\n')
}

export function buildMessages(utterance, p) {
  const lib = entries.map((e) => `[${e.id}] ${e.title}: ${e.steps.join(' ')} Check: ${e.check}`).join('\n')
  const system = [
    'You are the voice assistant of a circuit-board hand-assembly app. The user is soldering with both hands busy.',
    'Turn what they said into ONE action, or answer a short question about the build order or soldering.',
    'Actions: next (current part is done), skip, back (undo), goto {ref}, move_next {refs} (place these parts right after the current one),',
    'category_next {category} (do this category right after the current part), where {ref} (show where a part goes), answer {say}, none {say} (unclear; ask them to repeat).',
    'Only use refs and categories from the state. Never invent parts or values.',
    'Soldering advice must come from the technique library below; put the entry ids you used in "sources". If the library does not cover it, say so.',
    '"say" is spoken aloud: one or two short sentences.',
    'Reply with JSON only: {"action":"...","ref":null,"refs":[],"category":null,"say":"...","sources":[]}',
    '',
    'Technique library:',
    lib,
  ].join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${stateSummary(p)}\n\nThe user said: "${utterance}"` },
  ]
}

export function validate(value, p) {
  if (!value || typeof value !== 'object') throw new Error('Response was not an object.')
  const fixes = []
  let action = ACTIONS.includes(value.action) ? value.action : null
  if (!action) {
    fixes.push(`Unknown action "${value.action}" treated as "none".`)
    action = 'none'
  }
  const norm = (r) => String(r ?? '').trim().toUpperCase().replace(/\s+/g, '')
  const known = (r) => Boolean(p.board.parts[r])
  let ref = norm(value.ref)
  let refs = (Array.isArray(value.refs) ? value.refs : []).map(norm)
  const unknown = [ref, ...refs].filter((r) => r && !known(r))
  if (unknown.length) fixes.push(`Removed refs not on this board: ${unknown.join(', ')}.`)
  ref = known(ref) ? ref : null
  refs = refs.filter(known)
  if (!ref && refs.length && ['goto', 'where'].includes(action)) ref = refs[0]
  if (action === 'move_next' && !refs.length && ref) refs = [ref]
  const catName = String(value.category ?? '').trim().toLowerCase()
  const category = p.plan.categories.find((c) => c.name.toLowerCase() === catName || c.id === value.category) ?? null
  if (action === 'category_next' && !category) {
    fixes.push(`Category "${value.category}" not found.`)
    action = 'none'
  }
  if ((['goto', 'where'].includes(action) && !ref) || (action === 'move_next' && !refs.length)) {
    fixes.push(`"${action}" named no part on this board.`)
    action = 'none'
  }
  const sources = (Array.isArray(value.sources) ? value.sources : []).filter((id) => entryById(id))
  let say = String(value.say ?? '').trim().slice(0, 240)
  if (!say && action === 'none') say = 'Sorry, say that again?'
  return { data: { action, ref, refs, categoryId: category?.id ?? null, say, sources }, issues: fixes }
}

/** Keyless demo: recognise a category name, otherwise answer from the library. */
export function simulate(utterance, p) {
  const t = utterance.toLowerCase()
  const cat = p.plan.categories.find((c) => t.includes(c.name.toLowerCase().split(' ')[0].replace(/s$/, '')))
  if (cat) return JSON.stringify({ action: 'category_next', category: cat.name, say: `(Simulated) ${cat.name} next.` })
  const e = /bridge|short/.test(t) ? entryById('braid-bridge') : /flip|wrong way|backwards/.test(t) ? entryById('remove-two-terminal') : entryById('flux-first')
  return JSON.stringify({ action: 'answer', say: `(Simulated) ${e.steps[0]}`, sources: [e.id] })
}
