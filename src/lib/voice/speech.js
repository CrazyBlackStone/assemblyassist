// Thin wrappers over the browser Web Speech API (speech in) and speechSynthesis (speech out).
// These run in the browser and are free; they are not routed through the model provider.

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

export const canRecognize = () => Boolean(Recognition)
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/**
 * Start listening. continuous=true for hands-free mode (restarts itself until stopped).
 * onResult({ transcript, alternatives, isFinal, confidence })
 * Returns { stop() }.
 */
export function listen({ continuous = false, onResult, onState, onError }) {
  if (!Recognition) {
    onError?.('Speech recognition is not supported in this browser. Use Chrome or Edge, or the buttons.')
    return { stop() {} }
  }
  let stopped = false
  let rec = null

  const start = () => {
    rec = new Recognition()
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.maxAlternatives = 3
    rec.continuous = continuous
    rec.onstart = () => onState?.('listening')
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1]
      const alternatives = Array.from(r).map((a) => a.transcript.trim())
      onResult({ transcript: alternatives[0], alternatives, isFinal: r.isFinal, confidence: r[0].confidence })
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      onError?.(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Speech recognition error: ${e.error}`)
      if (e.error === 'not-allowed') stopped = true
    }
    rec.onend = () => {
      if (continuous && !stopped) {
        setTimeout(() => !stopped && start(), 250)
      } else {
        onState?.('idle')
      }
    }
    try {
      rec.start()
    } catch (err) {
      onError?.(err.message)
    }
  }
  start()
  return {
    stop() {
      stopped = true
      try {
        rec?.stop()
      } catch {
        /* already stopped */
      }
      onState?.('idle')
    },
  }
}

let lastSpoken = ''
export function speak(text, { rate = 1, enabled = true } = {}) {
  lastSpoken = text
  if (!enabled || !canSpeak()) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = rate
  u.lang = 'en-US'
  window.speechSynthesis.speak(u)
}
export const getLastSpoken = () => lastSpoken

/** Spell a reference so synthesis reads "C 8" rather than "see-eight" as a word. */
export const sayRef = (ref) => ref.replace(/^([A-Z]+)(\d+)$/, '$1 $2')
