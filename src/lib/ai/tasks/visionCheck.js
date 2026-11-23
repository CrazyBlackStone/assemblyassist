import { describeFootprint, shortFootprint } from '../../bom/footprint.js'
import { MARKINGS } from '../../bom/polarity.js'
import { pickEnum } from '../json.js'

// Task 2 (image understanding): judge one cropped photo of one part right after soldering.
// The model gets the expected part from the user's BOM; it is told not to assert part facts.
// It can never return "all clear": the best verdict is "looks_right", and the UI still
// requires the user to confirm with their own eyes.

export const TASK = 'visionCheck'

export const VERDICTS = ['looks_right', 'possible_problem', 'cant_tell']
export const CONFIDENCE = ['low', 'medium', 'high']
export const ISSUE_TYPES = [
  'flipped',
  'missing',
  'bridged',
  'lifted_lead',
  'insufficient_solder',
  'excess_solder',
  'cold_joint',
  'tombstoned',
  'misaligned',
  'wrong_part',
  'other',
]

export const ISSUE_LABELS = {
  flipped: 'Flipped / wrong orientation',
  missing: 'Part missing',
  bridged: 'Bridged pins',
  lifted_lead: 'Lifted leg or pad not wetted',
  insufficient_solder: 'Not enough solder',
  excess_solder: 'Too much solder',
  cold_joint: 'Dull / cold joint',
  tombstoned: 'Tombstoned (one end up)',
  misaligned: 'Misaligned on pads',
  wrong_part: 'Looks like a different part',
  other: 'Other problem',
}

/** Context assembled from board data the user loaded (never from the model). */
export function buildContext(board, ref, neighborList) {
  const p = board.parts[ref]
  return {
    ref,
    value: p.value,
    footprint: shortFootprint(p.footprint),
    size: describeFootprint(p.footprint).label,
    polarized: p.polarity.polarized,
    marking: p.polarity.polarized ? MARKINGS[p.polarity.marking]?.label : null,
    rotation: p.loc ? p.loc.rot : null,
    neighbors: neighborList.map((n) => `${n.ref} (${n.value})`),
  }
}

export function inputSummary(ctx, crop) {
  return `Crop ${crop.width}×${crop.height}px of ${ctx.ref} (${ctx.value}, ${ctx.footprint})${ctx.polarized ? `, polarized by ${ctx.marking}` : ''}; neighbors: ${ctx.neighbors.join(', ') || 'none listed'}.`
}

export function buildMessages(ctx, imageDataUrl) {
  const system = [
    'You inspect hand-soldered circuit boards from a close-up photo. You see ONE cropped region around one part.',
    'Judge only what is visible. If the image is blurry, dark, glare-filled, or the part is not clearly visible, answer cant_tell.',
    'Never claim a joint is definitely good; the best you can say is looks_right. The human makes the final call.',
    'Do not state facts about the part (values, pinouts) beyond what you are told; describe what you see.',
    `Possible issue types: ${ISSUE_TYPES.join(', ')}.`,
    'Reply with JSON only:',
    '{"observed":"one sentence: what is actually visible in the image",',
    '"verdict":"looks_right|possible_problem|cant_tell",',
    '"confidence":"low|medium|high",',
    '"issues":[{"type":"bridged","where":"between which pins or which end","detail":"short"}],',
    '"retake_advice":"null, or what would make the photo easier to judge"}',
  ].join(' ')
  const lines = [
    `Expected part: ${ctx.ref}, value ${ctx.value || 'unknown'}, package ${ctx.footprint || 'unknown'} (${ctx.size}).`,
    ctx.polarized
      ? `This part is polarized. Its marking is: ${ctx.marking}. Check that the marking matches the board's silkscreen mark.`
      : 'This part is not polarized.',
    ctx.neighbors.length ? `Nearby parts that may appear at the edges: ${ctx.neighbors.join(', ')}. Judge only ${ctx.ref}.` : '',
    'Check: is the part present, aligned, oriented correctly, and are all joints wetted with no bridges, lifted legs or tombstoning?',
  ].filter(Boolean)
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: lines.join('\n') },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ]
}

/**
 * Normalize model output. Safety rules applied by the app, not the model:
 *  - looks_right with low confidence becomes cant_tell
 *  - looks_right that lists issues becomes possible_problem
 *  - possible_problem with no issue gets an "other" issue so fix help still has a target
 */
export function validate(value) {
  const issues = []
  if (!value || typeof value !== 'object') throw new Error('Response was not an object.')
  let verdict = pickEnum(value.verdict, VERDICTS, null)
  if (!verdict) {
    issues.push(`Unknown verdict "${value.verdict}" treated as cant_tell.`)
    verdict = 'cant_tell'
  }
  let confidence = pickEnum(value.confidence, CONFIDENCE, null)
  if (!confidence) {
    issues.push(`Missing confidence treated as low.`)
    confidence = 'low'
  }
  const found = (Array.isArray(value.issues) ? value.issues : [])
    .filter((i) => i && (i.type || i.detail))
    .map((i) => ({
      type: pickEnum(i.type, ISSUE_TYPES, 'other'),
      where: String(i.where ?? '').slice(0, 120),
      detail: String(i.detail ?? '').slice(0, 200),
    }))

  if (verdict === 'looks_right' && found.length) {
    issues.push('Model said "looks right" but listed problems; shown as possible problem.')
    verdict = 'possible_problem'
  }
  if (verdict === 'looks_right' && confidence === 'low') {
    issues.push('"Looks right" with low confidence shown as "can\'t tell".')
    verdict = 'cant_tell'
  }
  if (verdict === 'possible_problem' && found.length === 0) {
    found.push({ type: 'other', where: '', detail: 'The model flagged a problem without naming it.' })
  }
  const advice = value.retake_advice && String(value.retake_advice).toLowerCase() !== 'null' ? String(value.retake_advice).slice(0, 200) : null
  return {
    data: {
      observed: String(value.observed ?? '').slice(0, 300) || 'The model did not describe what it saw.',
      verdict,
      confidence,
      issues: verdict === 'cant_tell' ? [] : found,
      retakeAdvice: advice ?? (verdict === 'cant_tell' ? 'Zoom in closer and retake in better light.' : null),
    },
    issues,
  }
}

let simCounter = 0
/** Canned outputs that cycle through every result type so each UI state can be demoed without a key. */
export function simulate(ctx) {
  const options = [
    { observed: `Simulated: no image was analysed. Pretending ${ctx.ref} is seated with shiny fillets.`, verdict: 'looks_right', confidence: 'medium', issues: [], retake_advice: null },
    { observed: `Simulated: no image was analysed. Pretending two pins of ${ctx.ref} are joined by solder.`, verdict: 'possible_problem', confidence: 'medium', issues: [{ type: 'bridged', where: 'between two adjacent pins', detail: 'A solder blob appears to connect neighbouring pins.' }], retake_advice: null },
    { observed: 'Simulated: no image was analysed. Pretending the photo is too dark to judge.', verdict: 'cant_tell', confidence: 'low', issues: [], retake_advice: 'Zoom in closer and retake in better light.' },
  ]
  if (ctx.polarized) {
    options.push({ observed: `Simulated: no image was analysed. Pretending ${ctx.ref}'s ${ctx.marking} mark is on the wrong side.`, verdict: 'possible_problem', confidence: 'medium', issues: [{ type: 'flipped', where: 'whole part', detail: 'The marking appears opposite the silkscreen mark.' }], retake_advice: null })
  }
  return JSON.stringify(options[simCounter++ % options.length])
}
