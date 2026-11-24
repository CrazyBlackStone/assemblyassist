import { loadBoardFromText, BoardFileError } from '../bom/board.js'
import { renderTop, fallbackRender, alignToRender } from '../gerber/render.js'
import { identifyFile } from '../gerber/identify.js'
import { parseIpc356 } from '../bom/ipc356.js'
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
  const { bom, cpl, netlist } = project.files
  const gerbers = project.files.gerbers.map((g) => (g.type ? g : { ...g, ...identifyFile(g.name, g.text) }))
  let p = project
  let board = project.board

  let pads = null
  if (netlist) {
    try {
      pads = parseIpc356(netlist.text).pads
      notes.push(`Footprints from ${netlist.name}: ${Object.keys(pads).length} parts.`)
    } catch {
      notes.push(`Could not read ${netlist.name}; using package sizes from names.`)
    }
  }

  if ((bom || cpl) && bomChanged) {
    try {
      board = loadBoardFromText({ name: project.name, bomText: bom?.text ?? null, pnpText: cpl?.text ?? null, pads })
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

/**
 * Put files from one upload into the project's slots. A fabrication zip often carries the
 * placement file, BOM and netlist too; they fill empty slots (or the slot that was targeted).
 */
export function assignFiles(current, sorted, target) {
  const files = { ...current }
  if (sorted.gerbers.length) files.gerbers = sorted.gerbers
  if (sorted.netlist) files.netlist = { name: sorted.netlist.name, text: sorted.netlist.text }
  if (sorted.placement && (target === 'cpl' || !files.cpl)) files.cpl = { name: sorted.placement.name, text: sorted.placement.text }
  if (sorted.bom && (target === 'bom' || !files.bom)) files.bom = { name: sorted.bom.name, text: sorted.bom.text }
  files.unused = sorted.unused.map((f) => ({ name: f.name, type: f.type }))
  return files
}

export async function createDemoProject() {
  const base = newProject('Demo board')
  base.demo = true
  base.files = {
    gerbers: Object.entries(demoGerbers).map(([path, text]) => ({ name: path.split('/').pop(), text, ...identifyFile(path, text) })),
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
