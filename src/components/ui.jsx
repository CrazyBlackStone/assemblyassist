import { useState } from 'react'
import { logFailure, recordFeedback } from '../state/logs.js'

const P = {
  back: 'M15 5l-7 7 7 7',
  next: 'M5 12h13M13 6l6 6-6 6',
  skip: 'M5 6l8 6-8 6V6zM15 6v12',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-2',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  flip: 'M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5',
  swap: 'M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4',
  mic: 'M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  retake: 'M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 110 8 4 4 0 010-8z',
  rotate: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  log: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  down: 'M7 14l5-5 5 5',
  thumbDown: 'M10 15v4a3 3 0 003 3l4-9V2H6.7a2 2 0 00-2 1.7l-1.4 9A2 2 0 005.3 15zM17 2h3v11h-3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  phone: 'M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2zM11 18h2',
  done: 'M4 12.5l3.5 3.5L14 9M10 16l1 1 9-10',
  board: 'M4 5h16v14H4zM8 9h3v3H8zM14 9h2M14 13h2M8 15h8',
}

export function Icon({ name, className = 'ico' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name]} />
    </svg>
  )
}

export function AiBadge({ simulated }) {
  return (
    <span className={`ai-badge ${simulated ? 'sim' : ''}`} title={simulated ? 'Simulated: no model was called' : 'AI-generated'}>
      <Icon name="spark" className="ico" />
      {simulated ? 'SIM' : 'AI'}
    </span>
  )
}

/**
 * Thumbs-down on any AI output: one tap opens a few correction chips; choosing one
 * writes a failure-log entry. Kept to icons so it doesn't crowd the screen.
 */
export function MarkWrong({ task, meta, inputSummary, modelSaid, uiAction, options, onMarked }) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)
  if (done) return <span className="faint" style={{ fontSize: '0.8rem' }}>Logged</span>
  const save = (choice) => {
    logFailure({ task, model: meta?.model, kind: 'marked-wrong', inputSummary, modelSaid, userSaysRight: choice, uiAction })
    recordFeedback({ task, model: meta?.model, verdict: 'wrong' })
    setDone(true)
    onMarked?.(choice)
  }
  return (
    <span className="feedback">
      {!open && (
        <button className="btn icon sm ghost" onClick={() => setOpen(true)} title="Mark as wrong" aria-label="Mark as wrong">
          <Icon name="thumbDown" />
        </button>
      )}
      {open &&
        options.map((o) => (
          <button key={o} className="btn sm" onClick={() => save(o)}>
            {o}
          </button>
        ))}
    </span>
  )
}

export function Switch({ checked, onChange, label }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

export function Seg({ value, options, onChange }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
