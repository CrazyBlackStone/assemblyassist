import { createStore } from './store.js'
import { pairing, requestStill } from './pairing/pairing.js'
import { frameToCanvas } from './imaging/image.js'
import { prefs } from '../state/settings.js'

// Which camera feeds the live view, plus calibration. In memory only: no frames are kept.

export const camera = createStore({
  key: null,
  storage: null,
  initial: { localStream: null, error: null, calibration: null, calibrating: null },
})

const setC = (patch) => camera.set((s) => ({ ...s, ...patch }))

let videoEl = null
export const registerVideo = (el) => {
  videoEl = el
}

export async function openLocalCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
    })
    setC({ localStream: stream, error: null })
    return stream
  } catch (e) {
    const msg = e.name === 'NotAllowedError' ? 'Camera permission was denied.' : `Could not open the camera: ${e.message}`
    setC({ error: msg })
    throw new Error(msg)
  }
}

export function closeLocalCamera() {
  camera.get().localStream?.getTracks().forEach((t) => t.stop())
  setC({ localStream: null })
}

/** The stream to show: phone stream when paired and selected, else the local camera. */
export function activeStream() {
  if (prefs.get().cameraSource === 'phone') return pairing.get().stream
  return camera.get().localStream
}

/** Full-resolution photo from the local camera track (ImageCapture where supported). */
export async function stillFromStream(stream, fallbackVideo) {
  const track = stream?.getVideoTracks?.()[0]
  if (track && 'ImageCapture' in window) {
    try {
      const blob = await new window.ImageCapture(track).takePhoto()
      const bmp = await createImageBitmap(blob)
      return frameToCanvas(bmp)
    } catch {
      // fall through to the video frame
    }
  }
  if (!fallbackVideo || !fallbackVideo.videoWidth) throw new Error('No camera frame available yet.')
  return frameToCanvas(fallbackVideo)
}

/**
 * Capture a still for the check. Returns { canvas, source } where source says how it was taken,
 * so the UI can be honest when it had to fall back to a compressed video frame.
 */
export async function captureStill() {
  const usePhone = prefs.get().cameraSource === 'phone'
  if (usePhone) {
    try {
      const blob = await requestStill()
      const bmp = await createImageBitmap(blob)
      return { canvas: frameToCanvas(bmp), source: 'phone photo (full resolution)' }
    } catch (e) {
      if (!videoEl?.videoWidth) throw e
      return { canvas: frameToCanvas(videoEl), source: `video frame (lower resolution; ${e.message})` }
    }
  }
  const canvas = await stillFromStream(camera.get().localStream, videoEl)
  return { canvas, source: 'this device camera' }
}

export const setCalibration = (calibration) => setC({ calibration, calibrating: null })
export const setCalibrating = (calibrating) => setC({ calibrating })
