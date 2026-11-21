import { createStore } from '../lib/store.js'
import { DEFAULT_TASKS, DEFAULT_ICE_SERVERS } from '../config/models.js'

// Settings are split in two stores:
//  - prefs: models, voice, pairing config (localStorage)
//  - keys: API keys. localStorage by default, or sessionStorage when the user
//    picks "forget keys when I close the tab" (shared lab computers).
// Keys never leave the browser except in requests to the provider they belong to.

const keyStorageMode = (() => {
  try {
    return window.localStorage.getItem('aa:keyStorage') === 'session' ? 'session' : 'local'
  } catch {
    return 'local'
  }
})()

export const keys = createStore({ key: 'keys', initial: { openrouter: '', openai: '', custom: '' }, storage: keyStorageMode })

export function setKeyStorageMode(mode) {
  try {
    window.localStorage.setItem('aa:keyStorage', mode)
    // Move existing keys to the chosen storage, then reload so the store re-binds.
    const value = JSON.stringify(keys.get())
    const name = 'aa:keys:v1'
    if (mode === 'session') {
      window.sessionStorage.setItem(name, value)
      window.localStorage.removeItem(name)
    } else {
      window.localStorage.setItem(name, value)
      window.sessionStorage.removeItem(name)
    }
  } catch {
    // Storage blocked; nothing to move.
  }
  window.location.reload()
}

export const getKeyStorageMode = () => keyStorageMode

export const initialPrefs = {
  provider: 'auto', // 'auto' = OpenRouter when a key is set, otherwise simulated
  customBaseUrl: '',
  models: Object.fromEntries(Object.entries(DEFAULT_TASKS).map(([k, t]) => [k, t.model])),
  autoPicked: {}, // task -> true when the app replaced an unavailable default
  speakAloud: true,
  voiceRate: 1,
  handsFree: false,
  cameraSource: 'phone', // 'phone' | 'local'
  peerHost: '', // empty = PeerJS public cloud server
  peerPort: 443,
  peerPath: '/',
  iceServers: JSON.stringify(DEFAULT_ICE_SERVERS),
  largeText: true,
  privacyAcknowledged: false,
}

export const prefs = createStore({ key: 'prefs', initial: initialPrefs })

/** Which provider will actually be used right now. */
export function activeProvider(p = prefs.get(), k = keys.get()) {
  if (p.provider !== 'auto') return p.provider
  return k.openrouter ? 'openrouter' : 'simulated'
}
