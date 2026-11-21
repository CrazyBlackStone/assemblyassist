import { parseDelimited, findColumn, parseNumber, parseYesNo } from './csv.js'
import { expandRefs, compareRefs } from './refs.js'
import { describeFootprint, shortFootprint } from './footprint.js'
import { detectPolarity } from './polarity.js'

// Column aliases for common CAD exports (KiCad, Altium, EasyEDA, Eagle, JLCPCB).
const BOM_COLS = {
  ref: ['Reference', 'References', 'Designator', 'Designators', 'RefDes', 'Ref', 'Part', 'Parts'],
  value: ['Value', 'Val', 'Comment', 'Description'],
  footprint: ['Footprint', 'Package', 'Footprint Name', 'Case', 'JLCPCB Footprint'],
  qty: ['Qty', 'Quantity', 'Count', 'Qnty'],
  spares: ['Spares', 'Spare', 'Extra', 'Extras', 'Overage'],
  dnp: ['DNP', 'DNF', 'Do Not Place', 'Exclude', 'Not Fitted'],
  polarized: ['Polarized', 'Polarised', 'Polarity'],
}

const PNP_COLS = {
  ref: ['Ref', 'Reference', 'Designator', 'RefDes', 'Part'],
  x: ['PosX', 'Pos X', 'Mid X', 'Center-X(mm)', 'Center X', 'X', 'Ref X', 'LocationX'],
  y: ['PosY', 'Pos Y', 'Mid Y', 'Center-Y(mm)', 'Center Y', 'Y', 'Ref Y', 'LocationY'],
  rot: ['Rot', 'Rotation', 'Angle', 'Orientation'],
  side: ['Side', 'Layer', 'TB', 'Top/Bottom'],
}

export class BoardFileError extends Error {}

/** Parse a BOM CSV into rows: { refs, value, footprint, qty, spares, dnp, polarized }. */
export function parseBom(text) {
  const { headers, rows } = parseDelimited(text)
  const col = Object.fromEntries(Object.entries(BOM_COLS).map(([k, a]) => [k, findColumn(headers, a)]))
  if (!col.ref) {
    throw new BoardFileError(
      `No reference-designator column found. Expected one of: ${BOM_COLS.ref.join(', ')}. Found: ${headers.join(', ') || 'nothing'}.`,
    )
  }
  const warnings = []
  if (!col.value) warnings.push('No value column found; values will show as "—".')
  if (!col.footprint) warnings.push('No footprint column found; package sizes will be missing.')

  const out = []
  rows.forEach((row, i) => {
    const { refs, problems } = expandRefs(row[col.ref])
    problems.forEach((p) => warnings.push(`Row ${i + 2}: ${p}`))
    if (refs.length === 0) return
    const qty = col.qty ? parseNumber(row[col.qty]) : NaN
    if (!Number.isNaN(qty) && qty !== refs.length && !(col.spares && qty > refs.length)) {
      warnings.push(`Row ${i + 2}: quantity ${qty} does not match ${refs.length} reference(s) (${refs.join(', ')}).`)
    }
    const sparesCell = col.spares ? parseNumber(row[col.spares]) : NaN
    out.push({
      refs,
      value: String(row[col.value] ?? '').trim(),
      footprint: String(row[col.footprint] ?? '').trim(),
      qty: Number.isNaN(qty) ? refs.length : qty,
      spares: Number.isNaN(sparesCell) ? 0 : Math.max(0, sparesCell),
      dnp: col.dnp ? parseYesNo(row[col.dnp]) === true : false,
      polarized: col.polarized ? parseYesNo(row[col.polarized]) : null,
    })
  })
  if (out.length === 0) throw new BoardFileError('The BOM has no rows with reference designators.')
  return { rows: out, warnings, hasSparesColumn: Boolean(col.spares) }
}

