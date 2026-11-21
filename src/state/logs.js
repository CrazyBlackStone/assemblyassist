import { createStore, uid } from '../lib/store.js'

// Usage (cost meter), failure log and feedback. Text only: no photos are ever stored here.

export const usage = createStore({ key: 'usage', initial: { calls: [] } })

/**
 * @param {{task, provider, model, ms, ok, promptTokens?, completionTokens?, cost: number|null, costSource: string, error?}} entry
 */
export function recordCall(entry) {
  const call = { id: uid(), ts: new Date().toISOString(), ...entry }
  usage.set((s) => ({ calls: [...s.calls, call].slice(-2000) }))
  return call
}

export function costSummary(calls) {
  const byTask = {}
  let known = 0
  let unknownCalls = 0
  let tokens = 0
  for (const c of calls) {
    const t = (byTask[c.task] ??= { calls: 0, failed: 0, tokens: 0, cost: 0, unknown: 0 })
    t.calls++
    if (!c.ok) t.failed++
    const tk = (c.promptTokens ?? 0) + (c.completionTokens ?? 0)
    t.tokens += tk
    tokens += tk
    if (c.cost == null) {
      t.unknown++
      unknownCalls++
    } else {
      t.cost += c.cost
      known += c.cost
    }
  }
  return { known, unknownCalls, tokens, calls: calls.length, byTask }
}

export function formatUsd(n) {
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

// ---------- failure log ----------

export const failureLog = createStore({ key: 'failures', initial: { entries: [] } })

/**
 * kind: 'marked-wrong' (user) | 'timeout' | 'error' | 'invalid-output' | 'corrected' (app repaired output)
 */
export function logFailure({ task, model, kind, inputSummary, modelSaid, userSaysRight = '', uiAction }) {
  const entry = {
    id: uid(),
    timestamp: new Date().toISOString(),
    callType: task,
    model: model ?? '',
    kind,
    inputSummary: String(inputSummary ?? '').slice(0, 2000),
    modelSaid: String(modelSaid ?? '').slice(0, 4000),
    userSaysRight: String(userSaysRight ?? ''),
    uiAction: String(uiAction ?? ''),
  }
  failureLog.set((s) => ({ entries: [...s.entries, entry] }))
  return entry
}

export const feedback = createStore({ key: 'feedback', initial: { items: [] } })

export function recordFeedback({ task, model, verdict, resultId }) {
  feedback.set((s) => ({ items: [...s.items, { id: uid(), ts: new Date().toISOString(), task, model, verdict, resultId }] }))
}

// ---------- export ----------

const FAILURE_COLUMNS = ['timestamp', 'callType', 'model', 'kind', 'inputSummary', 'modelSaid', 'userSaysRight', 'uiAction']

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n')
}

export const failuresToCsv = (entries) => toCsv(entries, FAILURE_COLUMNS)
export const callsToCsv = (calls) =>
  toCsv(calls, ['ts', 'task', 'provider', 'model', 'ok', 'ms', 'promptTokens', 'completionTokens', 'cost', 'costSource', 'error'])

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
