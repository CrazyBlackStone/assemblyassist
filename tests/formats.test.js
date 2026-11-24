import { describe, it, expect } from 'vitest'
import { identifyFile, canonicalName } from '../src/lib/gerber/identify.js'
import { parsePnp, loadBoardFromText } from '../src/lib/bom/board.js'
import { parseIpc356 } from '../src/lib/bom/ipc356.js'
import { packageGeometry, chipCode, ipc7351, CHIP_SIZES } from '../src/lib/bom/packages.js'
import { defaultPlan, defaultSideOrder, swapSides, sequenceOf, validatePlan } from '../src/lib/plan/plan.js'
import { sortFiles } from '../src/lib/gerber/render.js'

const GERBER = '%FSLAX55Y55*MOMM*%\n%IR0*IPPOS*%\nM02*\n'
const allegro = (layers) => `G04 File Origin:  Cadence Allegro 25.1*\n${layers.map((l) => `G04 Layer:  ${l}*`).join('\n')}\n${GERBER}`

describe('layer identification', () => {
  it('reads Cadence Allegro layer records, whatever the file is called', () => {
    expect(identifyFile('TOP.art', allegro(['VIA CLASS/TOP', 'PIN/TOP', 'ETCH/TOP']))).toEqual({ type: 'copper', side: 'top' })
    expect(identifyFile('x.art', allegro(['ETCH/BOTTOM']))).toEqual({ type: 'copper', side: 'bottom' })
    expect(identifyFile('GND02.art', allegro(['ETCH/GND02'])).type).toBe('inner')
    expect(identifyFile('SOLDER_TOP.art', allegro(['PIN/SOLDERMASK_TOP']))).toEqual({ type: 'soldermask', side: 'top' })
    expect(identifyFile('SILK_BOT.art', allegro(['REF DES/SILKSCREEN_BOTTOM']))).toEqual({ type: 'silkscreen', side: 'bottom' })
    expect(identifyFile('PASTE_TOP.art', allegro(['PIN/PASTEMASK_TOP']))).toEqual({ type: 'solderpaste', side: 'top' })
    expect(identifyFile('OUTLINE.gko', allegro(['BOARD GEOMETRY/DESIGN_OUTLINE'])).type).toBe('outline')
    expect(identifyFile('ASSYTP.art', allegro(['REF DES/ASSEMBLY_TOP', 'BOARD GEOMETRY/DESIGN_OUTLINE'])).type).toBe('assembly')
    expect(identifyFile('DRILL-1-6.art', allegro(['MANUFACTURING/NCLEGEND-1-6'])).type).toBe('drawing')
  })
  it('reads Gerber X2 file functions', () => {
    expect(identifyFile('a.gbr', '%TF.FileFunction,Copper,L1,Top*%\n' + GERBER)).toEqual({ type: 'copper', side: 'top' })
    expect(identifyFile('a.gbr', '%TF.FileFunction,Legend,Bot*%\n' + GERBER)).toEqual({ type: 'silkscreen', side: 'bottom' })
    expect(identifyFile('a.gbr', '%TF.FileFunction,Copper,L3,Inr*%\n' + GERBER).type).toBe('inner')
  })
  it('falls back to Altium, Eagle, KiCad and plain names', () => {
    for (const [name, type, side] of [
      ['b.GTL', 'copper', 'top'], ['b.GBO', 'silkscreen', 'bottom'], ['b.GM1', 'outline', null], ['b.sts', 'soldermask', 'bottom'],
      ['b-F_Paste.gbr', 'solderpaste', 'top'], ['b-Edge_Cuts.gbr', 'outline', null], ['Bottom Layer.gbr', 'copper', 'bottom'],
    ]) expect(identifyFile(name, GERBER)).toEqual({ type, side })
  })
  it('tells drill files from rout paths, and finds placement, BOM and netlist files', () => {
    expect(identifyFile('board-RoundHoles.TXT', 'M48\nMETRIC\nT1C0.3\n%\nT1\nX1Y1\nM30').type).toBe('drill')
    expect(identifyFile('b.rou', 'M48\nMETRIC\nT01\n%\nG90\nM16\nG00X1Y1\nM15\nG01X2Y2\nM30').type).toBe('rout')
    expect(identifyFile('place_txt.txt', 'VERSION = 2.0\nUUNITS = MILLIMETERS\n# refdes ! x\nJ1 ! 1').type).toBe('placement')
    expect(identifyFile('b.ipc', 'P  JOB   x\nP  UNITS CUST 1\n327N   J1 -1 A01X+000100Y+000100X0100Y0100R000 S1\n').type).toBe('netlist')
    expect(identifyFile('PickPlace for PCB1.csv', 'a,b').type).toBe('placement')
    expect(identifyFile('notes.txt', 'hello').type).toBe('ignore')
  })
  it('maps layers to names the renderer understands', () => {
    expect(canonicalName('copper', 'bottom', 3)).toBe('layer3.gbl')
    expect(canonicalName('inner', null, 1)).toBeNull()
    const sorted = sortFiles([{ name: 'a', type: 'copper', side: 'top' }, { name: 'p', type: 'placement' }, { name: 'r', type: 'rout' }])
    expect(sorted.gerbers).toHaveLength(1)
    expect(sorted.placement.name).toBe('p')
    expect(sorted.unused.map((f) => f.name)).toEqual(['r'])
  })
})

