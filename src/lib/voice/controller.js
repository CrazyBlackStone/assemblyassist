import { createStore } from '../store.js'
import { parseCommand, HELP_TEXT } from './grammar.js'
import { speak, sayRef, getLastSpoken, listen, canRecognize } from './speech.js'
import { createRecorder } from './recorder.js'
import { transcribe, sttEngine } from './stt.js'
import { project, dispatch, STATUS, nextAfterCurrent } from '../../state/projects.js'
import { setUi, ui } from '../../state/ui.js'
import { describeLocation } from '../geometry/board.js'
import { runTask, taskConfig } from '../ai/provider.js'
import * as Assistant from '../ai/tasks/assistant.js'
import { placeCurrent, checkPart, confirmCheck, runReview } from '../verify/flow.js'
import { categoryOf } from '../plan/plan.js'

// Voice: capture → speech-to-text model (or browser fallback) → simple command grammar →
// language model for anything else. Buttons call the same `execute`.

export const voice = createStore({
  key: null,
  storage: null,
  initial: {
    handsFree: false,
    listening: false, // push-to-talk held
    level: 0,
    busy: null, // 'transcribing' | 'thinking'
    heard: '',
    heardMeta: null, // STT meta when a model transcribed it
    say: '',
    sayMeta: null, // assistant meta when a model answered
    sayFrom: null, // { utterance, data } for mark-as-wrong
    sources: [],
    error: null,
  },
})
const setV = (patch) => voice.set((s) => ({ ...s, ...patch }))

export function spokenValue(part) {
  const v = String(part.value ?? '').trim()
  const m = /^(\d+(?:\.\d+)?)\s*([pnuµmkM])?(\d+)?\s*(F|H|Ω|ohm)?$/i.exec(v)
  if (!m) return v || 'no value'
  const UNIT = { p: 'pico', n: 'nano', u: 'micro', µ: 'micro', m: 'milli', k: 'kilo', M: 'mega' }
  const [, num, prefix, tail, unit] = m
  const word = unit ? (/f/i.test(unit) ? 'farad' : /h/i.test(unit) ? 'henry' : 'ohm') : /^R/i.test(part.ref) ? 'ohm' : ''
  return `${tail ? `${num} point ${tail}` : num} ${prefix ? UNIT[prefix] : ''}${word}`.replace(/\s+/g, ' ').trim()
}

const describe = (p, ref) => `${sayRef(ref)}, ${spokenValue(p.board.parts[ref])}`

function reply(say, extra = {}) {
  setV({ say, sayMeta: null, sayFrom: null, sources: [], busy: null, ...extra })
  speak(say)
}

/** Run one command; returns the sentence shown and spoken. */
export function execute(cmd) {
  const p = project.get()
  if (!p?.board) return 'Open a project first.'
  switch (cmd.type) {
    case 'placed': {
      const ref = placeCurrent()
      if (!ref) return 'Everything is placed.'
      const n = project.get().current
      return n ? `Next: ${describe(project.get(), n)}.` : 'That was the last part. Say review to check them all.'
    }
    case 'skip': {
      const ref = cmd.ref ?? p.current
      if (!ref) return 'Nothing to skip.'
      dispatch({ type: 'mark', ref, status: STATUS.skipped })
      const n = project.get().current
      return n ? `Skipped. Next: ${describe(project.get(), n)}.` : 'Skipped.'
    }
    case 'back': {
      const last = p.history[p.history.length - 1]
      if (!last) return 'Nothing to undo.'
      dispatch({ type: 'undo' })
      return `Undone. ${describe(project.get(), project.get().current)}.`
    }
    case 'jump':
      dispatch({ type: 'jump', ref: cmd.ref })
      return `${describe(project.get(), cmd.ref)}.`
    case 'move-next': {
      dispatch({ type: 'move-next', refs: cmd.refs })
      return `${cmd.refs.map(sayRef).join(', ')} next.`
    }
    case 'category-next': {
      const cat = p.plan.categories.find((c) => c.id === cmd.categoryId)
      if (!cat) return 'Which group?'
      if (cat === categoryOf(p.plan, p.current)) return `Already on ${cat.name}.`
      dispatch({ type: 'move-category-next', categoryId: cat.id })
      return `${cat.name} next.`
    }
    case 'where': {
      setUi({ highlightRef: cmd.ref })
      setTimeout(() => ui.get().highlightRef === cmd.ref && setUi({ highlightRef: null }), 6000)
      return describeLocation(p.board, cmd.ref).replace(cmd.ref, sayRef(cmd.ref))
    }
    case 'where-value':
      return cmd.groups.map((g) => `${g.value}: ${g.refs.map(sayRef).join(', ')}.`).join(' ')
    case 'value': {
      const ref = cmd.ref ?? p.current
      return ref ? `${describe(p, ref)}, ${p.board.parts[ref].size.code}.` : 'No current part.'
    }
    case 'check': {
      const ref = cmd.ref ?? lastPlaced(p) ?? p.current
      if (!ref) return 'Nothing to check.'
      checkPart(ref)
      return `Checking ${sayRef(ref)}.`
    }
    case 'confirm':
      return confirmCheck('ok') ? 'Confirmed.' : 'Nothing to confirm.'
    case 'problem':
      return confirmCheck('problem') ? 'Marked as a problem.' : 'Nothing to mark.'
    case 'review':
      runReview()
      return 'Reviewing every placed part.'
    case 'repeat':
      return getLastSpoken() || 'Nothing to repeat.'
    case 'help':
      return HELP_TEXT
    default:
      return 'Sorry, say that again?'
  }
}

