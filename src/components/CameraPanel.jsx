import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../lib/store.js'
import { camera, registerVideo, openLocalCamera } from '../lib/camera.js'
import { pairing, startHost, pairUrl } from '../lib/pairing/pairing.js'
import { ui } from '../state/ui.js'
import { calibrationFor, currentSide } from '../state/projects.js'
import { crops } from '../lib/verify/verify.js'
import { calibrationTap, completeTap, closeCheck, confirmCheck, checkPart, startCalibration, closeReview } from '../lib/verify/flow.js'
import { setUi } from '../state/ui.js'
import { ISSUE_LABELS } from '../lib/ai/tasks/verify.js'
import { Icon, AiBadge, MarkWrong } from './ui.jsx'

// Panel 3: the phone's camera. Checks blur it and float the cropped part with the AI's
// verdict on top; the final review shows every crop in order.

export function CameraPanel({ project }) {
  const source = project.settings.cameraSource
  const pair = useStore(pairing)
  const cam = useStore(camera)
  const u = useStore(ui)
  const stream = source === 'phone' ? pair.stream : cam.localStream
  const videoRef = useRef(null)
  const boxRef = useRef(null)
  const [aspect, setAspect] = useState(16 / 9)
  const [zoom, setZoom] = useState({ z: 1, x: 0.5, y: 0.5 })

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

  useEffect(() => {
    if (source === 'phone') startHost()
    else openLocalCamera().catch(() => {})
  }, [source])

  // Click position -> normalized video coordinates (object-fit: contain, plus zoom).
  const toVideo = (e) => {
    const r = boxRef.current.getBoundingClientRect()
    const boxAspect = r.width / r.height
    const dispW = boxAspect > aspect ? r.height * aspect : r.width
    const dispH = boxAspect > aspect ? r.height : r.width / aspect
    const qx = (e.clientX - r.left - (r.width - dispW) / 2) / dispW
    const qy = (e.clientY - r.top - (r.height - dispH) / 2) / dispH
    return { x: zoom.x + (qx - zoom.x) / zoom.z, y: zoom.y + (qy - zoom.y) / zoom.z }
  }

  const onTap = (e) => {
    if (!stream) return
    const pt = toVideo(e)
    if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) return
    if (u.calibrating) return calibrationTap(pt, aspect)
    if (u.tapRequest) return completeTap(pt)
    setZoom((z) => (z.z > 1 ? { z: 1, x: 0.5, y: 0.5 } : { z: 2.5, x: pt.x, y: pt.y }))
  }

  const overlay = (u.check && u.check.status !== 'tap') || u.review
  const calibrated = Boolean(calibrationFor(project, currentSide(project)))
  const promptRef = u.calibrating ? u.calibrating.refs[u.calibrating.taps.length] : u.tapRequest?.ref

  return (
    <section className="panel p3 glass" aria-label="Camera">
      <div className={`video-wrap ${overlay ? 'blur' : ''}`} ref={boxRef}>
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          style={{ transformOrigin: `${zoom.x * 100}% ${zoom.y * 100}%`, transform: overlay ? undefined : `scale(${zoom.z})` }}
        />
        {stream && <div className={`tapzone ${promptRef ? 'active' : ''}`} onClick={onTap} />}
      </div>

      {!stream && (source === 'phone' ? <PairInline pair={pair} /> : <LocalCamPrompt error={cam.error} />)}

      {promptRef && !overlay && (
        <div className="prompt glass">
          <Icon name="target" />
          Tap <b>{promptRef}</b>
          <button className="btn icon sm ghost" onClick={() => (u.calibrating ? setUi({ calibrating: null }) : closeCheck())} aria-label="Cancel">
            <Icon name="x" />
          </button>
        </div>
      )}

      {stream && !overlay && !promptRef && (
        <div className="corner tr">
          <button className={`btn icon ${calibrated ? 'on' : ''}`} onClick={() => startCalibration()} title={calibrated ? 'Recalibrate camera' : 'Calibrate camera'} aria-label="Calibrate camera">
            <Icon name="target" />
          </button>
        </div>
      )}
      {stream && !overlay && (
        <div className="corner tl">
          <span className="chip">
            <span className="dot placed" /> {source === 'phone' ? 'Phone' : 'Camera'}
          </span>
        </div>
      )}

      {u.check && u.check.status !== 'tap' && <CheckCard check={u.check} project={project} />}
      {u.review && <ReviewCard review={u.review} />}
    </section>
  )
}

