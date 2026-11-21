import { useEffect, useState } from 'react'
import { useStore } from '../lib/store.js'
import { session, progress, groupInfo, currentBlock, blocksAwaitingCheck, blockProgress, STATUS } from '../state/session.js'
import { ui } from '../state/ui.js'
import { runCommand } from '../lib/voice/controller.js'
import { MARKINGS } from '../lib/bom/polarity.js'
import { OrientationDiagram, BoardMap } from '../components/Diagrams.jsx'
import { LiveView } from '../components/LiveView.jsx'
import { CheckPanel } from '../components/CheckPanel.jsx'
import { VoiceBar, isTyping } from '../components/VoiceBar.jsx'
import { AiTag } from '../components/Ai.jsx'

export function Build() {
  const s = useStore(session)
  const u = useStore(ui)
  const [listOpen, setListOpen] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      const map = {
        ' ': { type: 'placed' },
        enter: { type: 'placed' },
        s: { type: 'skip' },
        z: { type: 'back' },
        backspace: { type: 'back' },
        o: { type: 'confirm' },
        d: { type: 'dropped' },
        k: { type: 'check' },
      }
      if (k === 'arrowright') session.dispatch({ type: 'step', delta: 1 })
      else if (k === 'arrowleft') session.dispatch({ type: 'step', delta: -1 })
      else if (map[k]) runCommand(map[k])
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!s.board) {
    return (
      <main className="empty">
        <h1>No board loaded</h1>
        <p>Load the demo board or upload a BOM to start.</p>
        <a className="btn primary big" href="#/setup">
          Go to setup
        </a>
      </main>
    )
  }

  const pr = progress(s)
  const ref = s.current
  const part = ref ? s.board.parts[ref] : null
  const awaiting = blocksAwaitingCheck(s)

  return (
    <main className="build">
      <ProgressBar pr={pr} />
      {awaiting.length > 0 && <CheckpointBanner block={awaiting[0]} />}

      <div className="build-grid">
        <div className="build-left">
          {part ? <CurrentPart s={s} refName={ref} /> : <AllDone s={s} />}
        </div>
        <div className="build-right">
          <LiveView board={s.board} current={ref} />
          {s.board.hasLocations && (
            <BoardMap board={s.board} status={s.status} current={ref} highlight={u.highlightRef} onPick={(r) => session.dispatch({ type: 'jump', ref: r })} />
          )}
          {part && <CheckPanel refName={ref} />}
        </div>
      </div>

      <button className="btn list-toggle" onClick={() => setListOpen((o) => !o)}>
        {listOpen ? 'Hide part list' : `Jump to any part (${pr.pending} left)`}
      </button>
      {listOpen && <PartList s={s} onPick={() => setListOpen(false)} />}
      <VoiceBar />
    </main>
  )
}

function ProgressBar({ pr }) {
  const pct = (n) => `${(n / Math.max(1, pr.total)) * 100}%`
  return (
    <div className="progress" aria-label={`${pr.placed} of ${pr.total} placed`}>
      <div className="progress-track">
        <div className="progress-placed" style={{ width: pct(pr.placed) }} />
        <div className="progress-skipped" style={{ width: pct(pr.skipped) }} />
      </div>
      <div className="progress-text">
        <strong>
          {pr.placed} / {pr.total} placed
        </strong>
        {pr.skipped > 0 && <span> · {pr.skipped} skipped</span>}
        {pr.dropped > 0 && <span className="warn-text"> · {pr.dropped} need replacement</span>}
      </div>
    </div>
  )
}

