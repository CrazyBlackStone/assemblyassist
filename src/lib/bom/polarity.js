import { refPrefix } from './refs.js'

// Deterministic polarity rules. The AI never decides whether a part is polarized:
// this comes from the reference designator, the footprint, or an explicit BOM column.

export const MARKINGS = {
  pin1: {
    label: 'Pin 1',
    howTo: 'Find the dot, notch or bevelled edge on the chip and line it up with the pin-1 mark on the board.',
  },
  cathode: {
    label: 'Cathode',
    howTo: 'Find the cathode mark on the part (line, notch or T-shape; check the datasheet) and line it up with the cathode mark on the board.',
  },
  tantalum: {
    label: 'Positive (+)',
    howTo: 'On tantalum capacitors the stripe marks the + side. Line it up with the + mark on the board.',
  },
  electrolytic: {
    label: 'Negative (−)',
    howTo: 'On aluminium electrolytic capacitors the stripe or shaded half marks the − side. Line the + side up with the + mark on the board.',
  },
  unknown: {
    label: 'Check datasheet',
    howTo: 'The BOM says this part is polarized. Check the datasheet for its marking before placing.',
  },
}

/**
 * @param {{ref: string, footprint?: string, override?: boolean|null}} part
 * @returns {{polarized: boolean, marking: keyof MARKINGS | null, reason: string}}
 */
export function detectPolarity({ ref, footprint, override = null }) {
  const prefix = refPrefix(ref)
  // Match on the full name: the library part ("Capacitor_Tantalum_SMD:") carries information too.
  const fp = String(footprint ?? '')
  const guess = guessMarking(prefix, fp)

  if (override === false) return { polarized: false, marking: null, reason: 'BOM marks it as not polarized' }
  if (override === true) {
    return { polarized: true, marking: guess?.marking ?? 'unknown', reason: 'BOM marks it as polarized' }
  }
  if (guess) return { polarized: true, ...guess }
  return { polarized: false, marking: null, reason: 'No polarity rule matched' }
}

function guessMarking(prefix, fp) {
  if (prefix === 'D' || prefix === 'LED') {
    return { marking: 'cathode', reason: `Reference starts with ${prefix} (diode/LED)` }
  }
  if (prefix === 'U' || prefix === 'IC' || prefix === 'Q') {
    return { marking: 'pin1', reason: `Reference starts with ${prefix} (chip/transistor)` }
  }
  if (prefix === 'C' || prefix === 'CP') {
    if (/tantal/i.test(fp)) return { marking: 'tantalum', reason: 'Tantalum capacitor footprint' }
    if (/elec|radial|CP_/i.test(fp)) {
      // KiCad "CP_" footprints include both tantalum (CP_EIA-*) and electrolytic (CP_Elec_*).
      if (/CP_EIA/i.test(fp)) return { marking: 'tantalum', reason: 'Tantalum capacitor footprint (CP_EIA)' }
      return { marking: 'electrolytic', reason: 'Electrolytic capacitor footprint' }
    }
  }
  return null
}