function PairInline({ pair }) {
  const [qr, setQr] = useState(null)
  const url = pair.code ? pairUrl(pair.code) : null
  useEffect(() => {
    if (url) QRCode.toDataURL(url, { margin: 1, width: 300 }).then(setQr).catch(() => setQr(null))
  }, [url])
  return (
    <div className="empty-cam">
      {qr ? <img className="qr" src={qr} alt="Scan with the phone to pair" /> : <div className="spinner" />}
      <div className="code">{pair.code ?? '······'}</div>
      <div className="muted">Scan with the phone</div>
      {pair.error && <div className="err-text">{pair.error}</div>}
    </div>
  )
}

function LocalCamPrompt({ error }) {
  return (
    <div className="empty-cam">
      <button className="btn primary xl" onClick={() => openLocalCamera().catch(() => {})}>
        Start camera
      </button>
      {error && <div className="err-text">{error}</div>}
    </div>
  )
}

const MARK = { ok: '✓', problem: '!', unclear: '?', bad: '✕' }

function Verdict({ label, state }) {
  const cls = { correct: 'ok', good: 'ok', wrong: 'bad', problem: 'bad', unclear: 'unclear', not_checked: 'na' }[state] ?? 'na'
  const icon = { ok: '✓', bad: '✕', unclear: '?', na: '–' }[cls]
  return (
    <div className={`v ${cls}`}>
      <span className="vi">{icon}</span>
      <span>
        {label}
        <small>{state === 'not_checked' ? 'off' : state === 'correct' || state === 'good' ? 'looks right' : state}</small>
      </span>
    </div>
  )
}

