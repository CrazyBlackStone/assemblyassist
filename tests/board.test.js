import { describe, it, expect } from 'vitest'
import { expandRefs, compareRefs } from '../src/lib/bom/refs.js'
import { describeFootprint } from '../src/lib/bom/footprint.js'
import { detectPolarity } from '../src/lib/bom/polarity.js'
import { parseNumber } from '../src/lib/bom/csv.js'
import { loadBoardFromText, parseBom, parsePnp, BoardFileError } from '../src/lib/bom/board.js'
import { demoBoardText } from '../src/data/demoBoard.js'

describe('refs', () => {
  it('expands lists and ranges', () => {
    expect(expandRefs('C1, C2 C3;C4').refs).toEqual(['C1', 'C2', 'C3', 'C4'])
    expect(expandRefs('R1-R4').refs).toEqual(['R1', 'R2', 'R3', 'R4'])
    expect(expandRefs('R7 - 9').refs).toEqual(['R7', 'R8', 'R9'])
    expect(expandRefs('r1-c3').problems.length).toBe(1)
  })
  it('sorts naturally', () => {
    expect(['C10', 'C2', 'R1', 'C1'].sort(compareRefs)).toEqual(['C1', 'C2', 'C10', 'R1'])
  })
})

describe('footprints and polarity', () => {
  it('describes common packages', () => {
    expect(describeFootprint('Capacitor_SMD:C_0805_2012Metric').code).toBe('0805')
    expect(describeFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm').code).toBe('SOIC-8')
    expect(describeFootprint('R_0402_1005Metric').tiny).toBe(true)
    expect(describeFootprint('Connector_PinHeader_2.54mm:PinHeader_2x03_P2.54mm_Vertical').label).toMatch(/2×3/)
  })
  it('detects polarity from refs, footprints and overrides', () => {
    expect(detectPolarity({ ref: 'D1', footprint: 'LED_0805' }).marking).toBe('cathode')
    expect(detectPolarity({ ref: 'U3', footprint: 'SOIC-8' }).marking).toBe('pin1')
    expect(detectPolarity({ ref: 'C1', footprint: 'Capacitor_Tantalum_SMD:CP_EIA-3216-18_Kemet-A' }).marking).toBe('tantalum')
    expect(detectPolarity({ ref: 'C9', footprint: 'Capacitor_SMD:CP_Elec_5x5.4' }).marking).toBe('electrolytic')
    expect(detectPolarity({ ref: 'C3', footprint: 'C_0805' }).polarized).toBe(false)
    expect(detectPolarity({ ref: 'C3', footprint: 'C_0805', override: true }).polarized).toBe(true)
    expect(detectPolarity({ ref: 'D1', footprint: 'LED_0805', override: false }).polarized).toBe(false)
  })
  it('parses numbers with units', () => {
    expect(parseNumber('12.5mm')).toBe(12.5)
    expect(parseNumber('-3,25')).toBe(-3.25)
    expect(parseNumber('90deg')).toBe(90)
    expect(Number.isNaN(parseNumber(''))).toBe(true)
  })
})

describe('board loading', () => {
  const board = loadBoardFromText({ ...demoBoardText, source: 'demo' })
  it('loads the demo board with locations', () => {
    expect(Object.keys(board.parts)).toHaveLength(20)
    expect(board.excluded).toEqual(['R5'])
    expect(board.hasLocations).toBe(true)
    expect(board.warnings).toEqual([])
    const caps = board.groups.find((g) => g.value === '100nF')
    expect(caps.refs).toEqual(['C3', 'C4', 'C5', 'C6', 'C7', 'C8'])
    expect(caps.spares).toBe(2)
    expect(board.parts.C8.loc).toMatchObject({ x: 20, y: 9, rot: 0, side: 'top' })
  })
  it('gives a stable id for the same board', () => {
    expect(loadBoardFromText({ ...demoBoardText }).id).toBe(board.id)
  })
  it('handles per-ref BOM rows and semicolon CSV', () => {
    const b = loadBoardFromText({ bomText: 'Designator;Comment;Footprint\nR1;10k;0603\nR2;10k;0603\nU1;LM358;SOIC-8\n' })
    expect(b.groups).toHaveLength(2)
    expect(b.groups[0].refs).toEqual(['R1', 'R2'])
  })
  it('rejects a BOM without a reference column', () => {
    expect(() => parseBom('Value,Footprint\n10k,0603')).toThrow(BoardFileError)
  })
  it('reads KiCad ASCII .pos files', () => {
    const pos = `### Module positions\n## Unit = mm, Angle = deg.\n# Ref     Val       Package          PosX       PosY       Rot  Side\nC1        100nF     C_0805           10.0000    -5.0000    90.0000  top\nU1        LM358     SOIC-8           20.0000    -8.5000   180.0000  bottom\n## End\n`
    const { locations } = parsePnp(pos)
    expect(locations.C1).toMatchObject({ x: 10, y: -5, rot: 90, side: 'top', pkg: 'C_0805', val: '100nF' })
    expect(locations.U1.side).toBe('bottom')
  })
  it('warns about PnP mismatches', () => {
    const b = loadBoardFromText({ bomText: 'Ref,Value,Footprint\nR1,1k,0603\nR2,1k,0603', pnpText: 'Ref,PosX,PosY\nR1,1,1\nR9,2,2' })
    expect(b.warnings.join(' ')).toMatch(/R2/)
    expect(b.warnings.join(' ')).toMatch(/R9/)
  })
})

describe('real-world BOM exports', () => {
  it('reads KiCad 8 "Refs" exports', () => {
    const b = loadBoardFromText({ bomText: '"Refs","Value","Footprint","${QUANTITY}","${DNP}"\n"C1,C2","10uF","Capacitor_SMD:C_0805_2012Metric","2",""\n"R1","1k","Resistor_SMD:R_0603_1608Metric","1","DNP"\n' })
    expect(Object.keys(b.parts)).toEqual(['C1', 'C2'])
    expect(b.excluded).toEqual(['R1'])
  })
  it('skips title lines above the header (KiCad legacy BOM script)', () => {
    const text = [
      'Source:,/home/me/board.kicad_sch',
      'Date:,Mon 01 Jan 2026',
      'Tool:,Eeschema 8.0',
      'Generator:,bom_csv_grouped_by_value',
      'Component Count:,3',
      '',
      'Collated Components:',
      '',
      'Item,Qty,Reference(s),Value,LibPart,Footprint,Datasheet',
      '1,2,"C1, C2",100nF,Device:C,Capacitor_SMD:C_0805_2012Metric,~',
      '2,1,"U1",LM358,Amplifier:LM358,Package_SO:SOIC-8_3.9x4.9mm_P1.27mm,~',
    ].join('\n')
    const b = loadBoardFromText({ bomText: text })
    expect(Object.keys(b.parts).sort()).toEqual(['C1', 'C2', 'U1'])
    expect(b.warnings.join(' ')).toMatch(/Skipped \d+ title line/)
  })
  it('explains Excel files instead of failing silently', () => {
    expect(() => loadBoardFromText({ bomText: 'PK\u0003\u0004 binary xlsx' })).toThrow(/Excel/)
  })
  it('says which file failed', () => {
    expect(() => loadBoardFromText({ bomText: 'Value\n10k' })).toThrow(/^BOM file:/)
    expect(() => loadBoardFromText({ bomText: 'Ref,Value\nR1,1k', pnpText: 'Ref,Rot\nR1,90' })).toThrow(/^Pick-and-place file:/)
  })
})
