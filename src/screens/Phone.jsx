import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store.js'
import { pairing, startGuest, stopGuest, sendToLaptop } from '../lib/pairing/pairing.js'
import { frameToCanvas } from '../lib/imaging/image.js'
import { createRecorder } from '../lib/voice/recorder.js'
import { listen, canRecognize } from '../lib/voice/speech.js'
import { sttEngine } from '../lib/voice/stt.js'
import { Icon } from '../components/ui.jsx'

// The page the QR code opens: this phone becomes the camera (and optionally the
// microphone) over the board.

export function Phone({ code: initialCode }) {
  const pair = useStore(pairing)
  const [code, setCode] = useState((initialCode ?? '').toUpperCase())
  const [stream, setStream] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('')
  const [micOn, setMicOn] = useState(false) // laptop asked for the phone's mic
  const [handsFree, setHandsFree] = useState(false)
  const [talking, setTalking] = useState(false)
  const [level, setLevel] = useState(0)
  const videoRef = useRef(null)
  const rec = useRef(null)
  const browserRec = useRef(null)
  const wake = useRef(null)
  const modelStt = Boolean(sttEngine())

  const start = async () => {
    setError(null)
    try {
      // Same track for preview, stream and stills, so stills match what the laptop sees.
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
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
          const v = videoRef.current
          const canvas = frameToCanvas(v)
          return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode photo'))), 'image/jpeg', 0.92))
        },
        onMessage: (msg) => {
          if (msg.type === 'status') setStatus(msg.text)
          if (msg.type === 'config') setMicOn(msg.mic === 'phone')
          if (msg.type === 'torch') applyTorch(s, msg.on)
        },
      })
    } catch (e) {
      setError(e.name === 'NotAllowedError' ? 'Allow the camera in the browser settings, then try again.' : e.message)
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
      browserRec.current?.stop()
      wake.current?.release?.()
    },
    [],
  )

  // Microphone: with a speech-to-text model, send audio clips to the laptop; otherwise
  // recognise on the phone and send the text.
  const ensureRecorder = async (mode) => {
    if (!rec.current) {
      rec.current = createRecorder({
        onClip: async (blob, seconds) => sendToLaptop({ type: 'audio', data: await blob.arrayBuffer(), seconds }),
        onLevel: (l) => setLevel(l),
        onError: setError,
      })
    }
    await rec.current.start(mode)
    rec.current.setMode(mode)
  }
  const down = async () => {
    setTalking(true)
    if (modelStt) {
      await ensureRecorder('ptt')
      rec.current.begin()
    } else if (canRecognize()) {
      browserRec.current = listen({ onResult: ({ transcript, isFinal }) => isFinal && sendToLaptop({ type: 'transcript', text: transcript }) })
    }
  }
  const up = () => {
    setTalking(false)
    if (modelStt) rec.current?.end()
  }
  useEffect(() => {
    if (!stream || !micOn) return
    if (modelStt) {
      if (handsFree) ensureRecorder('handsfree')
      else rec.current?.setMode('ptt')
    } else if (canRecognize()) {
      browserRec.current?.stop()
      browserRec.current = handsFree ? listen({ continuous: true, onResult: ({ transcript, isFinal }) => isFinal && sendToLaptop({ type: 'transcript', text: transcript }) }) : null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handsFree, micOn, stream])

  if (!stream) {
    return (
      <main className="phone">
        <h1 style={{ fontSize: '1.8rem', marginTop: 24 }}>Phone camera</h1>
        <p className="muted">Prop the phone 15–25 cm above the board, camera down.</p>
        <input className="code-input" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} aria-label="Pairing code" />
        <button className="btn primary xl" disabled={code.length !== 6} onClick={start}>
          Connect
        </button>
        <p className="faint" style={{ fontSize: '0.8rem' }}>
          Don’t point the camera at confidential designs. Nothing is recorded.
        </p>
        {error && <p className="err-text">{error}</p>}
      </main>
    )
  }

  const ok = pair.status === 'paired'
  return (
    <main className="phone">
      <div className={`status glass ${ok ? 'ok' : ''}`}>{ok ? 'Connected' : `Connecting to ${code}…`}</div>
      {pair.error && <p className="err-text">{pair.error}</p>}
      <video ref={videoRef} muted playsInline autoPlay />
      {status && <div style={{ textAlign: 'center', fontSize: '1.6rem', fontWeight: 800 }}>{status}</div>}
      {micOn && (
        <>
          <button className={`mic ${talking ? 'live' : ''} ${handsFree ? 'armed' : ''}`} onPointerDown={down} onPointerUp={up} onPointerCancel={up} aria-label="Hold to talk">
            <Icon name="mic" />
            <span className="lvl" style={{ opacity: handsFree ? Math.min(1, level * 2) : 0 }} />
          </button>
          <button className={`btn ${handsFree ? 'on' : ''}`} onClick={() => setHandsFree(!handsFree)}>
            {handsFree ? 'Hands-free on' : 'Hands-free'}
          </button>
        </>
      )}
      {error && <p className="err-text">{error}</p>}
    </main>
  )
}

async function applyTorch(stream, on) {
  try {
    await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on }] })
  } catch {
    /* not supported */
  }
}
