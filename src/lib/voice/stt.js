import { STT, hasProvider } from '../../config/ai.js'
import { baseUrl, authHeaders, fetchModel, resolveCost } from '../ai/provider.js'
import { modelFor } from '../ai/catalog.js'
import { recordCall, logFailure } from '../../state/logs.js'

// Speech to text through a model (the speech-in modality). The browser recognizer is
// only the fallback when no engine has a key.

export function sttEngine() {
  const e = STT.engines.find((x) => hasProvider(x.provider))
  return e ? { ...e, model: e.provider === 'openrouter' ? modelFor('stt', e.model) : e.model } : null
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * Transcribe one WAV clip. `vocab` (reference designators, values, command words)
 * is passed as a hint, which helps a lot with "C8" vs "see eight".
 * Returns { text, meta } or throws ModelError.
 */
export async function transcribe(blob, seconds, vocab = []) {
  const e = sttEngine()
  if (!e) throw new Error('No speech-to-text engine configured')
  const started = performance.now()
  const base = { task: 'stt', provider: e.provider, model: e.model }
  const hint = `Hand-soldering a circuit board. Words you may hear: next, skip, back, check, confirm, where is, ${vocab.join(', ')}.`
  try {
    let text
    let meta
    if (e.kind === 'transcriptions') {
      const form = new FormData()
      form.append('file', blob, 'clip.wav')
      form.append('model', e.model)
      form.append('language', 'en')
      form.append('prompt', hint.slice(0, 800))
      const json = await fetchModel(`${baseUrl(e.provider)}/audio/transcriptions`, { method: 'POST', headers: authHeaders(e.provider), body: form }, { timeoutMs: STT.timeoutMs })
      text = String(json?.text ?? '').trim()
      const cost = e.pricePerMinute != null ? (seconds / 60) * e.pricePerMinute : null
      meta = { ...base, cost, costSource: cost == null ? 'unknown' : 'price table', audioSeconds: Math.round(seconds * 10) / 10 }
    } else {
      const json = await fetchModel(
        `${baseUrl(e.provider)}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders(e.provider) },
          body: JSON.stringify({
            model: e.model,
            temperature: 0,
            max_tokens: 120,
            usage: { include: true },
            messages: [
              { role: 'system', content: `Transcribe the audio exactly. Reply with the words only, no quotes or commentary. If there is no speech, reply with nothing. ${hint}` },
              { role: 'user', content: [{ type: 'input_audio', input_audio: { data: await blobToBase64(blob), format: 'wav' } }] },
            ],
          }),
        },
        { timeoutMs: STT.timeoutMs },
      )
      const c = json?.choices?.[0]?.message?.content
      text = String(Array.isArray(c) ? c.map((p) => p.text ?? '').join('') : (c ?? '')).trim()
      const usage = json?.usage ?? {}
      meta = { ...base, promptTokens: usage.prompt_tokens ?? null, completionTokens: usage.completion_tokens ?? null, ...resolveCost(e.provider, e.model, usage), audioSeconds: Math.round(seconds * 10) / 10 }
    }
    meta.ms = Math.round(performance.now() - started)
    meta.ok = true
    recordCall(meta)
    return { text: text.replace(/^["“]|["”]$/g, ''), meta }
  } catch (err) {
    recordCall({ ...base, ms: Math.round(performance.now() - started), ok: false, cost: null, costSource: 'unknown', error: err.message })
    logFailure({ task: 'stt', model: e.model, kind: err.kind === 'timeout' ? 'timeout' : 'error', inputSummary: `${seconds.toFixed(1)} s of audio`, modelSaid: err.message, uiAction: 'Showed "not heard"; buttons still work.' })
    throw err
  }
}
