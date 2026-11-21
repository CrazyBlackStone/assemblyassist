// Image helpers for the solder check. Photos live only in memory for the session.

/** Draw the current frame of a <video> (or an ImageBitmap/Image) to a canvas at full resolution. */
export function frameToCanvas(source) {
  const w = source.videoWidth ?? source.naturalWidth ?? source.width
  const h = source.videoHeight ?? source.naturalHeight ?? source.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(source, 0, 0, w, h)
  return canvas
}

/**
 * Crop a normalized region { cx, cy, size } (size = fraction of the shorter side) from a canvas.
 * The result is scaled to at most maxSide px so requests stay small.
 */
export function cropCanvas(canvas, { cx, cy, size }, maxSide = 768) {
  const side = Math.round(Math.min(canvas.width, canvas.height) * size)
  const x = Math.round(Math.min(Math.max(cx * canvas.width - side / 2, 0), canvas.width - side))
  const y = Math.round(Math.min(Math.max(cy * canvas.height - side / 2, 0), canvas.height - side))
  const out = document.createElement('canvas')
  const scale = Math.min(1, maxSide / side)
  out.width = Math.round(side * scale)
  out.height = Math.round(side * scale)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, x, y, side, side, 0, 0, out.width, out.height)
  return { canvas: out, sourceSide: side }
}

/**
 * Cheap local check before spending a model call. Returns { brightness 0..255, sharpness, problems[] }.
 * Thresholds are deliberately lenient: this only warns, the user can send anyway.
 */
export function assessQuality(canvas) {
  const w = 160
  const h = Math.max(1, Math.round((canvas.height / canvas.width) * w))
  const small = document.createElement('canvas')
  small.width = w
  small.height = h
  const ctx = small.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(canvas, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  const gray = new Float32Array(w * h)
  let sum = 0
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    gray[i] = g
    sum += g
  }
  const brightness = sum / (w * h)
  // Variance of the Laplacian: low means blurry.
  let lapSum = 0
  let lapSq = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i]
      lapSum += lap
      lapSq += lap * lap
      n++
    }
  }
  const sharpness = n ? lapSq / n - (lapSum / n) ** 2 : 0
  const problems = []
  if (brightness < 45) problems.push('The photo looks very dark. Add light or turn on the phone torch.')
  if (brightness > 235) problems.push('The photo looks washed out. Reduce glare or angle the light.')
  if (sharpness < 25) problems.push('The photo looks blurry. Hold still, or tap the phone screen to focus.')
  return { brightness: Math.round(brightness), sharpness: Math.round(sharpness), problems }
}

export const toJpegDataUrl = (canvas, quality = 0.9) => canvas.toDataURL('image/jpeg', quality)

export function blobToImageBitmap(blob) {
  return createImageBitmap(blob)
}
