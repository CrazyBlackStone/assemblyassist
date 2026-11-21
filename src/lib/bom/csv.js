import Papa from 'papaparse'

const normalizeHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Parse delimited text (comma, semicolon or tab; auto-detected) into
 * { headers, rows } where rows are objects keyed by the original header.
 */
export function parseDelimited(text) {
  const result = Papa.parse(String(text).replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })
  const headers = (result.meta.fields ?? []).filter(Boolean)
  return { headers, rows: result.data }
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
