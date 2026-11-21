import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store.js'
import { voice, handleTranscript, setInterim } from '../lib/voice/controller.js'
import { listen, canRecognize } from '../lib/voice/speech.js'
import { prefs } from '../state/settings.js'
import { HELP_TEXT } from '../lib/voice/grammar.js'

/**
 * Push-to-talk + hands-free toggle. Always shows what was heard and how it was understood,
 * so a misheard command is visible (and undoable with one tap / "back").
 */
export function VoiceBar() {
  const v = useStore(voice)
  const p = useStore(prefs)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null)
  const session = useRef(null)

  const start = (continuous) => {
    session.current?.stop()
    setError(null)
    session.current = listen({
      continuous,
      onState: (st) => setListening(st === 'listening'),
      onError: setError,
      onResult: ({ transcript, alternatives, isFinal }) => {
        if (isFinal) handleTranscript(transcript, alternatives)
        else setInterim(transcript)
      },
    })
  }
  const stop = () => {
    session.current?.stop()
    session.current = null
    setListening(false)
  }

  useEffect(() => {
    if (p.handsFree) start(true)
    else stop()
    return () => session.current?.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.handsFree])

  // Space-bar style push-to-talk on the "T" key (works with a USB foot pedal mapped to T).
  useEffect(() => {
    const down = (e) => {
      if (e.repeat || e.key.toLowerCase() !== 't' || isTyping(e)) return
      if (!p.handsFree) start(false)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.handsFree])

  const supported = canRecognize()
  const fromPhone = v.source === 'phone'

  return (
    <section className="voice-bar" aria-live="polite">
      <div className="voice-controls">
        <button
          className={`btn ptt ${listening ? 'live' : ''}`}
          disabled={!supported || p.handsFree}
          onClick={() => (listening ? stop() : start(false))}
          title="Push to talk (T)"
        >
          🎤 {listening && !p.handsFree ? 'Listening…' : 'Talk'} <kbd>T</kbd>
        </button>
        <label className="toggle">
          <input type="checkbox" checked={p.handsFree} disabled={!supported} onChange={(e) => prefs.set((s) => ({ ...s, handsFree: e.target.checked }))} />
          Hands-free {p.handsFree && listening && <span className="dot-live" />}
        </label>
        <label className="toggle">
          <input type="checkbox" checked={p.speakAloud} onChange={(e) => prefs.set((s) => ({ ...s, speakAloud: e.target.checked }))} />
          Speak answers
        </label>
      </div>
      <div className="voice-transcript">
        <div>
          <span className="label">Heard{fromPhone ? ' (phone)' : ''}:</span>{' '}
          {v.interim ? <em>{v.interim}…</em> : v.heard === '(button)' ? <span className="muted">— (you tapped a button)</span> : v.heard ? <strong>“{v.heard}”</strong> : <span className="muted">nothing yet</span>}
          {v.command && v.heard !== '(button)' && <span className={`cmd ${v.command.type === 'unknown' ? 'bad' : ''}`}>→ {v.command.type}{v.command.ref ? ` ${v.command.ref}` : ''}</span>}
          {v.alternatives?.length > 1 && <span className="muted small"> (also heard: {v.alternatives.slice(1).join(' / ')})</span>}
        </div>
        <div className="voice-response">{v.response || <span className="muted">{supported ? HELP_TEXT : 'Voice needs Chrome or Edge. Buttons and keyboard work everywhere.'}</span>}</div>
        {error && <div className="error-text">{error}</div>}
      </div>
    </section>
  )
}

export const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)
