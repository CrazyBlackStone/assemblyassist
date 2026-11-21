import { createStore } from '../lib/store.js'
import { fallbackPlan, planSequence, blockOf } from '../lib/plan/plan.js'

// The build session: which board, the plan, part status, undo history.
// Persisted to localStorage so a refresh never loses progress. Contains no AI output
// except the accepted plan's block names/reasons (stored with their AI label).

export const STATUS = { placed: 'placed', skipped: 'skipped', dropped: 'dropped' }

const HISTORY_LIMIT = 100

export const initialSession = {
  board: null,
  plan: null, // { source: 'default'|'ai'|'simulated', model?, blocks: [{id,name,reason,refs}] }
  status: {}, // ref -> 'placed' | 'skipped' | 'dropped'
  orientationOk: {}, // ref -> true once the user confirmed a polarized part's orientation
  dropCount: {}, // ref -> times dropped (spares used)
  tray: {}, // groupId -> compartment number
  blockChecks: {}, // blockId -> { multimeter: true }
  checks: {}, // ref -> { user: 'ok'|'problem', ai: verdict|null, at } (the user's own confirmation)
  current: null,
  history: [], // [{ label, snapshot }]
  startedAt: null,
}

function snapshot(s) {
  return { status: s.status, orientationOk: s.orientationOk, dropCount: s.dropCount, current: s.current, blockChecks: s.blockChecks, checks: s.checks }
}

function withHistory(s, label) {
  const history = [...s.history, { label, snapshot: snapshot(s) }].slice(-HISTORY_LIMIT)
  return { ...s, history }
}

const isPending = (status, ref) => !status[ref] || status[ref] === STATUS.dropped

/** Next part still to place after `fromRef`, wrapping around. Null when everything is handled. */
export function nextPending(sequence, status, fromRef) {
  const start = Math.max(0, sequence.indexOf(fromRef))
  for (let k = 1; k <= sequence.length; k++) {
    const ref = sequence[(start + k) % sequence.length]
    if (isPending(status, ref)) return ref
  }
  return null
}

export function sessionReducer(s, action) {
  switch (action.type) {
    case 'load-board': {
      const plan = fallbackPlan(action.board)
      const seq = planSequence(plan)
      return { ...initialSession, board: action.board, plan, current: seq[0] ?? null, startedAt: Date.now() }
    }
    case 'clear':
      return initialSession
    case 'set-plan': {
      if (!s.board) return s
      const seq = planSequence(action.plan)
      const current = s.current && seq.includes(s.current) && isPending(s.status, s.current)
        ? s.current
        : seq.find((r) => isPending(s.status, r)) ?? null
      return { ...s, plan: action.plan, current }
    }
    case 'move-block': {
      const blocks = [...s.plan.blocks]
      const i = blocks.findIndex((b) => b.id === action.blockId)
      const j = i + action.delta
      if (i < 0 || j < 0 || j >= blocks.length) return s
      ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
      return { ...s, plan: { ...s.plan, blocks, reordered: true } }
    }
    case 'mark': {
      const ref = action.ref ?? s.current
      if (!ref || !s.board?.parts[ref]) return s
      const h = withHistory(s, `${ref} marked ${action.status}`)
      const status = { ...s.status, [ref]: action.status }
      const seq = planSequence(s.plan)
      const current = action.stay ? ref : nextPending(seq, status, ref)
      return { ...h, status, current }
    }
    case 'dropped': {
      const ref = action.ref ?? s.current
      if (!ref || !s.board?.parts[ref]) return s
      const h = withHistory(s, `${ref} dropped`)
      return {
        ...h,
        status: { ...s.status, [ref]: STATUS.dropped },
        orientationOk: { ...s.orientationOk, [ref]: false },
        dropCount: { ...s.dropCount, [ref]: (s.dropCount[ref] ?? 0) + 1 },
        current: ref,
      }
    }
    case 'confirm-orientation': {
      const ref = action.ref ?? s.current
      if (!ref) return s
      const h = withHistory(s, `${ref} orientation confirmed`)
      return { ...h, orientationOk: { ...s.orientationOk, [ref]: true } }
    }
    case 'undo': {
      if (s.history.length === 0) return s
      const last = s.history[s.history.length - 1]
      return { ...s, ...last.snapshot, history: s.history.slice(0, -1) }
    }
    case 'jump':
      return s.board?.parts[action.ref] ? { ...s, current: action.ref } : s
    case 'step': {
      const seq = planSequence(s.plan)
      const i = seq.indexOf(s.current)
      const j = Math.min(seq.length - 1, Math.max(0, i + action.delta))
      return { ...s, current: seq[j] ?? s.current }
    }
    case 'set-tray':
      return { ...s, tray: { ...s.tray, [action.groupId]: action.compartment } }
    case 'auto-tray': {
      const tray = {}
      const order = []
      for (const ref of planSequence(s.plan)) {
        const g = s.board.parts[ref].group
        if (!order.includes(g)) order.push(g)
      }
      order.forEach((g, i) => (tray[g] = i + 1))
      return { ...s, tray }
    }
    case 'clear-tray':
      return { ...s, tray: {} }
    case 'record-check': {
      const h = withHistory(s, `${action.ref} check recorded`)
      return { ...h, checks: { ...s.checks, [action.ref]: { user: action.user, ai: action.ai ?? null, issue: action.issue ?? null, at: Date.now() } } }
    }
    case 'block-check': {
      const h = withHistory(s, `Multimeter check recorded`)
      return { ...h, blockChecks: { ...s.blockChecks, [action.blockId]: { multimeter: action.done, at: Date.now() } } }
    }
    default:
      return s
  }
}

export const session = createStore({ key: 'session', initial: initialSession, reducer: sessionReducer, version: 1 })

// ---------- selectors ----------

export function progress(s) {
  const refs = s.plan ? planSequence(s.plan) : []
  const count = (st) => refs.filter((r) => s.status[r] === st).length
  const placed = count(STATUS.placed)
  const skipped = count(STATUS.skipped)
  const dropped = count(STATUS.dropped)
  return { total: refs.length, placed, skipped, dropped, pending: refs.length - placed - skipped }
}

export function blockProgress(s, block) {
  const placed = block.refs.filter((r) => s.status[r] === STATUS.placed).length
  const skipped = block.refs.filter((r) => s.status[r] === STATUS.skipped).length
  const dropped = block.refs.filter((r) => s.status[r] === STATUS.dropped).length
  return { total: block.refs.length, placed, skipped, dropped, done: placed + skipped === block.refs.length }
}

export function groupInfo(s, ref) {
  const part = s.board.parts[ref]
  const group = s.board.groups.find((g) => g.id === part.group)
  const placed = group.refs.filter((r) => s.status[r] === STATUS.placed).length
  const sparesUsed = group.refs.reduce((n, r) => n + (s.dropCount[r] ?? 0), 0)
  return {
    group,
    placed,
    total: group.refs.length,
    position: group.refs.indexOf(ref) + 1,
    spares: group.spares,
    sparesUsed,
    sparesLeft: group.spares - sparesUsed,
    compartment: s.tray[group.id] ?? null,
  }
}

export const currentBlock = (s) => (s.plan && s.current ? blockOf(s.plan, s.current) : null)

/** Blocks whose parts are all handled but whose multimeter check is neither recorded nor skipped. */
export function blocksAwaitingCheck(s) {
  if (!s.plan) return []
  return s.plan.blocks.filter((b) => blockProgress(s, b).done && !s.blockChecks[b.id])
}
