import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../lib/store.js'
import { session, progress } from '../state/session.js'
import { prefs, keys, activeProvider, setKeyStorageMode, getKeyStorageMode, initialPrefs } from '../state/settings.js'
import { PROVIDERS, DEFAULT_TASKS } from '../config/models.js'
import { catalog, loadOpenRouterCatalog, autoPickModels, isFree, acceptsImages } from '../lib/ai/catalog.js'
import { loadBoardFromText, BoardFileError } from '../lib/bom/board.js'
import { demoBoardText } from '../data/demoBoard.js'
import { pairing, startHost, resetHost, pairUrl } from '../lib/pairing/pairing.js'
import { openLocalCamera, closeLocalCamera, camera } from '../lib/camera.js'

export function Setup({ navigate }) {
  return (
    <main className="setup">
      <h1>Setup</h1>
      <PrivacyNote />
      <BoardSection navigate={navigate} />
      <CameraSection />
      <AiSection />
      <VoiceSection />
    </main>
  )
}

function PrivacyNote() {
  return (
    <div className="privacy">
      <strong>Privacy:</strong> don’t point the camera at confidential designs. Photos stay in this browser tab and are discarded when you leave; only the cropped area of a check is
      sent to the AI provider you choose. API keys are stored only in this browser.
    </div>
  )
}

