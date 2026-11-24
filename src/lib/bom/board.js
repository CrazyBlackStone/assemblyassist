import { parseDelimited, findColumn, parseNumber, parseYesNo, looksBinary } from './csv.js'
import { expandRefs, compareRefs } from './refs.js'
import { describeFootprint, shortFootprint } from './footprint.js'
import { detectPolarity } from './polarity.js'

// Column aliases for common CAD exports (KiCad, Altium, EasyEDA, Eagle, JLCPCB).
const BOM_COLS = {
  ref: ['Reference', 'References', 'Refs', 'Ref', 'Designator', 'Designators', 'RefDes', 'Ref Des', 'Part', 'Parts', 'Reference Designator', 'Reference Designators'],
  value: ['Value', 'Val', 'Comment', 'Description'],
  footprint: ['Footprint', 'Package', 'Footprint Name', 'Case', 'JLCPCB Footprint'],
  qty: ['Qty', 'Quantity', 'Count', 'Qnty', 'Quantity Per PCB'],
  spares: ['Spares', 'Spare', 'Extra', 'Extras', 'Overage'],
  dnp: ['DNP', 'DNF', 'Do Not Place', 'Exclude', 'Not Fitted'],
  polarized: ['Polarized', 'Polarised', 'Polarity'],
}

const PNP_COLS = {
  ref: ['Ref', 'Reference', 'Refs', 'Designator', 'RefDes', 'Part'],
  x: ['PosX', 'Pos X', 'Mid X', 'MidX', 'Center-X(mm)', 'Center-X(mil)', 'Center-X', 'Center X', 'X', 'X (mm)', 'Ref X', 'RefX', 'LocationX', 'symbol_x'],
  y: ['PosY', 'Pos Y', 'Mid Y', 'MidY', 'Center-Y(mm)', 'Center-Y(mil)', 'Center-Y', 'Center Y', 'Y', 'Y (mm)', 'Ref Y', 'RefY', 'LocationY', 'symbol_y'],
  rot: ['Rot', 'Rotation', 'Angle', 'Orientation'],
  side: ['Side', 'Layer', 'TB', 'Top/Bottom', 'mirror'],
  pkg: ['Package', 'Footprint', 'symbol_name', 'Pattern', 'Case'],
  val: ['Val', 'Value', 'Comment'],
}

export class BoardFileError extends Error {}

/** Parse a BOM CSV into rows: { refs, value, footprint, qty, spares, dnp, polarized }. */
export function parseBom(text) {
  const { headers, rows, skippedLines } = parseDelimited(text, { headerAliases: BOM_COLS.ref })
  const col = Object.fromEntries(Object.entries(BOM_COLS).map(([k, a]) => [k, findColumn(headers, a)]))
  if (!col.ref) {
    throw new BoardFileError(
      `No reference-designator column found. Expected one of: ${BOM_COLS.ref.join(', ')}. Found: ${headers.join(', ') || 'nothing'}.`,
    )
  }
  const warnings = []
  if (skippedLines) warnings.push(`Skipped ${skippedLines} title line(s) above the column headers.`)
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

const MM_PER = { mm: 1, mil: 0.0254, in: 25.4, um: 0.001, cm: 10 }

/** Units from the file's preamble or column names; mm when nothing says otherwise. */
function detectUnits(text) {
  const head = text.slice(0, 3000)
  const m =
    /UUNITS\s*=\s*(\w+)/i.exec(head) ?? /Unit(?:s)?(?:\s+used)?\s*[:=]\s*(\w+)/i.exec(head) ?? /Center-X\((\w+)\)/i.exec(head) ?? /\d(mil|mm|in)\b/i.exec(head)
  const u = (m?.[1] ?? 'mm').toLowerCase()
  if (u.startsWith('mil')) return u === 'millimeters' || u === 'millimetres' ? 'mm' : 'mil'
  if (u.startsWith('in')) return 'in'
  if (u.startsWith('micron')) return 'um'
  if (u.startsWith('centi')) return 'cm'
  return 'mm'
}

const quote = (c) => `"${String(c).replace(/"/g, '""')}"`
const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(quote).join(',')).join('\n')

