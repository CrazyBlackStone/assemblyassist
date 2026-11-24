import { createStore } from '../store.js'
import { TASKS, STT, hasProvider } from '../../config/ai.js'

// OpenRouter's public model list (no key needed): price data for the cost meter, and a
// replacement when a configured model has been retired. Replacements are recorded and
// shown in the log, never chosen silently.

export const catalog = createStore({ key: 'catalog', version: 2, initial: { fetchedAt: 0, models: [], overrides: {} } })

const DAY = 24 * 60 * 60 * 1000
const toNum = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v))

export async function loadOpenRouterCatalog({ force = false } = {}) {
  const c = catalog.get()
  if (!force && c.models.length && Date.now() - c.fetchedAt < DAY) return c.models
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`Model list request failed (${res.status})`)
  const json = await res.json()
  const models = (json.data ?? []).map((m) => ({
    id: m.id,
    inputs: m.architecture?.input_modalities ?? ['text'],
    prompt: toNum(m.pricing?.prompt),
    completion: toNum(m.pricing?.completion),
    request: toNum(m.pricing?.request),
    context: m.context_length ?? null,
  }))
  catalog.set((s) => ({ ...s, fetchedAt: Date.now(), models }))
  return models
}

export const findModel = (id) => catalog.get().models.find((m) => m.id === id) ?? null
const isFree = (m) => m.prompt === 0 && m.completion === 0
const accepts = (m, kind) => kind === 'text' || m.inputs.includes(kind)

/** Pick replacements for configured OpenRouter models that are no longer listed. */
export function autoPick(models = catalog.get().models) {
  if (!models.length) return {}
  const wanted = [
    ...Object.entries(TASKS).filter(([, t]) => t.provider === 'openrouter').map(([k, t]) => [k, t.model, t.needs]),
    ...STT.engines.filter((e) => e.provider === 'openrouter').map((e) => ['stt', e.model, 'audio']),
  ]
  const overrides = {}
  for (const [key, model, needs] of wanted) {
    const listed = models.find((m) => m.id === model)
    if (listed && accepts(listed, needs)) continue
    const pool = models.filter((m) => accepts(m, needs))
    const pick = pool.filter(isFree).sort((a, b) => (b.context ?? 0) - (a.context ?? 0))[0] ?? pool.sort((a, b) => (a.prompt ?? 1) - (b.prompt ?? 1))[0]
    if (pick) overrides[key] = { from: model, to: pick.id }
  }
  catalog.set((s) => ({ ...s, overrides }))
  return overrides
}

export const modelFor = (key, configured) => catalog.get().overrides[key]?.to ?? configured

export async function refreshCatalog() {
  if (!hasProvider('openrouter')) return
  try {
    await loadOpenRouterCatalog()
    autoPick()
  } catch {
    // Offline or blocked: keep the configured models.
  }
}