/** KiCad's default ASCII .pos format: "# Ref Val Package PosX PosY Rot Side" + whitespace columns. */
function kicadAsciiToCsv(text) {
  const lines = text.split(/\r?\n/)
  const headerLine = lines.find((l) => /^#\s*Ref\s+Val/i.test(l))
  if (!headerLine) return null
  const header = headerLine.replace(/^#\s*/, '').trim().split(/\s+/)
  const body = lines
    .filter((l) => l.trim() && !l.trim().startsWith('#') && !/^##/.test(l))
    .map((l) => (l.match(/"[^"]*"|\S+/g) ?? []).map((c) => c.replace(/^"|"$/g, '')))
    .filter((cells) => cells.length >= header.length)
  const quote = (c) => `"${String(c).replace(/"/g, '""')}"`
  return [header, ...body].map((r) => r.map(quote).join(',')).join('\n')
}

/** Parse a pick-and-place file into { locations: {ref: {x,y,rot,side}}, warnings }. */
export function parsePnp(text) {
  const csv = kicadAsciiToCsv(String(text)) ?? text
  const { headers, rows } = parseDelimited(csv)
  const col = Object.fromEntries(Object.entries(PNP_COLS).map(([k, a]) => [k, findColumn(headers, a)]))
  if (!col.ref || !col.x || !col.y) {
    throw new BoardFileError(
      `Pick-and-place file needs reference, X and Y columns. Found: ${headers.join(', ') || 'nothing'}.`,
    )
  }
  const warnings = []
  const locations = {}
  rows.forEach((row, i) => {
    const ref = String(row[col.ref] ?? '').trim().toUpperCase()
    if (!ref) return
    const x = parseNumber(row[col.x])
    const y = parseNumber(row[col.y])
    if (Number.isNaN(x) || Number.isNaN(y)) {
      warnings.push(`Row ${i + 2} (${ref}): could not read X/Y.`)
      return
    }
    const rot = col.rot ? parseNumber(row[col.rot]) : 0
    const sideRaw = String(row[col.side] ?? 'top').toLowerCase()
    const side = /^b|bottom|bot/.test(sideRaw) ? 'bottom' : 'top'
    locations[ref] = { x, y, rot: Number.isNaN(rot) ? 0 : ((rot % 360) + 360) % 360, side }
  })
  return { locations, warnings }
}

function hashString(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Build the board model from parsed BOM rows and optional PnP locations.
 * Parts with identical value + footprint share a group so they are placed together.
 */
export function buildBoard({ name, source, bom, pnp }) {
  const warnings = [...bom.warnings, ...(pnp?.warnings ?? [])]
  const parts = {}
  const groups = []
  const groupIndex = new Map()
  const excluded = []

  for (const row of bom.rows) {
    if (row.dnp) {
      excluded.push(...row.refs)
      continue
    }
    const key = `${row.value.toLowerCase()}|${shortFootprint(row.footprint).toLowerCase()}`
    let group = groupIndex.get(key)
    if (!group) {
      group = { id: `g${groups.length + 1}`, value: row.value, footprint: row.footprint, refs: [], spares: 0 }
      groupIndex.set(key, group)
      groups.push(group)
    }
    group.spares += row.spares
    for (const ref of row.refs) {
      if (parts[ref]) {
        warnings.push(`${ref} appears more than once in the BOM; keeping the first entry.`)
        continue
      }
      group.refs.push(ref)
      parts[ref] = {
        ref,
        value: row.value,
        footprint: row.footprint,
        size: describeFootprint(row.footprint),
        polarity: detectPolarity({ ref, footprint: row.footprint, override: row.polarized }),
        group: group.id,
        loc: pnp?.locations?.[ref] ?? null,
      }
    }
  }
  groups.forEach((g) => g.refs.sort(compareRefs))
  const realGroups = groups.filter((g) => g.refs.length > 0)

  if (pnp) {
    const missing = Object.keys(parts).filter((r) => !parts[r].loc)
    if (missing.length) warnings.push(`No location in the pick-and-place file for: ${missing.join(', ')}.`)
    const extra = Object.keys(pnp.locations).filter((r) => !parts[r] && !excluded.includes(r))
    if (extra.length) warnings.push(`Pick-and-place lists parts not in the BOM (ignored): ${extra.join(', ')}.`)
  }

  const fingerprint = realGroups.map((g) => `${g.value}|${g.footprint}|${g.refs.join(',')}`).join(';')
  return {
    id: `b_${hashString(fingerprint)}`,
    name: name || 'Untitled board',
    source,
    parts,
    groups: realGroups,
    excluded,
    hasLocations: Object.values(parts).some((p) => p.loc),
    hasSparesColumn: bom.hasSparesColumn,
    warnings,
  }
}

/** Default order: groups in BOM order, refs naturally sorted inside each group. */
export function defaultSequence(board) {
  return board.groups.flatMap((g) => g.refs)
}

export function loadBoardFromText({ name, source = 'upload', bomText, pnpText }) {
  const bom = parseBom(bomText)
  const pnp = pnpText ? parsePnp(pnpText) : null
  return buildBoard({ name, source, bom, pnp })
}
