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
const FILE_ROWS = [
  { key: 'gerber', label: 'Gerbers', hint: 'Fab .zip or layer files', icon: 'layers', color: 'var(--green)', multiple: true },
  { key: 'cpl', label: 'Placement', hint: 'Pick-and-place (CPL)', icon: 'pin', color: 'var(--blue)' },
  { key: 'bom', label: 'Bill of Materials', hint: 'Optional', icon: 'table', color: 'var(--orange)' },
]

/** A Settings-style row that is also a file picker and a drop target. */
function FileRow({ row, file, error, busy, onFiles }) {
  const [over, setOver] = useState(false)
  return (
    <label
      className={`row has-icon button ${over ? 'drop-over' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onFiles([...e.dataTransfer.files])
      }}
    >
      <input type="file" multiple={row.multiple} onChange={(e) => onFiles([...e.target.files])} aria-label={row.label} />
      <span className="row-icon" style={{ background: row.color }}>
        <Icon name={row.icon} />
      </span>
      <span className="row-main">
        <span className="row-title">{row.label}</span>
        <span className="row-sub">{error ? <span className="err-text t-footnote">{error}</span> : (file ?? row.hint)}</span>
      </span>
      <span className="row-trail">
        {busy ? <span className="spinner" /> : file && !error ? <Icon name="check" className="ico ok-mark" /> : <span>Choose</span>}
        <Icon name="chevron" className="ico chev" />
      </span>
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
      <header className="navbar">
        <div className="lead">
          <button className="btn back-btn" onClick={() => navigate('/')}>
            <Icon name="back" /> Projects
          </button>
        </div>
        <div className="center">{p.name}</div>
        <div className="trail">
          <CostChip />
          <button className="btn primary sm" disabled={!ready} onClick={() => navigate(`/p/${p.id}/build`)}>
            Start Building
          </button>
        </div>
      </header>

      <main className="setup">
        <div className="col">
          <section className="group">
            <h2 className="section-title">Board</h2>
            <div className="list">
              <label className="row">
                <span className="row-title">Name</span>
                <input className="row-input" value={p.name} onChange={(e) => dispatch({ type: 'rename', name: e.target.value })} aria-label="Project name" />
              </label>
              {FILE_ROWS.map((r) => (
                <FileRow key={r.key} row={r} file={fileLabel[r.key]} error={errors[r.key]} busy={busy === r.key} onFiles={(l) => onFiles(r.key, l)} />
              ))}
              {p.files.netlist && (
                <div className="row has-icon">
                  <span className="row-icon" style={{ background: 'var(--purple)' }}>
                    <Icon name="net" />
                  </span>
                  <span className="row-main">
                    <span className="row-title">Netlist</span>
                    <span className="row-sub">{p.files.netlist.name} · real pad positions</span>
                  </span>
                  <span className="row-trail">
                    <Icon name="check" className="ico ok-mark" />
                  </span>
                </div>
              )}
            </div>
            <p className="section-foot">Drop the fab zip from any EDA tool (KiCad, Altium, Allegro, Eagle). Layers are recognised from their contents, and a CPL, BOM or netlist inside the zip is picked up too.</p>
          </section>

          {(p.render || p.board) && (
            <section className="group">
              <div className="section-title">
                Preview
                <span className="spacer" />
                {hasBack && p.render && (
                  <button className="btn sm tinted" onClick={() => setPreviewSide(previewSide === 'top' ? 'bottom' : 'top')}>
                    <Icon name="flip" /> {previewSide === 'top' ? 'Show Back' : 'Show Front'}
                  </button>
                )}
              </div>
              {p.render && (
                <div className="preview">
                  <Suspense fallback={<div className="empty-cam"><div className="spinner" /></div>}>
                    <BoardView3D project={{ ...p, current: null }} side={previewSide} compact onFlip={null} />
                  </Suspense>
                </div>
              )}
              {p.board && (
                <div className="layers">
                  <span className="chip">{Object.keys(p.board.parts).length} parts</span>
                  {p.render && (
                    <span className="chip">
                      {p.render.size.w.toFixed(0)} × {p.render.size.h.toFixed(0)} mm
                    </span>
                  )}
                  {p.render?.layers?.length > 0 && <span className="chip">{p.render.layers.length} layers</span>}
                  {p.board.excluded.length > 0 && <span className="chip">{p.board.excluded.length} DNP</span>}
                  {!p.render?.svg && <span className="chip">No Gerbers: outline from parts</span>}
                </div>
              )}
              {p.files.gerbers.length > 0 && <LayerList files={p.files} />}
              {notes.length > 0 && (
                <details className="section-foot">
                  <summary className="note" style={{ cursor: 'pointer' }}>
                    {notes.length} note{notes.length > 1 ? 's' : ''} about these files
                  </summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}

          <section className="group">
            <h2 className="section-title">Assembly</h2>
            <div className="list">
              <div className="row has-icon">
                <span className="row-icon" style={{ background: 'var(--orange)' }}>
                  <Icon name="flame" />
                </span>
                <span className="row-main">
                  <span className="row-title">Check Soldering</span>
                  <span className="row-sub">Turn off when using solder paste</span>
                </span>
                <Switch checked={s.verifySoldering} onChange={(v) => dispatch({ type: 'setting', key: 'verifySoldering', value: v })} label="Check soldering" />
              </div>
              <div className="row has-icon">
                <span className="row-icon" style={{ background: 'var(--blue)' }}>
                  <Icon name="camera" />
                </span>
                <span className="row-main">
                  <span className="row-title">Camera</span>
                </span>
                <Seg value={s.cameraSource} options={[['phone', 'Phone'], ['local', 'This Device']]} onChange={(v) => dispatch({ type: 'setting', key: 'cameraSource', value: v })} />
              </div>
              <div className="row has-icon">
                <span className="row-icon" style={{ background: 'var(--red)' }}>
                  <Icon name="mic" />
                </span>
                <span className="row-main">
                  <span className="row-title">Microphone</span>
                </span>
                <Seg value={s.micSource} options={[['laptop', 'Laptop'], ['phone', 'Phone']]} onChange={(v) => dispatch({ type: 'setting', key: 'micSource', value: v })} />
              </div>
              <button className="row has-icon button" style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left' }} onClick={() => dispatch({ type: 'setting', key: 'viewRotation', value: ((s.viewRotation ?? 0) + 90) % 360 })}>
                <span className="row-icon" style={{ background: 'var(--label-2)' }}>
                  <Icon name="rotate" />
                </span>
                <span className="row-main">
                  <span className="row-title">Board Orientation</span>
                  <span className="row-sub">Match how the board sits in front of you</span>
                </span>
                <span className="row-trail tnum">
                  {s.viewRotation ?? 0}°
                  <Icon name="chevron" className="ico chev" />
                </span>
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
    <details className="section-foot">
      <summary style={{ cursor: 'pointer' }}>
        {layers.length} layers recognised{files.netlist ? ', plus a netlist' : ''}
        {files.unused?.length ? ` · ${files.unused.length} files not used` : ''}
      </summary>
      <div className="layers" style={{ marginTop: 8, padding: 0 }}>
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
    <section className="group">
      <h2 className="section-title">Phone</h2>
      <div className="list">
        <div className="pair">
          {qr && <img className="qr" src={qr} alt="Scan with the phone" />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <span className="t-subhead muted">Scan with the phone’s camera, or enter the code on the phone.</span>
            <div className="code">{pair.code ?? '······'}</div>
            <span className="t-subhead" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: ok ? 'var(--green)' : 'var(--label-2)', fontWeight: 600 }}>
              <span className={`status-dot ${ok ? 'on' : ''}`} /> {ok ? 'Streaming' : pair.status === 'linked' ? 'Linked' : 'Waiting for phone'}
            </span>
            {pair.error && <span className="err-text">{pair.error}</span>}
          </div>
        </div>
      </div>
      <p className="section-foot">
        Won’t connect?{' '}
        <a href="https://github.com/CrazyBlackStone/assemblyassist/blob/main/docs/phone-hotspot.md" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', textDecoration: 'none' }}>
          Use the phone’s hotspot
        </a>
        . Don’t point the camera at confidential designs.
      </p>
    </section>
  )
}

function OrderSection({ p }) {
  const ai = useAiTask(OrderPlan.TASK)
  if (!p.plan) {
    return (
      <section className="group">
        <h2 className="section-title">Build Order</h2>
        <div className="list">
          <div className="row">
            <span className="row-main">
              <span className="row-title muted">No parts yet</span>
              <span className="row-sub">Add a placement file or BOM to see the parts.</span>
            </span>
          </div>
        </div>
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
    <section className="group">
      <div className="section-title">
        Build Order
        <span className="spacer" />
        {p.plan.source !== 'default' && (
          <button className="btn sm plain" onClick={() => dispatch({ type: 'set-plan', plan: defaultPlan(p.board) })}>
            Reset
          </button>
        )}
        <button className="btn sm tinted" onClick={suggest} disabled={ai.status === 'loading'}>
          {ai.status === 'loading' ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <Icon name="spark" />} Suggest Order
        </button>
      </div>
      <p className="section-foot" style={{ marginTop: -2 }}>
        Drag parts, or whole categories by their name.
      </p>
      {ai.status === 'error' && <div className="err-text" style={{ padding: '0 16px' }}>Suggestion failed: {ai.error}</div>}
      {ai.status === 'done' && (
        <div className="cat" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 0 0 1.5px var(--tint), var(--shadow)' }}>
          <div className="card-row">
            <AiBadge simulated={ai.meta.simulated} />
            <span className="t-headline">Suggested Order</span>
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
            <div key={c.id} className="t-subhead">
              <b>
                {i + 1}. {c.name}
              </b>{' '}
              <span className="muted">{c.reason}</span>
              <div className="faint t-footnote">{c.refs.join(' ')}</div>
            </div>
          ))}
          {ai.issues.length > 0 && <div className="note">App fixed: {ai.issues.join(' ')}</div>}
          <div className="card-row">
            <span className="spacer" />
            <button className="btn sm" onClick={ai.reset}>
              Keep Mine
            </button>
            <button className="btn primary sm" onClick={() => (dispatch({ type: 'set-plan', plan: { ...ai.data, source: ai.meta.simulated ? 'simulated' : 'ai', model: ai.meta.model } }), ai.reset())}>
              Use This Order
            </button>
          </div>
        </div>
      )}
      <BomList plan={p.plan} board={p.board} status={p.status} onChange={(plan) => dispatch({ type: 'set-plan', plan })} />
    </section>
  )
}
