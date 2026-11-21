import { describe, it, expect } from 'vitest'
import { extractJson } from '../src/lib/ai/json.js'
import * as Vision from '../src/lib/ai/tasks/visionCheck.js'
import * as Fix from '../src/lib/ai/tasks/fixHelp.js'
import * as Plan from '../src/lib/ai/tasks/buildPlan.js'
import { loadBoardFromText } from '../src/lib/bom/board.js'
import { demoBoardText } from '../src/data/demoBoard.js'
import { neighbors } from '../src/lib/geometry/board.js'

const board = loadBoardFromText({ ...demoBoardText })

describe('json extraction', () => {
  it('handles fences, prose and trailing commas', () => {
    expect(extractJson('Sure!\n```json\n{"a": [1,2,],}\n```').value).toEqual({ a: [1, 2] })
    expect(extractJson('nope').ok).toBe(false)
  })
})

describe('vision check validation', () => {
  it('never lets low-confidence "looks right" through', () => {
    const { data } = Vision.validate({ verdict: 'looks_right', confidence: 'low', observed: 'x', issues: [] })
    expect(data.verdict).toBe('cant_tell')
    expect(data.retakeAdvice).toBeTruthy()
  })
  it('turns "looks right" with issues into a possible problem', () => {
    const { data, issues } = Vision.validate({ verdict: 'Looks Right', confidence: 'high', issues: [{ type: 'bridge', where: 'pins 2-3' }] })
    expect(data.verdict).toBe('possible_problem')
    expect(data.issues[0].type).toBe('other')
    expect(issues.length).toBe(1)
  })
  it('accepts a clean bridged result', () => {
    const { data } = Vision.validate({ verdict: 'possible_problem', confidence: 'medium', observed: 'blob', issues: [{ type: 'bridged', where: 'pins 3-4' }] })
    expect(data.issues[0]).toMatchObject({ type: 'bridged', where: 'pins 3-4' })
  })
  it('builds context from board data only', () => {
    const ctx = Vision.buildContext(board, 'U1', neighbors(board, 'U1'))
    expect(ctx).toMatchObject({ ref: 'U1', value: 'ATtiny85-20SU', polarized: true, marking: 'Pin 1' })
    expect(ctx.neighbors.length).toBeGreaterThan(0)
    const msgs = Vision.buildMessages(ctx, 'data:image/jpeg;base64,xx')
    expect(msgs[1].content[1].type).toBe('image_url')
  })
  it('simulated outputs validate', () => {
    const ctx = Vision.buildContext(board, 'D1', [])
    for (let i = 0; i < 4; i++) expect(() => Vision.validate(JSON.parse(Vision.simulate(ctx)))).not.toThrow()
  })
})

describe('fix help validation', () => {
  it('drops steps that cite entries outside the library', () => {
    const { data, issues } = Fix.validate('bridged', {
      steps: [{ text: 'Add flux', entry_id: 'flux-first' }, { text: 'Use a heat gun at 400C', entry_id: 'made-up' }],
      check: 'continuity', check_entry_id: 'braid-bridge',
    })
    expect(data.steps).toHaveLength(1)
    expect(data.entryIds).toEqual(['flux-first', 'braid-bridge'])
    expect(issues.length).toBe(1)
  })
  it('rejects output with no valid citations', () => {
    expect(() => Fix.validate('bridged', { steps: [{ text: 'x', entry_id: 'nope' }] })).toThrow()
  })
  it('every library entry is well formed and every issue type has an entry', () => {
    for (const e of Fix.entries) {
      expect(e.id && e.title && e.steps.length && e.check).toBeTruthy()
    }
    for (const t of Vision.ISSUE_TYPES) expect(Fix.candidatesFor(t).length).toBeGreaterThan(0)
  })
  it('simulated output validates', () => {
    const ctx = Vision.buildContext(board, 'U1', [])
    for (const t of ['bridged', 'flipped', 'missing', 'other']) {
      expect(() => Fix.validate(t, JSON.parse(Fix.simulate(ctx, { type: t, where: '' })))).not.toThrow()
    }
  })
})

describe('build plan task', () => {
  it('prompt lists every part and simulated plan validates', () => {
    const user = Plan.buildMessages(board)[1].content
    for (const r of Object.keys(board.parts)) expect(user).toContain(`${r} |`)
    const { data } = Plan.validate(board, JSON.parse(Plan.simulate(board)))
    expect(data.blocks.flatMap((b) => b.refs)).toHaveLength(20)
  })
})
