// Work out what each fabrication file is, across EDA tools. Order of evidence:
//   1. the file's own content: Excellon vs rout vs Gerber; Gerber X2 %TF.FileFunction;
//      Cadence Allegro "G04 Layer: CLASS/SUBCLASS" records
//   2. the file name: Protel/Altium extensions, KiCad and Eagle names, plain words
// Returns { type, side } where type is one of: copper, inner, soldermask, silkscreen,
// solderpaste, outline, drill, rout, assembly, drawing, placement, bom, netlist, ignore.

const PROTEL = {
  gtl: ['copper', 'top'], gbl: ['copper', 'bottom'], gts: ['soldermask', 'top'], gbs: ['soldermask', 'bottom'],
  gto: ['silkscreen', 'top'], gbo: ['silkscreen', 'bottom'], gtp: ['solderpaste', 'top'], gbp: ['solderpaste', 'bottom'],
  gko: ['outline', null], gm1: ['outline', null], gml: ['outline', null], gm: ['outline', null], oln: ['outline', null], out: ['outline', null],
  // Eagle CAM
  cmp: ['copper', 'top'], sol: ['copper', 'bottom'], stc: ['soldermask', 'top'], sts: ['soldermask', 'bottom'],
  plc: ['silkscreen', 'top'], pls: ['silkscreen', 'bottom'], crc: ['solderpaste', 'top'], crs: ['solderpaste', 'bottom'], dim: ['outline', null],
  drl: ['drill', null], xln: ['drill', null], exc: ['drill', null], drd: ['drill', null], tap: ['drill', null], rou: ['rout', null],
  ipc: ['netlist', null], d356: ['netlist', null],
}

const isExcellon = (t) => /^\s*(;[^\n]*\n\s*)*M48\b/.test(t) || /^M48\s*$/m.test(t.slice(0, 2000))
const isRout = (t) => /^M1[56]\s*$/m.test(t) && /^G0[01]X/m.test(t)
const isGerber = (t) => /%FS[LT]?[AI]?X\d\dY\d\d/.test(t.slice(0, 5000)) || /%MO(MM|IN)\*%/.test(t.slice(0, 5000))
const isIpc356 = (t) => /^P\s+(JOB|UNITS)\b/m.test(t.slice(0, 3000)) && /^3[1-3]7/m.test(t)

function fromX2(text) {
  const m = /%TF\.FileFunction,([^*]+)\*%/.exec(text.slice(0, 8000))
  if (!m) return null
  const f = m[1].split(',').map((s) => s.trim())
  const side = f.includes('Top') ? 'top' : f.includes('Bot') ? 'bottom' : null
  switch (f[0]) {
    case 'Copper':
      return f.includes('Inr') ? { type: 'inner', side: null } : { type: 'copper', side }
    case 'Soldermask':
      return { type: 'soldermask', side }
    case 'Legend':
      return { type: 'silkscreen', side }
    case 'Paste':
      return { type: 'solderpaste', side }
    case 'Profile':
      return { type: 'outline', side: null }
    case 'Plated':
    case 'NonPlated':
      return { type: 'drill', side: null }
    case 'AssemblyDrawing':
      return { type: 'assembly', side }
    default:
      return { type: 'drawing', side }
  }
}

function fromAllegro(text) {
  const recs = [...text.slice(0, 6000).matchAll(/^G04 Layer:\s*([^/\n]+)\/([^*\n]+)/gm)].map((m) => ({ cls: m[1].trim().toUpperCase(), sub: m[2].trim().toUpperCase() }))
  if (!recs.length) return null
  const subs = new Set(recs.map((r) => r.sub))
  const etch = recs.find((r) => r.cls === 'ETCH')
  if (etch) {
    if (etch.sub === 'TOP') return { type: 'copper', side: 'top' }
    if (etch.sub === 'BOTTOM') return { type: 'copper', side: 'bottom' }
    return { type: 'inner', side: null }
  }
  for (const [key, type] of [
    ['SOLDERMASK', 'soldermask'],
    ['PASTEMASK', 'solderpaste'],
    ['SILKSCREEN', 'silkscreen'],
    ['ASSEMBLY', 'assembly'],
  ]) {
    if (subs.has(`${key}_TOP`)) return { type, side: 'top' }
    if (subs.has(`${key}_BOTTOM`)) return { type, side: 'bottom' }
  }
  if ([...subs].some((s) => /NCLEGEND|NCDRILL|DIMENSION/.test(s))) return { type: 'drawing', side: null }
  if ([...subs].every((s) => /OUTLINE|CUTOUT/.test(s))) return { type: 'outline', side: null }
  return { type: 'drawing', side: null }
}

