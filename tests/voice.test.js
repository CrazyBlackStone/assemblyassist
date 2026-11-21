import { describe, it, expect } from 'vitest'
import { parseCommand, findRef, parseValue } from '../src/lib/voice/grammar.js'
import { loadBoardFromText } from '../src/lib/bom/board.js'
import { demoBoardText } from '../src/data/demoBoard.js'
import { solveCalibration, boardToImage, describeLocation } from '../src/lib/geometry/board.js'

const board = loadBoardFromText({ ...demoBoardText })
const refs = Object.keys(board.parts)

describe('voice grammar', () => {
  it('finds references however the recognizer spells them', () => {
    expect(findRef('where is c8', refs)).toBe('C8')
    expect(findRef('where is C 8', refs)).toBe('C8')
    expect(findRef('where is see eight', refs)).toBe('C8')
    expect(findRef('jump to are four', refs)).toBe('R4')
    expect(findRef('where is c 99', refs)).toBe(null)
  })
  it('parses the brief’s commands', () => {
    expect(parseCommand('next', board).type).toBe('placed')
    expect(parseCommand('back', board).type).toBe('back')
    expect(parseCommand('where is C8?', board)).toEqual({ type: 'where', ref: 'C8' })
    expect(parseCommand('what value is this', board).type).toBe('value')
    expect(parseCommand('I dropped it', board)).toEqual({ type: 'dropped', ref: null })
    expect(parseCommand('I dropped C8', board)).toEqual({ type: 'dropped', ref: 'C8' })
    expect(parseCommand('check this', board).type).toBe('check')
    expect(parseCommand('skip', board).type).toBe('skip')
    expect(parseCommand('banana', board).type).toBe('unknown')
  })
  it('answers "where are the 100nF capacitors" by value', () => {
    for (const t of ['where are the 100nF capacitors', 'where are the 100 nanofarad', 'where are the 0.1 micro farad caps']) {
      const c = parseCommand(t, board)
      expect(c.type).toBe('where-value')
      expect(c.groups.map((g) => g.value)).toEqual(['100nF'])
    }
    expect(parseCommand('where are the 10k resistors', board).groups.map((g) => g.value)).toEqual(['10k'])
  })
  it('parses engineering values', () => {
    expect(parseValue('4k7').num).toBeCloseTo(4700)
    expect(parseValue('100nF')).toMatchObject({ unit: 'F' })
    expect(parseValue('100nF').num).toBeCloseTo(1e-7)
  })
})

describe('geometry', () => {
  it('describes a location from PnP data', () => {
    expect(describeLocation(board, 'C8', 3)).toMatch(/C8 is at the .* of the top side.*compartment 3/)
  })
  it('two-point calibration maps both points back exactly', () => {
    const pairs = [
      { board: { x: 0, y: 0 }, image: { x: 0.2, y: 0.8 } },
      { board: { x: 40, y: 30 }, image: { x: 0.8, y: 0.2 } },
    ]
    const cal = solveCalibration(pairs, 16 / 9)
    for (const p of pairs) {
      const q = boardToImage(cal, p.board)
      expect(q.x).toBeCloseTo(p.image.x)
      expect(q.y).toBeCloseTo(p.image.y)
    }
  })
})
