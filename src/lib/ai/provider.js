import { PROVIDERS, DEFAULT_TASKS, PRICE_TABLE } from '../../config/models.js'
import { prefs, keys, activeProvider } from '../../state/settings.js'
import { recordCall, logFailure } from '../../state/logs.js'
import { findModel } from './catalog.js'
import { extractJson } from './json.js'

// ============================================================================
// The one place the app talks to models. Every call:
//   - has a timeout and can be cancelled
//   - is recorded in the cost meter (cost "unknown" when there is no price data)
//   - logs timeouts, errors and unreadable output to the failure log
// Tasks (src/lib/ai/tasks/*) build prompts and validate output; they never fetch.
// ============================================================================

export class ModelError extends Error {
  constructor(kind, message) {
    super(message)
    this.kind = kind // 'timeout' | 'cancelled' | 'no-key' | 'http' | 'network' | 'empty'
  }
}

export function taskConfig(task) {
  const base = DEFAULT_TASKS[task]
  const p = prefs.get()
  const provider = activeProvider()
  return { ...base, task, provider, model: provider === 'simulated' ? 'simulated' : p.models[task] ?? base.model }
}

function resolveCost(provider, model, usageObj) {
  if (provider === 'simulated') return { cost: 0, costSource: 'simulated' }
  if (typeof usageObj?.cost === 'number') return { cost: usageObj.cost, costSource: 'provider' }
  const pt = usageObj?.prompt_tokens
  const ct = usageObj?.completion_tokens
  const listed = provider === 'openrouter' ? findModel(model) : null
  if (listed && listed.prompt != null && listed.completion != null && pt != null && ct != null) {
    return { cost: pt * listed.prompt + ct * listed.completion + (listed.request ?? 0), costSource: 'price list' }
  }
  const table = PRICE_TABLE[model]
  if (table && pt != null && ct != null) {
    return { cost: (pt * table.input + ct * table.output) / 1e6, costSource: 'config price table' }
  }
  return { cost: null, costSource: 'unknown' }
}

function contentText(message) {
  const c = message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
  return ''
}

/**
 * Low-level call. Returns { text, meta }.
 * @param {object} o
 * @param {string} o.task           key of DEFAULT_TASKS
 * @param {Array}  o.messages       OpenAI-format messages (images as image_url parts)
 * @param {AbortSignal} [o.signal]  user cancel
 * @param {() => string} o.simulate canned response for simulated mode
 */
export async function callModel({ task, messages, signal, simulate }) {
  const cfg = taskConfig(task)
  const started = performance.now()
  const base = { task, provider: cfg.provider, model: cfg.model }

  if (cfg.provider === 'simulated') {
    await sleep(700 + Math.random() * 900, signal)
    const text = simulate()
    const ms = Math.round(performance.now() - started)
    const meta = { ...base, ms, ok: true, cost: 0, costSource: 'simulated', simulated: true }
    recordCall(meta)
    return { text, meta }
  }

  const provider = PROVIDERS[cfg.provider]
  const key = keys.get()[cfg.provider]
  const baseUrl = cfg.provider === 'custom' ? prefs.get().customBaseUrl : provider.baseUrl
  if (!key) throw fail(base, started, new ModelError('no-key', `No API key set for ${provider.label}. Add one on the Setup screen.`))
  if (!baseUrl) throw fail(base, started, new ModelError('http', 'No API base URL set for the custom provider.'))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), cfg.timeoutMs)
  const onCancel = () => controller.abort('cancelled')
  signal?.addEventListener('abort', onCancel)

  try {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
    if (cfg.provider === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin
      headers['X-Title'] = 'Assembly Assist'
    }
    let res
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: cfg.model,
          messages,
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature,
          ...provider.extraBody,
        }),
      })
    } catch (e) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason === 'cancelled' ? 'cancelled' : 'timeout'
        throw new ModelError(reason, reason === 'timeout' ? `No answer within ${Math.round(cfg.timeoutMs / 1000)} s.` : 'Cancelled.')
      }
      throw new ModelError('network', `Network error: ${e.message}`)
    }
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = json?.error?.message ?? res.statusText
      throw new ModelError('http', `${provider.label} returned ${res.status}: ${msg}`)
    }
    const text = contentText(json?.choices?.[0]?.message)
    const usageObj = json?.usage ?? {}
    const { cost, costSource } = resolveCost(cfg.provider, json?.model ?? cfg.model, usageObj)
    const meta = {
      ...base,
      model: json?.model ?? cfg.model,
      ms: Math.round(performance.now() - started),
      ok: Boolean(text),
      promptTokens: usageObj.prompt_tokens ?? null,
      completionTokens: usageObj.completion_tokens ?? null,
      cost,
      costSource,
      simulated: false,
    }
    recordCall(text ? meta : { ...meta, error: 'empty response' })
    if (!text) throw new ModelError('empty', 'The model returned an empty answer.')
    return { text, meta }
  } catch (e) {
    if (e instanceof ModelError && e.kind === 'empty') throw e // already recorded
    throw fail(base, started, e instanceof ModelError ? e : new ModelError('network', e.message))
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCancel)
  }
}

function fail(base, started, err) {
  if (err.kind !== 'no-key') {
    recordCall({ ...base, ms: Math.round(performance.now() - started), ok: false, cost: null, costSource: 'unknown', error: err.message })
  }
  return err
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new ModelError('cancelled', 'Cancelled.'))
    })
  })
}

/**
 * High-level runner used by every task: call -> extract JSON -> validate.
 * Logs failures automatically and tells the UI what fallback it is showing.
 *
 * validate(value) must return { data, issues } (issues: corrections the app made) or throw.
 * Returns { ok: true, data, issues, meta, raw } or { ok: false, error, kind, meta? }.
 */
export async function runTask({ task, messages, signal, simulate, validate, inputSummary, fallbackAction }) {
  let text
  let meta
  try {
    ;({ text, meta } = await callModel({ task, messages, signal, simulate }))
  } catch (e) {
    const kind = e.kind ?? 'error'
    if (kind !== 'cancelled' && kind !== 'no-key') {
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
    if (issues.length) {
      logFailure({ task, model: meta.model, kind: 'corrected', inputSummary, modelSaid: text, uiAction: `App corrected the output: ${issues.join(' ')}` })
    }
    return { ok: true, data, issues, meta, raw: text }
  } catch (e) {
    logFailure({ task, model: meta.model, kind: 'invalid-output', inputSummary, modelSaid: text, uiAction: `${e.message} ${fallbackAction}` })
    return { ok: false, kind: 'invalid-output', error: e.message, meta, raw: text }
  }
}
