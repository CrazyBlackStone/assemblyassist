import { createStore } from '../lib/store.js'

// Ephemeral UI state shared between panels (never persisted).
export const ui = createStore({
  key: null,
  storage: null,
  initial: {
    railOpen: false,
    highlightRef: null, // "where is C8?"
    calibrating: null, // { refs: [a, b], taps: [] }
    tapRequest: null, // { ref } — waiting for a tap on the video to crop (no calibration)
    check: null, // { ref, status: 'capturing'|'checking'|'done'|'error', result, error }
    review: null, // { status, items: [{ ref, status, result }], activeRef }
    logOpen: false,
    toast: null,
  },
})

export const setUi = (patch) => ui.set((s) => ({ ...s, ...patch }))

let toastTimer = null
export function toast(text, ms = 3000) {
  setUi({ toast: text })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => setUi({ toast: null }), ms)
}
