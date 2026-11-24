import { describe, it, expect } from 'vitest'
import { extractJson } from '../src/lib/ai/json.js'
import * as Verify from '../src/lib/ai/tasks/verify.js'
import * as Assistant from '../src/lib/ai/tasks/assistant.js'
import * as Order from '../src/lib/ai/tasks/orderPlan.js'
import { loadBoardFromText } from '../src/lib/bom/board.js'
import { demoBoardText } from '../src/data/demoBoard.js'
import { projectReducer, newProject } from '../src/state/projects.js'

const board = loadBoardFromText({ ...demoBoardText })
const project = projectReducer(newProject('t'), { type: 'load-board', board })

describe('json', () => {
  it('handles fences, prose and trailing commas', () => {
    expect(extractJson('Sure\n```json\n{"a":[1,2,],}\n```').value).toEqual({ a: [1, 2] })
    expect(extractJson('nope').ok).toBe(false)
  })
})

describe('placement check', () => {
  const pol = Verify.buildContext(board, 'D1', { canonical: true })
  const plain = Verify.buildContext(board, 'C3', { canonical: true, checkSoldering: false })
  it('tells the model where the mark must be in a rotated crop', () => {
    expect(pol.markWhere).toBe('left')
    expect(Verify.buildContext(board, 'U1', { canonical: true }).markWhere).toBe('top-left')
    expect(Verify.buildMessages(pol, 'data:x')[1].content[0].text).toMatch(/cathode|Cathode/)
  })
  it('never shows "no problem" at low confidence', () => {
    expect(Verify.validate({ orientation: 'correct', soldering: 'good', confidence: 'low', issues: [] }, pol).data.verdict).toBe('unclear')
  })
  it('listed issues force a problem; a flip forces orientation wrong', () => {
    const { data } = Verify.validate({ orientation: 'correct', soldering: 'good', confidence: 'high', issues: [{ type: 'flipped' }] }, pol)
    expect(data).toMatchObject({ verdict: 'problem', orientation: 'wrong' })
  })
  it('ignores solder issues when the soldering check is off, and flips on non-polarized parts', () => {
    const { data, issues } = Verify.validate({ orientation: 'wrong', soldering: 'problem', confidence: 'high', issues: [{ type: 'bridged' }, { type: 'flipped' }] }, plain)
    expect(data).toMatchObject({ verdict: 'ok', orientation: 'correct', soldering: 'not_checked' })
    expect(issues).toHaveLength(2)
  })
  it('simulated answers validate', () => {
    for (let i = 0; i < 4; i++) expect(() => Verify.validate(JSON.parse(Verify.simulate(pol)), pol)).not.toThrow()
  })
})

describe('assistant', () => {
  it('drops refs that are not on the board', () => {
    const { data, issues } = Assistant.validate({ action: 'move_next', refs: ['C8', 'Q9'], say: 'ok' }, project)
    expect(data.refs).toEqual(['C8'])
    expect(issues).toHaveLength(1)
  })
  it('turns an action without a valid target into "none"', () => {
    expect(Assistant.validate({ action: 'goto', ref: 'X1' }, project).data.action).toBe('none')
    expect(Assistant.validate({ action: 'category_next', category: 'Widgets' }, project).data.action).toBe('none')
  })
  it('matches categories by name and keeps only real library sources', () => {
    const { data } = Assistant.validate({ action: 'category_next', category: 'capacitors', say: 'ok', sources: ['braid-bridge', 'made-up'] }, project)
    expect(data.categoryId).toBe(project.plan.categories.find((c) => c.name === 'Capacitors').id)
    expect(data.sources).toEqual(['braid-bridge'])
  })
  it('prompt carries the board state and library', () => {
    const [sys, user] = Assistant.buildMessages('do the LEDs first', project)
    expect(sys.content).toMatch(/braid-bridge/)
    expect(user.content).toMatch(/Current part: U1/)
  })
  it('simulated answers validate', () => {
    for (const t of ['capacitors next', 'how do I fix a bridge']) expect(() => Assistant.validate(JSON.parse(Assistant.simulate(t, project)), project)).not.toThrow()
  })
})

describe('order suggestion', () => {
  it('simulated plan validates and covers every part', () => {
    const { data } = Order.validate(board, JSON.parse(Order.simulate(board)))
    expect(data.categories.flatMap((c) => c.refs)).toHaveLength(20)
  })
})