function BoardSection({ navigate }) {
  const s = useStore(session)
  const [bomFile, setBomFile] = useState(null)
  const [pnpFile, setPnpFile] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState([])

  const hasProgress = s.board && progress(s).placed + progress(s).skipped > 0
  const confirmReplace = () => !hasProgress || window.confirm(`Replace “${s.board.name}”? Its progress (${progress(s).placed} placed) will be cleared.`)

  const load = (board) => {
    session.dispatch({ type: 'load-board', board })
    setWarnings(board.warnings)
    setError(null)
  }

  const loadDemo = () => {
    if (!confirmReplace()) return
    load(loadBoardFromText({ ...demoBoardText, source: 'demo' }))
    navigate('/build')
  }

  const loadFiles = async () => {
    if (!bomFile) return setError('Choose a BOM file first.')
    if (!confirmReplace()) return
    try {
      const bomText = await bomFile.text()
      const pnpText = pnpFile ? await pnpFile.text() : null
      const board = loadBoardFromText({ name: name || bomFile.name.replace(/\.[^.]+$/, ''), bomText, pnpText })
      load(board)
    } catch (e) {
      setError(e instanceof BoardFileError ? e.message : `Could not read the files: ${e.message}`)
    }
  }

  return (
    <section className="card">
      <h2>1. Board</h2>
      {s.board ? (
        <p>
          Loaded: <strong>{s.board.name}</strong> ({Object.keys(s.board.parts).length} parts, {s.board.groups.length} value groups
          {s.board.hasLocations ? ', with locations' : ', no locations'}
          {s.board.excluded.length ? `; ${s.board.excluded.length} DNP excluded` : ''}).{' '}
          <a href="#/build">Continue building →</a>
        </p>
      ) : (
        <p>No board loaded yet.</p>
      )}
      <div className="row">
        <button className="btn primary big" onClick={loadDemo}>
          Use the demo board
        </button>
        <span className="muted">20 parts, with locations. Works with no uploads and no hardware.</span>
      </div>
      <h3>Or upload your own</h3>
      <div className="upload-grid">
        <label>
          BOM (CSV) — needs reference, value, footprint; optional qty, spares, DNP, polarized
          <input type="file" accept=".csv,.tsv,.txt" onChange={(e) => setBomFile(e.target.files[0] ?? null)} />
        </label>
        <label>
          Pick-and-place (optional) — KiCad .pos/.csv, Altium, JLCPCB
          <input type="file" accept=".csv,.pos,.txt,.tsv" onChange={(e) => setPnpFile(e.target.files[0] ?? null)} />
        </label>
        <label>
          Board name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lab 4 sensor board" />
        </label>
      </div>
      <button className="btn" onClick={loadFiles}>
        Load files
      </button>
      {error && <p className="error-text">{error}</p>}
      {warnings.length > 0 && (
        <details className="warnings" open>
          <summary>{warnings.length} note(s) about the files</summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {s.board && (
        <button
          className="btn small warn"
          onClick={() => window.confirm('Clear the board and all progress?') && session.dispatch({ type: 'clear' })}
        >
          Clear board and progress
        </button>
      )}
    </section>
  )
}

function CameraSection() {
  const p = useStore(prefs)
  const pair = useStore(pairing)
  const cam = useStore(camera)
  const [qr, setQr] = useState(null)
  const [advanced, setAdvanced] = useState(false)
  const url = pair.code ? pairUrl(pair.code) : null

  useEffect(() => {
    if (p.cameraSource === 'phone') startHost()
  }, [p.cameraSource])

  useEffect(() => {
    if (!url) return setQr(null)
    QRCode.toDataURL(url, { margin: 1, width: 320 }).then(setQr).catch(() => setQr(null))
  }, [url])

  const setSource = (cameraSource) => {
    prefs.set((s) => ({ ...s, cameraSource }))
    if (cameraSource === 'local') {
      resetHost()
      openLocalCamera().catch(() => {})
    } else {
      closeLocalCamera()
    }
  }

  return (
    <section className="card">
      <h2>2. Camera and microphone</h2>
      <div className="row">
        <label className="radio">
          <input type="radio" checked={p.cameraSource === 'phone'} onChange={() => setSource('phone')} /> Phone over the board (pair below)
        </label>
        <label className="radio">
          <input type="radio" checked={p.cameraSource === 'local'} onChange={() => setSource('local')} /> This device’s camera (phone-only testing, or a webcam)
        </label>
      </div>

      {p.cameraSource === 'phone' && (
        <div className="pairing">
          {qr && <img className="qr" src={qr} alt="QR code to pair the phone" />}
          <div>
            <p>On the phone, scan the QR code or open this address and allow the camera and microphone:</p>
            <p className="pair-url">{url ?? 'Starting…'}</p>
            <p>
              Code: <span className="pair-code">{pair.code ?? '……'}</span>
            </p>
            <p>
              Status: <strong>{pair.status}</strong>
              {pair.phoneInfo?.width && ` · phone camera ${pair.phoneInfo.width}px wide`}
            </p>
            {pair.error && <p className="error-text">{pair.error}</p>}
            <button className="btn small" onClick={() => { resetHost({ newCode: true }); startHost() }}>
              New code
            </button>
          </div>
        </div>
      )}
      {p.cameraSource === 'local' && (
        <p>
          {cam.localStream ? 'Camera is on.' : 'Camera is off.'} {cam.error && <span className="error-text">{cam.error}</span>}
          {!cam.localStream && (
            <button className="btn small" onClick={() => openLocalCamera().catch(() => {})}>
              Start camera
            </button>
          )}
        </p>
      )}

      <button className="btn small" onClick={() => setAdvanced((a) => !a)}>
        {advanced ? 'Hide' : 'Show'} connection settings (relay server)
      </button>
      {advanced && (
        <div className="advanced">
          <p className="muted">
            Leave empty to use the free PeerJS cloud server. If campus Wi-Fi blocks the phone–laptop connection, run a TURN server (e.g. coturn on EC2) and add it below;
            optionally run your own PeerServer too. Changes apply on “New code”.
          </p>
          <label>
            PeerServer host
            <input value={p.peerHost} placeholder="(PeerJS cloud)" onChange={(e) => prefs.set((s) => ({ ...s, peerHost: e.target.value.trim() }))} />
          </label>
          <label>
            Port
            <input type="number" value={p.peerPort} onChange={(e) => prefs.set((s) => ({ ...s, peerPort: Number(e.target.value) }))} />
          </label>
          <label>
            Path
            <input value={p.peerPath} onChange={(e) => prefs.set((s) => ({ ...s, peerPath: e.target.value }))} />
          </label>
          <label className="wide">
            ICE servers (JSON) — add TURN here, e.g. {'[{"urls":"turn:your-ec2-host:3478","username":"u","credential":"p"}]'}
            <textarea rows={3} value={p.iceServers} onChange={(e) => prefs.set((s) => ({ ...s, iceServers: e.target.value }))} />
          </label>
          <button className="btn small" onClick={() => prefs.set((s) => ({ ...s, iceServers: initialPrefs.iceServers, peerHost: '', peerPort: 443, peerPath: '/' }))}>
            Reset to defaults
          </button>
        </div>
      )}
    </section>
  )
}

function AiSection() {
  const p = useStore(prefs)
  const k = useStore(keys)
  const cat = useStore(catalog)
  const [show, setShow] = useState(false)
  const [catError, setCatError] = useState(null)
  const provider = activeProvider(p, k)
  const keyProvider = p.provider === 'auto' ? 'openrouter' : p.provider

  const refreshCatalog = async (force = false) => {
    try {
      const models = await loadOpenRouterCatalog({ force })
      setCatError(null)
      const { models: next, autoPicked } = autoPickModels(prefs.get().models, models)
      if (Object.keys(autoPicked).length) prefs.set((s) => ({ ...s, models: next, autoPicked: { ...s.autoPicked, ...autoPicked } }))
    } catch (e) {
      setCatError(e.message)
    }
  }

  useEffect(() => {
    if (provider === 'openrouter') refreshCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  return (
    <section className="card">
      <h2>3. AI models</h2>
      <p>
        Active: <strong className={provider === 'simulated' ? 'sim-text' : ''}>{PROVIDERS[provider].label}</strong>
        {provider === 'simulated' && ' — add an OpenRouter key to use real models. Everything else works without one.'}
      </p>
      <div className="form-grid">
        <label>
          Provider
          <select value={p.provider} onChange={(e) => prefs.set((s) => ({ ...s, provider: e.target.value }))}>
            <option value="auto">Automatic (OpenRouter if a key is set, else simulated)</option>
            {Object.entries(PROVIDERS).map(([id, pr]) => (
              <option key={id} value={id}>
                {pr.label}
              </option>
            ))}
          </select>
        </label>
        {keyProvider !== 'simulated' && (
          <label>
            {PROVIDERS[keyProvider].label} API key
            <span className="row">
              <input
                type={show ? 'text' : 'password'}
                autoComplete="off"
                value={k[keyProvider] ?? ''}
                placeholder="paste key"
                onChange={(e) => keys.set((s) => ({ ...s, [keyProvider]: e.target.value.trim() }))}
              />
              <button className="btn small" onClick={() => setShow((x) => !x)}>
                {show ? 'Hide' : 'Show'}
              </button>
            </span>
            <span className="muted small">{PROVIDERS[keyProvider].keyHelp}</span>
          </label>
        )}
        {p.provider === 'custom' && (
          <label>
            Base URL
            <input value={p.customBaseUrl} placeholder="https://…/v1" onChange={(e) => prefs.set((s) => ({ ...s, customBaseUrl: e.target.value.trim() }))} />
          </label>
        )}
        <label>
          Key storage
          <select value={getKeyStorageMode()} onChange={(e) => setKeyStorageMode(e.target.value)}>
            <option value="local">Remember on this browser</option>
            <option value="session">Forget when the tab closes (shared computers)</option>
          </select>
        </label>
      </div>

      <h3>Model per call</h3>
      {provider === 'openrouter' && (
        <p className="muted small">
          {cat.models.length ? `${cat.models.length} OpenRouter models loaded.` : 'Loading the OpenRouter model list…'} {catError && <span className="error-text">{catError}</span>}{' '}
          <button className="btn small" onClick={() => refreshCatalog(true)}>
            Refresh list
          </button>
        </p>
      )}
      <table className="models">
        <thead>
          <tr>
            <th>Call</th>
            <th>Modality</th>
            <th>Model</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(DEFAULT_TASKS).map(([task, cfg]) => {
            const m = cat.models.find((x) => x.id === p.models[task])
            const options = cat.models.filter((x) => !cfg.needsVision || acceptsImages(x))
            return (
              <tr key={task}>
                <td>{cfg.label}</td>
                <td>{cfg.modality}</td>
                <td>
                  <input
                    list={`models-${task}`}
                    value={p.models[task]}
                    disabled={provider === 'simulated'}
                    onChange={(e) => prefs.set((s) => ({ ...s, models: { ...s.models, [task]: e.target.value.trim() }, autoPicked: { ...s.autoPicked, [task]: false } }))}
                  />
                  <datalist id={`models-${task}`}>
                    {options.map((x) => (
                      <option key={x.id} value={x.id}>
                        {isFree(x) ? 'free · ' : ''}
                        {x.name}
                      </option>
                    ))}
                  </datalist>
                  {p.autoPicked[task] && <div className="muted small">Auto-picked: the default model is not listed any more.</div>}
                  {provider === 'openrouter' && cat.models.length > 0 && !m && <div className="warn-text small">Not in the OpenRouter list.</div>}
                  {cfg.needsVision && m && !acceptsImages(m) && <div className="error-text small">This model does not accept images.</div>}
                </td>
                <td className="small">{priceLabel(provider, m)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted small">To swap models for the course, edit src/config/models.js (defaults, timeouts, price table) or change them here.</p>
    </section>
  )
}

function priceLabel(provider, m) {
  if (provider === 'simulated') return '$0 (simulated)'
  if (!m) return 'unknown'
  if (isFree(m)) return 'free'
  if (m.prompt == null || m.completion == null) return 'unknown'
  return `$${(m.prompt * 1e6).toFixed(2)} / $${(m.completion * 1e6).toFixed(2)} per 1M in/out`
}

function VoiceSection() {
  const p = useStore(prefs)
  return (
    <section className="card">
      <h2>4. Voice</h2>
      <div className="row">
        <label className="toggle">
          <input type="checkbox" checked={p.speakAloud} onChange={(e) => prefs.set((s) => ({ ...s, speakAloud: e.target.checked }))} /> Speak answers aloud
        </label>
        <label>
          Speech rate
          <input type="range" min={0.6} max={1.6} step={0.1} value={p.voiceRate} onChange={(e) => prefs.set((s) => ({ ...s, voiceRate: Number(e.target.value) }))} />{' '}
          {p.voiceRate.toFixed(1)}×
        </label>
      </div>
      <p className="muted small">
        Speech recognition uses the browser (Chrome or Edge recommended). In a loud room, push-to-talk (button or the T key) is more reliable than hands-free. The phone page also has
        its own microphone button.
      </p>
    </section>
  )
}
