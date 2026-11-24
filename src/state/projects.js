import { createStore as idbStore, get, set, del } from 'idb-keyval'
import { createStore, uid } from '../lib/store.js'
import { defaultPlan, sequenceOf, moveRefs, moveCategory, categoryOf, enforceSides, swapSides, sideOf } from '../lib/plan/plan.js'

// Projects live in IndexedDB (Gerber files are too big for localStorage). The open
// project is mirrored in a store and saved shortly after every change.

const db = typeof indexedDB !== 'undefined' ? idbStore('assembly-assist', 'projects') : null
const INDEX = 'index'

export const STATUS = { placed: 'placed', skipped: 'skipped' }
const HISTORY_LIMIT = 100

export function newProject(name = 'Untitled board') {
  const now = Date.now()
  return {
    id: `p_${uid()}`,
    name,
    createdAt: now,
    updatedAt: now,
    files: { gerbers: [], bom: null, cpl: null },
    board: null,
    render: null,
    settings: { verifySoldering: true, micSource: 'laptop', cameraSource: 'phone', viewRotation: 0 },
    plan: null,
    status: {},
    current: null,
    history: [],
    verifications: {},
    calibration: null,
  }
}

// ---------------- index (workspace list) ----------------

export const workspace = createStore({ key: null, storage: null, initial: { loaded: false, projects: [] } })

function summary(p) {
  const total = sequenceOf(p.plan).length
  const placed = Object.values(p.status).filter((s) => s === STATUS.placed).length
  return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, placed, total, hasRender: Boolean(p.render), demo: Boolean(p.demo) }
}

export async function loadWorkspace() {
  const list = (db && (await get(INDEX, db))) || []
  workspace.set({ loaded: true, projects: list })
  return list
}

async function writeIndex(list) {
  workspace.set({ loaded: true, projects: list })
  if (db) await set(INDEX, list, db)
}

export async function saveProject(p) {
  if (db) await set(`project:${p.id}`, p, db)
  const list = workspace.get().projects.filter((x) => x.id !== p.id)
  await writeIndex([summary(p), ...list].sort((a, b) => b.updatedAt - a.updatedAt))
}

export async function readProject(id) {
  return db ? ((await get(`project:${id}`, db)) ?? null) : null
}

export async function deleteProject(id) {
  if (db) await del(`project:${id}`, db)
  await writeIndex(workspace.get().projects.filter((x) => x.id !== id))
  if (project.get()?.id === id) project.set(null)
}

export async function renameProject(id, name) {
  const p = await readProject(id)
  if (!p) return
  await saveProject({ ...p, name, updatedAt: Date.now() })
}

/** Board thumbnail (render) for workspace cards, loaded lazily. */
export async function projectThumb(id) {
  const p = await readProject(id)
  return p?.render ? { svg: p.render.svg, viewBox: p.render.viewBox } : null
}

// ---------------- open project ----------------

export const project = createStore({ key: null, storage: null, initial: null })

let saveTimer = null
project.subscribe(() => {
  const p = project.get()
  if (!p) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveProject(p), 300)
})

/** Bring projects saved by older versions up to date. */
function migrate(p) {
  if (!p) return p
  let out = p
  if (out.board && out.plan && !out.plan.sides) out = { ...out, plan: enforceSides(out.board, out.plan) }
  if (out.calibration?.a) out = { ...out, calibration: { top: out.calibration } }
  return out
}

export async function openProject(id) {
  if (project.get()?.id === id) return project.get()
  const p = migrate(await readProject(id))
  project.set(p)
  return p
}

export const dispatch = (action) => project.set((p) => (p ? projectReducer(p, action) : p))

const snapshot = (p) => ({ status: p.status, current: p.current, verifications: p.verifications, plan: p.plan })

function withHistory(p, label) {
  return { ...p, history: [...p.history, { label, snapshot: snapshot(p) }].slice(-HISTORY_LIMIT) }
}

const pending = (status, ref) => !status[ref]

/** The side the current part is on (where the board should be facing up). */
export const currentSide = (p) => (p?.board && p.current ? sideOf(p.board, p.current) : (p?.plan?.sides?.[0] ?? 'top'))
export const calibrationFor = (p, side) => (p?.calibration?.a ? (side === 'top' ? p.calibration : null) : (p?.calibration?.[side] ?? null))

