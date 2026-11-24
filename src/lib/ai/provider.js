import { PROVIDERS, TASKS, PRICE_TABLE, KEYS, PROXY_URL, hasProvider } from '../../config/ai.js'
import { recordCall, logFailure } from '../../state/logs.js'
import { findModel, modelFor } from './catalog.js'
import { extractJson } from './json.js'

// ============================================================================
// The one place the app talks to models. Every call has a timeout and can be
// cancelled, is recorded in the cost meter (cost "unknown" when there is no price
// data), and logs timeouts, errors and unreadable output to the failure log.
// Tasks (src/lib/ai/tasks/*) build prompts and validate output; they never fetch.
// ============================================================================

export class ModelError extends Error {
  constructor(kind, message) {
    super(message)
    this.kind = kind // 'timeout' | 'cancelled' | 'http' | 'network' | 'empty'
  }
}

export const baseUrl = (provider) => (PROXY_URL ? `${PROXY_URL}/${provider}` : PROVIDERS[provider].baseUrl)

export function authHeaders(provider) {
  const h = {}
  if (!PROXY_URL) h.Authorization = `Bearer ${KEYS[provider]}`
  if (provider === 'openrouter' && typeof window !== 'undefined') {
    h['HTTP-Referer'] = window.location.origin
    h['X-Title'] = 'Assembly Assist'
  }
  return h
}

export function taskConfig(task) {
  const t = TASKS[task]
  const simulated = !hasProvider(t.provider)
  return { ...t, task, simulated, model: simulated ? 'simulated' : modelFor(task, t.model) }
}

export function resolveCost(provider, model, usage) {
  if (typeof usage?.cost === 'number') return { cost: usage.cost, costSource: 'provider' }
  const pt = usage?.prompt_tokens
  const ct = usage?.completion_tokens
  const listed = provider === 'openrouter' ? findModel(model) : null
  if (listed && listed.prompt != null && listed.completion != null && pt != null && ct != null) {
    return { cost: pt * listed.prompt + ct * listed.completion + (listed.request ?? 0), costSource: 'price list' }
  }
  const table = PRICE_TABLE[model]
  if (table && pt != null && ct != null) return { cost: (pt * table.input + ct * table.output) / 1e6, costSource: 'price table' }
  return { cost: null, costSource: 'unknown' }
}

/** fetch with a timeout and an optional cancel signal; maps failures to ModelError. */
export async function fetchModel(url, init, { timeoutMs, signal }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
  const onCancel = () => controller.abort('cancelled')
  signal?.addEventListener('abort', onCancel)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new ModelError('http', `${res.status}: ${json?.error?.message ?? res.statusText}`)
    return json
  } catch (e) {
    if (e instanceof ModelError) throw e
    if (controller.signal.aborted) {
      const reason = controller.signal.reason === 'cancelled' ? 'cancelled' : 'timeout'
      throw new ModelError(reason, reason === 'timeout' ? `No answer within ${Math.round(timeoutMs / 1000)} s.` : 'Cancelled.')
    }
    throw new ModelError('network', `Network error: ${e.message}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCancel)
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new ModelError('cancelled', 'Cancelled.'))
    })
  })

function contentText(message) {
  const c = message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('')
  return ''
}

/** Low-level chat call. Returns { text, meta }. */
export async function callModel({ task, messages, signal, simulate }) {
  const cfg = taskConfig(task)
  const started = performance.now()
  const base = { task, provider: cfg.provider, model: cfg.model }
  const ms = () => Math.round(performance.now() - started)

  if (cfg.simulated) {
    await sleep(500 + Math.random() * 700, signal)
    const meta = { ...base, ms: ms(), ok: true, cost: 0, costSource: 'simulated', simulated: true }
    recordCall(meta)
    return { text: simulate(), meta }
  }

  try {
    const json = await fetchModel(
      `${baseUrl(cfg.provider)}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cfg.provider) },
        body: JSON.stringify({ model: cfg.model, messages, max_tokens: cfg.maxTokens, temperature: cfg.temperature, ...PROVIDERS[cfg.provider].extraBody }),
      },
      { timeoutMs: cfg.timeoutMs, signal },
    )
    const text = contentText(json?.choices?.[0]?.message)
    const usage = json?.usage ?? {}
    const model = json?.model ?? cfg.model
    const meta = { ...base, model, ms: ms(), ok: Boolean(text), promptTokens: usage.prompt_tokens ?? null, completionTokens: usage.completion_tokens ?? null, ...resolveCost(cfg.provider, model, usage), simulated: false }
    recordCall(text ? meta : { ...meta, error: 'empty response' })
    if (!text) throw new ModelError('empty', 'The model returned an empty answer.')
    return { text, meta }
  } catch (e) {
    if (e.kind !== 'empty') recordCall({ ...base, ms: ms(), ok: false, cost: null, costSource: 'unknown', error: e.message })
    throw e
  }
}

/**
 * call -> extract JSON -> validate. Logs failures and what the UI fell back to.
 * validate(value) returns { data, issues } (issues: corrections the app made) or throws.
 */
export async function runTask({ task, messages, signal, simulate, validate, inputSummary, fallbackAction }) {
  let text
  let meta
  try {
    ;({ text, meta } = await callModel({ task, messages, signal, simulate }))
  } catch (e) {
    const kind = e.kind ?? 'error'
    if (kind !== 'cancelled') {
      logFailure({ task, model: taskConfig(task).model, kind: kind === 'timeout' ? 'timeout' : 'error', inputSummary, modelSaid: e.message, uiAction: fallbackAction })
    }
    return { ok: false, kind, error: e.message }
  }
  const parsed = extractJson(text)
  if (!parsed.ok) {
    logFailure({ task, model: meta.model, kind: 'invalid-output', inputSummary, modelSaid: text, uiAction: fallbackAction })
    return { ok: false, kind: 'invalid-output', error: `${parsed.error}.`, meta, raw: text }
  }
  try {
    const { data, issues = [] } = validate(parsed.value)
    if (issues.length) logFailure({ task, model: meta.model, kind: 'corrected', inputSummary, modelSaid: text, uiAction: `App corrected the output: ${issues.join(' ')}` })
    return { ok: true, data, issues, meta, raw: text }
  } catch (e) {
    logFailure({ task, model: meta.model, kind: 'invalid-output', inputSummary, modelSaid: text, uiAction: `${e.message} ${fallbackAction}` })
    return { ok: false, kind: 'invalid-output', error: e.message, meta, raw: text }
  }
}