function fromName(name) {
  const base = name.toLowerCase().split('/').pop()
  const ext = base.includes('.') ? base.split('.').pop() : ''
  if (PROTEL[ext]) return { type: PROTEL[ext][0], side: PROTEL[ext][1] }
  if (/^g\d{1,2}$|^gp\d{1,2}$/.test(ext)) return { type: 'inner', side: null }
  const n = base.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, ' ')
  const has = (re) => re.test(` ${n} `)
  const side = has(/\b(top|f|front|cmp|component|tp)\b/) ? 'top' : has(/\b(bottom|bot|b|back|solder side|bt)\b/) ? 'bottom' : null
  if (has(/\b(edge cuts|edge|outline|profile|board outline|mechanical 1|dimension|keepout)\b/)) return { type: 'outline', side: null }
  if (has(/\b(paste|cream|stencil|smd)\b/)) return { type: 'solderpaste', side }
  if (has(/\b(silk|silks|silkscreen|legend|overlay)\b/)) return { type: 'silkscreen', side }
  if (has(/\b(mask|soldermask|solder|sm|resist)\b/)) return { type: 'soldermask', side }
  if (has(/\b(assy|assembly|fab)\b/)) return { type: 'assembly', side }
  if (has(/\b(in\d+ cu|inner|gnd\d*|pwr\d*|power|signal\d+|plane|l[2-9])\b/)) return { type: 'inner', side: null }
  if (has(/\b(f cu|b cu|copper|cu|layer|toplayer|bottomlayer|top|bottom|bot)\b/) && side) return { type: 'copper', side }
  return null
}

const PLACEMENT_NAME = /(pick|place|placement|pnp|cpl|centroid|xy|\.pos$|pos\.csv$|insert)/i
const BOM_NAME = /(bom|bill.?of.?materials|parts.?list)/i

/** Identify one file from its name and text. */
export function identifyFile(name, text) {
  const t = String(text ?? '')
  if (isIpc356(t)) return { type: 'netlist', side: null }
  if (/^\s*VERSION\s*=.*\n\s*UUNITS\s*=/m.test(t.slice(0, 400)) && /!/.test(t)) return { type: 'placement', side: null } // Allegro place_txt
  if (isExcellon(t)) return isRout(t) ? { type: 'rout', side: null } : { type: 'drill', side: null }
  if (isGerber(t)) return fromX2(t) ?? fromAllegro(t) ?? fromName(name) ?? { type: 'drawing', side: null }
  if (/\.(csv|txt|tsv|pos)$/i.test(name)) {
    if (PLACEMENT_NAME.test(name)) return { type: 'placement', side: null }
    if (BOM_NAME.test(name)) return { type: 'bom', side: null }
  }
  return { type: 'ignore', side: null }
}

export const LAYER_LABEL = {
  copper: 'Copper',
  soldermask: 'Mask',
  silkscreen: 'Silkscreen',
  solderpaste: 'Paste',
  outline: 'Outline',
  drill: 'Drill',
  inner: 'Inner copper',
  rout: 'Rout path',
  assembly: 'Assembly',
  drawing: 'Drawing',
  placement: 'Placement',
  bom: 'BOM',
  netlist: 'Netlist',
  ignore: 'Not used',
}

/** File name the renderer recognises for a layer (Protel-style extensions). */
export function canonicalName(type, side, i) {
  const ext = {
    'copper:top': 'gtl', 'copper:bottom': 'gbl', 'soldermask:top': 'gts', 'soldermask:bottom': 'gbs',
    'silkscreen:top': 'gto', 'silkscreen:bottom': 'gbo', 'solderpaste:top': 'gtp', 'solderpaste:bottom': 'gbp',
    'outline:null': 'gko', 'drill:null': 'drl',
  }[`${type}:${side}`]
  return ext ? `layer${i}.${ext}` : null
}
