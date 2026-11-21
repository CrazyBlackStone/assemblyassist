import { describe, it, expect } from 'vitest'
import { sessionReducer, initialSession, progress, groupInfo, nextPending, blocksAwaitingCheck } from '../src/state/session.js'
import { loadBoardFromText } from '../src/lib/bom/board.js'
import { demoBoardText } from '../src/data/demoBoard.js'
import { fallbackPlan, validatePlan, planSequence } from '../src/lib/plan/plan.js'

const board = loadBoardFromText({ ...demoBoardText })
const run = (actions, s = initialSession) => actions.reduce(sessionReducer, s)

describe('session', () => {
  it('starts on the first part of the default plan', () => {
    const s = run([{ type: 'load-board', board }])
    expect(s.current).toBe(planSequence(s.plan)[0])
    expect(s.plan.blocks[0].name).toMatch(/Chips/)
    expect(s.plan.blocks.at(-1).name).toMatch(/Connectors/)
  })
  it('marks, advances and undoes in one step', () => {
    let s = run([{ type: 'load-board', board }])
    const first = s.current
    s = sessionReducer(s, { type: 'mark', status: 'placed' })
    expect(s.status[first]).toBe('placed')
    expect(s.current).not.toBe(first)
    s = sessionReducer(s, { type: 'undo' })
    expect(s.status[first]).toBeUndefined()
    expect(s.current).toBe(first)
  })
  it('skips handled parts when advancing and wraps around', () => {
    const seq = ['A', 'B', 'C']
    expect(nextPending(seq, { B: 'placed' }, 'A')).toBe('C')
    expect(nextPending(seq, { A: 'skipped' }, 'C')).toBe('B')
    expect(nextPending(seq, { A: 'placed', B: 'placed', C: 'placed' }, 'A')).toBe(null)
  })
  it('tracks dropped parts against spares', () => {
    let s = run([{ type: 'load-board', board }, { type: 'jump', ref: 'C8' }, { type: 'dropped' }])
    expect(s.status.C8).toBe('dropped')
    expect(groupInfo(s, 'C8')).toMatchObject({ spares: 2, sparesUsed: 1, sparesLeft: 1 })
    expect(progress(s).dropped).toBe(1)
    s = sessionReducer(s, { type: 'mark', status: 'placed' })
    expect(s.status.C8).toBe('placed')
  })
  it('asks for a checkpoint when a block is complete', () => {
    let s = run([{ type: 'load-board', board }])
    for (const r of s.plan.blocks[0].refs) s = sessionReducer(s, { type: 'mark', ref: r, status: 'placed' })
    expect(blocksAwaitingCheck(s).map((b) => b.id)).toEqual([s.plan.blocks[0].id])
    s = sessionReducer(s, { type: 'block-check', blockId: s.plan.blocks[0].id, done: true })
    expect(blocksAwaitingCheck(s)).toEqual([])
  })
  it('assigns tray compartments in build order', () => {
    const s = run([{ type: 'load-board', board }, { type: 'auto-tray' }])
    expect(groupInfo(s, planSequence(s.plan)[0]).compartment).toBe(1)
  })
})

describe('plan validation', () => {
  it('drops invented parts, dedupes and collects missing parts', () => {
    const { plan, issues } = validatePlan(board, [
      { name: 'MCU', reason: 'x', refs: ['U1', 'C3', 'Z99'] },
      { name: 'Power', reason: 'y', refs: ['U2', 'c3', 'C1'] },
    ], 'ai')
    const all = planSequence(plan)
    expect(all).not.toContain('Z99')
    expect(all.filter((r) => r === 'C3')).toHaveLength(1)
    expect(new Set(all).size).toBe(20)
    expect(plan.blocks.at(-1).appAdded).toBe(true)
    expect(issues.length).toBe(3)
  })
  it('keeps identical parts together inside a block', () => {
    const { plan } = validatePlan(board, [{ name: 'All', refs: ['C3', 'R1', 'C4', 'R2'] }], 'ai')
    expect(plan.blocks[0].refs).toEqual(['C3', 'C4', 'R1', 'R2'])
  })
  it('fallback plan covers every part once', () => {
    const seq = planSequence(fallbackPlan(board))
    expect(seq).toHaveLength(20)
    expect(new Set(seq).size).toBe(20)
  })
})