describe('placement files', () => {
  it('reads Allegro place_txt with mirrored (bottom) parts', () => {
    const txt = 'VERSION = 2.0\nUUNITS = MILLIMETERS\n\n#    refdes ! symbol_x ! symbol_y ! rotation ! mirror ! symbol_name ! embedded_layer\n#----\nJ1 ! 11.5750 ! 6.0000 ! 90 ! m ! USB_C_RECEPTACLE !\nU3 ! 2.0 ! 3.5 ! 270 ! ! SOIC127P600X175-8N !\n'
    const { locations } = parsePnp(txt)
    expect(locations.J1).toMatchObject({ x: 11.575, y: 6, rot: 90, side: 'bottom', pkg: 'USB_C_RECEPTACLE' })
    expect(locations.U3.side).toBe('top')
  })
  it('converts mils', () => {
    const { locations, units } = parsePnp('Designator,Mid X,Mid Y,Layer,Rotation\nR1,1000mil,500mil,BottomLayer,90\n')
    expect(units).toBe('mil')
    expect(locations.R1.x).toBeCloseTo(25.4)
    expect(locations.R1.side).toBe('bottom')
  })
  it("reads Altium's space-separated text export", () => {
    const txt = 'Altium Designer Pick and Place Locations\nUnits used: mm\n\nDesignator Footprint Mid X Mid Y Ref X Ref Y Pad X Pad Y TB Rotation Comment\nC1 0805 10.0mm 5.0mm 10.0mm 5.0mm 9.0mm 5.0mm T 90 100nF 50V\n'
    const { locations } = parsePnp(txt)
    expect(locations.C1).toMatchObject({ x: 10, y: 5, rot: 90, side: 'top', pkg: '0805' })
  })
  it('builds a board from the placement file alone', () => {
    const b = loadBoardFromText({ pnpText: 'Ref,Val,Package,PosX,PosY,Rot,Side\nC1,100nF,C_0603_1608Metric,1,1,0,top\nC2,100nF,C_0603_1608Metric,3,1,0,top\n' })
    expect(b.groups).toHaveLength(1)
    expect(b.parts.C1.size.code).toBe('0603')
  })
})

describe('IPC-356 netlist', () => {
  const ipc = [
    'P  JOB   test',
    'P  UNITS CUST 1',
    '327USB0_DP          J2    -23         A01X+003185Y+002700X0220Y0520R270 S1      ',
    '317USB0_DP          VIA   -    MD0200PA00X+003785Y+002568X0400Y0400     S0      ',
    '317USB0_DP          J1    -B6   D0400PA00X+008800Y+005600X0600Y0600R090 S3      ',
    '327USB0_DP          J1    -A6         A06X+007875Y+006200X0230Y0850R090 S2      ',
    '327GND              J2    -1          A01X+003185Y+001500X0220Y0520R270 S1      ',
  ].join('\n')
  it('reads pads in mm with their side, skipping vias', () => {
    const { pads } = parseIpc356(ipc)
    expect(Object.keys(pads).sort()).toEqual(['J1', 'J2'])
    expect(pads.J2[0]).toMatchObject({ pin: '23', x: 3.185, y: 2.7, side: 'top' })
    expect(pads.J2[0].w).toBeCloseTo(0.52) // turned 270°: size swapped to board axes
    expect(pads.J1.find((p) => p.pin === 'A6').side).toBe('bottom')
    expect(pads.J1.find((p) => p.pin === 'B6')).toMatchObject({ side: 'both', drill: 0.4 })
  })
  it('sizes an unknown part from its real pads', () => {
    const { pads } = parseIpc356(ipc)
    const part = { ref: 'J2', footprint: 'HRS_DF56C-26S', loc: { x: 1.975, y: 2.1, rot: 270, side: 'top' }, pads: pads.J2, polarity: { polarized: false } }
    const g = packageGeometry(part)
    expect(g.real).toBe(true)
    expect(g.style).toBe('fpc')
    expect(g.mark?.type).toBe('pin1')
  })
})

