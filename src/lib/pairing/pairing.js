import Peer from 'peerjs'
import { createStore } from '../store.js'
import { PAIRING } from '../../config/ai.js'

// Phone <-> laptop link over WebRTC (PeerJS).
//  - Signaling: PeerJS public cloud by default, or your own PeerServer (e.g. on EC2) via Settings.
//  - Media: the phone calls the laptop with its camera stream.
//  - Data: transcripts (phone mic -> laptop), full-resolution stills on request.
// If campus Wi-Fi blocks direct connections, add a TURN server (e.g. coturn on EC2) under
// Settings -> ICE servers. No code change needed.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PREFIX = 'assemblyassist-'
const CODE_KEY = 'aa:pairCode'

export const pairing = createStore({
  key: null,
  storage: null,
  initial: { role: null, status: 'off', code: null, error: null, stream: null, phoneInfo: null },
})

const setP = (patch) => pairing.set((s) => ({ ...s, ...patch }))

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

function peerOptions() {
  const opts = { config: { iceServers: PAIRING.iceServers }, debug: 1 }
  if (PAIRING.peerHost) Object.assign(opts, { host: PAIRING.peerHost, port: PAIRING.peerPort, path: PAIRING.peerPath, secure: PAIRING.peerPort !== 80 })
  return opts
}

export function pairUrl(code) {
  const base = window.location.href.split('#')[0]
  return `${base}#/phone?code=${code}`
}

function watchIce(pc, onFail) {
  if (!pc) return
  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'failed') onFail()
  })
}

const ICE_FAIL =
  'Phone and laptop can’t connect directly on this Wi-Fi. Use the phone’s hotspot.'

// ============================ laptop (host) ============================

let host = null // { peer, conn, pending: Map }
let hostMessageHandler = null // survives code changes / reconnects
let hostRetry = null

// Release the id when the tab closes or reloads, so a refreshed laptop can reclaim its code at once.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => host?.peer.destroy())
}

export function startHost() {
  if (host) return
  let code = null
  try {
    code = sessionStorage.getItem(CODE_KEY)
  } catch {
    /* ignore */
  }
  code ??= newCode()
  openHost(code)
}

function openHost(code, attempt = 0) {
  try {
    sessionStorage.setItem(CODE_KEY, code)
  } catch {
    /* ignore */
  }
  const peer = new Peer(PREFIX + code, peerOptions())
  host = { peer, conn: null, pending: new Map() }
  setP({ role: 'host', status: 'connecting', code, error: null })

  peer.on('open', () => setP({ status: 'waiting' }))
  peer.on('connection', (conn) => {
    host.conn?.close()
    host.conn = conn
    conn.on('open', () => {
      setP({ status: pairing.get().stream ? 'paired' : 'linked', error: null })
      if (phoneConfig) conn.send({ type: 'config', ...phoneConfig })
    })
    conn.on('data', (msg) => handleHostMessage(msg))
    conn.on('close', () => {
      if (host?.conn === conn) {
        host.conn = null
        setP({ status: 'waiting', stream: null, phoneInfo: null })
      }
    })
  })
  peer.on('call', (call) => {
    call.answer()
    call.on('stream', (stream) => setP({ stream, status: 'paired', error: null }))
    call.on('close', () => setP({ stream: null }))
    watchIce(call.peerConnection, () => setP({ error: ICE_FAIL, status: 'waiting' }))
  })
  peer.on('disconnected', () => {
    setP({ error: 'Lost the pairing server. Reconnecting…' })
    setTimeout(() => !peer.destroyed && peer.reconnect(), 1500)
  })
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // After a laptop refresh the server still holds the old id for a few seconds.
      // Retry the same code so the phone reconnects, then fall back to a new code.
      peer.destroy()
      clearTimeout(hostRetry)
      hostRetry = setTimeout(() => {
        if (host?.peer !== peer) return // reset or replaced meanwhile
        if (attempt < 4) openHost(code, attempt + 1)
        else openHost(newCode())
      }, 2500)
      return
    }
    setP({ error: `Pairing: ${friendlyPeerError(err)}` })
  })
}

function handleHostMessage(msg) {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'hello') setP({ phoneInfo: msg.info ?? null })
  if (msg.type === 'still' || msg.type === 'still-error') {
    const waiter = host.pending.get(msg.id)
    if (waiter) {
      host.pending.delete(msg.id)
      if (msg.type === 'still') waiter.resolve(new Blob([msg.data], { type: msg.mime || 'image/jpeg' }))
      else waiter.reject(new Error(msg.error))
    }
  }
  hostMessageHandler?.(msg)
}

