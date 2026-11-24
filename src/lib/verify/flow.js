import { project, dispatch, STATUS, currentSide, calibrationFor } from '../../state/projects.js'
import { ui, setUi, toast } from '../../state/ui.js'
import { captureStill, streamFor } from '../camera.js'
import { solveCalibration } from '../geometry/board.js'
import { sequenceOf } from '../plan/plan.js'
import { verifyPart, crops } from './verify.js'
import { speak, sayRef } from '../voice/speech.js'
import { ISSUE_LABELS } from '../ai/tasks/verify.js'
import { packageGeometry, packageExtent, toBoard } from '../bom/packages.js'

// Orchestrates checks so buttons and voice behave identically.

let checkCtrl = null
let pendingTap = null // resolves with a tap point while ui.tapRequest is shown

const hasCamera = (p) => Boolean(streamFor(p.settings.cameraSource))

function summarize(ref, r) {
  if (!r.ok) return `${sayRef(ref)}: not checked.`
  const d = r.data
  if (d.verdict === 'problem') return `${sayRef(ref)}: ${d.issues.map((i) => ISSUE_LABELS[i.type]).join(', ')}.`
  if (d.verdict === 'unclear') return `${sayRef(ref)}: can't tell. Move closer or add light.`
  return `${sayRef(ref)} looks right. Confirm it.`
}

/** Check one part (default: the part just placed). Shows the result over the video. */
export async function checkPart(ref) {
  const p = project.get()
  if (!p || !ref) return
  if (!hasCamera(p)) return toast('Connect the camera to check parts')
  checkCtrl?.abort()
  const ctrl = new AbortController()
  checkCtrl = ctrl
  setUi({ check: { ref, status: 'capturing' }, review: null })
  let still
  try {
    still = (await captureStill(p.settings.cameraSource)).canvas
  } catch (e) {
    setUi({ check: { ref, status: 'error', error: e.message } })
    return
  }
  let tap = null
  const side = p.board.parts[ref]?.loc?.side === 'bottom' ? 'bottom' : 'top'
  if (!calibrationFor(p, side)) {
    setUi({ tapRequest: { ref }, check: { ref, status: 'tap' } })
    tap = await new Promise((resolve) => (pendingTap = resolve))
    setUi({ tapRequest: null })
    if (!tap || ctrl.signal.aborted) return setUi({ check: null })
  }
  setUi({ check: { ref, status: 'checking' } })
  const r = await verifyPart({ project: p, ref, still, tap, signal: ctrl.signal })
  if (ctrl.signal.aborted || ui.get().check?.ref !== ref) return
  if (r.kind === 'cancelled') return setUi({ check: null })
  if (r.ok) dispatch({ type: 'verification', ref, result: { verdict: r.data.verdict, orientation: r.data.orientation, soldering: r.data.soldering, issues: r.data.issues, user: null } })
  setUi({ check: { ref, status: r.ok ? 'done' : 'error', result: r, error: r.error } })
  speak(summarize(ref, r))
}

export function completeTap(pt) {
  pendingTap?.(pt)
  pendingTap = null
}

export function closeCheck() {
  checkCtrl?.abort()
  pendingTap?.(null)
  pendingTap = null
  setUi({ check: null, tapRequest: null })
}

/** The user's own call on a checked part. */
export function confirmCheck(user) {
  const c = ui.get().check
  if (!c) return false
  dispatch({ type: 'verification', ref: c.ref, result: { user } })
  setUi({ check: null })
  return true
}

/** Mark the current part placed, move on, and check it in the background. */
export function placeCurrent() {
  const p = project.get()
  const ref = p?.current
  if (!ref) return null
  dispatch({ type: 'mark', ref, status: STATUS.placed })
  if (hasCamera(p)) checkPart(ref)
  return ref
}

// ---------------- calibration ----------------

/**
 * Two parts far apart that are visible from the given side (parts on that side, or
 * through-hole parts, whose pins show on both).
 */
export function calibrationRefs(board, side = 'top') {
  const parts = Object.values(board.parts).filter((q) => q.loc && ((q.loc.side === 'bottom') === (side === 'bottom') || packageGeometry(q).tht))
  let best = null
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const d = Math.hypot(parts[i].loc.x - parts[j].loc.x, parts[i].loc.y - parts[j].loc.y)
      if (!best || d > best.d) best = { d, refs: [parts[i].ref, parts[j].ref] }
    }
  return best?.refs ?? null
}

