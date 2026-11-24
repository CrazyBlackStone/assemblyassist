import { shortFootprint } from './footprint.js'
import { refPrefix } from './refs.js'

// Package geometry in mm, in the part's own frame at rotation 0, Y up, origin = the
// pick-and-place position. Follows KiCad footprint conventions (pin 1 at the left /
// top-left; through-hole headers have their origin on pin 1). Used for the board
// render, the package drawing, the demo Gerbers and the size of verification crops.

const CHIP = {
  '0201': { L: 0.6, W: 0.3, pw: 0.35, ph: 0.4, px: 0.32 },
  '0402': { L: 1.0, W: 0.5, pw: 0.6, ph: 0.6, px: 0.5 },
  '0603': { L: 1.6, W: 0.8, pw: 0.8, ph: 0.95, px: 0.8 },
  '0805': { L: 2.0, W: 1.25, pw: 1.0, ph: 1.45, px: 0.95 },
  1206: { L: 3.2, W: 1.6, pw: 1.15, ph: 1.8, px: 1.5 },
  1210: { L: 3.2, W: 2.5, pw: 1.15, ph: 2.7, px: 1.5 },
  1812: { L: 4.5, W: 3.2, pw: 1.4, ph: 3.4, px: 2.1 },
  2010: { L: 5.0, W: 2.5, pw: 1.3, ph: 2.6, px: 2.35 },
  2512: { L: 6.3, W: 3.2, pw: 1.4, ph: 3.4, px: 3.0 },
}

const rect = (x, y, w, h, pin, shape = 'rect') => ({ x, y, w, h, pin, shape })

function twoTerminal({ L, W, pw, ph, px }) {
  return {
    body: { w: L, h: W },
    pads: [rect(-px, 0, pw, ph, 1), rect(px, 0, pw, ph, 2)],
  }
}

function dualRow(n, pitch, padX, pw, ph, bodyW, bodyH) {
  const per = n / 2
  const top = ((per - 1) * pitch) / 2
  const pads = []
  for (let i = 0; i < per; i++) pads.push(rect(-padX, top - i * pitch, pw, ph, i + 1))
  for (let i = 0; i < per; i++) pads.push(rect(padX, -top + i * pitch, pw, ph, per + i + 1))
  return { body: { w: bodyW, h: bodyH }, pads }
}

/**
 * @returns {{ family: string, body: {w,h,cx?,cy?}, pads: object[], mark: {type, x, y}|null, tht: boolean, drill?: number }}
 */
export function packageGeometry({ ref, footprint, polarity }) {
  const fp = shortFootprint(footprint)
  const full = String(footprint ?? '')
  const prefix = refPrefix(ref)
  let g

  const header = /PinHeader_(\d+)x(\d+)_P([\d.]+)mm/i.exec(fp)
  const soic = /(?:SOIC|SO|TSSOP|MSOP|SSOP)-?(\d+)(?:_([\d.]+)x([\d.]+)mm)?(?:.*_P([\d.]+)mm)?/i.exec(fp)
  const qfn = /(?:QFN|DFN)-?(\d+)(?:.*?_([\d.]+)x([\d.]+)mm)?/i.exec(fp)
  const eia = /EIA-(\d{2})(\d{2})/i.exec(fp)
  const chip = /(?:^|[^0-9])(0201|0402|0603|0805|1206|1210|1812|2010|2512)(?![0-9])/.exec(fp)

  if (header) {
    const cols = Number(header[1])
    const rows = Number(header[2])
    const p = Number(header[3])
    const pads = []
    let pin = 1
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) pads.push(rect(c * p, 0 - r * p, 1.7, 1.7, pin, pin++ === 1 ? 'rect' : 'circle'))
    const w = cols * p
    const h = rows * p
    g = { family: 'header', body: { w, h, cx: ((cols - 1) * p) / 2, cy: (-(rows - 1) * p) / 2 }, pads, tht: true, drill: 1.0 }
  } else if (/SOT-?223/i.test(fp)) {
    g = {
      family: 'sot223',
      body: { w: 3.5, h: 6.5 },
      pads: [rect(-3.15, 2.3, 2.0, 1.5, 1), rect(-3.15, 0, 2.0, 1.5, 2), rect(-3.15, -2.3, 2.0, 1.5, 3), rect(3.15, 0, 2.0, 3.8, 4)],
    }
  } else if (/SOT-?23/i.test(fp)) {
    const n = Number(/SOT-?23-(\d)/i.exec(fp)?.[1] ?? 3)
    const pads =
      n === 3
        ? [rect(-1.14, 0.95, 1.3, 0.6, 1), rect(-1.14, -0.95, 1.3, 0.6, 2), rect(1.14, 0, 1.3, 0.6, 3)]
        : dualRow(n === 5 ? 6 : n, 0.95, 1.14, 1.3, 0.6, 1.6, 2.9).pads.slice(0, n)
    g = { family: 'sot23', body: { w: 1.6, h: 2.9 }, pads }
  } else if (soic && !/QFN|DFN/i.test(fp)) {
    const n = Number(soic[1])
    const bodyW = Number(soic[2] ?? 3.9)
    const bodyL = Number(soic[3] ?? (n / 2) * 1.27 + 0.1)
    const pitch = Number(soic[4] ?? (/TSSOP|MSOP|SSOP/i.test(fp) ? 0.65 : 1.27))
    const padX = bodyW / 2 + (pitch >= 1 ? 0.75 : 0.6)
    g = { family: 'soic', ...dualRow(n, pitch, padX, pitch >= 1 ? 1.55 : 1.2, pitch * 0.47, bodyW, bodyL) }
  } else if (qfn) {
    const n = Number(qfn[1])
    const s = Number(qfn[2] ?? 4)
    const per = Math.max(1, Math.round(n / 4))
    const pitch = Math.min(0.65, (s - 0.6) / per)
    const pads = []
    const off = ((per - 1) * pitch) / 2
    let pin = 1
    for (let i = 0; i < per; i++) pads.push(rect(-s / 2, off - i * pitch, 0.7, pitch * 0.5, pin++))
    for (let i = 0; i < per; i++) pads.push(rect(-off + i * pitch, -s / 2, pitch * 0.5, 0.7, pin++))
    for (let i = 0; i < per; i++) pads.push(rect(s / 2, -off + i * pitch, 0.7, pitch * 0.5, pin++))
    for (let i = 0; i < per; i++) pads.push(rect(off - i * pitch, s / 2, pitch * 0.5, 0.7, pin++))
    pads.push(rect(0, 0, s * 0.55, s * 0.55, 0))
    g = { family: 'qfn', body: { w: s, h: s }, pads }
  } else if (/\bD_SMA\b|DO-?214AC/i.test(fp)) {
    g = { family: 'chip2', body: { w: 4.3, h: 2.6 }, pads: [rect(-2.0, 0, 2.5, 1.7, 1), rect(2.0, 0, 2.5, 1.7, 2)] }
  } else if (/\bD_SMB\b|DO-?214AA/i.test(fp)) {
    g = { family: 'chip2', body: { w: 4.3, h: 3.6 }, pads: [rect(-2.15, 0, 2.5, 2.3, 1), rect(2.15, 0, 2.5, 2.3, 2)] }
  } else if (eia) {
    const L = Number(eia[1]) / 10
    const W = Number(eia[2]) / 10
    g = { family: 'chip2', ...twoTerminal({ L, W, pw: L * 0.42, ph: W * 0.9, px: L * 0.44 }) }
  } else if (/PTS645|SW_SPST|6x6/i.test(fp)) {
    g = {
      family: 'switch',
      body: { w: 6, h: 6 },
      pads: [rect(-3.98, 2.25, 1.55, 1.3, 1), rect(3.98, 2.25, 1.55, 1.3, 2), rect(-3.98, -2.25, 1.55, 1.3, 3), rect(3.98, -2.25, 1.55, 1.3, 4)],
    }
  } else if (chip) {
    g = { family: 'chip2', ...twoTerminal(CHIP[chip[1]]) }
  } else {
    g = { family: 'generic', ...twoTerminal(CHIP['1206']) }
  }

  g.tht ??= false
  g.body.cx ??= 0
  g.body.cy ??= 0
  g.mark = markFor(g, polarity, prefix, full)
  return g
}