export function onPhoneMessage(fn) {
  hostMessageHandler = fn
  return () => {
    if (hostMessageHandler === fn) hostMessageHandler = null
  }
}

export function sendToPhone(msg) {
  if (host?.conn?.open) host.conn.send(msg)
}

let phoneConfig = null
/** Settings the phone needs (which device listens). Re-sent whenever the phone connects. */
export function configurePhone(cfg) {
  phoneConfig = cfg
  sendToPhone({ type: 'config', ...cfg })
}

/** Ask the phone for a full-resolution still. Falls back to the video frame on timeout (caller decides). */
export function requestStill(timeoutMs = 8000) {
  if (!host?.conn?.open) return Promise.reject(new Error('Phone not connected'))
  const id = Math.random().toString(36).slice(2)
  return new Promise((resolve, reject) => {
    host.pending.set(id, { resolve, reject })
    host.conn.send({ type: 'still-request', id })
    setTimeout(() => {
      if (host?.pending.has(id)) {
        host.pending.delete(id)
        reject(new Error('Phone did not send a photo in time'))
      }
    }, timeoutMs)
  })
}

export function resetHost({ newCode: fresh = false } = {}) {
  clearTimeout(hostRetry)
  host?.peer.destroy()
  host = null
  setP({ role: null, status: 'off', stream: null, error: null })
  if (fresh) {
    try {
      sessionStorage.removeItem(CODE_KEY)
    } catch {
      /* ignore */
    }
  }
}

// ============================ phone (guest) ============================

let guest = null

/**
 * Connect this phone to the laptop showing `code`. `stream` is the local camera stream.
 * `takeStill()` returns a Promise<Blob> of a full-resolution photo.
 */
export function startGuest({ code, stream, takeStill, onMessage }) {
  stopGuest()
  const peer = new Peer(undefined, peerOptions())
  guest = { peer, conn: null, call: null, retry: null }
  setP({ role: 'phone', status: 'connecting', code, error: null })

  const connect = () => {
    if (!guest || peer.destroyed) return
    const conn = peer.connect(PREFIX + code, { reliable: true })
    guest.conn = conn
    conn.on('open', () => {
      conn.send({ type: 'hello', info: { ua: navigator.userAgent, width: stream.getVideoTracks()[0]?.getSettings?.().width ?? null } })
      const call = peer.call(PREFIX + code, stream)
      guest.call = call
      watchIce(call.peerConnection, () => setP({ error: ICE_FAIL }))
      setP({ status: 'paired', error: null })
    })
    conn.on('data', async (msg) => {
      if (msg?.type === 'still-request') {
        try {
          const blob = await takeStill()
          conn.send({ type: 'still', id: msg.id, mime: blob.type, data: await blob.arrayBuffer() })
        } catch (e) {
          conn.send({ type: 'still-error', id: msg.id, error: e.message })
        }
      } else {
        onMessage?.(msg)
      }
    })
    conn.on('close', () => {
      setP({ status: 'connecting', error: 'Laptop disconnected. Retrying…' })
      scheduleRetry()
    })
  }
  const scheduleRetry = () => {
    clearTimeout(guest?.retry)
    if (guest) guest.retry = setTimeout(connect, 3000)
  }

  peer.on('open', connect)
  peer.on('error', (err) => {
    setP({ error: friendlyPeerError(err) })
    if (err.type === 'peer-unavailable') scheduleRetry()
  })
  return {
    send: (msg) => guest?.conn?.open && guest.conn.send(msg),
  }
}

export function sendToLaptop(msg) {
  if (guest?.conn?.open) guest.conn.send(msg)
}

export function stopGuest() {
  if (!guest) return
  clearTimeout(guest.retry)
  guest.peer.destroy()
  guest = null
  setP({ role: null, status: 'off' })
}

function friendlyPeerError(err) {
  switch (err.type) {
    case 'peer-unavailable':
      return 'No laptop found with that code yet. Check the code; retrying…'
    case 'network':
    case 'server-error':
    case 'socket-error':
      return 'Cannot reach the pairing server. Check the internet connection (or the custom server in Settings).'
    case 'browser-incompatible':
      return 'This browser does not support WebRTC.'
    default:
      return err.message || String(err.type)
  }
}
