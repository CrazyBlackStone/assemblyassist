import { packageGeometry } from '../lib/bom/packages.js'
import { PartGlyph, orientationLabel } from './PartGlyph.jsx'
import { nextAfterCurrent, progress } from '../state/projects.js'
import { SIDE_NAME } from '../lib/plan/plan.js'
import { runCommand } from '../lib/voice/controller.js'
import { runReview } from '../lib/verify/flow.js'
import { Icon } from './ui.jsx'

// Panel 1: the current part, drawn as it will sit on the board with its polarity mark
// lit, the next part in one line, and three controls.

export function PartPanel({ project }) {
  const { board, current, settings } = project
  const part = current ? board.parts[current] : null
  const next = nextAfterCurrent(project)
  const canUndo = project.history.length > 0

  if (!part) {
    const pr = progress(project)
    return (
      <section className="panel p1 glass" aria-label="Current part">
        <div>
          <div className="ref">Done</div>
          <div className="val" style={{ color: 'var(--green)' }}>
            {pr.placed} of {pr.total} placed
          </div>
        </div>
        <div className="glyph-stage" style={{ color: 'var(--green)' }}>
          <Icon name="check" className="ico" />
        </div>
        <button className="btn primary xl" onClick={runReview}>
          Review All Parts
        </button>
        <button className="btn" onClick={() => runCommand({ type: 'back' })} disabled={!canUndo}>
          <Icon name="undo" /> Undo Last
        </button>
      </section>
    )
  }

  const g = packageGeometry(part)
  const rot = part.loc?.rot ?? 0
  const side = part.loc?.side === 'bottom' ? 'bottom' : 'top'
  const label = orientationLabel(g, rot, settings.viewRotation ?? 0, side)
  const twoSided = project.plan.sides?.length === 2 && project.plan.categories.some((c) => c.side === 'bottom') && project.plan.categories.some((c) => c.side === 'top')
  const prev = project.history.length ? board.parts[/^(\S+) placed$/.exec(project.history[project.history.length - 1].label)?.[1]] : null
  const flipped = twoSided && prev?.loc && (prev.loc.side === 'bottom') !== (side === 'bottom')
  const meta = [part.size.code && part.size.code !== part.value ? part.size.code : null, twoSided ? SIDE_NAME[side] : null].filter(Boolean).join(' · ')

  return (
    <section className="panel p1 glass" aria-label="Current part">
      <div>
        <div className="ref">{part.ref}</div>
        <div className="val">{part.value || '—'}</div>
        {meta && <div className="pkg">{meta}</div>}
      </div>
      {flipped && (
        <div className="flip-note">
          <Icon name="flip" /> Flip the board to the {SIDE_NAME[side].toLowerCase()}
        </div>
      )}
      <div className="glyph-stage">
        <PartGlyph part={part} g={g} rot={rot} viewRotation={settings.viewRotation ?? 0} side={side} />
      </div>
      {label ? (
        <div className="orient">
          <span className="arrow">{label.arrow}</span> {label.name}
        </div>
      ) : (
        <div className="orient none">Either way round</div>
      )}
      {next && (
        <div className="up-next">
          <span className="label">Up Next</span>
          <span className="what">
            {next} <span>{board.parts[next].value}</span>
          </span>
        </div>
      )}
      <div className="controls">
        <button className="btn icon" onClick={() => runCommand({ type: 'back' })} disabled={!canUndo} aria-label="Back" title="Back (Z)">
          <Icon name="undo" />
        </button>
        <button className="btn icon" onClick={() => runCommand({ type: 'skip' })} aria-label="Skip" title="Skip (S)">
          <Icon name="skip" />
        </button>
        <button className="btn primary xl" onClick={() => runCommand({ type: 'placed' })} title="Next (Space)">
          Next <Icon name="next" />
        </button>
      </div>
    </section>
  )
}