function CheckCard({ check, project }) {
  const crop = useStore(crops, (s) => s[check.ref])
  const r = check.result
  const d = r?.ok ? r.data : null
  const busy = check.status === 'capturing' || check.status === 'checking'
  const head = d ? { ok: ['ok', 'AI sees no problem'], problem: ['bad', d.issues.map((i) => ISSUE_LABELS[i.type]).join(' · ')], unclear: ['unclear', 'Can’t tell'] }[d.verdict] : null
  return (
    <div className="overlay">
      <div className="check-card glass" role="dialog" aria-label={`Check of ${check.ref}`}>
        <div className="img">
          {crop ? <img src={crop.dataUrl} alt={`What the AI looked at: ${check.ref}`} /> : <div className="empty-cam"><div className="spinner" /></div>}
          <span className="ref">{check.ref}</span>
        </div>
        {busy && (
          <div className="card-row">
            <div className="spinner" />
            <span className="muted">{check.status === 'capturing' ? 'Taking photo…' : 'Checking…'}</span>
            <span className="spacer" />
            <button className="btn sm" onClick={closeCheck}>
              Cancel
            </button>
          </div>
        )}
        {check.status === 'error' && (
          <>
            <div className="headline unclear">Not checked</div>
            <div className="muted">{check.error}</div>
            <div className="card-row">
              <button className="btn" onClick={() => checkPart(check.ref)}>
                <Icon name="retake" /> Retry
              </button>
              <span className="spacer" />
              <button className="btn" onClick={closeCheck}>
                Close
              </button>
            </div>
          </>
        )}
        {d && (
          <>
            <div className="card-row">
              <span className={`headline ${head[0]}`}>{head[1]}</span>
              <span className="spacer" />
              <AiBadge simulated={r.meta?.simulated} />
            </div>
            <div className="verdicts">
              <Verdict label="Orientation" state={d.orientation} />
              <Verdict label="Solder" state={d.soldering} />
            </div>
            {d.verdict === 'unclear' && <div className="muted">Move closer or add light, then retake.</div>}
            {d.verdict === 'ok' && <div className="muted">Confirm with your own eyes.</div>}
            <div className="card-row">
              <button className="btn icon" onClick={() => checkPart(check.ref)} aria-label="Retake">
                <Icon name="retake" />
              </button>
              <MarkWrong
                task="verify"
                meta={r.meta}
                inputSummary={`Crop of ${check.ref} (${crop?.width}px${crop?.canonical ? ', rotated to reference' : ''})`}
                modelSaid={`${d.verdict}: orientation ${d.orientation}, solder ${d.soldering}, ${d.confidence}; ${d.issues.map((i) => `${i.type} ${i.where}`).join('; ')} — ${d.observed}`}
                uiAction={`Showed "${head[1]}" over the video and asked the user to confirm.`}
                options={['Actually fine', 'Missed a problem', 'Wrong problem', 'Photo unusable']}
              />
              <span className="spacer" />
              <button className="btn bad icon" onClick={() => confirmCheck('problem')} aria-label="It has a problem">
                <Icon name="x" />
              </button>
              <button className="btn ok" onClick={() => confirmCheck('ok')}>
                <Icon name="check" /> Good
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ReviewCard({ review }) {
  const all = useStore(crops)
  const [open, setOpen] = useState(null)
  const done = review.items.filter((i) => !['wait', 'checking'].includes(i.status)).length
  const problems = review.items.filter((i) => i.status === 'problem').length
  const sel = open ? review.items.find((i) => i.ref === open) : null
  return (
    <div className="overlay">
      <div className="review glass" role="dialog" aria-label="Final review">
        <div className="card-row">
          <span className="headline">{review.status === 'done' ? (problems ? `${problems} to fix` : 'No problems seen') : `${done} / ${review.items.length}`}</span>
          {review.status !== 'done' && <div className="spinner" />}
          <span className="spacer" />
          <AiBadge simulated={review.items.find((i) => i.result?.meta)?.result.meta.simulated} />
          <button className="btn icon sm" onClick={closeReview} aria-label="Close review">
            <Icon name="x" />
          </button>
        </div>
        {sel?.result?.ok ? (
          <div className="card-row" style={{ alignItems: 'flex-start' }}>
            <img src={all[sel.ref]?.dataUrl} alt="" style={{ width: 160, borderRadius: 16 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <b style={{ fontSize: '1.3rem' }}>{sel.ref}</b>
              <div className="verdicts">
                <Verdict label="Orientation" state={sel.result.data.orientation} />
                <Verdict label="Solder" state={sel.result.data.soldering} />
              </div>
              {sel.result.data.issues.length > 0 && <div className="issue">{sel.result.data.issues.map((i) => ISSUE_LABELS[i.type]).join(' · ')}</div>}
              <MarkWrong
                task="verify"
                meta={sel.result.meta}
                inputSummary={`Review crop of ${sel.ref}`}
                modelSaid={`${sel.result.data.verdict}: ${sel.result.data.observed}`}
                uiAction="Showed in the final review grid."
                options={['Actually fine', 'Missed a problem', 'Wrong problem', 'Photo unusable']}
              />
            </div>
          </div>
        ) : null}
        <div className="review-grid">
          {review.items.map((it) => (
            <button key={it.ref} className={`tile ${it.status} ${review.activeRef === it.ref || open === it.ref ? 'active' : ''} ${all[it.ref] ? '' : 'wait'}`} onClick={() => setOpen(open === it.ref ? null : it.ref)}>
              {all[it.ref] && it.status !== 'wait' ? <img src={all[it.ref].dataUrl} alt={it.ref} /> : it.status === 'checking' ? <div className="spinner" /> : null}
              <span className="tref">{it.ref}</span>
              {MARK[it.status] && <span className="tv">{MARK[it.status]}</span>}
            </button>
          ))}
        </div>
        {review.status === 'done' && <div className="muted">AI review only. Confirm by eye, then test with the multimeter.</div>}
      </div>
    </div>
  )
}
