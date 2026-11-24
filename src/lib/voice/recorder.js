// Microphone capture for speech-to-text. Raw PCM (not MediaRecorder) so every clip is a
// clean 16 kHz mono WAV that any transcription API accepts, on Chrome and Safari alike.
//
// Push-to-talk: begin() / end() mark a clip.
// Hands-free: an energy detector with an adaptive noise floor (the room is loud) starts a
// clip when speech rises above the floor and ends it after a short silence. 0.4 s of audio
// before the trigger is kept so first syllables are not cut off.

import { isSpeaking } from './speech.js'

const TARGET_RATE = 16000
const PREROLL_S = 0.4
const HANG_S = 0.7
const MAX_S = 10
const MIN_S = 0.35

export function encodeWav(samples, rate = TARGET_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export function downsample(input, fromRate, toRate = TARGET_RATE) {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

/**
 * @param {{ onClip(blob, seconds), onLevel?(level 0..1, speaking), onError?(msg) }} handlers
 */
export function createRecorder({ onClip, onLevel, onError }) {
  let ctx = null
  let stream = null
  let node = null
  let mode = 'ptt'
  let recording = false
  let chunks = []
  let preroll = []
  let prerollLen = 0
  let floor = 0.01
  let loudFor = 0
  let quietFor = 0
  let clipLen = 0

  const flush = () => {
    recording = false
    const len = chunks.reduce((n, c) => n + c.length, 0)
    const seconds = len / ctx.sampleRate
    const all = new Float32Array(len)
    let o = 0
    for (const c of chunks) {
      all.set(c, o)
      o += c.length
    }
    chunks = []
    clipLen = 0
    if (seconds >= MIN_S) onClip(encodeWav(downsample(all, ctx.sampleRate)), seconds)
  }

  const onAudio = (e) => {
    const data = new Float32Array(e.inputBuffer.getChannelData(0))
    const dt = data.length / ctx.sampleRate
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
    const rms = Math.sqrt(sum / data.length)
    const muted = isSpeaking() // don't transcribe the app's own voice
    if (!recording) floor = floor * 0.97 + Math.min(rms, floor * 3) * 0.03
    const speech = !muted && rms > Math.max(0.015, floor * 2.8)
    onLevel?.(Math.min(1, rms * 8), recording)

    if (recording) {
      chunks.push(data)
      clipLen += dt
    } else {
      preroll.push(data)
      prerollLen += dt
      while (prerollLen > PREROLL_S && preroll.length > 1) prerollLen -= preroll.shift().length / ctx.sampleRate
    }

    if (mode !== 'handsfree') {
      if (recording && clipLen > MAX_S * 2) flush()
      return
    }
    if (!recording) {
      loudFor = speech ? loudFor + dt : 0
      if (loudFor > 0.12) {
        recording = true
        chunks = [...preroll]
        clipLen = prerollLen
        quietFor = 0
      }
    } else {
      quietFor = speech ? 0 : quietFor + dt
      if (quietFor > HANG_S || clipLen > MAX_S || muted) flush()
    }
  }

  return {
    async start(nextMode = 'ptt') {
      mode = nextMode
      if (ctx) return
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      } catch (e) {
        onError?.(e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : `Microphone: ${e.message}`)
        throw e
      }
      ctx = new (window.AudioContext || window.webkitAudioContext)()
      const src = ctx.createMediaStreamSource(stream)
      node = ctx.createScriptProcessor(4096, 1, 1)
      node.onaudioprocess = onAudio
      src.connect(node)
      node.connect(ctx.destination)
    },
    setMode(m) {
      mode = m
      if (m !== 'handsfree' && recording) flush()
    },
    begin() {
      if (!ctx) return
      recording = true
      chunks = [...preroll]
      clipLen = prerollLen
    },
    end() {
      if (ctx && recording) flush()
    },
    get active() {
      return Boolean(ctx)
    },
    stop() {
      node?.disconnect()
      stream?.getTracks().forEach((t) => t.stop())
      ctx?.close()
      ctx = null
      recording = false
    },
  }
}
