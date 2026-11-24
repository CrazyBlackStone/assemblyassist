import { shortFootprint } from './footprint.js'
import { refPrefix } from './refs.js'

// Package geometry in mm, in the part's own frame at rotation 0, Y up, origin = the
// pick-and-place position. Follows KiCad footprint conventions (pin 1 at the left /
// top-left; through-hole headers have their origin on pin 1). Used for the board
// render, the package drawing, the demo Gerbers and the size of verification crops.

// Chip sizes (L × W, mm) for every EIA imperial code, and the metric code for each.
export const CHIP_SIZES = {
  '008004': [0.25, 0.125], '01005': [0.4, 0.2], '0201': [0.6, 0.3], '0402': [1.0, 0.5], '0603': [1.6, 0.8],
  '0805': [2.0, 1.25], '1008': [2.5, 2.0], '1206': [3.2, 1.6], '1210': [3.2, 2.5], '1806': [4.5, 1.6],
  '1808': [4.5, 2.0], '1812': [4.5, 3.2], '1825': [4.5, 6.4], '2010': [5.0, 2.5], '2220': [5.7, 5.0],
  '2225': [5.7, 6.3], '2512': [6.3, 3.2], '2920': [7.4, 5.1],
}
const METRIC_TO_IMPERIAL = {
  '0201M': '008004', '0402M': '01005', '0603M': '0201', 1005: '0402', 1608: '0603', 2012: '0805', 2520: '1008', 3216: '1206',
  3225: '1210', 4516: '1806', 4520: '1808', 4532: '1812', 4564: '1825', 5025: '2010', 5750: '2220', 5764: '2225', 6332: '2512', 7451: '2920',
}

/** Pads for a chip of length L, width W (land pattern close to IPC-7351 nominal). */
function chipPads(L, W) {
  const pw = Math.max(0.2, 0.3 * L + 0.25)
  return { pw, ph: W * 1.1 + 0.15, px: L / 2 - 0.05 + pw * 0.05 }
}

export function chipCode(fp) {
  const imperial = /(?:^|[^0-9])(008004|01005|0201|0402|0603|0805|1008|1206|1210|1806|1808|1812|1825|2010|2220|2225|2512|2920)(?![0-9])/.exec(fp)?.[1]
  if (imperial) return imperial
  const metric = /(\d{4}M?)_?Metric/i.exec(fp)?.[1] ?? /\b[RCL](\d{4})\b/.exec(fp)?.[1]
  return METRIC_TO_IMPERIAL[metric] ?? null
}

// Tantalum case letters (KEMET/AVX): EIA size and height.
const TANT_CASE = { R: [2012, 1.2], S: [3216, 1.2], A: [3216, 1.8], T: [3528, 1.2], B: [3528, 2.1], U: [6032, 1.5], C: [6032, 2.8], W: [7343, 1.5], V: [7343, 2.0], D: [7343, 3.1], Y: [7343, 2.0], X: [7343, 4.3], E: [7343, 4.3] }

/**
 * IPC-7351 footprint names spell out the package: RESC1608X55N, CAPC2012X125N, CAPMP3216X180N,
 * CAPAE530X610N, DIOM5226X230N, SOD3716X135N, SOIC127P600X175-8N, SOT95P280X145-5N,
 * QFN50P400X400X100-21N, QFP50P1200X1200X160-64N. Used by Altium, Allegro libraries,
 * Ultra Librarian and SnapEDA. Returns dimensions in mm or null.
 */