/** Next part still to place after `fromRef`, wrapping around; null when all are handled. */
export function nextPending(sequence, status, fromRef) {
  const start = Math.max(0, sequence.indexOf(fromRef))
  for (let k = 1; k <= sequence.length; k++) {
    const ref = sequence[(start + k) % sequence.length]
    if (pending(status, ref)) return ref
  }
  return null
}

export function projectReducer(p0, action) {
  const p = { ...p0, updatedAt: Date.now() }
  switch (action.type) {
    case 'rename':
      return { ...p, name: action.name }
    case 'set-files':
      return { ...p, files: { ...p.files, ...action.files } }
    case 'load-board': {
      const plan = defaultPlan(action.board)
      return { ...p, board: action.board, plan, status: {}, history: [], verifications: {}, current: sequenceOf(plan)[0] ?? null }
    }
    case 'set-render':
      return { ...p, render: action.render, board: action.board ?? p.board }
    case 'setting':
      return { ...p, settings: { ...p.settings, [action.key]: action.value } }
    case 'set-plan': {
      const plan = p.board ? enforceSides(p.board, action.plan) : action.plan
      const seq = sequenceOf(plan)
      const current = p.current && seq.includes(p.current) && pending(p.status, p.current) ? p.current : (seq.find((r) => pending(p.status, r)) ?? null)
      return { ...withHistory(p, 'reorder'), plan, current }
    }
    case 'swap-sides': {
      const plan = swapSides(p.board, p.plan)
      const first = plan.sides[0]
      const seq = sequenceOf(plan)
      const current = seq.find((r) => pending(p.status, r) && sideOf(p.board, r) === first) ?? p.current
      return { ...withHistory(p, 'sides swapped'), plan, current }
    }
    case 'move-next': {
      // Put refs right after the current part and make the first of them next.
      const refs = action.refs.filter((r) => p.board?.parts[r] && r !== p.current)
      if (!refs.length) return p0
      return { ...withHistory(p, `${refs.join(', ')} moved next`), plan: moveRefs(p.plan, refs, p.current) }
    }
    case 'move-category-next': {
      const cat = p.plan.categories.find((c) => c.id === action.categoryId)
      if (!cat || cat === categoryOf(p.plan, p.current)) return p0
      return { ...withHistory(p, `${cat.name} moved next`), plan: moveCategory(p.plan, cat.id, p.current) }
    }
    case 'mark': {
      const ref = action.ref ?? p.current
      if (!ref || !p.board?.parts[ref]) return p0
      const h = withHistory(p, `${ref} ${action.status}`)
      const status = { ...p.status, [ref]: action.status }
      return { ...h, status, current: nextPending(sequenceOf(p.plan), status, ref) }
    }
    case 'undo': {
      const last = p.history[p.history.length - 1]
      if (!last) return p0
      return { ...p, ...last.snapshot, history: p.history.slice(0, -1) }
    }
    case 'jump':
      return p.board?.parts[action.ref] ? { ...p, current: action.ref } : p0
    case 'verification':
      return { ...p, verifications: { ...p.verifications, [action.ref]: { ...p.verifications[action.ref], ...action.result, at: Date.now() } } }
    case 'calibration':
      return { ...p, calibration: { ...(p.calibration?.a ? { top: p.calibration } : p.calibration), [action.side ?? 'top']: action.calibration } }
    case 'reset-progress':
      return { ...p, status: {}, history: [], verifications: {}, current: sequenceOf(p.plan)[0] ?? null }
    default:
      return p0
  }
}

// ---------------- selectors ----------------

export function progress(p) {
  const refs = sequenceOf(p?.plan)
  const placed = refs.filter((r) => p.status[r] === STATUS.placed).length
  const skipped = refs.filter((r) => p.status[r] === STATUS.skipped).length
  return { total: refs.length, placed, skipped, pending: refs.length - placed - skipped }
}

/** The part after the current one in the order that is still pending. */
export const nextAfterCurrent = (p) => (p?.current ? nextPending(sequenceOf(p.plan), { ...p.status, [p.current]: 'x' }, p.current) : null)
