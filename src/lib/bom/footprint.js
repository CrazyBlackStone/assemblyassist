// Turn CAD footprint names into something a person at the bench can use.
// These are fixed reference facts (package dimensions), never model output.

const CHIP_SIZES = {
  '01005': '0.4 × 0.2 mm',
  '0201': '0.6 × 0.3 mm',
  '0402': '1.0 × 0.5 mm',
  '0603': '1.6 × 0.8 mm',
  '0805': '2.0 × 1.25 mm',
  '1206': '3.2 × 1.6 mm',
  '1210': '3.2 × 2.5 mm',
  '1812': '4.5 × 3.2 mm',
  '2010': '5.0 × 2.5 mm',
  '2512': '6.3 × 3.2 mm',
}

const TINY = new Set(['01005', '0201', '0402'])

/** "Capacitor_SMD:C_0805_2012Metric" -> "C_0805_2012Metric" */
export function shortFootprint(footprint) {
  const s = String(footprint ?? '').trim()
  const i = s.lastIndexOf(':')
  return i >= 0 ? s.slice(i + 1) : s
}

/**
 * Returns { code, label, tiny } describing the package size.
 * code: short name ("0805", "SOIC-8"); label: human description; tiny: hard to see/handle.
 */
export function describeFootprint(footprint) {
  const name = shortFootprint(footprint)
  if (!name) return { code: '', label: 'Footprint not listed', tiny: false }

  const chip = /(?:^|[^0-9])(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)(?![0-9])/.exec(name)
  if (chip) {
    const code = chip[1]
    return { code, label: `${code} chip (${CHIP_SIZES[code]})`, tiny: TINY.has(code) }
  }

  const eia = /EIA-(\d{2})(\d{2})/i.exec(name)
  if (eia) {
    const [l, w] = [Number(eia[1]) / 10, Number(eia[2]) / 10]
    return { code: `EIA ${eia[1]}${eia[2]}`, label: `EIA ${eia[1]}${eia[2]} (${l} × ${w} mm)`, tiny: false }
  }

  const header = /PinHeader_(\d+)x(\d+)_P([\d.]+)mm/i.exec(name)
  if (header) {
    const [, rows, cols, pitch] = header
    return { code: `${Number(rows)}×${Number(cols)} header`, label: `Pin header ${Number(rows)}×${Number(cols)}, ${pitch} mm pitch (through-hole)`, tiny: false }
  }

  const families = [
    [/SOIC-?(\d+)/i, (n) => `SOIC-${n}`, (n) => `SOIC-${n} chip, 1.27 mm pin pitch`],
    [/TSSOP-?(\d+)/i, (n) => `TSSOP-${n}`, (n) => `TSSOP-${n} chip, fine pitch`],
    [/MSOP-?(\d+)/i, (n) => `MSOP-${n}`, (n) => `MSOP-${n} chip, fine pitch`],
    [/QFN-?(\d+)/i, (n) => `QFN-${n}`, (n) => `QFN-${n} chip, pads underneath`],
    [/[LT]?QFP-?(\d+)/i, (n) => `QFP-${n}`, (n) => `QFP-${n} chip, fine pitch`],
    [/DIP-?(\d+)/i, (n) => `DIP-${n}`, (n) => `DIP-${n} chip (through-hole)`],
    [/SOT-?223/i, () => 'SOT-223', () => 'SOT-223 (6.5 × 3.5 mm, large tab)'],
    [/SOT-?23-?(\d)?/i, (n) => `SOT-23${n ? `-${n}` : ''}`, (n) => `SOT-23${n ? `-${n}` : ''} (2.9 × 1.3 mm)`],
    [/\bD_SMA\b|DO-?214AC/i, () => 'SMA', () => 'SMA diode (4.3 × 2.6 mm)'],
    [/\bD_SMB\b|DO-?214AA/i, () => 'SMB', () => 'SMB diode (4.3 × 3.6 mm)'],
    [/PTS645|6x6/i, () => '6×6 switch', () => '6 × 6 mm tactile switch'],
  ]
  for (const [re, code, label] of families) {
    const m = re.exec(name)
    if (m) {
      const tiny = /TSSOP|MSOP|QFN|QFP/i.test(m[0])
      return { code: code(m[1]), label: label(m[1]), tiny }
    }
  }

  return { code: name, label: name, tiny: false }
}