describe('package sizes', () => {
  it('knows every EIA chip size, imperial or metric', () => {
    expect(Object.keys(CHIP_SIZES)).toHaveLength(18)
    expect(chipCode('R_0402_1005Metric')).toBe('0402')
    expect(chipCode('C_3216Metric')).toBe('1206')
    expect(chipCode('Capacitor_SMD:C_2220_5750Metric')).toBe('2220')
  })
  it('makes high-value MLCCs thicker', () => {
    const h = (value, fp = 'C_0805_2012Metric') => packageGeometry({ ref: 'C1', footprint: fp, value, polarity: {} }).height
    expect(h('1nF')).toBe(0.6)
    expect(h('100nF')).toBe(0.85)
    expect(h('10uF')).toBe(1.25)
    expect(h('22u', 'C_1210_3225Metric')).toBe(2.5)
  })
  it('reads IPC-7351 names', () => {
    expect(ipc7351('RESC1608X55N')).toMatchObject({ kind: 'chip', L: 1.6, W: 0.8, H: 0.55 })
    expect(ipc7351('SOIC127P600X175-8N')).toMatchObject({ kind: 'soic', pitch: 1.27, span: 6, H: 1.75, pins: 8 })
    expect(ipc7351('QFN50P400X400X100-21N')).toMatchObject({ kind: 'qfn', L: 4, H: 1, pins: 21 })
    expect(packageGeometry({ ref: 'U1', footprint: 'SOT95P280X145-5N', polarity: {} }).pads).toHaveLength(5)
  })
  it('sizes tantalum cases and through-hole parts', () => {
    const g = (ref, fp) => packageGeometry({ ref, footprint: fp, polarity: { polarized: ref.startsWith('C'), marking: 'tantalum' } })
    expect(g('C1', 'CP_Tantalum_Case-D').height).toBe(3.1)
    expect(g('C1', 'CP_EIA-3528-21_Kemet-B').height).toBe(2.1)
    expect(g('R1', 'R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal')).toMatchObject({ family: 'axial', tht: true })
    expect(g('C2', 'CP_Radial_D8.0mm_P3.50mm').height).toBe(11.5)
  })
})

describe('front and back', () => {
  const board = loadBoardFromText({
    pnpText: 'Ref,Val,Package,PosX,PosY,Rot,Side\nC1,100nF,C_0603_1608Metric,1,1,0,top\nJ1,USB,USB_C_Receptacle,5,5,0,top\nR1,1k,R_0402_1005Metric,3,3,0,bottom\nR2,1k,R_0402_1005Metric,4,3,0,bottom\n',
  })
  it('builds the back first when it has only low parts and the front has tall ones', () => {
    expect(defaultSideOrder(board)).toEqual(['bottom', 'top'])
    const plan = defaultPlan(board)
    expect(sequenceOf(plan).slice(0, 2)).toEqual(['R1', 'R2'])
    expect(plan.categories.every((c) => c.side)).toBe(true)
  })
  it('swaps sides and keeps categories on one side', () => {
    const plan = swapSides(board, defaultPlan(board))
    expect(sequenceOf(plan)[0]).toBe('C1')
    const { plan: p2, issues } = validatePlan(board, [{ name: 'All', refs: ['C1', 'R1', 'J1', 'R2'] }], 'ai')
    expect(p2.categories.map((c) => c.side)).toEqual(['bottom', 'top'])
    expect(issues.join(' ')).toMatch(/Split/)
  })
})
