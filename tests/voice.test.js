import { describe, it, expect } from 'vitest'
import { parseCommand, findRef, parseValue } from '../src/lib/voice/grammar.js'
import { encodeWav, downsample } from '../src/lib/voice/recorder.js'
import { loadBoardFromText } from '../src/lib/bom/board.js'
import { demoBoardText } from '../src/data/demoBoard.js'
import { defaultPlan } from '../src/lib/plan/plan.js'
import { solveCalibration, boardToImage, describeLocation } from '../src/lib/geometry/board.js'

const board = loadBoardFromText({ ...demoBoardText })
const plan = defaultPlan(board)
const cmd = (t) => parseCommand(t, board, plan)

describe('voice grammar', () => {
  it('finds refs however they are spelled', () => {
    expect(findRef('where is see eight', Object.keys(board.parts))).toBe('C8')
    expect(findRef('C 8', Object.keys(board.parts))).toBe('C8')
  })
  it('handles the simple controls', () => {
    expect(cmd('next').type).toBe('placed')
    expect(cmd('okay next').type).toBe('placed')
    expect(cmd('skip').type).toBe('skip')
    expect(cmd('undo').type).toBe('back')
    expect(cmd('looks good').type).toBe('confirm')
    expect(cmd('all done').type).toBe('review')
  })
  it('chooses what to place next', () => {
    expect(cmd('C8 next')).toEqual({ type: 'move-next', refs: ['C8'] })
    expect(cmd('do the LEDs next').type).toBe('category-next')
    expect(cmd('capacitors next').categoryId).toBe(plan.categories.find((c) => c.name === 'Capacitors').id)
    expect(cmd('go to U2')).toEqual({ type: 'jump', ref: 'U2' })
  })
  it('sends anything longer to the language model', () => {
    expect(cmd('next do the resistors before the LEDs').type).toBe('unknown')
    expect(cmd('how do I fix a bridge').type).toBe('unknown')
  })
  it('answers where-is questions', () => {
    expect(cmd('where is C8')).toEqual({ type: 'where', ref: 'C8' })
    expect(cmd('where are the 100 nanofarad').groups.map((g) => g.value)).toEqual(['100nF'])
    expect(parseValue('4k7').num).toBeCloseTo(4700)
  })
})

describe('audio', () => {
  it('encodes 16 kHz mono WAV', async () => {
    const pcm = downsample(new Float32Array(48000).fill(0.5), 48000)
    expect(pcm.length).toBe(16000)
    const wav = encodeWav(pcm)
    const head = new Uint8Array(await wav.arrayBuffer()).slice(0, 4)
    expect(String.fromCharCode(...head)).toBe('RIFF')
    expect(wav.size).toBe(44 + 16000 * 2)
  })
})

describe('geometry', () => {
  it('describes a location', () => {
    expect(describeLocation(board, 'C8')).toMatch(/C8 is at the .* of the top side/)
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
