import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store.js'
import { camera, registerVideo, setCalibration, setCalibrating, openLocalCamera } from '../lib/camera.js'
import { pairing, sendToPhone } from '../lib/pairing/pairing.js'
import { prefs } from '../state/settings.js'
import { ui, setUi } from '../state/ui.js'
import { solveCalibration, boardToImage } from '../lib/geometry/board.js'

/** Pick two located parts far apart, for the two-tap calibration. */
function calibrationRefs(board) {
  const located = Object.values(board.parts).filter((p) => p.loc && p.loc.side === 'top')
  let best = null
  for (let i = 0; i < located.length; i++)
    for (let j = i + 1; j < located.length; j++) {
      const d = Math.hypot(located[i].loc.x - located[j].loc.x, located[i].loc.y - located[j].loc.y)
      if (!best || d > best.d) best = { d, a: located[i].ref, b: located[j].ref }
    }
  return best ? [best.a, best.b] : null
}

/**
 * Magnified live view: digital zoom slider + tap-to-zoom, crop-tap for checks,
 * and an overlay ring on the current part once calibrated (needs pick-and-place data).
 */
export function LiveView({ board, current }) {
  const p = useStore(prefs)
  const pair = useStore(pairing)
  const cam = useStore(camera)
  const u = useStore(ui)
  const stream = p.cameraSource === 'phone' ? pair.stream : cam.localStream
  const videoRef = useRef(null)
  const boxRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [origin, setOrigin] = useState({ x: 0.5, y: 0.5 })
  const [aspect, setAspect] = useState(16 / 9)
  const [mirror, setMirror] = useState(false)
  const [torch, setTorch] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    registerVideo(v)
    if (v.srcObject !== stream) v.srcObject = stream ?? null
    if (stream) v.play().catch(() => {})
    const onMeta = () => v.videoWidth && setAspect(v.videoWidth / v.videoHeight)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('resize', onMeta)
    return () => {
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('resize', onMeta)
    }
  }, [stream])

  const toVideo = (e) => {
    const r = boxRef.current.getBoundingClientRect()
    const qx = (e.clientX - r.left) / r.width
    const qy = (e.clientY - r.top) / r.height
    // Inverse of scale(zoom) about origin: p = o + (q - o) / z
    return { x: origin.x + (qx - origin.x) / zoom, y: origin.y + (qy - origin.y) / zoom }
  }
  const toScreen = (pt) => ({ x: origin.x + (pt.x - origin.x) * zoom, y: origin.y + (pt.y - origin.y) * zoom })

  const calRefs = board?.hasLocations ? calibrationRefs(board) : null

  const onTap = (e) => {
    if (!stream) return
    const pt = toVideo(e)
    if (u.liveMode === 'crop') {
      setUi({ cropTap: { cx: pt.x, cy: pt.y, nonce: Date.now() }, liveMode: 'zoom' })
      return
    }
    if (u.liveMode === 'calibrate' && cam.calibrating) {
      const taps = [...cam.calibrating.taps, pt]
      if (taps.length < 2) {
        setCalibrating({ ...cam.calibrating, taps })
        return
      }
      const pairs = calRefs.map((ref, i) => ({ board: board.parts[ref].loc, image: taps[i] }))
      const cal = solveCalibration(pairs, aspect, mirror)
      setCalibration(cal ? { ...cal, boardId: board.id } : null)
      setUi({ liveMode: 'zoom' })
      return
    }
    // Tap to zoom: zoom in about the tapped point; tap again at max zoom to reset.
    if (zoom >= 6) {
      setZoom(1)
      setOrigin({ x: 0.5, y: 0.5 })
    } else {
      setOrigin(pt)
      setZoom((z) => Math.min(8, z < 2 ? 3 : z * 2))
    }
  }

  const cal = cam.calibration?.boardId === board?.id ? cam.calibration : null
  const curLoc = board?.parts[current]?.loc
  const ring = cal && curLoc ? toScreen(boardToImage(cal, curLoc)) : null
  const ringR = cal ? Math.max(0.03, cal.scale * 2.2 * zoom) : 0
  const crop = u.liveMode === 'crop'
  const calibrating = u.liveMode === 'calibrate' && cam.calibrating
  const calTarget = calibrating ? calRefs?.[cam.calibrating.taps.length] : null

  return (
    <section className="live-view">
      <div
        className={`live-box ${crop ? 'crop-mode' : ''} ${calibrating ? 'cal-mode' : ''}`}
        ref={boxRef}
        style={{ aspectRatio: aspect }}
        onClick={onTap}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          style={{ transformOrigin: `${origin.x * 100}% ${origin.y * 100}%`, transform: `scale(${zoom})` }}
        />
        {!stream && <NoCamera />}
        {ring && ring.x > -0.1 && ring.x < 1.1 && ring.y > -0.1 && ring.y < 1.1 && (
          <svg className="live-overlay" viewBox={`0 0 ${aspect} 1`} preserveAspectRatio="none">
            <circle cx={ring.x * aspect} cy={ring.y} r={ringR} className="live-ring" />
            <text x={ring.x * aspect + ringR + 0.01} y={ring.y} className="live-ring-label">
              {current}
            </text>
          </svg>
        )}
        {crop && <div className="live-banner">Tap the centre of {current} to crop it for the check</div>}
        {calTarget && <div className="live-banner">Calibrate: tap the centre of {calTarget} ({cam.calibrating.taps.length + 1} of 2)</div>}
        {stream && <div className="live-zoom-label">{zoom.toFixed(1)}×</div>}
      </div>
      <div className="live-controls">
        <label className="zoom-slider">
          Zoom
          <input
            type="range"
            min={1}
            max={8}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Digital zoom"
          />
        </label>
        <button
          className="btn small"
          onClick={() => {
            setZoom(1)
            setOrigin({ x: 0.5, y: 0.5 })
          }}
        >
          Reset zoom
        </button>
        {p.cameraSource === 'phone' && pair.status === 'paired' && (
          <button
            className={`btn small ${torch ? 'on' : ''}`}
            onClick={() => {
              sendToPhone({ type: 'torch', on: !torch })
              setTorch(!torch)
            }}
          >
            {torch ? 'Light off' : 'Phone light'}
          </button>
        )}
        {calRefs && stream && (
          <>
            <button
              className="btn small"
              onClick={() => {
                setCalibrating({ taps: [] })
                setUi({ liveMode: 'calibrate' })
              }}
            >
              {cal ? 'Re-calibrate overlay' : 'Calibrate overlay'}
            </button>
            <label className="small">
              <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> mirrored view
            </label>
            {cal && (
              <button className="btn small" onClick={() => setCalibration(null)}>
                Clear overlay
              </button>
            )}
          </>
        )}
        {(crop || calibrating) && (
          <button className="btn small" onClick={() => setUi({ liveMode: 'zoom' })}>
            Cancel tap
          </button>
        )}
      </div>
    </section>
  )
}

function NoCamera() {
  const p = useStore(prefs)
  const pair = useStore(pairing)
  const cam = useStore(camera)
  return (
    <div className="no-camera" onClick={(e) => e.stopPropagation()}>
      {p.cameraSource === 'phone' ? (
        <>
          <strong>No phone camera yet</strong>
          <span>{pair.status === 'off' ? 'Pair a phone on the Setup screen.' : 'Waiting for the phone to start streaming…'}</span>
          <a className="btn small" href="#/setup">
            Pair phone
          </a>
        </>
      ) : (
        <>
          <strong>Camera off</strong>
          {cam.error && <span className="error-text">{cam.error}</span>}
          <button className="btn small primary" onClick={() => openLocalCamera().catch(() => {})}>
            Start this device’s camera
          </button>
        </>
      )}
      <span className="muted small">Don’t point the camera at confidential designs. Photos are never saved.</span>
    </div>
  )
}
