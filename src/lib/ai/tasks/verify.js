import { describeFootprint, shortFootprint } from '../../bom/footprint.js'
import { MARKINGS } from '../../bom/polarity.js'
import { packageGeometry, markDirection } from '../../bom/packages.js'
import { pickEnum } from '../json.js'

// Image task: judge ONE cropped photo of ONE placed part. Facts about the part come from
// the user's BOM/CPL; the model only reports what it sees. When the camera is calibrated
// the crop is rotated so the part sits in its reference orientation, which lets the prompt
// say exactly where the polarity mark must be. The app never shows an all-clear: the
// best result is "AI sees no problem", which the user confirms.

export const TASK = 'verify'

const ORIENT = ['correct', 'wrong', 'unclear']
const SOLDER = ['good', 'problem', 'unclear']
const CONF = ['low', 'medium', 'high']
const PLACEMENT_ISSUES = ['flipped', 'missing', 'misaligned', 'wrong_part', 'tombstoned', 'other']
const SOLDER_ISSUES = ['bridged', 'insufficient_solder', 'excess_solder', 'cold_joint', 'lifted_lead']
export const ISSUES = [...PLACEMENT_ISSUES, ...SOLDER_ISSUES]

export const ISSUE_LABELS = {
  flipped: 'Flipped',
  missing: 'Missing',
  misaligned: 'Off its pads',
  wrong_part: 'Wrong part?',
  tombstoned: 'Tombstoned',
  bridged: 'Bridged pins',
  insufficient_solder: 'Too little solder',
  excess_solder: 'Too much solder',
  cold_joint: 'Dull joint',
  lifted_lead: 'Lifted leg',
  other: 'Problem',
}

/** Built from board data only. `canonical` = the crop was rotated to the reference orientation. */
export function buildContext(board, ref, { canonical = false, checkSoldering = true, neighbors = [] } = {}) {
  const p = board.parts[ref]
  const g = packageGeometry(p)
  const polarized = Boolean(g.mark)
  return {
    ref,
    value: p.value,
    footprint: shortFootprint(p.footprint),
    size: describeFootprint(p.footprint).label,
    polarized,
    markLabel: polarized ? (g.mark.type === 'pin1' ? 'pin-1 dot or notch' : MARKINGS[p.polarity.marking]?.label ?? 'polarity mark') : null,
    markWhere: polarized && canonical ? markDirection(g, 0) : null,
    canonical,
    checkSoldering,
    neighbors,
  }
}

export const inputSummary = (ctx, crop) =>
  `${crop.width}×${crop.height}px crop of ${ctx.ref} (${ctx.value}, ${ctx.footprint})${ctx.canonical ? ', rotated to reference' : ''}${ctx.checkSoldering ? '' : ', soldering not checked'}.`

