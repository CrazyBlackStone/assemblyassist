import { createStore } from '../store.js'
import { DEFAULT_TASKS } from '../../config/models.js'

// OpenRouter's public model list (no key needed): used for price data and for
// auto-picking a free model when a configured default has been retired.

export const catalog = createStore({ key: 'catalog', initial: { fetchedAt: 0, models: [] } })

const DAY = 24 * 60 * 60 * 1000

export async function loadOpenRouterCatalog({ force = false } = {}) {
  const c = catalog.get()
  if (!force && c.models.length && Date.now() - c.fetchedAt < DAY) return c.models
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`Model list request failed (${res.status})`)
  const json = await res.json()
  const models = (json.data ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    inputs: m.architecture?.input_modalities ?? (m.architecture?.modality?.includes('image') ? ['text', 'image'] : ['text']),
    prompt: toNum(m.pricing?.prompt),
    completion: toNum(m.pricing?.completion),
    image: toNum(m.pricing?.image),
    request: toNum(m.pricing?.request),
    context: m.context_length ?? null,
  }))
  catalog.set({ fetchedAt: Date.now(), models })
  return models
}

function toNum(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function findModel(id) {
  return catalog.get().models.find((m) => m.id === id) ?? null
}

export const isFree = (m) => m && m.prompt === 0 && m.completion === 0
export const acceptsImages = (m) => Boolean(m?.inputs?.includes('image'))

/**
 * For each task whose chosen model is missing from the catalog, pick a free model with the
 * right input type. Returns { models, autoPicked } to merge into prefs.
 */
export function autoPickModels(currentModels, models = catalog.get().models) {
  if (!models.length) return { models: currentModels, autoPicked: {} }
  const next = { ...currentModels }
  const autoPicked = {}
  for (const [task, cfg] of Object.entries(DEFAULT_TASKS)) {
    const chosen = models.find((m) => m.id === next[task])
    const ok = chosen && (!cfg.needsVision || acceptsImages(chosen))
    if (ok) continue
    const candidates = models
      .filter((m) => isFree(m) && (!cfg.needsVision || acceptsImages(m)))
      .sort((a, b) => (b.context ?? 0) - (a.context ?? 0))
    if (candidates[0]) {
      next[task] = candidates[0].id
      autoPicked[task] = true
    }
  }
  return { models: next, autoPicked }
}