function lastPlaced(p) {
  for (let i = p.history.length - 1; i >= 0; i--) {
    const m = /^(\S+) placed$/.exec(p.history[i].label)
    if (m) return m[1]
  }
  return null
}

/** Buttons go through here so a tap and a spoken command behave the same. */
export function runCommand(cmd) {
  const say = execute(cmd)
  reply(say, { heard: '', heardMeta: null })
  return say
}

/** One recognised utterance from any source. */
export async function handleUtterance(text, heardMeta = null) {
  const p = project.get()
  const utterance = String(text ?? '').trim()
  if (!utterance) return setV({ busy: null, heard: '', heardMeta: null, say: 'Didn’t catch that.' })
  setV({ heard: utterance, heardMeta, error: null })
  if (!p?.board) return reply('Open a project first.')
  const cmd = parseCommand(utterance, p.board, p.plan)
  if (cmd.type !== 'unknown') return reply(execute(cmd))

  // Not a simple command: ask the language model to map it to an action or answer it.
  setV({ busy: 'thinking' })
  const r = await runTask({
    task: Assistant.TASK,
    messages: Assistant.buildMessages(utterance, p),
    simulate: () => Assistant.simulate(utterance, p),
    validate: (v) => Assistant.validate(v, project.get()),
    inputSummary: `"${utterance}" (current ${p.current ?? 'none'})`,
    fallbackAction: 'Said "say that again"; buttons still work.',
  })
  if (!r.ok) return reply(r.kind === 'timeout' ? 'That took too long. Try a short command.' : 'Sorry, say that again?')
  const d = r.data
  const map = {
    next: { type: 'placed' },
    skip: { type: 'skip' },
    back: { type: 'back' },
    goto: { type: 'jump', ref: d.ref },
    move_next: { type: 'move-next', refs: d.refs },
    category_next: { type: 'category-next', categoryId: d.categoryId },
    where: { type: 'where', ref: d.ref },
  }
  const said = map[d.action] ? execute(map[d.action]) : null
  const say = d.say || said || 'Okay.'
  setV({ say, sayMeta: r.meta, sayFrom: { utterance, data: d }, sources: d.sources, busy: null })
  speak(say)
}

// ---------------- listening engines ----------------

let recorder = null
let browserRec = null

const vocab = () => {
  const p = project.get()
  return p?.board ? [...Object.keys(p.board.parts), ...p.plan.categories.map((c) => c.name)] : []
}

export async function handleClip(blob, seconds) {
  setV({ busy: 'transcribing' })
  try {
    const { text, meta } = await transcribe(blob, seconds, vocab())
    if (!text) return setV({ busy: null })
    await handleUtterance(text, meta)
  } catch {
    setV({ busy: null, say: 'Not heard. Try again or use the buttons.' })
  }
}

export const usesModelStt = () => Boolean(sttEngine())

async function ensureRecorder(mode) {
  if (!recorder) recorder = createRecorder({ onClip: handleClip, onLevel: (level) => setV({ level }), onError: (error) => setV({ error }) })
  await recorder.start(mode)
  recorder.setMode(mode)
}

/** Push-to-talk on this device. */
export async function pttDown() {
  setV({ listening: true, error: null })
  if (usesModelStt()) {
    await ensureRecorder('ptt')
    recorder.begin()
  } else if (canRecognize()) {
    browserRec?.stop()
    browserRec = listen({
      onResult: ({ transcript, isFinal }) => (isFinal ? handleUtterance(transcript) : setV({ heard: transcript })),
      onError: (error) => setV({ error }),
      onState: (st) => st === 'idle' && setV({ listening: false }),
    })
  } else {
    setV({ listening: false, error: 'No speech recognition here. Use the buttons.' })
  }
}

export function pttUp() {
  setV({ listening: false })
  if (usesModelStt()) recorder?.end()
  // The browser recognizer ends by itself after a pause.
}

/** Hands-free on this device. */
export async function setHandsFree(on) {
  setV({ handsFree: on, error: null })
  if (usesModelStt()) {
    if (on) await ensureRecorder('handsfree')
    else recorder?.setMode('ptt')
  } else if (canRecognize()) {
    browserRec?.stop()
    browserRec = on
      ? listen({ continuous: true, onResult: ({ transcript, isFinal }) => isFinal && handleUtterance(transcript), onError: (error) => setV({ error }) })
      : null
  }
}

export function stopVoice() {
  recorder?.stop()
  recorder = null
  browserRec?.stop()
  browserRec = null
  setV({ handsFree: false, listening: false })
}

export const assistantTimeout = () => taskConfig(Assistant.TASK).timeoutMs
export { nextAfterCurrent }