export function ipc7351(fp) {
  const n = String(fp).toUpperCase()
  let m
  if ((m = /\b(RES|CAP|IND|LED|DIO|FUS|BEAD)(C|MP)(\d{4,6})X(\d{2,3})/.exec(n))) {
    const d = m[3]
    const half = d.length / 2
    return { kind: m[2] === 'MP' ? 'tant' : 'chip', what: m[1], L: Number(d.slice(0, half)) / 10, W: Number(d.slice(half)) / 10, H: Number(m[4]) / 100 }
  }
  if ((m = /\bCAPAE(\d{3,4})X(\d{3,4})/.exec(n))) return { kind: 'elec', L: Number(m[1]) / 100, W: Number(m[1]) / 100, H: Number(m[2]) / 100 }
  if ((m = /\b(DIOM|DIOMELF|SOD|SODFL)(\d{4})X(\d{2,3})/.exec(n))) return { kind: 'diode', L: Number(m[2].slice(0, 2)) / 10, W: Number(m[2].slice(2)) / 10, H: Number(m[3]) / 100 }
  if ((m = /\b(SOIC|SOP|SSOP|TSOP|TSSOP|MSOP)(\d+)P(\d+)X(\d+)-(\d+)/.exec(n)))
    return { kind: 'soic', pitch: Number(m[2]) / 100, span: Number(m[3]) / 100, H: Number(m[4]) / 100, pins: Number(m[5]) }
  if ((m = /\b(QFN|DFN|SON|VQFN|WQFN|UQFN)(\d+)P(\d+)X(\d+)X(\d+)-(\d+)/.exec(n)))
    return { kind: 'qfn', pitch: Number(m[2]) / 100, L: Number(m[3]) / 100, W: Number(m[4]) / 100, H: Number(m[5]) / 100, pins: Number(m[6]) }
  if ((m = /\b(QFP|LQFP|TQFP)(\d+)P(\d+)X(\d+)X(\d+)-(\d+)/.exec(n)))
    return { kind: 'qfp', pitch: Number(m[2]) / 100, L: Number(m[3]) / 100, W: Number(m[4]) / 100, H: Number(m[5]) / 100, pins: Number(m[6]) }
  if ((m = /\bSOT(\d+)P(\d+)X(\d+)-(\d+)/.exec(n))) return { kind: 'sot', pitch: Number(m[1]) / 100, span: Number(m[2]) / 100, H: Number(m[3]) / 100, pins: Number(m[4]) }
  return null
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
 * Geometry for a part: library footprint by package name, replaced by the real pads when a
 * netlist provides them, plus a body height and a model style for the 3D view.
 * @returns {{ family, style, body: {w,h,cx,cy}, height, pads, mark: {type,x,y}|null, tht }}
 */
export function packageGeometry(part) {
  const g = libraryGeometry(part)
  if (part.pads?.length && part.loc) applyRealPads(g, part)
  g.style = styleFor(g, part)
  g.height = heightFor(g, part)
  if (g.family === 'generic' && part.pads?.length) g.mark = padMark(g)
  return g
}

function libraryGeometry({ ref, footprint, polarity }) {
  const fp = shortFootprint(footprint)
  const full = String(footprint ?? '')
  const prefix = refPrefix(ref)
  let g

  const ipc = ipc7351(fp)
  const header = /PinHeader_(\d+)x(\d+)_P([\d.]+)mm/i.exec(fp)
  const axial = /Axial.*?L([\d.]+)mm_D([\d.]+)mm_P([\d.]+)mm(?:_(Horizontal|Vertical))?/i.exec(fp) ?? (/AXIAL-?0?\.(\d)/i.test(fp) ? [null, 6.3, 2.5, Number(/AXIAL-?0?\.(\d)/i.exec(fp)[1]) * 2.54, 'Horizontal'] : null)
  const disc = /C_Disc_D([\d.]+)mm_W([\d.]+)mm_P([\d.]+)mm/i.exec(fp)
  const film = /C_Rect_L([\d.]+)mm_W([\d.]+)mm_P([\d.]+)mm/i.exec(fp)
  const radial = /CP_Radial_D([\d.]+)mm_P([\d.]+)mm/i.exec(fp) ?? (/\bRB([\d.]+)-([\d.]+)/i.exec(fp) ? [null, /\bRB([\d.]+)-([\d.]+)/i.exec(fp)[2], /\bRB([\d.]+)-([\d.]+)/i.exec(fp)[1]] : null)
  const tantCase = /(?:Case|Tant\w*)[_ -]?([RSATBUCWVDYXE])\b/i.exec(fp)
  const soic = /(?:SOIC|SO|TSSOP|MSOP|SSOP)-?(\d+)(?:_([\d.]+)x([\d.]+)mm)?(?:.*_P([\d.]+)mm)?/i.exec(fp)
  const qfn = /(?:QFN|DFN)-?(\d+)(?:.*?_([\d.]+)x([\d.]+)mm)?/i.exec(fp)
  const eia = /EIA-(\d{2})(\d{2})/i.exec(fp)

  const thtPads = (P, d) => [{ ...rect(0, 0, d + 0.8, d + 0.8, 1), drill: d }, { ...rect(P, 0, d + 0.8, d + 0.8, 2, 'circle'), drill: d }]
  if (ipc?.kind === 'chip' || ipc?.kind === 'tant' || ipc?.kind === 'diode') {
    const { pw, ph, px } = chipPads(ipc.L, ipc.W)
    g = { family: 'chip2', body: { w: ipc.L, h: ipc.W }, pads: [rect(-px, 0, pw, ph, 1), rect(px, 0, pw, ph, 2)], H: ipc.H }
  } else if (ipc?.kind === 'elec') {
    g = { family: 'chip2', body: { w: ipc.L, h: ipc.W }, pads: [rect(-ipc.L * 0.42, 0, ipc.L * 0.4, ipc.L * 0.3, 1), rect(ipc.L * 0.42, 0, ipc.L * 0.4, ipc.L * 0.3, 2)], H: ipc.H, elec: true }
  } else if (ipc?.kind === 'soic') {
    const bodyW = Math.max(1, ipc.span - 2.1)
    g = { family: 'soic', ...dualRow(ipc.pins, ipc.pitch, ipc.span / 2 - 0.5, 1.3, ipc.pitch * 0.47, bodyW, (ipc.pins / 2) * ipc.pitch + 0.4), H: ipc.H }
  } else if (ipc?.kind === 'qfn' || ipc?.kind === 'qfp') {
    const per = Math.max(1, Math.floor(ipc.pins / 4))
    const s2 = ipc.kind === 'qfn' ? ipc.L : ipc.L - 2.0
    const pads = []
    const off = ((per - 1) * ipc.pitch) / 2
    const edge = ipc.kind === 'qfn' ? ipc.L / 2 : ipc.L / 2 - 0.5
    let pin = 1
    for (let i = 0; i < per; i++) pads.push(rect(-edge, off - i * ipc.pitch, 0.8, ipc.pitch * 0.5, pin++))
    for (let i = 0; i < per; i++) pads.push(rect(-off + i * ipc.pitch, -edge, ipc.pitch * 0.5, 0.8, pin++))
    for (let i = 0; i < per; i++) pads.push(rect(edge, -off + i * ipc.pitch, 0.8, ipc.pitch * 0.5, pin++))
    for (let i = 0; i < per; i++) pads.push(rect(off - i * ipc.pitch, edge, ipc.pitch * 0.5, 0.8, pin++))
    g = { family: 'qfn', body: { w: s2, h: s2 }, pads, H: ipc.H }
  } else if (ipc?.kind === 'sot') {
    const pads = ipc.pins === 3 ? [rect(-ipc.span / 2 + 0.3, ipc.pitch, 1.1, 0.6, 1), rect(-ipc.span / 2 + 0.3, -ipc.pitch, 1.1, 0.6, 2), rect(ipc.span / 2 - 0.3, 0, 1.1, 0.6, 3)] : dualRow(ipc.pins % 2 ? ipc.pins + 1 : ipc.pins, ipc.pitch, ipc.span / 2 - 0.3, 1.1, 0.6, 1.6, 2.9).pads.slice(0, ipc.pins)
    g = { family: 'sot23', body: { w: Math.max(1.2, ipc.span - 1.2), h: (Math.ceil(ipc.pins / 2) - 1) * ipc.pitch + 1.0 }, pads, H: ipc.H }
  } else if (axial) {
    const [, L, D, P, orient] = axial
    const vertical = /Vertical/i.test(orient ?? '')
    g = { family: 'axial', body: vertical ? { w: Number(D), h: Number(D), cx: 0, cy: 0 } : { w: Number(L), h: Number(D), cx: Number(P) / 2, cy: 0 }, pads: thtPads(Number(P), 0.8), tht: true, H: vertical ? Number(L) + 1 : Number(D) + 0.6, vertical }
  } else if (disc) {
    const [, D, W, P] = disc
    g = { family: 'disc', body: { w: Number(D), h: Number(W), cx: Number(P) / 2, cy: 0 }, pads: thtPads(Number(P), 0.8), tht: true, H: Number(D) + 1.5 }
  } else if (film) {
    const [, L, W, P] = film
    g = { family: 'film', body: { w: Number(L), h: Number(W), cx: Number(P) / 2, cy: 0 }, pads: thtPads(Number(P), 0.8), tht: true, H: Math.max(4, Number(W) * 2.4) }
  } else if (radial) {
    const D = Number(radial[1])
    const P = Number(radial[2])
    const heightByD = [[4, 7], [5, 11], [6.3, 11], [8, 11.5], [10, 16], [12.5, 20], [16, 25], [18, 35], [Infinity, 40]].find(([d]) => D <= d)[1]
    g = { family: 'radial', body: { w: D, h: D, cx: P / 2, cy: 0 }, pads: thtPads(P, D >= 10 ? 1.0 : 0.8), tht: true, H: heightByD }
  } else if (header) {
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
  } else if (eia || tantCase) {
    const [code, caseH] = eia ? [`${eia[1]}${eia[2]}`, null] : TANT_CASE[tantCase[1].toUpperCase()].map(String)
    const L = Number(code.slice(0, 2)) / 10
    const W = Number(code.slice(2)) / 10
    g = { family: 'chip2', ...twoTerminal({ L, W, pw: L * 0.42, ph: W * 0.9, px: L * 0.44 }), H: caseH ? Number(caseH) : undefined }
  } else if (/PTS645|SW_SPST|6x6/i.test(fp)) {
    g = {
      family: 'switch',
      body: { w: 6, h: 6 },
      pads: [rect(-3.98, 2.25, 1.55, 1.3, 1), rect(3.98, 2.25, 1.55, 1.3, 2), rect(-3.98, -2.25, 1.55, 1.3, 3), rect(3.98, -2.25, 1.55, 1.3, 4)],
    }
  } else if (chipCode(fp)) {
    const [L, W] = CHIP_SIZES[chipCode(fp)]
    const { pw, ph, px } = chipPads(L, W)
    g = { family: 'chip2', body: { w: L, h: W }, pads: [rect(-px, 0, pw, ph, 1), rect(px, 0, pw, ph, 2)] }
  } else if (/SOT-?89/i.test(fp)) {
    g = { family: 'sot223', body: { w: 2.5, h: 4.5 }, pads: [rect(-1.8, 1.5, 1.2, 0.6, 1), rect(-1.8, 0, 1.2, 0.6, 2), rect(-1.8, -1.5, 1.2, 0.6, 3), rect(1.2, 0, 2.6, 2.2, 4)] }
  } else if (/CP_Elec_([\d.]+)x([\d.]+)/i.test(fp)) {
    const d = Number(/CP_Elec_([\d.]+)x/i.exec(fp)[1])
    g = { family: 'chip2', body: { w: d, h: d }, pads: [rect(-d * 0.42, 0, d * 0.4, d * 0.3, 1), rect(d * 0.42, 0, d * 0.4, d * 0.3, 2)] }
  } else {
    const [L, W] = CHIP_SIZES['1206']
    const { pw, ph, px } = chipPads(L, W)
    g = { family: 'generic', body: { w: L, h: W }, pads: [rect(-px, 0, pw, ph, 1), rect(px, 0, pw, ph, 2)] }
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

/**
 * Part frame -> board (top view, Y up): mirror for bottom-side parts (KiCad/Allegro flip the
 * footprint left-right), rotate `rot` degrees counter-clockwise, move to the placement point.
 */
export function toBoard(pt, loc) {
  const a = (loc.rot * Math.PI) / 180
  const x = loc.side === 'bottom' ? -pt.x : pt.x
  return { x: loc.x + x * Math.cos(a) - pt.y * Math.sin(a), y: loc.y + x * Math.sin(a) + pt.y * Math.cos(a) }
}

/** Inverse of toBoard. */
export function toLocal(pt, loc) {
  const a = (-loc.rot * Math.PI) / 180
  const dx = pt.x - loc.x
  const dy = pt.y - loc.y
  const x = dx * Math.cos(a) - dy * Math.sin(a)
  return { x: loc.side === 'bottom' ? -x : x, y: dx * Math.sin(a) + dy * Math.cos(a) }
}

// ---------------- real pads (IPC-356) ----------------

function applyRealPads(g, part) {
  const local = part.pads.map((p) => {
    const c = toLocal(p, part.loc)
    // Pad sizes come in board axes; swap them back when the part is turned 90/270.
    const turned = Math.round(part.loc.rot / 90) % 2 === 1
    return { x: c.x, y: c.y, w: turned ? p.h : p.w, h: turned ? p.w : p.h, pin: p.pin, shape: p.shape, drill: p.drill }
  })
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of local) {
    minX = Math.min(minX, p.x - p.w / 2)
    maxX = Math.max(maxX, p.x + p.w / 2)
    minY = Math.min(minY, p.y - p.h / 2)
    maxY = Math.max(maxY, p.y + p.h / 2)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  if (g.family === 'generic') {
    // Unknown package: the body covers the pad field (a little inside it).
    g.body = { w: Math.max(0.6, (maxX - minX) * 0.9), h: Math.max(0.6, (maxY - minY) * 0.9), cx, cy }
  } else {
    const dx = cx - (g.body.cx ?? 0)
    const dy = cy - (g.body.cy ?? 0)
    g.body = { ...g.body, cx, cy }
    if (g.mark) g.mark = { ...g.mark, x: g.mark.x + dx, y: g.mark.y + dy }
  }
  g.pads = local
  g.tht = local.some((p) => p.drill)
  g.real = true
}

function padMark(g) {
  const p1 = g.pads.find((p) => /^(1|A1|P1)$/i.test(p.pin))
  if (!p1) return null
  const { w, h, cx, cy } = g.body
  const inset = Math.min(w, h) * 0.18
  return { type: 'pin1', x: Math.min(Math.max(p1.x, cx - w / 2 + inset), cx + w / 2 - inset), y: Math.min(Math.max(p1.y, cy - h / 2 + inset), cy + h / 2 - inset) }
}

// ---------------- 3D: style and height ----------------

function styleFor(g, part) {
  const p = refPrefix(part.ref)
  const fp = String(part.footprint ?? '')
  const m = part.polarity?.marking
  if (g.family === 'header') return 'header'
  if (g.family === 'axial') return p === 'D' ? 'axial-diode' : 'axial'
  if (g.family === 'disc') return 'disc'
  if (g.family === 'film') return 'film'
  if (g.family === 'radial' || g.elec) return 'elec'
  if (g.family === 'switch') return 'switch'
  if (/CP_Elec/i.test(fp) || m === 'electrolytic') return 'elec'
  if (m === 'tantalum') return 'tant'
  if (p === 'LED' || /LED/i.test(fp)) return 'led'
  if (['soic', 'qfn', 'sot23', 'sot223'].includes(g.family)) return 'ic'
  if (p === 'D') return 'diode'
  if (g.family === 'chip2') return p === 'C' ? 'cap' : p === 'L' || p === 'FB' ? 'ind' : 'res'
  if (/USB|CX70|TYPE.?C|HDMI|RJ45|DC.?JACK/i.test(fp)) return 'usb'
  if (/FPC|FFC|DF56|FH12|FH19|FH26|ZIF/i.test(fp)) return 'fpc'
  if (['J', 'P', 'CN', 'CON'].includes(p)) return 'connector'
  if (['U', 'IC'].includes(p)) return 'ic'
  return 'generic'
}

// Seated heights (mm), typical datasheet values. Thick-film resistors by size:
const RES_H = { '008004': 0.1, '01005': 0.13, '0201': 0.23, '0402': 0.35, '0603': 0.45, '0805': 0.5, 1008: 0.55, 1206: 0.55, 1210: 0.55, 1806: 0.55, 1808: 0.55, 1812: 0.55, 1825: 0.55, 2010: 0.55, 2220: 0.6, 2225: 0.6, 2512: 0.55, 2920: 0.6 }
// MLCC thickness grows with capacitance for each size: [limit in farads, height] steps.
const CAP_H = {
  '008004': [[Infinity, 0.125]], '01005': [[Infinity, 0.2]], '0201': [[Infinity, 0.3]], '0402': [[Infinity, 0.5]],
  '0603': [[1e-6, 0.8], [Infinity, 0.8]],
  '0805': [[10e-9, 0.6], [1e-6, 0.85], [Infinity, 1.25]],
  1008: [[Infinity, 1.6]],
  1206: [[100e-9, 0.85], [2.2e-6, 1.15], [Infinity, 1.6]],
  1210: [[1e-6, 1.25], [10e-6, 2.0], [Infinity, 2.5]],
  1806: [[Infinity, 1.25]], 1808: [[Infinity, 1.6]], 1812: [[1e-6, 1.6], [Infinity, 2.0]], 1825: [[Infinity, 2.0]],
  2010: [[Infinity, 1.6]], 2220: [[Infinity, 2.5]], 2225: [[Infinity, 2.5]], 2512: [[Infinity, 1.6]], 2920: [[Infinity, 2.5]],
}
const LED_H = { '0402': 0.4, '0603': 0.6, '0805': 0.8, 1206: 1.1 }
const IND_H = { '0201': 0.3, '0402': 0.5, '0603': 0.8, '0805': 1.0, 1008: 1.8, 1206: 1.1, 1210: 2.0, 1812: 3.0, 2220: 3.5 }

/** "100nF", "4.7u", "4u7", "10 µF" -> farads (or the bare number). */
function engValue(v) {
  const m = /([\d.]+)\s*([pnuµmk]?)(\d*)\s*F?/i.exec(String(v ?? '').replace(',', '.'))
  if (!m) return null
  const mult = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, '': 1 }[m[2].toLowerCase() === 'µ' ? 'µ' : m[2].toLowerCase()] ?? 1
  return Number(m[3] ? `${m[1]}.${m[3]}` : m[1]) * mult
}

/** Typical seated height in mm, from datasheet values for each package family. */
function heightFor(g, part) {
  const fp = String(part.footprint ?? '')
  if (g.H) return g.H
  const code = chipCode(fp)
  switch (g.style) {
    case 'res':
      return RES_H[code] ?? 0.5
    case 'cap': {
      const steps = CAP_H[code]
      if (!steps) return 1.0
      const f = engValue(part.value)
      return (steps.find(([limit]) => f == null || f <= limit) ?? steps[steps.length - 1])[1]
    }
    case 'led':
      return LED_H[code] ?? 0.8
    case 'ind':
      return IND_H[code] ?? 1.0
    case 'tant': {
      const named = /EIA-\d{4}-(\d{2})/i.exec(fp)
      if (named) return Number(named[1]) / 10
      return { 3216: 1.6, 3528: 1.9, 6032: 2.5, 7343: 2.8 }[/EIA-(\d{4})/i.exec(fp)?.[1]] ?? 1.8
    }
    case 'elec':
      return Number(/CP_Elec_[\d.]+x([\d.]+)/i.exec(fp)?.[1] ?? 5.4)
    case 'diode':
      return /SMC/i.test(fp) ? 2.5 : /SMA|SMB|DO-?214/i.test(fp) ? 2.3 : /SOD-?123/i.test(fp) ? 1.1 : /SOD-?323/i.test(fp) ? 0.9 : 1.0
    case 'ic':
      if (g.family === 'sot23') return 1.0
      if (g.family === 'sot223') return /SOT-?89/i.test(fp) ? 1.5 : 1.65
      if (g.family === 'qfn') return 0.85
      if (/TSSOP|MSOP/i.test(fp)) return 1.0
      if (/QFP/i.test(fp)) return 1.4
      if (/SOIC|SO-/i.test(fp)) return g.body.w > 4.5 ? 1.8 : 1.5
      return 1.2
    case 'header':
      return 2.5
    case 'switch':
      return 3.5
    case 'usb':
      return 3.2
    case 'fpc':
      return 1.0
    case 'connector':
      return 3.0
    default:
      return 1.0
  }
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
