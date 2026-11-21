import { useState } from 'react'
import { useStore } from '../lib/store.js'
import { session, blockProgress, STATUS } from '../state/session.js'
import { fallbackPlan } from '../lib/plan/plan.js'
import * as BuildPlan from '../lib/ai/tasks/buildPlan.js'
import { useAiTask } from '../lib/ai/useAiTask.js'
import { AiResult, AiLoading, AiError, AiTag } from '../components/Ai.jsx'

export function Blocks({ navigate }) {
  const s = useStore(session)
  if (!s.board) {
    return (
      <main className="empty">
        <h1>No board loaded</h1>
        <a className="btn primary" href="#/setup">
          Go to setup
        </a>
      </main>
    )
  }
  return (
    <main className="blocks">
      <h1>Blocks: {s.board.name}</h1>
      <PlanSection s={s} />
      <BlockList s={s} navigate={navigate} />
      <TraySection s={s} />
    </main>
  )
}

function PlanSection({ s }) {
  const ai = useAiTask(BuildPlan.TASK)
  const run = () =>
    ai.run({
      key: s.board.id,
      messages: BuildPlan.buildMessages(s.board),
      simulate: () => BuildPlan.simulate(s.board),
      validate: (v) => BuildPlan.validate(s.board, v),
      inputSummary: BuildPlan.inputSummary(s.board),
      fallbackAction: 'Kept the current (rule-based or earlier) build order.',
    })
  const sourceLabel = { default: 'Rule-based default order (not AI)', ai: 'AI build plan', simulated: 'Simulated AI build plan' }[s.plan.source]

  return (
    <section className="card">
      <h2>Build order</h2>
      <p>
        Current: <strong>{sourceLabel}</strong>
        {s.plan.model && <span className="muted"> ({s.plan.model})</span>}
        {s.plan.reordered && <span className="muted"> · reordered by you</span>}
      </p>
      <p className="muted">Test one block at a time. Hard-to-reach parts go before the parts that would block them.</p>
      <div className="row">
        {ai.status !== 'loading' && (
          <button className="btn primary" onClick={run}>
            Suggest a build plan with AI
          </button>
        )}
        {s.plan.source !== 'default' && (
          <button className="btn" onClick={() => session.dispatch({ type: 'set-plan', plan: fallbackPlan(s.board) })}>
            Use the rule-based order
          </button>
        )}
      </div>
      {ai.status === 'loading' && <AiLoading label="AI is reading the BOM and layout…" timeoutMs={ai.timeoutMs} onCancel={ai.cancel} />}
      {ai.status === 'error' && <AiError kind={ai.kind} error={ai.error} onRetry={run} fallbackText="Nothing changed: you can keep building with the current order." />}
      {ai.status === 'done' && (
        <AiResult
          meta={ai.meta}
          title="Proposed build plan"
          feedback={{
            task: BuildPlan.TASK,
            inputSummary: BuildPlan.inputSummary(s.board),
            modelSaid: ai.data.blocks.map((b) => `${b.name}: ${b.refs.join(',')}`).join(' | '),
            uiAction: ai.issues.length ? `Showed the plan after corrections: ${ai.issues.join(' ')}` : 'Showed the proposed plan for the user to accept.',
            corrections: ['Bad grouping', 'Wrong order (blocked parts)', 'Reasons are wrong', 'Missing or invented parts'],
          }}
        >
          {ai.issues.length > 0 && (
            <div className="warn-text">
              The app corrected the AI’s plan: <ul>{ai.issues.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          )}
          <ol className="plan-proposal">
            {ai.data.blocks.map((b) => (
              <li key={b.id}>
                <strong>{b.name}</strong> — {b.reason} {b.appAdded && <span className="muted">(added by the app)</span>}
                <div className="muted small">{b.refs.join(', ')}</div>
              </li>
            ))}
          </ol>
          <div className="row">
            <button
              className="btn good"
              onClick={() => {
                session.dispatch({ type: 'set-plan', plan: { ...ai.data, source: ai.meta.simulated ? 'simulated' : 'ai', model: ai.meta.model } })
                ai.reset()
              }}
            >
              Use this plan
            </button>
            <button className="btn" onClick={ai.reset}>
              Keep current order
            </button>
          </div>
          <p className="muted small">Your progress is kept when you switch plans.</p>
        </AiResult>
      )}
    </section>
  )
}

function BlockList({ s, navigate }) {
  const aiPlan = s.plan.source === 'ai' || s.plan.source === 'simulated'
  return (
    <section className="card">
      <h2>Blocks and checkpoints</h2>
      <ol className="block-list">
        {s.plan.blocks.map((b, i) => {
          const bp = blockProgress(s, b)
          const check = s.blockChecks[b.id]
          const left = b.refs.filter((r) => s.status[r] !== STATUS.placed)
          return (
            <li key={b.id} className={`block-item ${bp.done ? 'done' : ''}`}>
              <div className="block-head">
                <div>
                  <strong>
                    {i + 1}. {b.name}
                  </strong>{' '}
                  {aiPlan && !b.appAdded && <AiTag simulated={s.plan.source === 'simulated'} />}
                  {b.reason && <div className="muted">{b.reason}</div>}
                </div>
                <div className="row">
                  <button className="btn small" disabled={i === 0} onClick={() => session.dispatch({ type: 'move-block', blockId: b.id, delta: -1 })} aria-label="Move block up">
                    ↑
                  </button>
                  <button className="btn small" disabled={i === s.plan.blocks.length - 1} onClick={() => session.dispatch({ type: 'move-block', blockId: b.id, delta: 1 })} aria-label="Move block down">
                    ↓
                  </button>
                </div>
              </div>
              <div className="block-progress">
                <progress max={bp.total} value={bp.placed} /> {bp.placed}/{bp.total} placed
                {bp.skipped > 0 && ` · ${bp.skipped} skipped`}
                {bp.dropped > 0 && <span className="warn-text"> · {bp.dropped} need replacement</span>}
              </div>
              {left.length > 0 && (
                <div className="chips">
                  {left.map((r) => (
                    <button
                      key={r}
                      className={`chip ref ${s.status[r] ?? 'todo'}`}
                      onClick={() => {
                        session.dispatch({ type: 'jump', ref: r })
                        navigate('/build')
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
              <div className="checkpoint-line">
                {check?.multimeter ? (
                  <span className="pill good">✓ multimeter check done</span>
                ) : check ? (
                  <span className="pill warn">multimeter check skipped</span>
                ) : (
                  <span className="pill">{bp.done ? 'multimeter check due' : 'checkpoint: test this block before the next'}</span>
                )}
                {!check?.multimeter && (
                  <button className="btn small" onClick={() => session.dispatch({ type: 'block-check', blockId: b.id, done: true })}>
                    Mark multimeter check done
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function TraySection({ s }) {
  const [open, setOpen] = useState(Object.keys(s.tray).length > 0)
  const order = []
  for (const b of s.plan.blocks)
    for (const r of b.refs) {
      const g = s.board.parts[r].group
      if (!order.includes(g)) order.push(g)
    }
  return (
    <section className="card">
      <h2>Tray mode</h2>
      <p className="muted">Assign each value group to a numbered compartment of a segmented tray. Then “where are the 100nF?” answers with the compartment.</p>
      <div className="row">
        <button className="btn" onClick={() => { session.dispatch({ type: 'auto-tray' }); setOpen(true) }}>
          Number compartments in build order
        </button>
        <button className="btn small" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Edit'} assignments
        </button>
        {Object.keys(s.tray).length > 0 && (
          <button className="btn small warn" onClick={() => session.dispatch({ type: 'clear-tray' })}>
            Clear tray
          </button>
        )}
      </div>
      {open && (
        <table className="tray">
          <thead>
            <tr>
              <th>Compartment</th>
              <th>Value</th>
              <th>Package</th>
              <th>Parts</th>
            </tr>
          </thead>
          <tbody>
            {order.map((gid) => {
              const g = s.board.groups.find((x) => x.id === gid)
              return (
                <tr key={gid}>
                  <td>
                    <input
                      type="number"
                      min={1}
                      className="tray-num"
                      value={s.tray[gid] ?? ''}
                      onChange={(e) => session.dispatch({ type: 'set-tray', groupId: gid, compartment: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </td>
                  <td>{g.value}</td>
                  <td>{s.board.parts[g.refs[0]].size.code}</td>
                  <td>
                    {g.refs.join(', ')} {g.spares > 0 && <span className="muted">(+{g.spares} spare)</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
