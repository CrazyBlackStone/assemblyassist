import { useEffect, useState } from 'react'
import { useStore } from '../lib/store.js'
import { workspace, newProject, saveProject, deleteProject, projectThumb } from '../state/projects.js'
import { createDemoProject } from '../lib/projects/load.js'
import { appearance, setAppearance } from '../lib/theme.js'
import { CostChip } from '../components/BuildChrome.jsx'
import { Icon, Seg } from '../components/ui.jsx'

function Thumb({ id, hasRender }) {
  const [t, setT] = useState(null)
  useEffect(() => {
    if (hasRender) projectThumb(id).then(setT)
  }, [id, hasRender])
  if (!t) return <Icon name="board" className="ico" />
  return <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(t.svg)}`} />
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'Yesterday' : `${d} days ago`
}

function status(p) {
  if (!p.total) return 'Not set up'
  if (p.placed >= p.total) return 'Complete'
  if (!p.placed) return `${p.total} parts`
  return `${p.placed} of ${p.total} placed`
}

export function Workspace({ navigate }) {
  const ws = useStore(workspace)
  const mode = useStore(appearance, (s) => s.mode)
  const create = async () => {
    const p = newProject(`Board ${ws.projects.length + 1}`)
    await saveProject(p)
    navigate(`/p/${p.id}/setup`)
  }
  return (
    <main className="workspace">
      <header className="ws-head">
        <div>
          <div className="t-footnote muted" style={{ fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
            Assembly Assist
          </div>
          <h1 className="t-large">Projects</h1>
        </div>
        <div className="tools">
          <Seg
            value={mode}
            options={[
              ['light', 'Light'],
              ['dark', 'Dark'],
              ['auto', 'Auto'],
            ]}
            onChange={setAppearance}
          />
          <CostChip />
          <button className="btn primary sm" onClick={create}>
            <Icon name="plus" /> New Project
          </button>
        </div>
      </header>

      {ws.loaded && ws.projects.length === 0 && (
        <div className="empty-state">
          <Icon name="board" className="ico" />
          <div className="t-title2" style={{ color: 'var(--label)' }}>
            No Projects
          </div>
          <div>Add your Gerbers and pick-and-place file to start a build.</div>
          <button className="btn primary" onClick={create}>
            New Project
          </button>
        </div>
      )}

      <div className="ws-grid">
        {ws.projects.map((p) => {
          const pct = p.total ? Math.round((p.placed / p.total) * 100) : 0
          return (
            <div key={p.id} className="card" role="button" tabIndex={0} onClick={() => navigate(`/p/${p.id}/${p.total ? 'build' : 'setup'}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/p/${p.id}/${p.total ? 'build' : 'setup'}`)}>
              <div className="thumb">
                <Thumb id={p.id} hasRender={p.hasRender} />
              </div>
              <div className="meta">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="name">{p.name}</div>
                  <div className="t-subhead muted">
                    {status(p)} · {ago(p.updatedAt)}
                  </div>
                  {p.total > 0 && (
                    <div className="bar" aria-label={`${pct}% placed`}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <div className="menu">
                  <button
                    className="btn icon sm plain"
                    aria-label={`Set up ${p.name}`}
                    title="Setup"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/p/${p.id}/setup`)
                    }}
                  >
                    <Icon name="sliders" />
                  </button>
                  <button
                    className="btn icon sm plain danger"
                    aria-label={`Delete ${p.name}`}
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (window.confirm(`Delete “${p.name}”?`)) deleteProject(p.id)
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {!ws.projects.some((p) => p.demo) && ws.loaded && (
        <p style={{ marginTop: 28 }}>
          <button className="btn sm plain" onClick={() => createDemoProject()}>
            Add the Demo Board
          </button>
        </p>
      )}
    </main>
  )
}
