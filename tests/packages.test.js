import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { packageGeometry, packageExtent, markDirection } from '../src/lib/bom/packages.js'
import { detectPolarity } from '../src/lib/bom/polarity.js'
import { read } from '@tracespace/core'
import { renderRead, alignToRender, fallbackRender } from '../src/lib/gerber/render.js'
import { loadBoardFromText } from '../src/lib/bom/board.js'
import { demoBoardText } from '../src/data/demoBoard.js'

const part = (ref, footprint) => ({ ref, footprint, polarity: detectPolarity({ ref, footprint }) })

describe('package geometry', () => {
  it('builds SOIC-8 with pin 1 top-left', () => {
    const g = packageGeometry(part('U1', 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'))
    expect(g.pads).toHaveLength(8)
    const p1 = g.pads.find((p) => p.pin === 1)
    expect(p1.x).toBeLessThan(0)
    expect(p1.y).toBeGreaterThan(0)
    expect(markDirection(g, 0)).toBe('top-left')
    expect(markDirection(g, 180)).toBe('bottom-right')
  })
  it('puts the cathode on the left and turns it with the part', () => {
    const g = packageGeometry(part('D1', 'LED_SMD:LED_0805_2012Metric'))
    expect(g.mark.type).toBe('cathode')
    expect(markDirection(g, 0)).toBe('left')
    expect(markDirection(g, 90)).toBe('bottom')
    expect(markDirection(g, 270)).toBe('top')
  })
  it('headers have their origin on pin 1', () => {
    const g = packageGeometry(part('J2', 'Connector_PinHeader_2.54mm:PinHeader_2x03_P2.54mm_Vertical'))
    expect(g.pads).toHaveLength(6)
    expect(g.pads[0]).toMatchObject({ x: 0, y: 0, shape: 'rect' })
    expect(packageExtent(g).w).toBeGreaterThan(4)
  })
  it('non-polarized passives have no mark', () => {
    expect(packageGeometry(part('R1', 'R_0603_1608Metric')).mark).toBeNull()
  })
})

describe('gerber render', () => {
  const dir = 'src/data/demo/gerbers'
  const paths = readdirSync(dir).map((name) => `${dir}/${name}`)
  const render = async () => renderRead(await read(paths))
  const board = loadBoardFromText({ ...demoBoardText })
  it('renders the demo board top side at 40 × 30 mm', async () => {
    const r = await render()
    expect(r.size.w).toBeCloseTo(40, 0)
    expect(r.size.h).toBeCloseTo(30, 0)
    expect(r.svg).toMatch(/^<svg/)
    expect(r.hasOutline).toBe(true)
    expect(alignToRender(board, r).note).toBeNull()
  })
  it('re-centres a pick-and-place file with a different origin', async () => {
    const r = await render()
    const shifted = { ...board, parts: Object.fromEntries(Object.entries(board.parts).map(([k, p]) => [k, { ...p, loc: { ...p.loc, x: p.loc.x + 100, y: p.loc.y + 80 } }])) }
    const { board: fixed, note } = alignToRender(shifted, r)
    expect(note).toMatch(/centred/)
    expect(Math.abs(fixed.parts.U1.loc.x - board.parts.U1.loc.x)).toBeLessThan(2)
  })
  it('rejects files that are not Gerbers', async () => {
    await expect(renderRead({ layers: [{ id: 'x', filename: 'notes.txt', type: null }], parseTreesById: {} })).rejects.toThrow(/look like Gerber/)
  })
  it('falls back to an outline around the parts', () => {
    const r = fallbackRender(board)
    expect(r.svg).toBeNull()
    expect(r.size.w).toBeGreaterThan(30)
  })
})
