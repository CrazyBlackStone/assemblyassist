import { useStore } from '../lib/store.js'
import { usage, failureLog, feedback, costSummary, formatUsd, failuresToCsv, callsToCsv, download } from '../state/logs.js'
import { DEFAULT_TASKS } from '../config/models.js'

const KIND_LABEL = {
  'marked-wrong': 'User marked wrong',
  timeout: 'Timed out',
  error: 'Call failed',
  'invalid-output': 'Unreadable output',
  corrected: 'App corrected output',
}

export function Log() {
  const calls = useStore(usage, (s) => s.calls)
  const entries = useStore(failureLog, (s) => s.entries)
  const fb = useStore(feedback, (s) => s.items)
  const sum = costSummary(calls)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

  return (
    <main className="log">
      <h1>Log</h1>

      <section className="card">
        <h2>Cost</h2>
        <p className="cost-big">
          {formatUsd(sum.known)}
          {sum.unknownCalls > 0 && <span className="cost-unknown"> + {sum.unknownCalls} call(s) with unknown cost</span>}
        </p>
        <table>
          <thead>
            <tr>
              <th>Call type</th>
              <th>Calls</th>
              <th>Failed</th>
              <th>Tokens</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(DEFAULT_TASKS).map(([task, cfg]) => {
              const t = sum.byTask[task] ?? { calls: 0, failed: 0, tokens: 0, cost: 0, unknown: 0 }
              return (
                <tr key={task}>
                  <td>
                    {cfg.label} <span className="muted small">({cfg.modality})</span>
                  </td>
                  <td>{t.calls}</td>
                  <td>{t.failed}</td>
                  <td>{t.tokens.toLocaleString()}</td>
                  <td>
                    {formatUsd(t.cost)}
                    {t.unknown > 0 && <span className="cost-unknown"> + {t.unknown} unknown</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="muted small">
          Cost comes from the provider’s reported cost when available, else its price list, else the price table in src/config/models.js. If none apply it shows “unknown”,
          never $0. Feedback: {fb.filter((f) => f.verdict === 'helpful').length} helpful, {fb.filter((f) => f.verdict === 'wrong').length} marked wrong.
        </p>
        <div className="row">
          <button className="btn small" onClick={() => download(`assembly-assist-calls-${stamp}.csv`, callsToCsv(calls), 'text/csv')}>
            Export calls (CSV)
          </button>
          <button className="btn small warn" onClick={() => window.confirm('Clear the cost history?') && usage.reset()}>
            Clear cost history
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Failure log ({entries.length})</h2>
        <p className="muted">Every time a model was wrong, slow, failed or needed correcting, and what the app did about it. Text only, no photos.</p>
        <div className="row">
          <button className="btn small" onClick={() => download(`assembly-assist-failures-${stamp}.json`, JSON.stringify(entries, null, 2), 'application/json')}>
            Export JSON
          </button>
          <button className="btn small" onClick={() => download(`assembly-assist-failures-${stamp}.csv`, failuresToCsv(entries), 'text/csv')}>
            Export CSV
          </button>
          <button className="btn small warn" onClick={() => window.confirm('Clear the failure log?') && failureLog.reset()}>
            Clear log
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="muted">Nothing logged yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="failures">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Call</th>
                  <th>Kind</th>
                  <th>Input</th>
                  <th>Model said</th>
                  <th>User says right</th>
                  <th>UI did</th>
                </tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{new Date(e.timestamp).toLocaleString()}</td>
                    <td>
                      {DEFAULT_TASKS[e.callType]?.label ?? e.callType}
                      <div className="muted small">{e.model}</div>
                    </td>
                    <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                    <td>{e.inputSummary}</td>
                    <td className="clip">{e.modelSaid}</td>
                    <td>{e.userSaysRight || '—'}</td>
                    <td>{e.uiAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