function markFor(g, polarity, prefix, full) {
  if (g.family === 'header') return { type: 'pin1', x: 0, y: 0 }
  if (!polarity?.polarized && !['U', 'IC', 'Q'].includes(prefix)) return null
  const m = polarity?.marking
  const { w, h, cx, cy } = g.body
  if (g.family === 'chip2' || g.family === 'generic') {
    if (m === 'electrolytic') return { type: 'minus', x: cx + w * 0.32, y: cy }
    if (m === 'tantalum') return { type: 'plus', x: cx - w * 0.32, y: cy }
    return { type: 'cathode', x: cx - w * 0.32, y: cy }
  }
  // Chips: dot near pin 1 (top-left in KiCad orientation).
  return { type: 'pin1', x: cx - w / 2 + Math.min(w, h) * 0.22, y: cy + h / 2 - Math.min(w, h) * 0.22 }
}

/** Axis-aligned extent of body + pads in the part frame (before rotation). */
export function packageExtent(g) {
  let minX = g.body.cx - g.body.w / 2
  let maxX = g.body.cx + g.body.w / 2
  let minY = g.body.cy - g.body.h / 2
  let maxY = g.body.cy + g.body.h / 2
  for (const p of g.pads) {
    minX = Math.min(minX, p.x - p.w / 2)
    maxX = Math.max(maxX, p.x + p.w / 2)
    minY = Math.min(minY, p.y - p.h / 2)
    maxY = Math.max(maxY, p.y + p.h / 2)
  }
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY }
}

/** Rotate a part-frame point by `rot` degrees counter-clockwise and move it to (x0, y0). */
export function toBoard(pt, loc) {
  const a = (loc.rot * Math.PI) / 180
  return { x: loc.x + pt.x * Math.cos(a) - pt.y * Math.sin(a), y: loc.y + pt.x * Math.sin(a) + pt.y * Math.cos(a) }
}

/** Where the polarity mark sits, in words, for the part frame after rotation (Y up). */
export function markDirection(g, rotDeg) {
  if (!g.mark) return null
  const a = (rotDeg * Math.PI) / 180
  const dx = g.mark.x - g.body.cx
  const dy = g.mark.y - g.body.cy
  const x = dx * Math.cos(a) - dy * Math.sin(a)
  const y = dx * Math.sin(a) + dy * Math.cos(a)
  const h = Math.abs(x) < 0.25 * Math.hypot(x, y) ? '' : x < 0 ? 'left' : 'right'
  const v = Math.abs(y) < 0.25 * Math.hypot(x, y) ? '' : y > 0 ? 'top' : 'bottom'
  return [v, h].filter(Boolean).join('-') || 'centre'
}
