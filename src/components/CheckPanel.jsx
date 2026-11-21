import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store.js'
import { session } from '../state/session.js'
import { ui, setUi } from '../state/ui.js'
import { prefs } from '../state/settings.js'
import { captureStill, activeStream } from '../lib/camera.js'
import { pairing } from '../lib/pairing/pairing.js'
import { cropCanvas, assessQuality, toJpegDataUrl } from '../lib/imaging/image.js'
import { neighbors } from '../lib/geometry/board.js'
import * as Vision from '../lib/ai/tasks/visionCheck.js'
import { useAiTask } from '../lib/ai/useAiTask.js'
import { AiResult, AiLoading, AiError } from './Ai.jsx'
import { FixHelp } from './FixHelp.jsx'
import { speak, sayRef } from '../lib/voice/speech.js'

const VERDICT_UI = {
  looks_right: { label: 'AI sees no problem', cls: 'ok', icon: '○' },
  possible_problem: { label: 'Possible problem', cls: 'bad', icon: '!' },
  cant_tell: { label: 'Can’t tell', cls: 'unsure', icon: '?' },
}

/**
 * Check flow: tap the part on the live view -> full-res still -> crop -> local quality check
 * -> vision model with BOM context -> verdict that the user must confirm themselves.
 */
export function CheckPanel({ refName }) {
  const s = useStore(session)
  const u = useStore(ui)
  useStore(pairing, (p) => p.stream)
  useStore(prefs, (p) => p.cameraSource)
  const part = s.board.parts[refName]
  const [stage, setStage] = useState('idle') // idle | await-tap | capturing | preview | done
  const [still, setStill] = useState(null) // { canvas, source }
  const [tap, setTap] = useState(null)
  const [size, setSize] = useState(0.22)
  const [crop, setCrop] = useState(null) // { dataUrl, width, height, quality }
  const [error, setError] = useState(null)
  const ai = useAiTask(Vision.TASK)
  const lastRequest = useRef(u.checkRequest)
  const lastTap = useRef(u.cropTap?.nonce)

  const needsOrientation = part.polarity.polarized && !s.orientationOk[refName]
  const hasCamera = Boolean(activeStream())

  // Reset when the part changes, so nothing from C7 is shown against C8.
  useEffect(() => {
    setStage('idle')
    setStill(null)
    setCrop(null)
    setError(null)
    ai.reset()
    if (ui.get().liveMode === 'crop') setUi({ liveMode: 'zoom' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refName])

  const begin = () => {
    setError(null)
    setCrop(null)
    ai.reset()
    setStage('await-tap')
    setUi({ liveMode: 'crop' })
    // The user has to tap the live view next: make sure it is on screen.
    document.querySelector('.live-box')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  // Voice "check this"
  useEffect(() => {
    if (u.checkRequest !== lastRequest.current) {
      lastRequest.current = u.checkRequest
      if (!needsOrientation && hasCamera) begin()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u.checkRequest])

  // Crop tap on the live view
  useEffect(() => {
    const t = u.cropTap
    if (!t || t.nonce === lastTap.current) return
    lastTap.current = t.nonce
    if (stage !== 'await-tap') return
    setTap(t)
    setStage('capturing')
    captureStill()
      .then((st) => {
        setStill(st)
        setStage('preview')
      })
      .catch((e) => {
        setError(e.message)
        setStage('idle')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u.cropTap])

  // (Re)build the crop when the still, tap or size changes
  useEffect(() => {
    if (!still || !tap) return
    const { canvas } = cropCanvas(still.canvas, { cx: tap.cx, cy: tap.cy, size })
    setCrop({ dataUrl: toJpegDataUrl(canvas), width: canvas.width, height: canvas.height, quality: assessQuality(canvas) })
  }, [still, tap, size])

  const send = () => {
    const ctx = Vision.buildContext(s.board, refName, neighbors(s.board, refName))
    setStage('done')
    ai.run({
      key: refName,
      messages: Vision.buildMessages(ctx, crop.dataUrl),
      simulate: () => Vision.simulate(ctx),
      validate: (v) => Vision.validate(v),
      inputSummary: Vision.inputSummary(ctx, crop),
      fallbackAction: 'Showed the error and offered a manual check by eye.',
    }).then((r) => {
      if (!r) return
      const p = prefs.get()
      if (r.ok) {
        const v = VERDICT_UI[r.data.verdict]
        speak(`AI check of ${sayRef(refName)}: ${v.label}. ${r.data.verdict === 'looks_right' ? 'Please confirm with your own eyes.' : ''}`, { enabled: p.speakAloud, rate: p.voiceRate })
      } else {
        speak('The AI check did not work. Check it by eye.', { enabled: p.speakAloud, rate: p.voiceRate })
      }
    })
  }

  const record = (user, issue = null) => {
    session.dispatch({ type: 'record-check', ref: refName, user, ai: ai.status === 'done' ? ai.data.verdict : null, issue })
  }

  const ctxForFix = Vision.buildContext(s.board, refName, [])
  const userCheck = s.checks[refName]

  return (
    <section className="check-panel">
      <div className="panel-title">
        <h2>Check {refName}</h2>
        {userCheck && <span className={`pill ${userCheck.user === 'ok' ? 'good' : 'bad'}`}>You marked: {userCheck.user === 'ok' ? 'looks good' : 'problem'}</span>}
      </div>

      {stage === 'idle' && (
        <div className="check-start">
          <button className="btn big" disabled={needsOrientation || !hasCamera} onClick={begin}>
            🔍 Check this part <kbd>K</kbd>
          </button>
          {needsOrientation && <p className="hint">Confirm the orientation first (polarized part).</p>}
          {!hasCamera && <p className="hint">No camera connected. You can still check by eye:</p>}
          <ManualCheck onRecord={record} />
          {error && <p className="error-text">{error}</p>}
        </div>
      )}

      {stage === 'await-tap' && (
        <div className="check-step">
          <p className="big-hint">👆 Tap the centre of {refName} on the live view.</p>
          <p className="muted">Zoom in first if the part is small. Only the cropped area is sent, never the whole board.</p>
          <button className="btn" onClick={() => { setStage('idle'); setUi({ liveMode: 'zoom' }) }}>
            Cancel
          </button>
        </div>
      )}

      {stage === 'capturing' && <AiLoading label="Taking a full-resolution photo on the phone…" />}

      {stage === 'preview' && crop && (
        <div className="check-step">
          <div className="crop-preview">
            <img src={crop.dataUrl} alt={`Crop of ${refName} to be checked`} />
            <div>
              <label>
                Crop size
                <input type="range" min={0.06} max={0.6} step={0.01} value={size} onChange={(e) => setSize(Number(e.target.value))} />
              </label>
              <p className="muted small">
                {crop.width}×{crop.height}px from {still.source}.
              </p>
              {crop.quality.problems.map((q) => (
                <p key={q} className="warn-text">⚠ {q}</p>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="btn primary big" onClick={send}>
              Send to AI check
            </button>
            <button className="btn" onClick={begin}>
              Retake
            </button>
            <button className="btn" onClick={() => setStage('idle')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === 'done' && (
        <div className="check-step">
          {ai.status === 'loading' && <AiLoading label={`AI is looking at ${refName}…`} timeoutMs={ai.timeoutMs} onCancel={() => { ai.cancel(); setStage('preview') }} />}
          {ai.status === 'error' && (
            <>
              <AiError kind={ai.kind} error={ai.error} onRetry={send} fallbackText="The check is optional: inspect the joint yourself and record the result." />
              <ManualCheck onRecord={record} />
            </>
          )}
          {ai.status === 'done' && ai.key === refName && (
            <VisionResult
              refName={refName}
              crop={crop}
              result={ai}
              onRetake={begin}
              onRecord={record}
              ctx={ctxForFix}
            />
          )}
        </div>
      )}
    </section>
  )
}

function ManualCheck({ onRecord }) {
  return (
    <div className="row manual-check">
      <button className="btn" onClick={() => onRecord('ok')}>
        ✓ I checked it: looks good
      </button>
      <button className="btn warn" onClick={() => onRecord('problem')}>
        ✗ I see a problem
      </button>
    </div>
  )
}

function VisionResult({ refName, crop, result, onRetake, onRecord, ctx }) {
  const d = result.data
  const v = VERDICT_UI[d.verdict]
  const [manualIssue, setManualIssue] = useState(null)
  const [overridden, setOverridden] = useState(false)
  const issue = manualIssue ?? d.issues[0] ?? null

  return (
    <>
      <AiResult
        meta={result.meta}
        title={`Solder check: ${refName}`}
        feedback={{
          task: Vision.TASK,
          inputSummary: `Crop ${crop.width}×${crop.height}px of ${refName}`,
          modelSaid: `${d.verdict} (${d.confidence}): ${d.observed} ${d.issues.map((i) => `${i.type} ${i.where}`).join('; ')}`,
          uiAction: `Showed "${v.label}"${d.issues.length ? ` with ${d.issues.map((i) => i.type).join(', ')}` : ''}; asked the user to confirm by eye.`,
          corrections: ['Actually fine', 'Missed a problem', 'Named the wrong problem', 'Photo was unusable', 'Wrong part'],
        }}
        onMarkedWrong={() => setOverridden(true)}
      >
        <div className="vision-result">
          <figure>
            <img src={crop.dataUrl} alt={`The exact image the AI analysed for ${refName}`} />
            <figcaption className="muted small">What the AI looked at</figcaption>
          </figure>
          <div>
            <div className={`verdict ${v.cls}`}>
              <span className="verdict-icon">{v.icon}</span> {v.label}
              <span className="confidence">confidence: {d.confidence}</span>
            </div>
            <p>
              <strong>It saw:</strong> {d.observed}
            </p>
            {d.issues.length > 0 && (
              <ul className="issues">
                {d.issues.map((i, k) => (
                  <li key={k}>
                    <strong>{Vision.ISSUE_LABELS[i.type]}</strong>
                    {i.where && ` — ${i.where}`}
                    {i.detail && <div className="muted">{i.detail}</div>}
                  </li>
                ))}
              </ul>
            )}
            {d.verdict === 'cant_tell' && (
              <div className="unsure-box">
                <strong>The AI could not judge this photo.</strong> {d.retakeAdvice}
                <div className="row">
                  <button className="btn" onClick={onRetake}>
                    Retake closer
                  </button>
                </div>
              </div>
            )}
            {d.verdict === 'looks_right' && (
              <p className="confirm-note">AI sees no problem, please confirm with your own eyes. It is never an all-clear.</p>
            )}
            {d.verdict === 'possible_problem' && d.retakeAdvice && <p className="muted">{d.retakeAdvice}</p>}
          </div>
        </div>
      </AiResult>

      {overridden && <p className="muted">Marked as wrong. Trust your own inspection; record it below.</p>}

      <div className="row your-call">
        <strong>Your call:</strong>
        <button className="btn good" onClick={() => onRecord('ok')}>
          ✓ I looked myself: it’s good
        </button>
        <button className="btn warn" onClick={() => onRecord('problem', issue?.type ?? 'other')}>
          ✗ It has a problem
        </button>
        <button className="btn" onClick={onRetake}>
          Retake
        </button>
      </div>

      <div className="fix-picker">
        <span className="muted">Need fix steps? Pick the problem{d.issues.length ? ' (AI suggestion first)' : ''}:</span>
        <div className="chips">
          {[...new Set([...d.issues.map((i) => i.type), 'bridged', 'flipped', 'insufficient_solder', 'lifted_lead', 'tombstoned', 'misaligned', 'missing'])].map((t) => (
            <button key={t} className={`chip ${issue?.type === t ? 'on' : ''}`} onClick={() => setManualIssue(d.issues.find((i) => i.type === t) ?? { type: t, where: '', detail: '' })}>
              {Vision.ISSUE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      {issue && (d.verdict === 'possible_problem' || manualIssue) && <FixHelp ctx={ctx} issue={issue} />}
    </>
  )
}
