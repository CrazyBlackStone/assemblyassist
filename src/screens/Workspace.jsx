import { useEffect, useState } from 'react'
import { useStore } from '../lib/store.js'
import { workspace, newProject, saveProject, deleteProject, projectThumb } from '../state/projects.js'
import { createDemoProject } from '../lib/projects/load.js'
import { CostChip } from '../components/BuildChrome.jsx'
import { Icon } from '../components/ui.jsx'

function Thumb({ id, hasRender }) {
  const [t, setT] = useState(null)
  useEffect(() => {
    if (hasRender) projectThumb(id).then(setT)
  }, [id, hasRender])
  if (!t) return <Icon name="board" className="ico" />
  return <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(t.svg)}`} style={{ objectFit: 'contain', padding: 12 }} />
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`
}

export function Workspace({ navigate }) {
  const ws = useStore(workspace)
  const create = async () => {
    const p = newProject(`Board ${ws.projects.length + 1}`)
    await saveProject(p)
    navigate(`/p/${p.id}/setup`)
  }
  return (
    <main className="workspace">
      <div className="ws-head">
        <h1>Projects</h1>
        <CostChip />
      </div>
      <div className="ws-grid">
        <button className="card glass new" onClick={create}>
          <span className="plus">
            <Icon name="plus" />
          </span>
          New project
        </button>
        {ws.projects.map((p) => (
          <div key={p.id} className="card glass" role="button" tabIndex={0} onClick={() => navigate(`/p/${p.id}/${p.total ? 'build' : 'setup'}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/p/${p.id}/build`)}>
            <div className="thumb">
              <Thumb id={p.id} hasRender={p.hasRender} />
            </div>
            <div className="meta">
              <div>
                <div className="name">{p.name}</div>
                <div className="faint" style={{ fontSize: '0.8rem' }}>
                  {p.total ? `${p.placed}/${p.total}` : 'Not set up'} · {ago(p.updatedAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  className="btn icon sm ghost"
                  aria-label={`Set up ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/p/${p.id}/setup`)
                  }}
                >
                  <Icon name="list" />
                </button>
                <button
                  className="btn icon sm ghost"
                  aria-label={`Delete ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`Delete “${p.name}”?`)) deleteProject(p.id)
                  }}
                >
                  <Icon name="trash" />
                </button>
                <span className="ring" style={{ '--p': p.total ? Math.round((p.placed / p.total) * 100) : 0 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      {!ws.projects.some((p) => p.demo) && ws.loaded && (
        <p style={{ marginTop: 24 }}>
          <button className="btn sm ghost" onClick={() => createDemoProject()}>
            Add the demo board
          </button>
        </p>
      )}
    </main>
  )
}
