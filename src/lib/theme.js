import { createStore } from './store.js'

// Appearance: Light (default), Dark, or Auto (follows the system). Applied as
// data-theme on <html>; index.html applies it before first paint to avoid a flash.

export const appearance = createStore({ key: 'appearance', initial: { mode: 'light' } })

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

function resolved(mode) {
  if (mode === 'auto') return media?.matches ? 'dark' : 'light'
  return mode === 'dark' ? 'dark' : 'light'
}

function apply() {
  if (typeof document === 'undefined') return
  const theme = resolved(appearance.get().mode)
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#f2f2f7')
}

export function setAppearance(mode) {
  appearance.set({ mode })
}

appearance.subscribe(apply)
media?.addEventListener?.('change', apply)
apply()