function CurrentPart({ s, refName }) {
  const part = s.board.parts[refName]
  const g = groupInfo(s, refName)
  const block = currentBlock(s)
  const st = s.status[refName]
  const pol = part.polarity
  const needsOrientation = pol.polarized && !s.orientationOk[refName]
  const aiPlan = s.plan.source === 'ai' || s.plan.source === 'simulated'
  const canUndo = s.history.length > 0
  const lastLabel = s.history[s.history.length - 1]?.label

  return (
    <>
      <article className={`part-card ${pol.polarized ? 'polarized' : ''}`}>
        {block && (
          <div className="part-block">
            Block: <strong>{block.name}</strong> {aiPlan && !block.appAdded && <AiTag simulated={s.plan.source === 'simulated'} />}
          </div>
        )}
        <div className="part-ref">{refName}</div>
        <div className="part-value">{part.value || '—'}</div>
        <div className="part-size">
          {part.size.label}
          {part.size.tiny && <span className="pill warn"> tiny: use tweezers, work over the tray</span>}
        </div>
        <div className="part-meta">
          <span>
            {g.position} of {g.total} in this group · {g.placed} placed
          </span>
          {g.compartment && <span className="tray-big">Tray {g.compartment}</span>}
          {s.board.hasSparesColumn && (g.spares > 0 ? <span>Spares: {g.sparesLeft} of {g.spares} left</span> : <span>No spares listed</span>)}
        </div>
        {pol.polarized && (
          <div className="polar-badge">
            ⚠ POLARIZED: {MARKINGS[pol.marking].label} mark{' '}
            {needsOrientation ? <span className="pill bad">confirm orientation</span> : <span className="pill good">orientation confirmed</span>}
          </div>
        )}
        {st && (
          <div className={`status-note ${st}`}>
            {st === STATUS.placed && 'Already marked placed.'}
            {st === STATUS.skipped && 'Skipped earlier.'}
            {st === STATUS.dropped && `Dropped (${s.dropCount[refName]}×): place a replacement part.`}
          </div>
        )}
      </article>

      {pol.polarized && (
        <div className="orientation-wrap">
          <OrientationDiagram part={part} />
          {needsOrientation && (
            <button className="btn big good" onClick={() => runCommand({ type: 'confirm' })}>
              I’ve checked the orientation <kbd>O</kbd>
            </button>
          )}
        </div>
      )}

      <div className="actions">
        <button
          className="btn huge primary"
          disabled={needsOrientation}
          onClick={() => runCommand({ type: 'placed' })}
          title={needsOrientation ? 'Confirm orientation first' : 'Mark placed (Space)'}
        >
          ✓ Placed <kbd>Space</kbd>
        </button>
        <div className="actions-row">
          <button className="btn big" onClick={() => runCommand({ type: 'skip' })}>
            Skip <kbd>S</kbd>
          </button>
          <button className="btn big" disabled={!canUndo} onClick={() => runCommand({ type: 'back' })} title={lastLabel ? `Undo: ${lastLabel}` : 'Nothing to undo'}>
            ↶ Undo <kbd>Z</kbd>
          </button>
          <button className="btn big warn" onClick={() => runCommand({ type: 'dropped' })}>
            Dropped it <kbd>D</kbd>
          </button>
        </div>
        {canUndo && <div className="muted small">Undo will revert: {lastLabel}</div>}
        <div className="actions-row nav">
          <button className="btn" onClick={() => session.dispatch({ type: 'step', delta: -1 })}>
            ← Prev
          </button>
          <button className="btn" onClick={() => session.dispatch({ type: 'step', delta: 1 })}>
            Next →
          </button>
        </div>
      </div>
    </>
  )
}

function AllDone({ s }) {
  const left = Object.keys(s.board.parts).filter((r) => s.status[r] === STATUS.skipped || s.status[r] === STATUS.dropped)
  return (
    <article className="part-card done">
      <div className="part-ref">Done</div>
      <p>Every part is placed or skipped.</p>
      {left.length > 0 && (
        <>
          <p>Still to do:</p>
          <div className="chips">
            {left.map((r) => (
              <button key={r} className="chip" onClick={() => session.dispatch({ type: 'jump', ref: r })}>
                {r} ({s.status[r]})
              </button>
            ))}
          </div>
        </>
      )}
      <a className="btn" href="#/blocks">
        Block summary
      </a>
    </article>
  )
}

function CheckpointBanner({ block }) {
  return (
    <div className="checkpoint" role="alert">
      <div>
        <strong>Block “{block.name}” is done. Multimeter check before moving on:</strong>
        <ul>
          <li>Continuity mode: probe power to ground. It should not beep.</li>
          <li>Check that the parts in this block connect the way the schematic says before starting the next block.</li>
        </ul>
      </div>
      <div className="row">
        <button className="btn good" onClick={() => session.dispatch({ type: 'block-check', blockId: block.id, done: true })}>
          ✓ Multimeter check done
        </button>
        <button className="btn" onClick={() => session.dispatch({ type: 'block-check', blockId: block.id, done: false })}>
          Skip this check
        </button>
      </div>
    </div>
  )
}

export function PartList({ s, onPick }) {
  const [leftOnly, setLeftOnly] = useState(false)
  return (
    <section className="part-list">
      <label className="toggle">
        <input type="checkbox" checked={leftOnly} onChange={(e) => setLeftOnly(e.target.checked)} /> Only what’s left
      </label>
      {s.plan.blocks.map((b) => {
        const bp = blockProgress(s, b)
        const refs = b.refs.filter((r) => !leftOnly || s.status[r] !== STATUS.placed)
        if (!refs.length) return null
        const groups = []
        for (const r of refs) {
          const g = s.board.parts[r].group
          const last = groups[groups.length - 1]
          if (last && last.id === g) last.refs.push(r)
          else groups.push({ id: g, refs: [r] })
        }
        return (
          <div key={b.id} className="pl-block">
            <h4>
              {b.name} <span className="muted">({bp.placed}/{bp.total})</span>
            </h4>
            {groups.map((g, i) => {
              const grp = s.board.groups.find((x) => x.id === g.id)
              return (
                <div key={`${g.id}-${i}`} className="pl-group">
                  <span className="pl-value">
                    {grp.value} <span className="muted">{s.board.parts[g.refs[0]].size.code}</span>
                    {s.tray[g.id] && <span className="pill">tray {s.tray[g.id]}</span>}
                  </span>
                  <span className="chips">
                    {g.refs.map((r) => (
                      <button
                        key={r}
                        className={`chip ref ${s.status[r] ?? 'todo'} ${r === s.current ? 'cur' : ''}`}
                        onClick={() => {
                          session.dispatch({ type: 'jump', ref: r })
                          onPick?.()
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </section>
  )
}
