import { useEffect, useState } from 'react'
import { logFailure, recordFeedback, formatUsd } from '../state/logs.js'

/** Small inline tag for AI-generated text that appears outside an AiResult card (e.g. block reasons). */
export function AiTag({ simulated }) {
  return <span className={`ai-tag ${simulated ? 'sim' : ''}`}>{simulated ? 'Simulated AI' : 'AI-generated'}</span>
}

/**
 * Every AI result is shown through this wrapper: it always shows the AI label, the model,
 * time and cost, and the "helpful" / "mark as wrong" controls that feed the failure log.
 *
 * feedback: { task, inputSummary, modelSaid, uiAction, corrections: string[] }
 */
export function AiResult({ meta, title, children, feedback, onMarkedWrong, compact = false }) {
  const [state, setState] = useState('none') // none | helpful | wrong-open | wrong
  const [choice, setChoice] = useState('')
  const [note, setNote] = useState('')
  const simulated = meta?.simulated

  const saveWrong = () => {
    const userSaysRight = [choice, note].filter(Boolean).join(' — ') || 'Not specified'
    logFailure({
      task: feedback.task,
      model: meta?.model,
      kind: 'marked-wrong',
      inputSummary: feedback.inputSummary,
      modelSaid: feedback.modelSaid,
      userSaysRight,
      uiAction: feedback.uiAction,
    })
    recordFeedback({ task: feedback.task, model: meta?.model, verdict: 'wrong' })
    setState('wrong')
    onMarkedWrong?.(choice)
  }

  return (
    <section className={`ai-result ${simulated ? 'sim' : ''} ${compact ? 'compact' : ''}`} aria-label="AI-generated result">
      <header className="ai-head">
        <AiTag simulated={simulated} />
        {title && <h3>{title}</h3>}
        <span className="ai-meta">
          {simulated ? 'no model was called' : meta?.model}
          {meta?.ms != null && ` · ${(meta.ms / 1000).toFixed(1)} s`}
          {meta && ` · ${meta.cost == null ? 'cost unknown' : formatUsd(meta.cost)}`}
        </span>
      </header>
      <div className="ai-body">{children}</div>
      <footer className="ai-feedback">
        {state === 'none' && (
          <>
            <button
              className="btn small"
              onClick={() => {
                recordFeedback({ task: feedback.task, model: meta?.model, verdict: 'helpful' })
                setState('helpful')
              }}
            >
              👍 Helpful
            </button>
            <button className="btn small warn" onClick={() => setState('wrong-open')}>
              ✗ Mark as wrong
            </button>
          </>
        )}
        {state === 'helpful' && <span className="muted">Thanks, recorded as helpful.</span>}
        {state === 'wrong' && <span className="muted">Recorded in the failure log.</span>}
        {state === 'wrong-open' && (
          <div className="wrong-form">
            <strong>What was actually right?</strong>
            <div className="chips">
              {(feedback.corrections ?? []).map((c) => (
                <button key={c} className={`chip ${choice === c ? 'on' : ''}`} onClick={() => setChoice(c)}>
                  {c}
                </button>
              ))}
            </div>
            <input placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              <button className="btn small primary" onClick={saveWrong}>
                Save to failure log
              </button>
              <button className="btn small" onClick={() => setState('none')}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </footer>
    </section>
  )
}

/** Visible loading state with elapsed time, cancel, and a reminder that manual mode still works. */
export function AiLoading({ label, timeoutMs, onCancel }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const t = setInterval(() => setElapsed(Date.now() - start), 200)
    return () => clearInterval(t)
  }, [])
  const slow = timeoutMs && elapsed > timeoutMs * 0.5
  return (
    <div className="ai-loading" role="status">
      <div className="spinner" aria-hidden />
      <div>
        <strong>{label}</strong>
        <div className="muted">
          {(elapsed / 1000).toFixed(1)} s{timeoutMs ? ` (gives up at ${Math.round(timeoutMs / 1000)} s)` : ''}
          {slow && ' · slow answer; you can keep working manually'}
        </div>
      </div>
      {onCancel && (
        <button className="btn small" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  )
}

export function AiError({ error, kind, onRetry, fallbackText }) {
  return (
    <div className="ai-error" role="alert">
      <strong>{kind === 'no-key' ? 'No API key' : kind === 'timeout' ? 'The AI took too long' : 'The AI call did not work'}</strong>
      <div>{error}</div>
      {fallbackText && <div className="muted">{fallbackText}</div>}
      {onRetry && kind !== 'no-key' && (
        <button className="btn small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
