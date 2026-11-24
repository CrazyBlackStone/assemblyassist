import { createStore } from './store.js'
import { pairing, requestStill } from './pairing/pairing.js'
import { frameToCanvas } from './imaging/image.js'

// Which camera feeds the live view. In memory only: no frames are kept.
// Stills are frames of the same video track (not ImageCapture photos), so their field
// of view and aspect ratio match the live view the calibration taps were made on.

export const camera = createStore({ key: null, storage: null, initial: { localStream: null, error: null } })
const setC = (patch) => camera.set((s) => ({ ...s, ...patch }))

let videoEl = null
export const registerVideo = (el) => {
  videoEl = el
}

export async function openLocalCamera() {
  if (camera.get().localStream) return camera.get().localStream
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
    })
    setC({ localStream: stream, error: null })
    return stream
  } catch (e) {
    const msg = e.name === 'NotAllowedError' ? 'Camera permission was denied.' : `Camera: ${e.message}`
    setC({ error: msg })
    throw new Error(msg)
  }
}

export function closeLocalCamera() {
  camera.get().localStream?.getTracks().forEach((t) => t.stop())
  setC({ localStream: null })
}

export const streamFor = (source) => (source === 'phone' ? pairing.get().stream : camera.get().localStream)

/** Full-resolution frame. Returns { canvas, source } so the UI can say when it fell back. */
export async function captureStill(source) {
  if (source === 'phone') {
    try {
      const blob = await requestStill()
      return { canvas: frameToCanvas(await createImageBitmap(blob)), source: 'phone' }
    } catch (e) {
      if (!videoEl?.videoWidth) throw e
      return { canvas: frameToCanvas(videoEl), source: 'stream' }
    }
  }
  if (!videoEl?.videoWidth) throw new Error('No camera frame yet.')
  return { canvas: frameToCanvas(videoEl), source: 'local' }
}
