import library from '../../../data/techniques.json'

// Task 3 (language): turn a flagged issue into short, checkable steps for this exact
// part and spot. The model may only choose and adapt entries from the curated
// technique library; every step must cite the entry it came from.

export const TASK = 'fixHelp'

export const entries = library.entries
export const entryById = (id) => entries.find((e) => e.id === id) ?? null

export function candidatesFor(issueType) {
  const hit = entries.filter((e) => e.issues.includes(issueType))
  return hit.length ? hit : entries.filter((e) => e.issues.includes('other'))
}

export function inputSummary(ctx, issue) {
  return `${ctx.ref} (${ctx.value}, ${ctx.footprint}): ${issue.type}${issue.where ? ` ${issue.where}` : ''}.`
}

export function buildMessages(ctx, issue) {
  const cands = candidatesFor(issue.type)
  const lib = cands
    .map((e) => `[${e.id}] ${e.title}\n${e.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\n  Check: ${e.check}${e.caution ? `\n  Caution: ${e.caution}` : ''}`)
    .join('\n\n')
  const system = [
    'You help someone fix one soldering problem at the bench. Their hands are busy, so be brief.',
    'Use ONLY the technique library entries given. Choose the relevant entries and adapt their steps to this part and spot.',
    'Do not add techniques, tools, temperatures or facts that are not in the entries. Each step must cite its entry id.',
    'At most 5 steps, each under 20 words. End with how to check the fix, taken from the entries.',
    'Reply with JSON only: {"steps":[{"text":"...","entry_id":"braid-bridge"}],"check":"...","check_entry_id":"braid-bridge"}',
  ].join(' ')
  const user = [
    `Part: ${ctx.ref}, ${ctx.value}, package ${ctx.footprint} (${ctx.size}).`,
    `Problem flagged: ${issue.type}${issue.where ? `, ${issue.where}` : ''}${issue.detail ? ` (${issue.detail})` : ''}.`,
    '',
    'Technique library entries:',
    lib,
  ].join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function validate(issueType, value) {
  const allowed = new Set(candidatesFor(issueType).map((e) => e.id))
  const issues = []
  const steps = []
  for (const s of Array.isArray(value?.steps) ? value.steps : []) {
    const id = String(s?.entry_id ?? '').trim()
    const text = String(s?.text ?? '').trim()
    if (!text) continue
    if (!allowed.has(id)) {
      issues.push(`Dropped a step citing "${id || 'no entry'}", which is not in the library for this issue.`)
      continue
    }
    steps.push({ text: text.slice(0, 200), entryId: id })
  }
  if (steps.length === 0) throw new Error('No step cited a valid library entry.')
  if (steps.length > 5) issues.push('Trimmed to 5 steps.')
  let checkId = String(value?.check_entry_id ?? '').trim()
  let check = String(value?.check ?? '').trim()
  if (!allowed.has(checkId)) {
    checkId = steps[steps.length - 1].entryId
    check = entryById(checkId).check
    issues.push('Check step did not cite a valid entry; used the library text instead.')
  }
  const used = [...new Set([...steps.map((s) => s.entryId), checkId])]
  return { data: { steps: steps.slice(0, 5), check: check.slice(0, 300), checkEntryId: checkId, entryIds: used }, issues }
}

export function simulate(ctx, issue) {
  const [first, second] = candidatesFor(issue.type).filter((e) => e.id !== 'flux-first').concat(entryById('flux-first'))
  const main = first ?? second
  return JSON.stringify({
    steps: [
      { text: `(Simulated) Add flux to ${ctx.ref}${issue.where ? ` ${issue.where}` : ''}.`, entry_id: 'flux-first' },
      ...main.steps.slice(1, 4).map((t) => ({ text: `(Simulated) ${t}`, entry_id: main.id })),
    ].filter((s) => candidatesFor(issue.type).some((e) => e.id === s.entry_id)),
    check: main.check,
    check_entry_id: main.id,
  })
}
