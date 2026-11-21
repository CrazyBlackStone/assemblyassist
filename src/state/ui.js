import { createStore } from '../lib/store.js'

// Ephemeral UI state shared between panels (never persisted).
export const ui = createStore({
  key: null,
  storage: null,
  initial: {
    highlightRef: null, // part highlighted by "where is C8?"
    liveMode: 'zoom', // 'zoom' | 'crop' | 'calibrate'
    checkRequest: 0, // bumped by the "check this" voice command
    cropTap: null, // { cx, cy, nonce } last crop tap on the live view
    toast: null,
  },
})

export const setUi = (patch) => ui.set((s) => ({ ...s, ...patch }))

let toastTimer = null
export function toast(text, ms = 3500) {
  setUi({ toast: text })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => setUi({ toast: null }), ms)
}
