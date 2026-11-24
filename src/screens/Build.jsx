import { useEffect } from 'react'
import { useStore } from '../lib/store.js'
import { project, dispatch, progress } from '../state/projects.js'
import { ui } from '../state/ui.js'
import { runCommand } from '../lib/voice/controller.js'
import { runReview } from '../lib/verify/flow.js'
import { BoardView } from '../components/BoardView.jsx'
import { PartPanel } from '../components/PartPanel.jsx'
import { CameraPanel } from '../components/CameraPanel.jsx'
import { BomRail, VoiceBar, CostChip } from '../components/BuildChrome.jsx'
import { Icon } from '../components/ui.jsx'

export function Build({ navigate }) {
  const p = useStore(project)
  const u = useStore(ui)

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
      <main className="workspace" style={{ textAlign: 'center', paddingTop: '20vh' }}>
        <h1>Add the board files first</h1>
        <p>
          <button className="btn primary xl" onClick={() => navigate(`/p/${p.id}/setup`)}>
            Open setup
          </button>
        </p>
      </main>
    )
  }

  const pr = progress(p)
  const reviewing = Boolean(u.review)

  return (
    <div className="build">
      <header className="topbar glass">
        <button className="btn icon ghost" onClick={() => navigate('/')} aria-label="Projects">
          <Icon name="back" />
        </button>
        <span className="title">{p.name}</span>
        <button className="btn icon sm ghost" onClick={() => navigate(`/p/${p.id}/setup`)} aria-label="Setup" title="Setup">
          <Icon name="list" />
        </button>
        <span className="spacer" />
        <div className="progress-pill" aria-label={`${pr.placed} of ${pr.total} placed`}>
          <div className="track">
            <div className="fill" style={{ width: `${(pr.placed / Math.max(1, pr.total)) * 100}%` }} />
          </div>
          {pr.placed}/{pr.total}
        </div>
        <span className="spacer" />
        <CostChip />
        <button className={`btn ${pr.pending === 0 ? 'primary' : ''}`} onClick={runReview} disabled={reviewing || pr.placed === 0}>
          <Icon name="done" /> Done
        </button>
      </header>

      <main className="stage">
        <BomRail project={p} />
        <PartPanel project={p} />
        <section className="panel p2 glass" aria-label="Board">
          {p.render ? (
            <BoardView
              project={p}
              highlightRef={u.highlightRef}
              activeRef={u.review?.activeRef ?? null}
              calibrateRef={u.calibrating ? u.calibrating.refs[u.calibrating.taps.length] : (u.tapRequest?.ref ?? null)}
              reviewItems={u.review?.items ?? null}
              onPick={(ref) => dispatch({ type: 'jump', ref })}
            />
          ) : (
            <div className="empty-cam muted">No positions: add a CPL file to see the board.</div>
          )}
          <div className="corner br">
            <button className="btn icon sm" onClick={() => dispatch({ type: 'setting', key: 'viewRotation', value: ((p.settings.viewRotation ?? 0) + 90) % 360 })} aria-label="Turn board view" title="Turn board view">
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
