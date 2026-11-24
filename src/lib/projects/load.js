import { loadBoardFromText, BoardFileError } from '../bom/board.js'
import { renderTop, fallbackRender, alignToRender } from '../gerber/render.js'
import { newProject, saveProject, projectReducer, workspace } from '../../state/projects.js'
import { demoBoardText } from '../../data/demoBoard.js'

/**
 * Rebuild a project's board and render from its files.
 * Returns { project, errors: { gerber?, bom?, cpl? }, notes: [] }.
 * The build order and progress reset only when the BOM or CPL changed.
 */
export async function rebuild(project, { bomChanged = true } = {}) {
  const errors = {}
  const notes = []
  const { gerbers, bom, cpl } = project.files
  let p = project
  let board = project.board

  if (bom && bomChanged) {
    try {
      board = loadBoardFromText({ name: project.name, bomText: bom.text, pnpText: cpl?.text ?? null })
      p = projectReducer(p, { type: 'load-board', board })
    } catch (e) {
      const msg = e instanceof BoardFileError ? e.message : `Could not read the files: ${e.message}`
      if (/^Pick-and-place/.test(msg)) errors.cpl = msg.replace(/^Pick-and-place file: /, '')
      else errors.bom = msg.replace(/^BOM file: /, '')
      return { project: p, errors, notes }
    }
  }
  if (!board) return { project: p, errors, notes }

  let render = null
  if (gerbers.length) {
    try {
      render = await renderTop(gerbers)
    } catch (e) {
      errors.gerber = e.message
    }
  }
  if (render) {
    const aligned = alignToRender(p.board, render)
    if (aligned.note) notes.push(aligned.note)
    p = projectReducer(p, { type: 'set-render', render, board: aligned.board })
  } else {
    p = projectReducer(p, { type: 'set-render', render: board.hasLocations ? fallbackRender(p.board) : null })
  }
  if (cpl && !board.hasLocations) errors.cpl = 'No positions matched the BOM.'
  notes.push(...board.warnings.filter((w) => !notes.includes(w)))
  return { project: p, errors, notes }
}

const demoGerbers = import.meta.glob('../../data/demo/gerbers/*', { query: '?raw', import: 'default', eager: true })

export async function createDemoProject() {
  const base = newProject('Demo board')
  base.demo = true
  base.files = {
    gerbers: Object.entries(demoGerbers).map(([path, text]) => ({ name: path.split('/').pop(), text })),
    bom: { name: 'demo-bom.csv', text: demoBoardText.bomText },
    cpl: { name: 'demo-cpl.csv', text: demoBoardText.pnpText },
  }
  const { project } = await rebuild(base)
  await saveProject(project)
  return project
}

let seeding = null
/** First visit: create the demo so the app works with no uploads. Runs once even if called twice. */
export function ensureDemo() {
  seeding ??= seedDemo()
  return seeding
}

async function seedDemo() {
  let seeded = false
  try {
    seeded = localStorage.getItem('aa:demoSeeded') === '1'
  } catch {
    /* ignore */
  }
  if (seeded || workspace.get().projects.length) return
  await createDemoProject()
  try {
    localStorage.setItem('aa:demoSeeded', '1')
  } catch {
    /* ignore */
  }
}
