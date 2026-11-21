import { useSyncExternalStore } from 'react'

function safeStorage(kind) {
  try {
    const s = kind === 'session' ? window.sessionStorage : window.localStorage
    const probe = '__aa_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

/**
 * Tiny observable store persisted to localStorage (or sessionStorage).
 * Pass storage: null for an in-memory store (e.g. photos, which must not outlive the session).
 */
export function createStore({ key, initial, storage = 'local', version = 1, reducer = null }) {
  const backend = storage ? (typeof window === 'undefined' ? null : safeStorage(storage)) : null
  const storageKey = key ? `aa:${key}:v${version}` : null
  let state = initial
  if (backend && storageKey) {
    try {
      const raw = backend.getItem(storageKey)
      if (raw) state = { ...initial, ...JSON.parse(raw) }
    } catch {
      state = initial
    }
  }
  const listeners = new Set()

  const persist = () => {
    if (!backend || !storageKey) return
    try {
      backend.setItem(storageKey, JSON.stringify(state))
    } catch {
      // Quota or privacy mode: keep working in memory.
    }
  }

  const store = {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? next(state) : next
      if (value === state) return
      state = value
      persist()
      listeners.forEach((l) => l())
    },
    dispatch(action) {
      if (!reducer) throw new Error('Store has no reducer')
      store.set((s) => reducer(s, action))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reset() {
      store.set(initial)
    },
  }
  return store
}

export function useStore(store, selector = (s) => s) {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()))
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
