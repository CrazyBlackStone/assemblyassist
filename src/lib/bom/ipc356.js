// IPC-D-356 netlist (exported by Allegro, Altium, KiCad, PADS, ...). Its test-point records
// give every component pad's position, size and side, i.e. the real footprint, which sizes
// parts the package library doesn't know (connectors, odd modules).
//
// Record layout (fixed columns): 1-3 type (317 through-hole, 327 SMD), 4-17 net,
// 21-26 refdes, 28-31 pin, 33-38 drill "Dnnnn", access "Ann" (00 both, 01 top, max = bottom),
// X/Y with sign and 6 digits, pad size Xnnnn Ynnnn, rotation Rnnn.

export function isIpc356(text) {
  return /^P\s+(JOB|UNITS)\b/m.test(String(text).slice(0, 3000)) && /^3[1-3]7/m.test(text)
}

/** Returns { pads: { ref: [{ pin, x, y, w, h, rot, side, drill }] }, units } in mm. */
export function parseIpc356(text) {
  const units = /^P\s+UNITS\s+(CUST\s+\d|SI|ENG\w*)/im.exec(text)?.[1]?.replace(/\s+/g, ' ').toUpperCase() ?? 'CUST 0'
  // CUST 1 and SI: 0.001 mm. CUST 0/2 and ENGLISH: 0.0001 in.
  const k = units === 'CUST 1' || units === 'SI' ? 0.001 : 0.00254
  const recs = []
  let maxAccess = 1
  for (const line of String(text).split(/\r?\n/)) {
    if (!/^3[1-3]7/.test(line)) continue
    const ref = line.slice(20, 26).trim()
    if (!ref || /^VIA$/i.test(ref)) continue
    const rest = line.slice(26)
    const pos = /X([+-]\d{4,7})Y([+-]\d{4,7})/.exec(rest)
    if (!pos) continue
    const after = rest.slice(pos.index + pos[0].length)
    const size = /^X(\d{4})(?:Y(\d{4}))?(?:R(\d{3}))?/.exec(after)
    const access = Number(/A(\d\d)/.exec(rest)?.[1] ?? 0)
    maxAccess = Math.max(maxAccess, access)
    const drill = /D(\d{4})/.exec(rest.slice(0, pos.index))
    const w = size ? Number(size[1]) * k : 0.5
    recs.push({
      ref: ref.toUpperCase(),
      pin: line.slice(27, 31).trim(),
      x: Number(pos[1]) * k,
      y: Number(pos[2]) * k,
      w,
      h: size?.[2] ? Number(size[2]) * k : w,
      rot: size?.[3] ? Number(size[3]) : 0,
      access,
      drill: drill ? Number(drill[1]) * k : null,
      tht: line.startsWith('317'),
    })
  }
  const pads = {}
  for (const r of recs) {
    const side = r.tht || r.access === 0 ? 'both' : r.access === 1 ? 'top' : r.access === maxAccess ? 'bottom' : 'inner'
    if (side === 'inner') continue
    // Pad size is given before rotation; turn it to board axes for 90/270.
    const turned = Math.round(r.rot / 90) % 2 === 1
    ;(pads[r.ref] ??= []).push({ pin: r.pin, x: r.x, y: r.y, w: turned ? r.h : r.w, h: turned ? r.w : r.h, side, drill: r.drill, shape: r.drill ? 'circle' : 'rect' })
  }
  return { pads, units }
}