/** Cadence Allegro place_txt: "refdes ! symbol_x ! symbol_y ! rotation ! mirror ! symbol_name". */
function allegroToCsv(text) {
  if (!/^\s*UUNITS\s*=/m.test(text) || !text.includes('!')) return null
  const lines = text.split(/\r?\n/)
  const headerLine = lines.find((l) => /^#.*refdes.*!/i.test(l))
  const header = headerLine ? headerLine.replace(/^#/, '').split('!').map((h) => h.trim()) : ['refdes', 'symbol_x', 'symbol_y', 'rotation', 'mirror', 'symbol_name']
  const rows = lines.filter((l) => l.includes('!') && !l.trim().startsWith('#')).map((l) => l.split('!').map((c) => c.trim()))
  return toCsv(header, rows)
}

/**
 * Whitespace-separated tables: KiCad ASCII .pos ("# Ref Val Package PosX PosY Rot Side") and
 * Altium's text pick-and-place ("Designator Footprint Mid X Mid Y ... TB Rotation Comment").
 */
function whitespaceToCsv(text) {
  const lines = text.split(/\r?\n/)
  const refWords = /^(ref|refdes|designator|reference)$/i
  const idx = lines.slice(0, 60).findIndex((l) => {
    if (/[,;\t]/.test(l)) return false
    const t = l.replace(/^#\s*/, '').trim().split(/\s+/)
    return t.length >= 4 && refWords.test(t[0].replace(/"/g, ''))
  })
  if (idx < 0) return null
  const header = lines[idx]
    .replace(/^#\s*/, '')
    .replace(/"/g, '')
    .replace(/\b(Mid|Ref|Pad|Center)\s+([XY])\b/gi, '$1$2')
    .trim()
    .split(/\s+/)
  const rows = lines
    .slice(idx + 1)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => (l.match(/"[^"]*"|\S+/g) ?? []).map((c) => c.replace(/^"|"$/g, '')))
    .filter((cells) => cells.length >= Math.min(header.length, 4))
    .map((cells) => (cells.length > header.length ? [...cells.slice(0, header.length - 1), cells.slice(header.length - 1).join(' ')] : cells))
  return toCsv(header, rows)
}

/**
 * Parse a pick-and-place / centroid / CPL file (KiCad, Altium, Allegro, JLCPCB, Eagle, generic
 * CSV) into { locations: { ref: { x, y, rot, side, pkg, val } }, units, warnings }. Positions in mm.
 */
export function parsePnp(text) {
  const raw = String(text)
  const units = detectUnits(raw)
  const scale = MM_PER[units]
  const csv = allegroToCsv(raw) ?? whitespaceToCsv(raw) ?? raw
  const { headers, rows } = parseDelimited(csv, { headerAliases: PNP_COLS.ref })
  const col = Object.fromEntries(Object.entries(PNP_COLS).map(([k, a]) => [k, findColumn(headers, a)]))
  if (!col.ref || !col.x || !col.y) {
    throw new BoardFileError(`Pick-and-place file needs reference, X and Y columns. Found: ${headers.join(', ') || 'nothing'}.`)
  }
  const warnings = []
  if (units !== 'mm') warnings.push(`Pick-and-place units: ${units}, converted to mm.`)
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
    const sideRaw = String(row[col.side] ?? '').trim().toLowerCase()
    const side = /^(b|bot|bottom|m|mirror|yes|y|true)/.test(sideRaw) ? 'bottom' : 'top'
    locations[ref] = {
      x: x * scale,
      y: y * scale,
      rot: Number.isNaN(rot) ? 0 : ((rot % 360) + 360) % 360,
      side,
      pkg: col.pkg ? String(row[col.pkg] ?? '').trim() : '',
      val: col.val ? String(row[col.val] ?? '').trim() : '',
    }
  })
  if (!Object.keys(locations).length) throw new BoardFileError('The pick-and-place file has no rows with positions.')
  return { locations, units, warnings }
}

/** Without a BOM: one part per placement row, value and package from the placement file. */
export function bomFromPnp(pnp) {
  const rows = Object.entries(pnp.locations).map(([ref, l]) => ({
    refs: [ref],
    value: l.val || l.pkg || '',
    footprint: l.pkg || '',
    qty: 1,
    spares: 0,
    dnp: false,
    polarized: null,
  }))
  return { rows, warnings: ['No BOM: parts, values and packages come from the placement file.'], hasSparesColumn: false }
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
export function buildBoard({ name, source, bom, pnp, pads = null }) {
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
      const footprint = row.footprint || pnp?.locations?.[ref]?.pkg || ''
      parts[ref] = {
        ref,
        value: row.value,
        footprint,
        size: describeFootprint(footprint),
        polarity: detectPolarity({ ref, footprint, override: row.polarized }),
        group: group.id,
        loc: pnp?.locations?.[ref] ?? null,
        pads: pads?.[ref] ?? null,
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

export function loadBoardFromText({ name, source = 'upload', bomText, pnpText, pads = null }) {
  for (const [label, t] of [['BOM', bomText], ['pick-and-place', pnpText]]) {
    const kind = t ? looksBinary(t) : null
    if (kind) throw new BoardFileError(`The ${label} file looks like ${kind}. Export or "Save as" CSV (comma-separated) and load that instead.`)
  }
  let pnp = null
  try {
    pnp = pnpText ? parsePnp(pnpText) : null
  } catch (e) {
    throw new BoardFileError(`Pick-and-place file: ${e.message}`)
  }
  let bom
  try {
    bom = bomText ? parseBom(bomText) : pnp ? bomFromPnp(pnp) : null
  } catch (e) {
    throw new BoardFileError(`BOM file: ${e.message}`)
  }
  if (!bom) throw new BoardFileError('BOM file: add a BOM or a placement file.')
  return buildBoard({ name, source, bom, pnp, pads })
}
