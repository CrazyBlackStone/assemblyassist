import { packageGeometry, packageExtent, toBoard } from '../bom/packages.js'
import { boardToImage, neighbors } from '../geometry/board.js'
import { cropCanvas, assessQuality, toJpegDataUrl } from '../imaging/image.js'
import * as Verify from '../ai/tasks/verify.js'
import { runTask, taskConfig } from '../ai/provider.js'
import { createStore } from '../store.js'

// Placement verification: crop one part out of a full-resolution frame and ask the
// vision model about it. Crops stay in memory for this session only.

export const crops = createStore({ key: null, storage: null, initial: {} }) // ref -> { dataUrl, width, height, canonical }

/**
 * Crop a part using the camera calibration: centred on the footprint, sized to it
 * (+ margin), and rotated so the part is in its reference orientation (pin 1 top-left /
 * polarity mark on the left), whatever its rotation on the board.
 */
export function partCrop(src, part, cal) {
  const W = src.width
  const H = src.height
  const e = packageExtent(packageGeometry(part))
  const px = (pt) => {
    const q = boardToImage(cal, pt)
    return { x: q.x * W, y: q.y * H }
  }
  const c = px(toBoard({ x: e.cx, y: e.cy }, part.loc))
  const ax = px(toBoard({ x: e.cx + 1, y: e.cy }, part.loc))
  const ay = px(toBoard({ x: e.cx, y: e.cy + 1 }, part.loc))
  const vx = { x: ax.x - c.x, y: ax.y - c.y }
  const vy = { x: ay.x - c.x, y: ay.y - c.y }
  const pxPerMm = Math.hypot(vx.x, vx.y)
  const phi = Math.atan2(vx.y, vx.x)
  // After rotating by -phi, board "up" must point up on screen; otherwise the view is mirrored.
  const mirrored = vy.x * Math.sin(-phi) + vy.y * Math.cos(-phi) > 0
  const sideMm = Math.max(3, Math.max(e.w, e.h) * 1.7)
  const sidePx = sideMm * pxPerMm
  const out = Math.round(Math.min(768, Math.max(256, sidePx)))
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, out, out)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(out / 2, out / 2)
  ctx.scale(out / sidePx, out / sidePx)
  if (mirrored) ctx.scale(1, -1)
  ctx.rotate(-phi)
  ctx.drawImage(src, -c.x, -c.y)
  const inFrame = c.x > 0 && c.y > 0 && c.x < W && c.y < H
  return { canvas, canonical: true, inFrame, pxPerMm }
}

/** Fallback without calibration: a square around a tap, a fifth of the frame. */
export function tapCrop(src, tap) {
  return { ...cropCanvas(src, { cx: tap.x, cy: tap.y, size: 0.2 }), canonical: false, inFrame: true }
}

/**
 * Verify one part. Returns { ok, crop, data?, meta?, kind?, error?, quality }.
 * `tap` is used only when there is no calibration.
 */
export async function verifyPart({ project, ref, still, tap, signal }) {
  const part = project.board.parts[ref]
  const cal = project.calibration
  let cropped
  if (cal && part.loc) cropped = partCrop(still, part, cal)
  else if (tap) cropped = tapCrop(still, tap)
  else return { ok: false, kind: 'needs-tap' }
  if (!cropped.inFrame) return { ok: false, kind: 'out-of-frame', error: `${ref} is outside the camera view.` }

  const crop = { dataUrl: toJpegDataUrl(cropped.canvas, 0.9), width: cropped.canvas.width, height: cropped.canvas.height, canonical: cropped.canonical }
  crops.set((s) => ({ ...s, [ref]: crop }))
  const quality = assessQuality(cropped.canvas)
  const near = neighbors(project.board, ref, 5, 4).map((n) => `${n.ref} ${n.value}`)
  const ctx = Verify.buildContext(project.board, ref, { canonical: cropped.canonical, checkSoldering: project.settings.verifySoldering, neighbors: near })
  const res = await runTask({
    task: Verify.TASK,
    signal,
    messages: Verify.buildMessages(ctx, crop.dataUrl),
    simulate: () => Verify.simulate(ctx),
    validate: (v) => Verify.validate(v, ctx),
    inputSummary: Verify.inputSummary(ctx, crop),
    fallbackAction: 'Showed "not checked"; the user checks by eye.',
  })
  return { ...res, crop, quality, ctx }
}

export const verifyTimeout = () => taskConfig(Verify.TASK).timeoutMs
