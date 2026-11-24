import { useStore } from '../lib/store.js'
import { ui, setUi } from '../state/ui.js'
import { usage, failureLog, feedback, costSummary, formatUsd, failuresToCsv, callsToCsv, download } from '../state/logs.js'
import { catalog } from '../lib/ai/catalog.js'
import { TASKS, STT, hasProvider } from '../config/ai.js'
import { Icon } from './ui.jsx'

const KIND = { 'marked-wrong': 'Marked wrong', timeout: 'Timed out', error: 'Failed', 'invalid-output': 'Unreadable', corrected: 'App corrected' }
const TYPES = [...Object.entries(TASKS).map(([k, t]) => [k, t.label, t.modality]), ['stt', STT.label, STT.modality]]

/** Cost per call type, model replacements, and the failure log with exports. */
export function LogSheet() {
  const open = useStore(ui, (s) => s.logOpen)
  const calls = useStore(usage, (s) => s.calls)
  const entries = useStore(failureLog, (s) => s.entries)
  const fb = useStore(feedback, (s) => s.items)
  const overrides = useStore(catalog, (s) => s.overrides)
  if (!open) return null
  const sum = costSummary(calls)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const simulated = !Object.values(TASKS).some((t) => hasProvider(t.provider))
  const label = Object.fromEntries(TYPES.map(([k, l]) => [k, l]))

  return (
    <div className="scrim" onClick={() => setUi({ logOpen: false })}>
      <div className="sheet glass" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Cost and failure log">
        <div className="card-row">
          <div>
            <div className="total">{formatUsd(sum.known)}</div>
            <div className="muted">
              {sum.calls} AI calls{sum.unknownCalls ? `, ${sum.unknownCalls} with unknown cost` : ''}
              {simulated && ' · simulated (no key configured)'}
            </div>
          </div>
          <span className="spacer" />
          <button className="btn icon" onClick={() => setUi({ logOpen: false })} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Call</th>
              <th>Modality</th>
              <th>Calls</th>
              <th>Failed</th>
              <th>Tokens</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {TYPES.map(([k, l, m]) => {
              const t = sum.byTask[k] ?? { calls: 0, failed: 0, tokens: 0, cost: 0, unknown: 0 }
              return (
                <tr key={k}>
                  <td>{l}</td>
                  <td className="muted">{m}</td>
                  <td>{t.calls}</td>
                  <td>{t.failed}</td>
                  <td>{t.tokens.toLocaleString()}</td>
                  <td>
                    {formatUsd(t.cost)}
                    {t.unknown > 0 && <span style={{ color: 'var(--warn)' }}> + {t.unknown} unknown</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {Object.keys(overrides).length > 0 && (
          <div className="muted">
            Model replaced (no longer listed): {Object.entries(overrides).map(([k, o]) => `${label[k] ?? k}: ${o.from} → ${o.to}`).join('; ')}
          </div>
        )}
        <div className="card-row">
          <h2>Failure log ({entries.length})</h2>
          <span className="faint">
            {fb.filter((f) => f.verdict === 'wrong').length} marked wrong
          </span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => download(`failures-${stamp}.json`, JSON.stringify(entries, null, 2), 'application/json')}>
            JSON
          </button>
          <button className="btn sm" onClick={() => download(`failures-${stamp}.csv`, failuresToCsv(entries), 'text/csv')}>
            CSV
          </button>
          <button className="btn sm" onClick={() => download(`calls-${stamp}.csv`, callsToCsv(calls), 'text/csv')}>
            Calls CSV
          </button>
        </div>
        {entries.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Call</th>
                  <th>Kind</th>
                  <th>Input</th>
                  <th>Model said</th>
                  <th>Right answer</th>
                  <th>UI did</th>
                </tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.timestamp).toLocaleTimeString()}</td>
                    <td>
                      {label[e.callType] ?? e.callType}
                      <div className="faint">{e.model}</div>
                    </td>
                    <td>{KIND[e.kind] ?? e.kind}</td>
                    <td>{e.inputSummary}</td>
                    <td style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{e.modelSaid}</td>
                    <td>{e.userSaysRight || '–'}</td>
                    <td>{e.uiAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-row">
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => window.confirm('Clear cost history and failure log?') && (usage.reset(), failureLog.reset(), feedback.reset())}>
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}
