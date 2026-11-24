import { lazy, Suspense, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../lib/store.js'
import { project, dispatch, saveProject } from '../state/projects.js'
import { pairing, pairUrl, startHost } from '../lib/pairing/pairing.js'
import { collectFiles, sortFiles } from '../lib/gerber/render.js'
import { LAYER_LABEL } from '../lib/gerber/identify.js'
import { rebuild, assignFiles } from '../lib/projects/load.js'
import { defaultPlan } from '../lib/plan/plan.js'
import * as OrderPlan from '../lib/ai/tasks/orderPlan.js'
import { useAiTask } from '../lib/ai/useAiTask.js'
import { BomList } from '../components/BomList.jsx'
import { CostChip } from '../components/BuildChrome.jsx'
import { Icon, AiBadge, MarkWrong, Switch, Seg } from '../components/ui.jsx'

const BoardView3D = lazy(() => import('../components/BoardView3D.jsx'))

// No accept filters: Allegro (.art), Altium (.GTL, .TXT drill), Eagle (.cmp) and others all
// use different extensions; files are identified by content instead.
const TILES = [
  { key: 'gerber', label: 'Gerber', hint: 'fab .zip or files', multiple: true },
  { key: 'cpl', label: 'CPL', hint: 'pick-and-place' },
  { key: 'bom', label: 'BOM', hint: 'optional' },
]

function DropTile({ tile, file, error, busy, onFiles }) {
  const [over, setOver] = useState(false)
  return (
    <label
      className={`drop ${over ? 'over' : ''} ${file && !error ? 'done' : ''} ${error ? 'err' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onFiles([...e.dataTransfer.files])
      }}
    >
      <input type="file" multiple={tile.multiple} onChange={(e) => onFiles([...e.target.files])} />
      {busy ? <div className="spinner" /> : <Icon name={file && !error ? 'check' : 'upload'} />}
      <span className="big">{tile.label}</span>
      <span className="file">{error ? <span className="err-text">{error}</span> : (file ?? tile.hint)}</span>
    </label>
  )
}

export function Setup({ navigate }) {
  const p = useStore(project)
  const [errors, setErrors] = useState({})
  const [notes, setNotes] = useState([])
  const [busy, setBusy] = useState(null)
  const [previewSide, setPreviewSide] = useState('top')

  if (!p) return null
  const s = p.settings

  const onFiles = async (key, list) => {
    if (!list.length) return
    setBusy(key)
    try {
      let files = { ...p.files }
      // A fab zip (or several files) is sorted by content; it may also carry the CPL, BOM and netlist.
      if (key === 'gerber' || list.length > 1 || /\.zip$/i.test(list[0].name)) {
        files = assignFiles(files, sortFiles(await collectFiles(list)), key)
      } else {
        files[key] = { name: list[0].name, text: await list[0].text() }
      }
      const same = (a, b) => (a?.name ?? null) === (b?.name ?? null) && (a?.text?.length ?? 0) === (b?.text?.length ?? 0)
      const bomChanged = !same(files.bom, p.files.bom) || !same(files.cpl, p.files.cpl) || !same(files.netlist, p.files.netlist)
      const hasProgress = Object.keys(p.status).length > 0
      if (bomChanged && hasProgress && !window.confirm('Replacing this file resets the build progress. Continue?')) return
      const { project: next, errors: errs, notes: ns } = await rebuild({ ...p, files }, { bomChanged })
      project.set(next)
      await saveProject(next)
      setErrors(errs)
      setNotes(ns)
    } finally {
      setBusy(null)
    }
  }

  const fileLabel = { gerber: p.files.gerbers.length ? `${p.files.gerbers.length} layers` : null, bom: p.files.bom?.name, cpl: p.files.cpl?.name }
  const hasBack = Boolean(p.render?.svgBottom) || Object.values(p.board?.parts ?? {}).some((x) => x.loc?.side === 'bottom')
  const ready = Boolean(p.board && p.plan)

  return (
    <div>
      <header className="topbar glass">
        <button className="btn icon ghost" onClick={() => navigate('/')} aria-label="Projects">
          <Icon name="back" />
        </button>
        <input
          className="title"
          value={p.name}
          onChange={(e) => dispatch({ type: 'rename', name: e.target.value })}
          aria-label="Project name"
          style={{ background: 'transparent', border: 0, outline: 'none', minWidth: 0, flex: 1 }}
        />
        <CostChip />
        <button className="btn primary" disabled={!ready} onClick={() => navigate(`/p/${p.id}/build`)}>
          Start <Icon name="next" />
        </button>
      </header>

      <main className="setup">
        <div className="col">
          <section className="section glass">
            <h2>Files</h2>
            <div className="drops">
              {TILES.map((t) => (
                <DropTile key={t.key} tile={t} file={fileLabel[t.key]} error={errors[t.key]} busy={busy === t.key} onFiles={(l) => onFiles(t.key, l)} />
              ))}
            </div>
            {p.render && (
              <div className="preview" style={{ position: 'relative' }}>
                <Suspense fallback={<div className="empty-cam"><div className="spinner" /></div>}>
                  <BoardView3D project={{ ...p, current: null }} side={previewSide} compact onFlip={null} />
                </Suspense>
                {hasBack && (
                  <div className="corner tr">
                    <button className="btn sm" onClick={() => setPreviewSide(previewSide === 'top' ? 'bottom' : 'top')}>
                      <Icon name="flip" /> {previewSide === 'top' ? 'Back' : 'Front'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {p.files.gerbers.length > 0 && <LayerList files={p.files} />}
            {p.board && (
              <div className="stats">
                <span className="chip">{Object.keys(p.board.parts).length} parts</span>
                {p.render && (
                  <span className="chip">
                    {p.render.size.w.toFixed(0)} × {p.render.size.h.toFixed(0)} mm
                  </span>
                )}
                {p.render?.layers?.length > 0 && <span className="chip">{p.render.layers.length} layers</span>}
                {p.board.excluded.length > 0 && <span className="chip">{p.board.excluded.length} DNP</span>}
                {!p.render?.svg && <span className="chip">No Gerber: outline from parts</span>}
              </div>
            )}
            {notes.length > 0 && (
              <details className="note">
                <summary>{notes.length} note{notes.length > 1 ? 's' : ''}</summary>
                <ul>
                  {notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <section className="section glass">
            <div className="option">
              <div>
                <div className="label">Check soldering</div>
                <div className="sub">Turn off when using solder paste</div>
              </div>
              <Switch checked={s.verifySoldering} onChange={(v) => dispatch({ type: 'setting', key: 'verifySoldering', value: v })} label="Check soldering" />
            </div>
            <div className="option">
              <div className="label">Camera</div>
              <Seg value={s.cameraSource} options={[['phone', 'Phone'], ['local', 'This device']]} onChange={(v) => dispatch({ type: 'setting', key: 'cameraSource', value: v })} />
            </div>
            <div className="option">
              <div className="label">Microphone</div>
              <Seg value={s.micSource} options={[['laptop', 'Laptop'], ['phone', 'Phone']]} onChange={(v) => dispatch({ type: 'setting', key: 'micSource', value: v })} />
            </div>
            <div className="option">
              <div>
                <div className="label">Board orientation</div>
                <div className="sub">Match how the board sits in front of you</div>
              </div>
              <button className="btn" onClick={() => dispatch({ type: 'setting', key: 'viewRotation', value: ((s.viewRotation ?? 0) + 90) % 360 })}>
                <Icon name="rotate" /> {s.viewRotation ?? 0}°
              </button>
            </div>
          </section>

          {s.cameraSource === 'phone' && <PhonePair />}
        </div>

        <div className="col">
          <OrderSection p={p} />
        </div>
      </main>
    </div>
  )
}

const ORDER = ['copper', 'soldermask', 'silkscreen', 'solderpaste', 'outline', 'drill']

/** Which layer each uploaded file was recognised as, in a few chips. */
function LayerList({ files }) {
  const sideName = (s) => (s === 'top' ? 'Top' : s === 'bottom' ? 'Bottom' : '')
  const layers = [...files.gerbers].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type))
  return (
    <details className="layers-box">
      <summary className="faint" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
        {layers.length} layers{files.netlist ? ' · netlist' : ''}
        {files.unused?.length ? ` · ${files.unused.length} not used` : ''}
      </summary>
      <div className="layers" style={{ marginTop: 8 }}>
        {layers.map((l) => (
          <span key={l.name} className="chip" title={l.name}>
            <b>
              {sideName(l.side)} {LAYER_LABEL[l.type] ?? l.type}
            </b>{' '}
            <span className="faint">{l.name}</span>
          </span>
        ))}
        {files.netlist && (
          <span className="chip" title="Pad positions for every part">
            <b>Netlist</b> <span className="faint">{files.netlist.name}</span>
          </span>
        )}
        {(files.unused ?? []).map((l) => (
          <span key={l.name} className="chip faint" title={LAYER_LABEL[l.type]}>
            {l.name}
          </span>
        ))}
      </div>
    </details>
  )
}

function PhonePair() {
  const pair = useStore(pairing)
  const [qr, setQr] = useState(null)
  useEffect(() => {
    startHost()
  }, [])
  const url = pair.code ? pairUrl(pair.code) : null
  useEffect(() => {
    if (url) QRCode.toDataURL(url, { margin: 1, width: 300 }).then(setQr)
  }, [url])
  const ok = pair.status === 'paired'
  return (
    <section className="section glass">
      <div className="pair">
        {qr && <img className="qr" src={qr} alt="Scan with the phone" />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2>Phone</h2>
          <div className="code">{pair.code ?? '······'}</div>
          <span className="chip" style={{ alignSelf: 'flex-start', color: ok ? 'var(--ok)' : undefined }}>
            <span className={`dot ${ok ? 'placed' : ''}`} /> {ok ? 'Streaming' : pair.status === 'linked' ? 'Linked' : 'Waiting'}
          </span>
          {pair.error && <span className="err-text">{pair.error}</span>}
          <a className="faint" style={{ fontSize: '0.8rem' }} href="https://github.com/CrazyBlackStone/assemblyassist/blob/main/docs/phone-hotspot.md" target="_blank" rel="noreferrer">
            Won’t connect? Use the phone’s hotspot
          </a>
        </div>
      </div>
    </section>
  )
}

function OrderSection({ p }) {
  const ai = useAiTask(OrderPlan.TASK)
  if (!p.plan) {
    return (
      <section className="section glass">
        <h2>Order</h2>
        <p className="muted">Add a BOM to see the parts.</p>
      </section>
    )
  }
  const suggest = () =>
    ai.run({
      key: p.board.id,
      messages: OrderPlan.buildMessages(p.board),
      simulate: () => OrderPlan.simulate(p.board),
      validate: (v) => OrderPlan.validate(p.board, v),
      inputSummary: OrderPlan.inputSummary(p.board),
      fallbackAction: 'Kept the current order.',
    })
  return (
    <section className="section glass">
      <div className="card-row">
        <h2>Order</h2>
        <span className="faint" style={{ fontSize: '0.85rem' }}>
          Drag to reorder
        </span>
        <span className="spacer" />
        {p.plan.source !== 'default' && (
          <button className="btn sm ghost" onClick={() => dispatch({ type: 'set-plan', plan: defaultPlan(p.board) })}>
            Reset
          </button>
        )}
        <button className="btn sm" onClick={suggest} disabled={ai.status === 'loading'}>
          {ai.status === 'loading' ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <Icon name="spark" />} Suggest
        </button>
      </div>
      {ai.status === 'error' && <div className="err-text">Suggestion failed: {ai.error}</div>}
      {ai.status === 'done' && (
        <div className="cat" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card-row">
            <AiBadge simulated={ai.meta.simulated} />
            <b>Suggested order</b>
            <span className="spacer" />
            <MarkWrong
              task="orderPlan"
              meta={ai.meta}
              inputSummary={OrderPlan.inputSummary(p.board)}
              modelSaid={ai.data.categories.map((c) => `${c.name}: ${c.refs.join(',')}`).join(' | ')}
              uiAction={ai.issues.length ? `Corrected: ${ai.issues.join(' ')}` : 'Offered the order to accept.'}
              options={['Bad grouping', 'Bad order']}
            />
          </div>
          {ai.data.categories.map((c, i) => (
            <div key={c.id} style={{ fontSize: '0.9rem' }}>
              <b>
                {i + 1}. {c.name}
              </b>{' '}
              <span className="muted">{c.reason}</span>
              <div className="faint">{c.refs.join(' ')}</div>
            </div>
          ))}
          {ai.issues.length > 0 && <div className="note">App fixed: {ai.issues.join(' ')}</div>}
          <div className="card-row">
            <button className="btn ok sm" onClick={() => (dispatch({ type: 'set-plan', plan: { ...ai.data, source: ai.meta.simulated ? 'simulated' : 'ai', model: ai.meta.model } }), ai.reset())}>
              Use it
            </button>
            <button className="btn sm" onClick={ai.reset}>
              Keep mine
            </button>
          </div>
        </div>
      )}
      <BomList plan={p.plan} board={p.board} status={p.status} onChange={(plan) => dispatch({ type: 'set-plan', plan })} />
    </section>
  )
}
