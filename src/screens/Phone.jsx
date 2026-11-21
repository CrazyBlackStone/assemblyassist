import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store.js'
import { pairing, startGuest, stopGuest, sendToLaptop } from '../lib/pairing/pairing.js'
import { stillFromStream } from '../lib/camera.js'
import { listen, canRecognize } from '../lib/voice/speech.js'

// The page the phone opens from the QR code: camera + microphone for the laptop.

export function Phone({ code: initialCode }) {
  const pair = useStore(pairing)
  const [code, setCode] = useState((initialCode ?? '').toUpperCase())
  const [stream, setStream] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('')
  const [torch, setTorch] = useState(false)
  const [heard, setHeard] = useState('')
  const [handsFree, setHandsFree] = useState(false)
  const [listening, setListening] = useState(false)
  const videoRef = useRef(null)
  const rec = useRef(null)
  const wake = useRef(null)

  const start = async () => {
    setError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      setStream(s)
      try {
        wake.current = await navigator.wakeLock?.request('screen')
      } catch {
        /* optional */
      }
      startGuest({
        code,
        stream: s,
        takeStill: async () => {
          const canvas = await stillFromStream(s, videoRef.current)
          return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode photo'))), 'image/jpeg', 0.92))
        },
        onMessage: (msg) => {
          if (msg.type === 'status') setStatus(msg.text)
          if (msg.type === 'torch') applyTorch(s, msg.on).then(setTorch)
        },
      })
    } catch (e) {
      setError(e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in the browser settings and try again.' : e.message)
    }
  }

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch(() => {})
    }
  }, [stream])

  useEffect(
    () => () => {
      stopGuest()
      rec.current?.stop()
      wake.current?.release?.()
      stream?.getTracks().forEach((t) => t.stop())
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const talk = (continuous) => {
    rec.current?.stop()
    rec.current = listen({
      continuous,
      onState: (st) => setListening(st === 'listening'),
      onError: setError,
      onResult: ({ transcript, alternatives, isFinal }) => {
        setHeard(isFinal ? transcript : `${transcript}…`)
        if (isFinal) sendToLaptop({ type: 'transcript', text: transcript, alternatives })
      },
    })
  }

  useEffect(() => {
    if (!stream) return
    if (handsFree) talk(true)
    else rec.current?.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handsFree, stream])

  if (!stream) {
    return (
      <main className="phone">
        <h1>Assembly Assist: phone camera</h1>
        <p>This phone becomes the camera and microphone over the board. Prop it about 15–25 cm above the board, camera facing down.</p>
        <label>
          Pairing code shown on the laptop
          <input className="code-input" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
        </label>
        <button className="btn huge primary" disabled={code.length !== 6} onClick={start}>
          Start camera and connect
        </button>
        <p className="muted small">Don’t point the camera at confidential designs. Nothing is recorded or saved.</p>
        {error && <p className="error-text">{error}</p>}
      </main>
    )
  }

  return (
    <main className="phone live">
      <div className={`phone-status ${pair.status}`}>{pair.status === 'paired' ? `Connected to laptop (${code})` : `Connecting to ${code}…`}</div>
      {pair.error && <p className="error-text">{pair.error}</p>}
      <video ref={videoRef} muted playsInline autoPlay className="phone-preview" />
      {status && <div className="phone-part">{status}</div>}
      <div className="phone-controls">
        <button className={`btn huge ${listening ? 'live' : ''}`} disabled={!canRecognize() || handsFree} onClick={() => (listening ? rec.current?.stop() : talk(false))}>
          🎤 {listening && !handsFree ? 'Listening…' : 'Talk'}
        </button>
        <label className="toggle">
          <input type="checkbox" checked={handsFree} disabled={!canRecognize()} onChange={(e) => setHandsFree(e.target.checked)} /> Hands-free
        </label>
        <button className={`btn ${torch ? 'on' : ''}`} onClick={() => applyTorch(stream, !torch).then(setTorch)}>
          {torch ? 'Light off' : 'Light on'}
        </button>
      </div>
      {!canRecognize() && <p className="muted small">This browser has no speech recognition; use the laptop’s microphone or buttons.</p>}
      {heard && (
        <p>
          Heard: <strong>“{heard}”</strong>
        </p>
      )}
    </main>
  )
}

async function applyTorch(stream, on) {
  const track = stream?.getVideoTracks()[0]
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] })
    return on
  } catch {
    return false
  }
}
