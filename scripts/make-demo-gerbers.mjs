#!/usr/bin/env node
// Writes Gerber + Excellon files for the bundled demo board, generated from the demo
// BOM/CPL and the package geometry the app uses. Re-run after changing the demo parts:
//   node scripts/make-demo-gerbers.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBoardFromText } from '../src/lib/bom/board.js'
import { packageGeometry, toBoard } from '../src/lib/bom/packages.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const demo = join(root, 'src/data/demo')
const out = join(demo, 'gerbers')
const W = 40
const H = 30

const board = loadBoardFromText({
  bomText: await readFile(join(demo, 'demo-bom.csv'), 'utf8'),
  pnpText: await readFile(join(demo, 'demo-pnp.csv'), 'utf8'),
})
const parts = Object.values(board.parts).map((p) => ({ ...p, g: packageGeometry(p) }))

const n = (v) => Math.round(v * 1e6)
const xy = (p) => `X${n(p.x)}Y${n(p.y)}`

function header(func) {
  return [`%TF.GenerationSoftware,AssemblyAssist,demo*%`, `%TF.FileFunction,${func}*%`, '%FSLAX46Y46*%', '%MOMM*%', '%LPD*%']
}

function rectRegion(cx, cy, w, h, rotDeg, loc) {
  const pts = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([dx, dy]) => toBoard({ x: cx + dx, y: cy + dy }, loc))
  return ['G36*', `${xy(pts[0])}D02*`, ...pts.slice(1).map((p) => `${xy(p)}D01*`), `${xy(pts[0])}D01*`, 'G37*']
}

function padLayer(func, grow, includeTht = true) {
  const lines = header(func)
  const circles = new Map()
  const body = ['G01*']
  for (const p of parts) {
    if (p.g.tht && !includeTht) continue
    for (const pad of p.g.pads) {
      if (pad.shape === 'circle') {
        const d = (pad.w + grow * 2).toFixed(3)
        if (!circles.has(d)) circles.set(d, 10 + circles.size)
        body.push(`D${circles.get(d)}*`, `${xy(toBoard(pad, p.loc))}D03*`)
      } else {
        body.push(...rectRegion(pad.x, pad.y, pad.w + grow * 2, pad.h + grow * 2, p.loc.rot, p.loc))
      }
    }
  }
  for (const [d, code] of circles) lines.push(`%ADD${code}C,${d}*%`)
  return [...lines, ...body]
}

// A few traces so the render looks like a board (visual only).
const TRACES = [
  ['U1', 1, 'C4', 2], ['U1', 8, 'C3', 1], ['U1', 4, 'C6', 1], ['U1', 5, 'C8', 2],
  ['U2', 3, 'C2', 1], ['U2', 1, 'C1', 2], ['R3', 2, 'D1', 1], ['R4', 1, 'D2', 2], ['U1', 7, 'R4', 2],
  ['R1', 1, 'SW1', 1], ['U1', 6, 'R1', 2], ['C5', 1, 'U2', 2],
]
function padPos(ref, pin) {
  const p = parts.find((q) => q.ref === ref)
  return toBoard(p.g.pads.find((x) => x.pin === pin), p.loc)
}

const cu = padLayer('Copper,L1,Top', 0)
cu.push('%ADD20C,0.300*%', 'D20*')
for (const [a, pa, b, pb] of TRACES) {
  const s = padPos(a, pa)
  const e = padPos(b, pb)
  cu.push(`${xy(s)}D02*`, `${xy({ x: e.x, y: s.y })}D01*`, `${xy(e)}D01*`)
}
cu.push('M02*')

const mask = [...padLayer('Soldermask,Top', 0.05), 'M02*']
const paste = [...padLayer('Paste,Top', 0, false), 'M02*']
const bcu = [...header('Copper,L2,Bot'), '%ADD10C,1.700*%', '%ADD11R,1.700X1.700*%']
for (const p of parts.filter((q) => q.g.tht)) {
  for (const pad of p.g.pads) bcu.push(pad.shape === 'circle' ? 'D10*' : 'D11*', `${xy(toBoard(pad, p.loc))}D03*`)
}
bcu.push('M02*')

// Silkscreen: body outline, pin-1 dot, cathode bar, + sign.
const silk = [...header('Legend,Top'), '%ADD10C,0.150*%', '%ADD11C,0.500*%', 'D10*', 'G01*']
for (const p of parts) {
  const { w, h, cx, cy } = p.g.body
  const m = 0.25
  const c = [
    [cx - w / 2 - m, cy - h / 2 - m],
    [cx + w / 2 + m, cy - h / 2 - m],
    [cx + w / 2 + m, cy + h / 2 + m],
    [cx - w / 2 - m, cy + h / 2 + m],
  ].map(([x, y]) => toBoard({ x, y }, p.loc))
  silk.push(`${xy(c[0])}D02*`, ...c.slice(1).map((q) => `${xy(q)}D01*`), `${xy(c[0])}D01*`)
  const mk = p.g.mark
  if (!mk) continue
  if (mk.type === 'pin1') {
    const dot = toBoard({ x: cx - w / 2 - 0.8, y: cy + h / 2 + 0.4 }, p.loc)
    silk.push('D11*', `${xy(dot)}D03*`, 'D10*')
  } else if (mk.type === 'cathode' || mk.type === 'plus') {
    const x = cx - w / 2 - m - 0.35
    silk.push(`${xy(toBoard({ x, y: cy - h / 2 }, p.loc))}D02*`, `${xy(toBoard({ x, y: cy + h / 2 }, p.loc))}D01*`)
    if (mk.type === 'plus') {
      const px = cx - w / 2 - 1.1
      silk.push(`${xy(toBoard({ x: px - 0.4, y: cy + h / 2 + 0.6 }, p.loc))}D02*`, `${xy(toBoard({ x: px + 0.4, y: cy + h / 2 + 0.6 }, p.loc))}D01*`)
      silk.push(`${xy(toBoard({ x: px, y: cy + h / 2 + 0.2 }, p.loc))}D02*`, `${xy(toBoard({ x: px, y: cy + h / 2 + 1.0 }, p.loc))}D01*`)
    }
  }
}
silk.push('M02*')

const edge = [...header('Profile,NP'), '%ADD10C,0.100*%', 'D10*', 'G01*']
const corners = [
  [0, 0],
  [W, 0],
  [W, H],
  [0, H],
  [0, 0],
]
edge.push(`X${n(0)}Y${n(0)}D02*`, ...corners.slice(1).map(([x, y]) => `X${n(x)}Y${n(y)}D01*`), 'M02*')

const drills = parts.filter((q) => q.g.tht).flatMap((p) => p.g.pads.map((pad) => toBoard(pad, p.loc)))
const drl = ['M48', 'METRIC,TZ', 'T1C1.000', '%', 'G90', 'G05', 'T1', ...drills.map((d) => `X${d.x.toFixed(3)}Y${d.y.toFixed(3)}`), 'M30']

await mkdir(out, { recursive: true })
const files = {
  'demo-F_Cu.gbr': cu,
  'demo-B_Cu.gbr': bcu,
  'demo-F_Mask.gbr': mask,
  'demo-F_Paste.gbr': paste,
  'demo-F_Silkscreen.gbr': silk,
  'demo-Edge_Cuts.gbr': edge,
  'demo-PTH.drl': drl,
}
for (const [name, lines] of Object.entries(files)) await writeFile(join(out, name), lines.join('\n') + '\n')
console.log(`Wrote ${Object.keys(files).length} files to ${out}`)
