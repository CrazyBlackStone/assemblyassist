import { packageGeometry, packageExtent, toBoard } from '../bom/packages.js'

// Gerber handling: unzip uploads, render the top side with tracespace, and line the
// pick-and-place coordinates up with the board outline.
// All geometry here is in mm, "screen" orientation: X right, Y down (svgY = -boardY).

const SKIP = /\.(pdf|png|jpe?g|csv|xlsx?|txt|md|zip|html?|step|stp|wrl)$/i

/** Turn uploaded files (loose Gerbers and/or .zip archives) into [{ name, text }]. */
export async function collectGerbers(fileList) {
  const out = []
  for (const f of fileList) {
    if (/\.zip$/i.test(f.name)) {
      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(f)
      for (const entry of Object.values(zip.files)) {
        const base = entry.name.split('/').pop()
        if (entry.dir || !base || entry.name.includes('__MACOSX') || base.startsWith('.') || SKIP.test(base)) continue
        out.push({ name: base, text: await entry.async('string') })
      }
    } else if (!SKIP.test(f.name)) {
      out.push({ name: f.name, text: await f.text() })
    }
  }
  return out
}

function recolor(svg) {
  return svg
    .replace(/fill="#666"/g, 'fill="#1d1c17"') // bare substrate
    .replace(/color="#c93"/g, 'color="#d8b45a"') // exposed copper (ENIG-like)
    .replace(/fill="#004200" opacity="0.8"/g, 'fill="#0d3a2b" opacity="0.93"') // soldermask
    .replace(/color="#fff"/g, 'color="#e9ece4"') // silkscreen
    .replace(/<g color="#999"/g, '<g color="#999" opacity="0"') // paste: hidden
    .replace(/<svg ([^>]*?)>/, (m, attrs) => `<svg ${attrs} preserveAspectRatio="xMidYMid meet">`)
}

/**
 * Render the top side. Returns { svg, viewBox: [x, y, w, h] in mm (screen orientation),
 * size: { w, h }, layers: [{ name, type }] } or throws with a readable message.
 */
export async function renderTop(gerbers) {
  if (!gerbers.length) throw new Error('No Gerber files found.')
  const { read } = await import('@tracespace/core')
  const files = gerbers.map((g) => new File([g.text], g.name, { type: 'text/plain' }))
  return renderRead(await read(files))
}

/** Plot and render an already-read set of layers (split out so tests can read from disk). */
export async function renderRead(readResult) {
  const { plot, renderLayers, renderBoard, stringifySvg } = await import('@tracespace/core')
  const known = readResult.layers.filter((l) => l.type)
  if (!known.length) throw new Error('None of the files look like Gerber or drill files.')
  const plotResult = plot(readResult)
  const units = Object.values(plotResult.plotTreesById)[0]?.units ?? 'mm'
  const perMm = units === 'in' ? 1 / 25.4 : 1
  const layersResult = renderLayers(plotResult)
  const top = renderBoard(layersResult).top
  const [vx, vy, vw, vh] = layersResult.boardShapeRender.viewBox
  return {
    svg: recolor(stringifySvg(top)),
    viewBox: [vx / perMm, vy / perMm, vw / perMm, vh / perMm],
    size: { w: vw / perMm, h: vh / perMm },
    layers: readResult.layers.map((l) => ({ name: l.filename, type: l.type, side: l.side })),
    hasOutline: readResult.layers.some((l) => l.type === 'outline'),
  }
}

/** Board box from part extents when there are no Gerbers. */
export function fallbackRender(board) {
  const pts = []
  for (const p of Object.values(board.parts)) {
    if (!p.loc) continue
    const e = packageExtent(packageGeometry(p))
    for (const [x, y] of [
      [e.minX, e.minY],
      [e.maxX, e.maxY],
      [e.minX, e.maxY],
      [e.maxX, e.minY],
    ])
      pts.push(toBoard({ x, y }, p.loc))
  }
  if (!pts.length) return null
  const m = 2.5
  const minX = Math.min(...pts.map((q) => q.x)) - m
  const maxX = Math.max(...pts.map((q) => q.x)) + m
  const minY = Math.min(...pts.map((q) => q.y)) - m
  const maxY = Math.max(...pts.map((q) => q.y)) + m
  return { svg: null, viewBox: [minX, -maxY, maxX - minX, maxY - minY], size: { w: maxX - minX, h: maxY - minY }, layers: [], hasOutline: false }
}

const inside = (render, x, y) => {
  const [vx, vy, vw, vh] = render.viewBox
  return x >= vx && x <= vx + vw && -y >= vy && -y <= vy + vh
}

/**
 * Pick-and-place files sometimes use a different origin or a flipped Y. If most parts
 * fall outside the Gerber outline, try a flipped Y, then centre the parts on the board.
 * Returns { board, note } where note explains any correction (or null).
 */
export function alignToRender(board, render) {
  const parts = Object.values(board.parts).filter((p) => p.loc && p.loc.side !== 'bottom')
  if (!parts.length || !render?.svg) return { board, note: null }
  const score = (fx) => parts.filter((p) => inside(render, ...fx(p.loc))).length / parts.length
  const asIs = score((l) => [l.x, l.y])
  if (asIs >= 0.8) return { board, note: null }
  const flipped = score((l) => [l.x, -l.y])
  let fx = (l) => ({ ...l, y: -l.y, rot: (360 - l.rot) % 360 })
  let note = 'Pick-and-place Y axis was flipped to match the Gerbers.'
  if (flipped < 0.8) {
    const xs = parts.map((p) => p.loc.x)
    const ys = parts.map((p) => p.loc.y)
    const [vx, vy, vw, vh] = render.viewBox
    const dx = vx + vw / 2 - (Math.min(...xs) + Math.max(...xs)) / 2
    const dy = -(vy + vh / 2) - (Math.min(...ys) + Math.max(...ys)) / 2
    fx = (l) => ({ ...l, x: l.x + dx, y: l.y + dy })
    note = 'Pick-and-place positions did not line up with the Gerbers; centred them on the board. Check the board view.'
  }
  const partsOut = Object.fromEntries(Object.entries(board.parts).map(([r, p]) => [r, p.loc ? { ...p, loc: fx(p.loc) } : p]))
  return { board: { ...board, parts: partsOut, warnings: [...board.warnings, note] }, note }
}