export function buildMessages(ctx, imageDataUrl) {
  const issues = ctx.checkSoldering ? ISSUES : PLACEMENT_ISSUES
  const system = [
    'You inspect one hand-placed component on a circuit board from a close-up photo.',
    'Judge only what is visible. If the image is blurry, dark, glare-filled, or the part is not clearly visible, use "unclear".',
    'Never claim the part is definitely fine; a human makes the final call.',
    ctx.checkSoldering
      ? 'Check orientation and the solder joints.'
      : 'The board uses solder paste that is not reflowed yet: check placement and orientation only, not solder joints.',
    `Issue types: ${issues.join(', ')}.`,
    'Reply with JSON only:',
    '{"observed":"one short sentence about what is visible",',
    '"orientation":"correct|wrong|unclear",',
    ctx.checkSoldering ? '"soldering":"good|problem|unclear",' : '',
    '"confidence":"low|medium|high",',
    '"issues":[{"type":"bridged","where":"which pins or end"}]}',
  ].join(' ')
  const lines = [
    `Expected part: ${ctx.ref}, ${ctx.value || 'value unknown'}, package ${ctx.footprint || 'unknown'} (${ctx.size}).`,
    ctx.polarized
      ? ctx.markWhere
        ? `It is polarized. The image is rotated to the reference orientation, so the ${ctx.markLabel} must be at the ${ctx.markWhere} of the part. If it is on the opposite side, orientation is wrong.`
        : `It is polarized (${ctx.markLabel}). Compare the part's mark with the board's printed mark next to it.`
      : 'It is not polarized: answer orientation "correct" if it is seated on its pads.',
    ctx.neighbors.length ? `Other parts may show at the edges (${ctx.neighbors.join(', ')}); judge only the centred part.` : '',
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
 * Normalise model output, then apply the app's own safety rules:
 * non-polarized parts can't be "wrong way round"; soldering is ignored when not checked;
 * listed issues force "problem"; low confidence never yields "no problem".
 */
export function validate(value, ctx) {
  if (!value || typeof value !== 'object') throw new Error('Response was not an object.')
  const fixes = []
  const confidence = pickEnum(value.confidence, CONF, 'low')
  let orientation = pickEnum(value.orientation, ORIENT, 'unclear')
  let soldering = ctx.checkSoldering ? pickEnum(value.soldering, SOLDER, 'unclear') : 'not_checked'
  let issues = (Array.isArray(value.issues) ? value.issues : [])
    .filter((i) => i && (i.type || i.where))
    .map((i) => ({ type: pickEnum(i.type, ISSUES, 'other'), where: String(i.where ?? i.detail ?? '').slice(0, 80) }))
  if (!ctx.checkSoldering && issues.some((i) => SOLDER_ISSUES.includes(i.type))) {
    issues = issues.filter((i) => !SOLDER_ISSUES.includes(i.type))
    fixes.push('Dropped solder-joint issues (soldering check is off).')
  }
  if (!ctx.polarized && orientation === 'wrong') {
    orientation = 'correct'
    issues = issues.filter((i) => i.type !== 'flipped')
    fixes.push('Ignored "wrong orientation" for a non-polarized part.')
  }
  if (issues.some((i) => i.type === 'flipped')) orientation = 'wrong'
  if (ctx.checkSoldering && issues.some((i) => SOLDER_ISSUES.includes(i.type))) soldering = 'problem'
  if (orientation === 'wrong' && !issues.some((i) => i.type === 'flipped')) issues.unshift({ type: 'flipped', where: '' })
  if (soldering === 'problem' && !issues.some((i) => SOLDER_ISSUES.includes(i.type))) issues.push({ type: 'other', where: 'solder joint' })

  let verdict = 'ok'
  if (issues.length || orientation === 'wrong' || soldering === 'problem') verdict = 'problem'
  else if (orientation === 'unclear' || soldering === 'unclear') verdict = 'unclear'
  else if (confidence === 'low') {
    verdict = 'unclear'
    fixes.push('"No problem" with low confidence shown as "unclear".')
  }
  return {
    data: { verdict, orientation, soldering, confidence, issues, observed: String(value.observed ?? '').slice(0, 200) },
    issues: fixes,
  }
}

let sim = 0
/** Cycles through every result type so each state can be seen without a key. */
export function simulate(ctx) {
  const options = [
    { observed: 'Simulated: no image was analysed.', orientation: 'correct', soldering: 'good', confidence: 'medium', issues: [] },
    ctx.polarized
      ? { observed: 'Simulated: no image was analysed.', orientation: 'wrong', soldering: 'good', confidence: 'medium', issues: [{ type: 'flipped', where: 'mark on the opposite side' }] }
      : { observed: 'Simulated: no image was analysed.', orientation: 'correct', soldering: 'problem', confidence: 'medium', issues: [{ type: 'bridged', where: 'right end' }] },
    { observed: 'Simulated: no image was analysed.', orientation: 'unclear', soldering: 'unclear', confidence: 'low', issues: [] },
  ]
  return JSON.stringify(options[sim++ % options.length])
}
