/**
 * Models often wrap JSON in prose or code fences, or leave trailing commas.
 * Returns { ok: true, value } or { ok: false, error }.
 */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Empty response' }
  let s = text.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, error: 'No JSON object found in the response' }
  const body = s.slice(start, end + 1)
  for (const candidate of [body, body.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      return { ok: true, value: JSON.parse(candidate) }
    } catch {
      // try the next repair
    }
  }
  return { ok: false, error: 'Response was not valid JSON' }
}

/** Pick an allowed enum value, case/space-insensitively, or return the fallback. */
export function pickEnum(value, allowed, fallback) {
  const v = String(value ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_')
  return allowed.includes(v) ? v : fallback
}
