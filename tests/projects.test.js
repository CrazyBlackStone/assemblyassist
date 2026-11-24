import { describe, it, expect } from 'vitest'
import { projectReducer, newProject, nextPending, progress, nextAfterCurrent } from '../src/state/projects.js'
import { loadBoardFromText } from '../src/lib/bom/board.js'
import { demoBoardText } from '../src/data/demoBoard.js'
import { defaultPlan, validatePlan, sequenceOf, moveRefs, moveCategory } from '../src/lib/plan/plan.js'

const board = loadBoardFromText({ ...demoBoardText })
const run = (actions, p = newProject('t')) => actions.reduce(projectReducer, p)

describe('project reducer', () => {
  it('starts on the first part of the default order', () => {
    const p = run([{ type: 'load-board', board }])
    expect(p.current).toBe('U1')
    expect(p.plan.categories.map((c) => c.name)).toEqual(['Chips', 'Capacitors', 'Resistors', 'Diodes & LEDs', 'Other', 'Connectors'])
  })
  it('marks, advances and undoes in one step', () => {
    let p = run([{ type: 'load-board', board }, { type: 'mark', status: 'placed' }])
    expect(p.status.U1).toBe('placed')
    expect(p.current).toBe('U2')
    p = projectReducer(p, { type: 'undo' })
    expect(p.status.U1).toBeUndefined()
    expect(p.current).toBe('U1')
  })
  it('moves parts and categories to right after the current part', () => {
    let p = run([{ type: 'load-board', board }, { type: 'move-next', refs: ['C8'] }])
    expect(nextAfterCurrent(p)).toBe('C8')
    const leds = p.plan.categories.find((c) => c.name === 'Diodes & LEDs')
    p = projectReducer(p, { type: 'move-category-next', categoryId: leds.id })
    expect(p.plan.categories[1].name).toBe('Diodes & LEDs')
    p = projectReducer(p, { type: 'undo' })
    expect(p.plan.categories[1].name).not.toBe('Diodes & LEDs')
  })
  it('records verifications and progress', () => {
    const p = run([{ type: 'load-board', board }, { type: 'mark', status: 'placed' }, { type: 'verification', ref: 'U1', result: { verdict: 'ok' } }, { type: 'verification', ref: 'U1', result: { user: 'ok' } }])
    expect(p.verifications.U1).toMatchObject({ verdict: 'ok', user: 'ok' })
    expect(progress(p)).toMatchObject({ total: 20, placed: 1, pending: 19 })
  })
  it('nextPending wraps and ends', () => {
    expect(nextPending(['A', 'B', 'C'], { B: 'placed' }, 'A')).toBe('C')
    expect(nextPending(['A', 'B'], { A: 'placed', B: 'skipped' }, 'A')).toBe(null)
  })
})

describe('plan', () => {
  it('default plan covers every part once', () => {
    const seq = sequenceOf(defaultPlan(board))
    expect(new Set(seq).size).toBe(20)
  })
  it('validatePlan drops invented parts, dedupes, and collects the rest', () => {
    const { plan, issues } = validatePlan(board, [{ name: 'A', refs: ['U1', 'Z9', 'C3'] }, { name: 'B', refs: ['c3', 'U2'] }], 'ai')
    const seq = sequenceOf(plan)
    expect(seq).not.toContain('Z9')
    expect(new Set(seq).size).toBe(20)
    expect(plan.categories.at(-1).appAdded).toBe(true)
    expect(issues).toHaveLength(3)
  })
  it('moveRefs / moveCategory keep every part', () => {
    const plan = defaultPlan(board)
    const a = moveRefs(plan, ['J2', 'D1'], 'U1')
    expect(sequenceOf(a).slice(0, 3)).toEqual(['U1', 'J2', 'D1'])
    expect(new Set(sequenceOf(a)).size).toBe(20)
    const b = moveCategory(plan, plan.categories.at(-1).id, 'U1')
    expect(b.categories[1].name).toBe('Connectors')
  })
})
