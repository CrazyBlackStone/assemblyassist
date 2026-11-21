// Reference-designator helpers: "C1,C2 C3-C5" -> ["C1","C2","C3","C4","C5"].

const MAX_RANGE = 500

/** Letter prefix of a reference designator ("LED3" -> "LED", "U1" -> "U"). */
export function refPrefix(ref) {
  const m = /^[A-Za-z_]+/.exec(ref)
  return m ? m[0].toUpperCase() : ''
}

/** Natural sort: C2 before C10, grouped by prefix. */
export function compareRefs(a, b) {
  const pa = refPrefix(a)
  const pb = refPrefix(b)
  if (pa !== pb) return pa < pb ? -1 : 1
  const na = parseInt(a.slice(pa.length), 10)
  const nb = parseInt(b.slice(pb.length), 10)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Expand a designator cell into individual references.
 * Accepts separators , ; and whitespace, and ranges "R1-R4" or "R1-4".
 * Returns { refs, problems } where problems are human-readable warnings.
 */
export function expandRefs(cell) {
  const problems = []
  if (cell == null) return { refs: [], problems }
  const normalized = String(cell).trim().replace(/\s*-\s*/g, '-')
  if (!normalized) return { refs: [], problems }

  const refs = []
  for (const token of normalized.split(/[\s,;]+/)) {
    if (!token) continue
    const range = /^([A-Za-z_]+)(\d+)-([A-Za-z_]+)?(\d+)$/.exec(token)
    if (range) {
      const [, prefix, startStr, endPrefix, endStr] = range
      const start = Number(startStr)
      const end = Number(endStr)
      if ((endPrefix && endPrefix.toUpperCase() !== prefix.toUpperCase()) || end < start || end - start > MAX_RANGE) {
        problems.push(`Could not expand range "${token}"; kept as written.`)
        refs.push(token.toUpperCase())
        continue
      }
      for (let n = start; n <= end; n++) refs.push(`${prefix.toUpperCase()}${n}`)
      continue
    }
    refs.push(token.toUpperCase())
  }
  return { refs, problems }
}
