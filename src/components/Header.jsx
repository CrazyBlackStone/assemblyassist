import { useStore } from '../lib/store.js'
import { usage, costSummary, formatUsd } from '../state/logs.js'
import { session, progress } from '../state/session.js'
import { pairing } from '../lib/pairing/pairing.js'
import { prefs, keys, activeProvider } from '../state/settings.js'
import { PROVIDERS } from '../config/models.js'

/** Always-visible cost meter: running total plus calls per type; "unknown" never shown as $0. */
export function CostMeter({ onOpen }) {
  const calls = useStore(usage, (s) => s.calls)
  const sum = costSummary(calls)
  const p = useStore(prefs)
  const k = useStore(keys)
  const provider = activeProvider(p, k)
  return (
    <button className="cost-meter" onClick={onOpen} title="Open cost breakdown">
      <span className="cost-total">
        {formatUsd(sum.known)}
        {sum.unknownCalls > 0 && <span className="cost-unknown"> + {sum.unknownCalls} unknown</span>}
      </span>
      <span className="cost-detail">
        {sum.calls} AI call{sum.calls === 1 ? '' : 's'}
        {Object.entries(sum.byTask).map(([t, v]) => ` · ${shortTask(t)} ${v.calls}`)}
        {sum.tokens > 0 && ` · ${sum.tokens.toLocaleString()} tok`}
      </span>
      <span className={`cost-provider ${provider === 'simulated' ? 'sim' : ''}`}>{PROVIDERS[provider].label.split(' (')[0]}</span>
    </button>
  )
}

const shortTask = (t) => ({ buildPlan: 'plan', visionCheck: 'check', fixHelp: 'fix' })[t] ?? t

export function Header({ route, navigate }) {
  const s = useStore(session)
  const pair = useStore(pairing, (p) => p.status)
  const pr = s.board ? progress(s) : null
  const tabs = [
    ['/setup', 'Setup'],
    ['/build', 'Build'],
    ['/blocks', 'Blocks'],
    ['/log', 'Log'],
  ]
  return (
    <header className="app-header">
      <div className="brand">
        <span className="logo" aria-hidden>
          ◎
        </span>
        Assembly Assist
      </div>
      <nav className="tabs">
        {tabs.map(([path, label]) => (
          <a key={path} href={`#${path}`} className={route === path ? 'on' : ''}>
            {label}
          </a>
        ))}
      </nav>
      <div className="header-status">
        {pr && (
          <span className="pill">
            {s.board.name}: {pr.placed}/{pr.total}
          </span>
        )}
        <span className={`pill pair-${pair}`}>{pairLabel(pair)}</span>
        <CostMeter onOpen={() => navigate('/log')} />
      </div>
    </header>
  )
}

function pairLabel(status) {
  return (
    {
      off: 'Phone: not paired',
      connecting: 'Phone: starting…',
      waiting: 'Phone: waiting',
      linked: 'Phone: linked',
      paired: 'Phone: streaming',
    }[status] ?? status
  )
}
