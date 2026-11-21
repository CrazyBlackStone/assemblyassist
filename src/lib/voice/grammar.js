// Turn a transcript into a command. Deterministic (no model): fast, free, and
// every answer it triggers comes from the user's board data.

const NUMBER_WORDS = {
  zero: 0, oh: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6,
  seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
}

// How recognizers commonly spell single letters.
const LETTER_WORDS = {
  see: 'C', sea: 'C', si: 'C', cee: 'C', c: 'C',
  are: 'R', our: 'R', ar: 'R', r: 'R',
  you: 'U', u: 'U',
  dee: 'D', d: 'D',
  jay: 'J', j: 'J',
  queue: 'Q', cue: 'Q', q: 'Q',
  el: 'L', l: 'L',
  why: 'Y', y: 'Y',
  ex: 'X', x: 'X',
  pee: 'P', p: 'P',
  ess: 'S', s: 'S',
  led: 'LED', sw: 'SW', switch: 'SW', ic: 'IC', fb: 'FB', tp: 'TP',
}

function wordsToNumber(tokens, i) {
  // Reads "12", "twelve", "twenty three", "one two" (digit by digit). Returns { value, used }.
  if (/^\d+$/.test(tokens[i] ?? '')) return { value: Number(tokens[i]), used: 1 }
  let total = null
  let used = 0
  while (i + used < tokens.length) {
    const n = NUMBER_WORDS[tokens[i + used]]
    if (n == null) break
    if (total == null) total = n
    else if (total >= 20 && total % 10 === 0 && n < 10) total += n
    else if (n === 100) total *= 100
    else total = Number(`${total}${n}`)
    used++
  }
  return total == null ? null : { value: total, used }
}

/** Find a known reference in the transcript ("c 8", "see eight", "C8", "c-8"). */
export function findRef(text, knownRefs) {
  const known = new Set(knownRefs.map((r) => r.toUpperCase()))
  const compact = text.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
  for (const m of compact.matchAll(/\b([A-Z]{1,3})\s?(\d{1,4})\b/g)) {
    const ref = `${m[1]}${m[2]}`
    if (known.has(ref)) return ref
  }
  const tokens = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  for (let i = 0; i < tokens.length - 1; i++) {
    const letter = LETTER_WORDS[tokens[i]]
    if (!letter) continue
    const num = wordsToNumber(tokens, i + 1)
    if (num && known.has(`${letter}${num.value}`)) return `${letter}${num.value}`
  }
  return null
}

// ---------- values: "100nF" vs "100 nano farad" vs "0.1 microfarad" ----------

const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, R: 1, r: 1 }

/** Parse "100nF", "4k7", "0.1uF", "330", "10k" -> { num, unit } or null. */
export function parseValue(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, '').replace(/Ω|ohms?/gi, '')
  let m = /^(\d+)([pnuµmkKMRr])(\d+)([a-zA-Z]*)$/.exec(s) // 4k7, 2R2
  if (m) return { num: Number(`${m[1]}.${m[3]}`) * PREFIX[m[2]], unit: unitOf(m[4], m[2]) }
  m = /^(\d*\.?\d+)([pnuµmkKMRr]?)([a-zA-Z]*)$/.exec(s)
  if (!m) return null
  const mult = m[2] ? PREFIX[m[2]] : 1
  return { num: Number(m[1]) * mult, unit: unitOf(m[3], m[2]) }
}

function unitOf(suffix, prefix) {
  const u = suffix.toLowerCase()
  if (u.startsWith('f')) return 'F'
  if (u.startsWith('h')) return 'H'
  if (prefix === 'R' || prefix === 'r') return 'ohm'
  return u ? u : 'ohm?'
}

// Order matters: unit words first ("nanofarad" -> "nanoF"), then prefixes ("nanoF" -> "nF").
const SPOKEN_PREFIX = [
  [/farads?\b/g, 'F'], [/henr(y|ies)\b/g, 'H'], [/\s?k\s?ohms?\b/g, 'k'], [/\s?kilo\s?ohms?\b/g, 'k'],
  [/\bohms?\b/g, ''], [/\bpico\s?/g, 'p'], [/\bnano\s?/g, 'n'], [/\bmicro\s?/g, 'u'], [/\bmilli\s?/g, 'm'],
  [/\bkilo\s?/g, 'k'], [/\bmega\s?/g, 'M'], [/\bthousand\b/g, 'k'],
]

/** Board groups whose value matches a spoken value in the transcript. */
export function findValueGroups(text, groups) {
  let t = ` ${text.toLowerCase()} `
  for (const [re, rep] of SPOKEN_PREFIX) t = t.replace(re, rep)
  t = t.replace(/(\d)\s+(?=[pnumkMFH]\b|[pnumkM]F)/g, '$1')
  const spoken = (t.match(/\d*\.?\d+[pnumkMRr]?\d*[FHfh]?/g) ?? []).map(parseValue).filter(Boolean)
  const hits = []
  for (const g of groups) {
    const v = parseValue(g.value)
    if (!v) {
      if (g.value && t.includes(g.value.toLowerCase())) hits.push(g)
      continue
    }
    const match = spoken.some((sv) => Math.abs(sv.num - v.num) <= v.num * 0.01 && (sv.unit === v.unit || sv.unit.startsWith('ohm') || v.unit.startsWith('ohm')))
    if (match) hits.push(g)
  }
  return hits
}

// ---------- commands ----------

const has = (t, ...words) => words.some((w) => new RegExp(`\\b${w}\\b`).test(t))

/**
 * @returns {{type: string, ref?: string, groups?: object[]}} type is one of:
 *  placed, skip, back, where, value, dropped, check, confirm, orientation, repeat, jump, help, unknown
 */
export function parseCommand(transcript, board) {
  const t = String(transcript ?? '').toLowerCase().trim()
  if (!t) return { type: 'unknown' }
  const refs = board ? Object.keys(board.parts) : []
  const ref = board ? findRef(t, refs) : null

  if (has(t, 'dropped', 'drop', 'lost', 'lose')) return { type: 'dropped', ref }
  if (has(t, 'where')) {
    if (ref) return { type: 'where', ref }
    const groups = board ? findValueGroups(t, board.groups) : []
    return groups.length ? { type: 'where-value', groups } : { type: 'where', ref: null }
  }
  if (has(t, 'what') && has(t, 'value', 'this', 'part', 'is')) return { type: 'value', ref }
  if (has(t, 'which way', 'orientation', 'polarity', 'direction', 'face', 'facing')) return { type: 'orientation', ref }
  if (has(t, 'check', 'inspect', 'look')) return { type: 'check', ref }
  if (has(t, 'confirm', 'confirmed', 'correct', 'orientation ok', 'looks good', 'yes')) return { type: 'confirm', ref }
  if (has(t, 'skip', 'later')) return { type: 'skip', ref }
  if (has(t, 'back', 'undo', 'oops')) return { type: 'back' }
  if (has(t, 'repeat', 'again', 'say that')) return { type: 'repeat' }
  if (has(t, 'help', 'commands')) return { type: 'help' }
  if (ref && has(t, 'go', 'jump', 'show', 'open', 'select')) return { type: 'jump', ref }
  if (has(t, 'next', 'done', 'placed', 'finished', 'ok', 'okay')) return { type: 'placed', ref }
  if (ref) return { type: 'jump', ref }
  return { type: 'unknown' }
}

export const HELP_TEXT =
  'Say: next, skip, back, where is C8, where are the 100 nanofarad, what value is this, which way, confirm, check this, I dropped it, repeat.'
