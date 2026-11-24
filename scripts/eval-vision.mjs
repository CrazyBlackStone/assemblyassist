#!/usr/bin/env node
// Runs the placement check (orientation + soldering) on every photo in test-set/manifest.json
// and records accuracy. Uses the same prompt and validation as the app (src/lib/ai/tasks/verify.js).
//
//   OPENROUTER_API_KEY=sk-or-... npm run eval:vision
//   npm run eval:vision -- --dry-run                   # no key: simulated answers (tests the script)
//   MODEL=some/vision-model npm run eval:vision
//   BASE_URL=https://api.openai.com/v1 API_KEY=sk-... MODEL=gpt-4o-mini npm run eval:vision
//
// Output: test-set/results/<timestamp>.csv and .json, plus a summary printed here.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Verify from '../src/lib/ai/tasks/verify.js'
import { extractJson } from '../src/lib/ai/json.js'
import { TASKS } from '../src/config/ai.js'
import { describeFootprint } from '../src/lib/bom/footprint.js'
import { MARKINGS } from '../src/lib/bom/polarity.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const manifestPath = resolve(root, args.find((a) => !a.startsWith('--')) ?? 'test-set/manifest.json')
const baseUrl = (process.env.BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')
const apiKey = process.env.API_KEY ?? process.env.OPENROUTER_API_KEY
const model = process.env.MODEL ?? TASKS.verify.model
const timeoutMs = Number(process.env.TIMEOUT_MS ?? TASKS.verify.timeoutMs)

if (!dryRun && !apiKey) {
  console.error('Set OPENROUTER_API_KEY (or API_KEY + BASE_URL), or pass --dry-run.')
  process.exit(1)
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

function contextFor(item) {
  const marking = item.marking && MARKINGS[item.marking] ? MARKINGS[item.marking].label : (item.marking ?? null)
  return {
    ref: item.ref,
    value: item.value ?? '',
    footprint: item.footprint ?? '',
    size: describeFootprint(item.footprint ?? '').label,
    polarized: Boolean(item.polarized),
    markLabel: item.marking === 'pin1' ? 'pin-1 dot or notch' : marking,
    // Set markWhere ("left", "top-left", ...) when the photo is cropped and turned to the
    // part's reference orientation, as the app does once the camera is calibrated.
    markWhere: item.markWhere ?? null,
    canonical: Boolean(item.markWhere),
    checkSoldering: item.checkSoldering ?? true,
    neighbors: item.neighbors ?? [],
  }
}

async function callVision(messages) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-Title': 'Assembly Assist eval' },
      body: JSON.stringify({ model, messages, max_tokens: TASKS.verify.maxTokens, temperature: 0, usage: { include: true } }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`${res.status} ${json?.error?.message ?? res.statusText}`)
    const c = json?.choices?.[0]?.message?.content
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text ?? '').join('') : ''
    return { text, ms: Date.now() - started, cost: typeof json?.usage?.cost === 'number' ? json.usage.cost : null }
  } catch (e) {
    throw new Error(ctrl.signal.aborted ? `timeout after ${timeoutMs} ms` : e.message)
  } finally {
    clearTimeout(t)
  }
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const photosDir = dirname(manifestPath)
const rows = []

for (const item of manifest.photos) {
  const ctx = contextFor(item)
  const file = join(photosDir, item.file)
  const exp = { looks_right: 'ok', possible_problem: 'problem' }[item.expected.verdict] ?? item.expected.verdict
  const row = { file: item.file, ref: item.ref, expectedVerdict: exp, expectedOrientation: item.expected.orientation ?? '', expectedIssue: item.expected.issue ?? '' }
  try {
    let dataUrl = 'data:image/jpeg;base64,'
    if (existsSync(file)) {
      dataUrl = `data:${MIME[extname(file).toLowerCase()] ?? 'image/jpeg'};base64,${(await readFile(file)).toString('base64')}`
    } else if (!dryRun) {
      throw new Error('photo file not found')
    }
    const { text, ms, cost } = dryRun ? { text: Verify.simulate(ctx), ms: 0, cost: 0 } : await callVision(Vision.buildMessages(ctx, dataUrl))
    const parsed = extractJson(text)
    if (!parsed.ok) throw new Error(`unreadable output: ${text.slice(0, 120)}`)
    const { data, issues } = Verify.validate(parsed.value, ctx)
    Object.assign(row, {
      verdict: data.verdict,
      orientation: data.orientation,
      soldering: data.soldering,
      confidence: data.confidence,
      issues: data.issues.map((i) => i.type).join('|'),
      observed: data.observed,
      appCorrections: issues.join(' '),
      ms,
      cost: cost ?? '',
      error: '',
    })
  } catch (e) {
    Object.assign(row, { verdict: 'error', confidence: '', issues: '', observed: '', appCorrections: '', ms: '', cost: '', error: e.message })
  }
  rows.push(row)
  console.log(`${row.file.padEnd(34)} expected ${row.expectedVerdict.padEnd(16)} got ${String(row.verdict).padEnd(16)} ${row.issues || row.error}`)
}

// ---- metrics ----
const scored = rows.filter((r) => r.verdict !== 'error')
const bad = scored.filter((r) => r.expectedVerdict === 'problem')
const good = scored.filter((r) => r.expectedVerdict === 'ok')
const oriented = scored.filter((r) => r.expectedOrientation)
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}% (${n}/${d})` : 'n/a')
const summary = {
  model: dryRun ? 'simulated' : model,
  photos: rows.length,
  errors: rows.length - scored.length,
  verdictAccuracy: pct(scored.filter((r) => r.verdict === r.expectedVerdict).length, scored.length),
  // The safety number: a real problem the model called "looks right".
  missedProblems: pct(bad.filter((r) => r.verdict === 'ok').length, bad.length),
  problemsFlagged: pct(bad.filter((r) => r.verdict === 'problem').length, bad.length),
  orientationCorrect: pct(oriented.filter((r) => r.orientation === r.expectedOrientation).length, oriented.length),
  flipsMissed: pct(oriented.filter((r) => r.expectedOrientation === 'wrong' && r.orientation === 'correct').length, oriented.filter((r) => r.expectedOrientation === 'wrong').length),
  issueTypeCorrect: pct(
    bad.filter((r) => r.expectedIssue && r.issues.split('|').includes(r.expectedIssue)).length,
    bad.filter((r) => r.expectedIssue).length,
  ),
  falseAlarms: pct(good.filter((r) => r.verdict === 'problem').length, good.length),
  cantTellRate: pct(scored.filter((r) => r.verdict === 'unclear').length, scored.length),
  avgSeconds: scored.length ? (scored.reduce((a, r) => a + (Number(r.ms) || 0), 0) / scored.length / 1000).toFixed(1) : 'n/a',
  totalCost: rows.some((r) => r.cost === '') ? 'unknown for some calls' : `$${rows.reduce((a, r) => a + (Number(r.cost) || 0), 0).toFixed(4)}`,
}
console.log('\n', summary)

const outDir = join(root, 'test-set', 'results')
await mkdir(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const cols = Object.keys(rows[0] ?? {})
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
await writeFile(join(outDir, `${stamp}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c] ?? '')).join(','))].join('\n'))
await writeFile(join(outDir, `${stamp}.json`), JSON.stringify({ summary, rows }, null, 2))
console.log(`Saved test-set/results/${stamp}.csv and .json`)
