import { useEffect, useRef } from 'react'
import { useStore } from '../lib/store.js'
import { ui, setUi } from '../state/ui.js'
import { dispatch } from '../state/projects.js'
import { usage, costSummary, formatUsd } from '../state/logs.js'
import { voice, pttDown, pttUp, setHandsFree, runCommand } from '../lib/voice/controller.js'
import { packageGeometry } from '../lib/bom/packages.js'
import { categoryOf } from '../lib/plan/plan.js'
import { entryById } from '../lib/ai/tasks/assistant.js'
import library from '../data/techniques.json'
import { BomList } from './BomList.jsx'
import { Icon, AiBadge, MarkWrong } from './ui.jsx'

// ---------------- BOM rail ----------------

/** Collapsed: a thin bar of ref des in build order. Tap to open the full draggable list. */
export function BomRail({ project }) {
  const open = useStore(ui, (s) => s.railOpen)
  const curRef = useRef(null)
  useEffect(() => {
    curRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [project.current])
  return (
    <>
      <nav className="rail glass" onClick={() => setUi({ railOpen: true })} aria-label="Build order (tap to edit)">
        {project.plan.categories.map((c, ci) => (
          <div key={c.id} style={{ display: 'contents' }}>
            {ci > 0 && <span className="gap" />}
            {c.refs.map((r) => (
              <span key={r} ref={r === project.current ? curRef : undefined} className={`r ${r === project.current ? 'cur' : (project.status[r] ?? '')}`}>
                {r}
              </span>
            ))}
          </div>
        ))}
      </nav>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => setUi({ railOpen: false })} />
          <aside className="drawer glass" aria-label="Build order">
            <div className="card-row">
              <h2>Order</h2>
              <span className="spacer" />
              <button className="btn icon sm" onClick={() => setUi({ railOpen: false })} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <BomList
              plan={project.plan}
              board={project.board}
              status={project.status}
              current={project.current}
              verifications={project.verifications}
              onChange={(plan) => dispatch({ type: 'set-plan', plan })}
              onPick={(ref) => dispatch({ type: 'jump', ref })}
            />
          </aside>
        </>
      )}
    </>
  )
}

// ---------------- voice bar ----------------

const tips = library.tips ?? {}

/** Bottom bar: what was heard, what the app says, and a one-line tip for the current part. */
export function VoiceBar({ project }) {
  const v = useStore(voice)
  const part = project.current ? project.board.parts[project.current] : null
  const family = part ? packageGeometry(part).family : null
  const cat = part ? categoryOf(project.plan, part.ref) : null
  const guidance = part ? (tips[family] ?? tips.generic) : ''
  const phoneMic = project.settings.micSource === 'phone'

  useEffect(() => {
    const down = (e) => {
      if (e.repeat || e.key.toLowerCase() !== 't' || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      pttDown()
    }
    const up = (e) => e.key.toLowerCase() === 't' && pttUp()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  return (
    <footer className="voicebar glass">
      <button
        className={`mic ${v.listening ? 'live' : ''} ${v.handsFree ? 'armed' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId)
          pttDown()
        }}
        onPointerUp={pttUp}
        onPointerCancel={pttUp}
        aria-label="Hold to talk (T)"
        title="Hold to talk (T)"
      >
        <Icon name={phoneMic ? 'phone' : 'mic'} />
        <span className="lvl" style={{ opacity: v.handsFree ? Math.min(1, v.level * 2) : 0, transform: `scale(${1 + v.level * 0.25})` }} />
      </button>
      <div className="vtext" aria-live="polite">
        <div className="vheard">
          {v.busy === 'transcribing' ? (
            <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          ) : v.heard ? (
            <>
              {v.heardMeta && <AiBadge simulated={false} />}
              <q>{v.heard}</q>
              {v.heardMeta && (
                <MarkWrong task="stt" meta={v.heardMeta} inputSummary={`${v.heardMeta.audioSeconds ?? '?'} s of audio`} modelSaid={v.heard} uiAction="Ran the command it heard." options={['Misheard']} onMarked={() => runCommand({ type: 'back' })} />
              )}
            </>
          ) : (
            <span className="faint">{cat ? cat.name : 'Hold the mic or press T'}</span>
          )}
        </div>
        <div className="vsay">
          {v.busy === 'thinking' ? (
            <>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> <span className="muted">Thinking…</span>
            </>
          ) : v.say ? (
            <>
              {v.sayMeta && <AiBadge simulated={v.sayMeta.simulated} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.say}</span>
              {v.sources.map((id) => (
                <span key={id} className="src" title={entryById(id)?.steps.join(' ')}>
                  {entryById(id)?.title}
                </span>
              ))}
              {v.sayMeta && (
                <MarkWrong task="assistant" meta={v.sayMeta} inputSummary={`"${v.sayFrom?.utterance}"`} modelSaid={JSON.stringify(v.sayFrom?.data)} uiAction={`Did "${v.sayFrom?.data.action}" and said: ${v.say}`} options={['Wrong action', 'Wrong answer']} />
              )}
            </>
          ) : (
            <span>{guidance}</span>
          )}
        </div>
        {v.error && <div className="err-text">{v.error}</div>}
      </div>
      <button className={`btn sm ${v.handsFree ? 'on' : ''}`} onClick={() => setHandsFree(!v.handsFree)} aria-pressed={v.handsFree} title="Listen without holding the button">
        {v.handsFree ? 'Hands-free on' : 'Hands-free'}
      </button>
    </footer>
  )
}

// ---------------- top bar pieces ----------------

export function CostChip() {
  const calls = useStore(usage, (s) => s.calls)
  const sum = costSummary(calls)
  return (
    <button className="chip cost" onClick={() => setUi({ logOpen: true })} title="Cost and failure log">
      {formatUsd(sum.known)}
      {sum.unknownCalls > 0 && <span className="unk">+{sum.unknownCalls}?</span>}
      <Icon name="log" className="ico" />
    </button>
  )
}