export function startCalibration(sideArg) {
  const p = project.get()
  const side = sideArg ?? currentSide(p)
  const refs = p?.board ? calibrationRefs(p.board, side) : null
  if (!refs) return toast('Needs a pick-and-place file')
  if (!hasCamera(p)) return toast('Connect the camera first')
  closeCheck()
  setUi({ calibrating: { refs, taps: [], side } })
  speak(`Tap ${sayRef(refs[0])} on the camera view.`)
}

export function calibrationTap(pt, aspect) {
  const c = ui.get().calibrating
  const p = project.get()
  if (!c || !p) return
  const taps = [...c.taps, pt]
  if (taps.length < 2) {
    setUi({ calibrating: { ...c, taps } })
    speak(`Now ${sayRef(c.refs[1])}.`)
    return
  }
  // People tap the middle of the part, which is the footprint centre (not the placement
  // origin, which is pin 1 for through-hole headers).
  const centre = (ref) => {
    const part = p.board.parts[ref]
    const e = packageExtent(packageGeometry(part))
    return toBoard({ x: e.cx, y: e.cy }, part.loc)
  }
  const pairs = c.refs.map((ref, i) => ({ board: centre(ref), image: taps[i] }))
  // Looking at the back, the board is flipped over: the image is a mirror of the top view.
  const cal = solveCalibration(pairs, aspect, c.side === 'bottom')
  dispatch({ type: 'calibration', side: c.side, calibration: cal })
  setUi({ calibrating: null })
  toast(cal ? 'Camera calibrated' : 'Calibration failed, try again')
}

// ---------------- final review ("Done") ----------------

let reviewCtrl = null

export async function runReview() {
  const p = project.get()
  if (!p) return
  if (!hasCamera(p)) return toast('Connect the camera to review')
  const side = currentSide(p)
  if (!calibrationFor(p, side)) {
    toast('Calibrate the camera first')
    return startCalibration(side)
  }
  closeCheck()
  reviewCtrl?.abort()
  const ctrl = new AbortController()
  reviewCtrl = ctrl
  // Review the side that is facing the camera.
  const refs = sequenceOf(p.plan).filter((r) => p.status[r] === STATUS.placed && (p.board.parts[r].loc?.side === 'bottom') === (side === 'bottom'))
  if (!refs.length) return toast('Nothing placed on this side yet')
  crops.reset()
  setUi({ review: { status: 'capturing', items: refs.map((ref) => ({ ref, status: 'wait' })), activeRef: null } })
  let still
  try {
    still = (await captureStill(p.settings.cameraSource)).canvas
  } catch (e) {
    setUi({ review: null })
    return toast(e.message)
  }
  speak(`Checking ${refs.length} parts.`)
  const update = (ref, patch) => {
    const rv = ui.get().review
    if (!rv) return
    setUi({ review: { ...rv, status: 'running', activeRef: patch.status === 'checking' ? ref : rv.activeRef, items: rv.items.map((it) => (it.ref === ref ? { ...it, ...patch } : it)) } })
  }
  // Two at a time: parts light up in order on the board while their checks run.
  let next = 0
  const worker = async () => {
    while (next < refs.length && !ctrl.signal.aborted) {
      const ref = refs[next++]
      update(ref, { status: 'checking' })
      const r = await verifyPart({ project: project.get(), ref, still, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      if (r.ok) dispatch({ type: 'verification', ref, result: { verdict: r.data.verdict, orientation: r.data.orientation, soldering: r.data.soldering, issues: r.data.issues } })
      update(ref, { status: r.ok ? r.data.verdict : 'error', result: r })
    }
  }
  await Promise.all([worker(), worker()])
  if (ctrl.signal.aborted) return
  const items = ui.get().review?.items ?? []
  const bad = items.filter((i) => i.status === 'problem').map((i) => i.ref)
  const unclear = items.filter((i) => i.status === 'unclear' || i.status === 'error').length
  setUi({ review: { ...ui.get().review, status: 'done', activeRef: null } })
  speak(bad.length ? `Check ${bad.map(sayRef).join(', ')}.` : unclear ? `${unclear} parts unclear. No problems seen; confirm by eye.` : 'No problems seen. Confirm by eye.')
}

export function closeReview() {
  reviewCtrl?.abort()
  setUi({ review: null })
}
