import Papa from 'papaparse'

const normalizeHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Parse delimited text (comma, semicolon or tab; auto-detected) into
 * { headers, rows, skippedLines } where rows are objects keyed by the original header.
 *
 * Some exporters (KiCad's legacy BOM script, several EDA tools) write title lines such as
 * "Source:", "Date:" or "Tool:" above the column headers. When headerAliases is given, the
 * header row is the first line (within the first 40) that contains one of those names.
 */
export function parseDelimited(text, { headerAliases = null } = {}) {
  let body = String(text).replace(/^\uFEFF/, '')
  let skippedLines = 0
  if (headerAliases) {
    const wanted = new Set(headerAliases.map(normalizeHeader))
    const lines = body.split(/\r?\n/)
    const preview = Papa.parse(lines.slice(0, 40).join('\n'), { skipEmptyLines: false }).data
    const idx = preview.findIndex((cells) => cells.some((c) => wanted.has(normalizeHeader(c))))
    if (idx > 0) {
      skippedLines = idx
      body = lines.slice(idx).join('\n')
    }
  }
  const result = Papa.parse(body, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })
  const headers = (result.meta.fields ?? []).filter(Boolean)
  return { headers, rows: result.data, skippedLines }
}

/** Spreadsheet or other binary files read as text: explain instead of showing garbage. */
export function looksBinary(text) {
  const head = String(text).slice(0, 2000)
  if (head.startsWith('PK')) return 'an Excel or other zipped file'
  if (head.startsWith('\u00d0\u00cf') || head.startsWith('\uFFFD\uFFFD')) return 'an old Excel (.xls) file'
  if (/%PDF-/.test(head.slice(0, 10))) return 'a PDF'
  const odd = (head.match(/[\u0000-\u0008\u000E-\u001F\uFFFD]/g) ?? []).length
  return odd > 20 ? 'a binary file' : null
}

/**
 * Find the header that matches one of the aliases (case- and punctuation-
 * insensitive). Returns the original header string or null.
 */
export function findColumn(headers, aliases) {
  const wanted = aliases.map(normalizeHeader)
  for (const alias of wanted) {
    const hit = headers.find((h) => normalizeHeader(h) === alias)
    if (hit) return hit
  }
  return null
}

/** Parse a number that may carry a unit suffix ("12.5mm", "90°", "1,5"). */
export function parseNumber(value) {
  if (value == null) return NaN
  const m = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(String(value).trim().replace(',', '.'))
  return m ? Number(m[0]) : NaN
}

/** Interpret yes/no-style cells. Returns true, false, or null when empty/unknown. */
export function parseYesNo(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return null
  if (['y', 'yes', 'true', '1', 'x', 'dnp', 'dnf', 'nf'].includes(v)) return true
  if (['n', 'no', 'false', '0', '-'].includes(v)) return false
  return null
}
