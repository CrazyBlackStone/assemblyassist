import { lazy, Suspense, useEffect } from 'react'
import { useStore } from '../lib/store.js'
import { project, dispatch, progress, currentSide } from '../state/projects.js'
import { ui, setUi } from '../state/ui.js'
import { runCommand } from '../lib/voice/controller.js'
import { runReview } from '../lib/verify/flow.js'
import { PartPanel } from '../components/PartPanel.jsx'
import { CameraPanel } from '../components/CameraPanel.jsx'
import { BomRail, VoiceBar, CostChip } from '../components/BuildChrome.jsx'
import { Icon } from '../components/ui.jsx'

const BoardView3D = lazy(() => import('../components/BoardView3D.jsx'))

export function Build({ navigate }) {
  const p = useStore(project)
  const u = useStore(ui)
  const partSide = currentSide(p)

  // Follow the current part's side again whenever it changes.
  useEffect(() => {
    setUi({ viewSide: null })
  }, [partSide])

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      const map = { ' ': 'placed', enter: 'placed', arrowright: 'placed', s: 'skip', z: 'back', backspace: 'back', arrowleft: 'back', k: 'check', y: 'confirm' }
      if (!map[k]) return
      e.preventDefault()
      runCommand({ type: map[k] })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!p) return null
  if (!p.board || !p.plan) {
    return (
      <main className="workspace">
        <div className="empty-state" style={{ paddingTop: '18vh' }}>
          <Icon name="layers" className="ico" />
          <div className="t-title2" style={{ color: 'var(--label)' }}>
            Add the Board Files First
          </div>
          <div>The build needs a placement file (and ideally the Gerbers).</div>
          <button className="btn primary" onClick={() => navigate(`/p/${p.id}/setup`)}>
            Open Setup
          </button>
        </div>
      </main>
    )
  }

  const pr = progress(p)
  const reviewing = Boolean(u.review)

  return (
    <div className="build">
      <header className="navbar">
        <div className="lead">
          <button className="btn back-btn" onClick={() => navigate('/')}>
            <Icon name="back" /> Projects
          </button>
        </div>
        <div className="center pill">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
          <div className="progress-pill" aria-label={`${pr.placed} of ${pr.total} placed`}>
            <div className="track">
              <div className="fill" style={{ width: `${(pr.placed / Math.max(1, pr.total)) * 100}%` }} />
            </div>
            <span className="muted">
              {pr.placed} of {pr.total}
            </span>
          </div>
        </div>
        <div className="trail">
          <button className="btn icon sm plain" onClick={() => navigate(`/p/${p.id}/setup`)} aria-label="Setup" title="Setup">
            <Icon name="sliders" />
          </button>
          <CostChip />
          <button className={`btn sm ${pr.pending === 0 ? 'primary' : 'tinted'}`} onClick={runReview} disabled={reviewing || pr.placed === 0} title="Check every placed part">
            <Icon name="done" /> Done
          </button>
        </div>
      </header>

      <main className="stage">
        <BomRail project={p} />
        <PartPanel project={p} />
        <section className="panel p2 glass" aria-label="Board">
          {p.render ? (
            <Suspense fallback={<div className="empty-cam"><div className="spinner" /></div>}>
              <BoardView3D
                project={p}
                side={u.viewSide ?? partSide}
                highlightRef={u.highlightRef}
                activeRef={u.review?.activeRef ?? null}
                calibrateRef={u.calibrating ? u.calibrating.refs[u.calibrating.taps.length] : (u.tapRequest?.ref ?? null)}
                reviewItems={u.review?.items ?? null}
                viewCmd={u.viewCmd}
                onPick={(ref) => dispatch({ type: 'jump', ref })}
                onFlip={() => setUi({ viewSide: (u.viewSide ?? partSide) === 'top' ? 'bottom' : 'top' })}
              />
            </Suspense>
          ) : (
            <div className="empty-cam muted">No positions yet. Add a placement file to see the board.</div>
          )}
          <div className="corner br">
            <button className="btn icon sm" onClick={() => dispatch({ type: 'setting', key: 'viewRotation', value: ((p.settings.viewRotation ?? 0) + 90) % 360 })} aria-label="Turn board view" title="Turn board view 90°">
              <Icon name="rotate" />
            </button>
          </div>
        </section>
        <CameraPanel project={p} />
      </main>

      <VoiceBar project={p} />
    </div>
  )
}
