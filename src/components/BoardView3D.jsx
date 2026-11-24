import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js'
import { packageGeometry, packageExtent, toBoard } from '../lib/bom/packages.js'
import { STATUS } from '../state/projects.js'
import { Icon } from './ui.jsx'

// Panel 2: the board in 3D. The slab is textured with the rendered Gerbers (top and bottom);
// every part is a model built from its pads and package dimensions (body size and seated
// height). Placed parts sit on the board, the current part hovers and lands when placed.
// Board coordinates: mm, X right, Y up, Z out of the top surface.

const T = 1.6 // board thickness, mm
const HOVER = 2.2

const MAT = {
  metal: () => new THREE.MeshStandardMaterial({ color: '#dfe3e8', metalness: 0.95, roughness: 0.28 }),
  gold: () => new THREE.MeshStandardMaterial({ color: '#e6bd62', metalness: 0.95, roughness: 0.32 }),
  black: () => new THREE.MeshStandardMaterial({ color: '#1d1d20', metalness: 0.05, roughness: 0.55 }),
  ceramic: () => new THREE.MeshStandardMaterial({ color: '#b99872', metalness: 0, roughness: 0.65 }),
  grey: () => new THREE.MeshStandardMaterial({ color: '#4a4a4f', metalness: 0.1, roughness: 0.6 }),
  tant: () => new THREE.MeshStandardMaterial({ color: '#d9a52b', metalness: 0, roughness: 0.45 }),
  tantBand: () => new THREE.MeshStandardMaterial({ color: '#7d5612', roughness: 0.5 }),
  led: () => new THREE.MeshPhysicalMaterial({ color: '#f4f2ea', roughness: 0.25, transmission: 0.2, thickness: 0.5 }),
  ledMark: () => new THREE.MeshStandardMaterial({ color: '#30d158', roughness: 0.4 }),
  band: () => new THREE.MeshStandardMaterial({ color: '#d7d9de', roughness: 0.4 }),
  dimple: () => new THREE.MeshStandardMaterial({ color: '#3b3c42', roughness: 0.4 }),
  beige: () => new THREE.MeshStandardMaterial({ color: '#dccba4', roughness: 0.55 }),
  steel: () => new THREE.MeshStandardMaterial({ color: '#aab0b8', metalness: 0.85, roughness: 0.35 }),
  alu: () => new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.8, roughness: 0.3 }),
}

function box(group, w, h, d, x, y, z0, mat, radius = 0) {
  const geo = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d)
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z0 + d / 2)
  m.castShadow = true
  m.receiveShadow = true
  group.add(m)
  return m
}

function cyl(group, r, d, x, y, z0, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d, 32), mat)
  m.rotation.x = Math.PI / 2
  m.position.set(x, y, z0 + d / 2)
  m.castShadow = true
  group.add(m)
  return m
}

/** Cylinder lying along X (axial parts) or standing along Y (disc capacitors). */
function cylAlong(group, r, len, x, y, z, axis, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 32), mat)
  if (axis === 'x') m.rotation.z = Math.PI / 2
  m.position.set(x, y, z)
  m.castShadow = true
  group.add(m)
  return m
}

/** Wire between two points (leads of through-hole parts). */
function wire(group, a, b, r, mat) {
  const A = new THREE.Vector3(...a)
  const B = new THREE.Vector3(...b)
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 12), mat)
  m.position.copy(A).add(B).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize())
  group.add(m)
}

/** Build a part model in its own frame (pads and body from packageGeometry, Z up from the board). */
function buildModel(part, g) {
  const model = new THREE.Group()
  const { w, h, cx, cy } = g.body
  const H = g.height
  const markMats = []
  const mk = g.mark
  const along = w >= h // terminations at the ends of the long axis

  if (!['header'].includes(g.style)) {
    for (const p of g.pads) {
      if (p.drill) continue
      box(model, p.w * 0.85, p.h * 0.85, 0.05, p.x, p.y, 0, MAT.metal())
    }
  }

  const caps = (bodyMat, capMat = MAT.metal()) => {
    const capL = (along ? w : h) * 0.2
    box(model, along ? w - 2 * capL : w, along ? h : h - 2 * capL, H * 0.98, cx, cy, 0, bodyMat, 0.04)
    for (const s of [-1, 1]) box(model, along ? capL : w, along ? h : capL, H, along ? cx + s * (w / 2 - capL / 2) : cx, along ? cy : cy + s * (h / 2 - capL / 2), 0, capMat, 0.04)
  }

  switch (g.style) {
    case 'res':
      caps(MAT.black())
      break
    case 'cap':
      caps(MAT.ceramic())
      break
    case 'ind':
      caps(MAT.grey())
      break
    case 'led': {
      box(model, w, h, H * 0.55, cx, cy, 0, MAT.band(), 0.04)
      box(model, w * 0.8, h * 0.8, H * 0.45, cx, cy, H * 0.55, MAT.led(), 0.08)
      if (mk) markMats.push(box(model, w * 0.1, h * 0.8, 0.02, mk.x, mk.y, H, MAT.ledMark()).material)
      break
    }
    case 'tant':
      box(model, w * 0.88, h, H, cx, cy, 0, MAT.tant(), 0.06)
      if (mk) markMats.push(box(model, w * 0.14, h * 0.96, 0.03, mk.x, mk.y, H, MAT.tantBand()).material)
      break
    case 'diode':
      box(model, w * 0.72, h, H, cx, cy, 0.05, MAT.black(), 0.06)
      if (mk) markMats.push(box(model, w * 0.1, h * 0.96, 0.03, mk.x, mk.y, H + 0.05, MAT.band()).material)
      break
    case 'elec': {
      if (!g.tht) box(model, w, h, 0.5, cx, cy, 0, MAT.black(), 0.05)
      cyl(model, w * 0.48, H - 0.5, cx, cy, 0.5, g.tht ? MAT.black() : MAT.alu()).material.color.set(g.tht ? '#1f2b4a' : '#c9ced6')
      if (mk) markMats.push(box(model, w * 0.14, h * 0.7, 0.03, mk.x, mk.y, H, MAT.dimple()).material)
      break
    }
    case 'ic': {
      // Gull-wing leads: from the body edge out to each pad.
      for (const p of g.pads) {
        const outX = Math.abs(p.x - cx) > w / 2 - 0.05
        const outY = Math.abs(p.y - cy) > h / 2 - 0.05
        if (!outX && !outY) continue
        if (outX) {
          const edge = cx + Math.sign(p.x - cx) * (w / 2)
          const tip = p.x + Math.sign(p.x - cx) * (p.w * 0.35)
          box(model, Math.abs(tip - edge), Math.min(p.h * 0.75, 0.5), 0.18, (tip + edge) / 2, p.y, 0.04, MAT.metal())
        } else {
          const edge = cy + Math.sign(p.y - cy) * (h / 2)
          const tip = p.y + Math.sign(p.y - cy) * (p.h * 0.35)
          box(model, Math.min(p.w * 0.75, 0.5), Math.abs(tip - edge), 0.18, p.x, (tip + edge) / 2, 0.04, MAT.metal())
        }
      }
      box(model, w, h, H - 0.1, cx, cy, 0.1, MAT.black(), Math.min(w, h) * 0.04)
      if (mk) markMats.push(cyl(model, Math.max(0.18, Math.min(w, h) * 0.09), 0.02, mk.x, mk.y, H, MAT.dimple()).material)
      break
    }
    case 'axial':
    case 'axial-diode': {
      const lead = MAT.metal()
      const [p1, p2] = g.pads
      if (g.vertical) {
        cyl(model, w / 2, H - 1, p1.x, p1.y, 0.5, g.style === 'axial' ? MAT.beige() : MAT.black())
        wire(model, [p1.x, p1.y, H - 0.5], [p2.x, p2.y, H - 0.5], 0.3, lead)
        wire(model, [p2.x, p2.y, -2], [p2.x, p2.y, H - 0.5], 0.3, lead)
      } else {
        const zc = h / 2 + 0.3
        cylAlong(model, h / 2, w, cx, cy, zc, 'x', g.style === 'axial' ? MAT.beige() : MAT.black())
        for (const p of [p1, p2]) {
          const end = cx + Math.sign(p.x - cx) * (w / 2)
          wire(model, [p.x, p.y, -2], [p.x, p.y, zc], 0.3, lead)
          wire(model, [p.x, p.y, zc], [end, cy, zc], 0.3, lead)
        }
        if (g.style === 'axial-diode' && mk) markMats.push(cylAlong(model, h / 2 + 0.02, w * 0.1, mk.x, cy, zc, 'x', MAT.band()).material)
      }
      break
    }
    case 'disc': {
      const [p1, p2] = g.pads
      const m = cylAlong(model, w / 2, h, cx, cy, 1.5 + w / 2, 'y', MAT.tant())
      m.material.color.set('#e0a23a')
      for (const p of [p1, p2]) wire(model, [p.x, p.y, -2], [p.x, p.y, 1.5 + w * 0.2], 0.25, MAT.metal())
      break
    }
    case 'film':
      box(model, w, h, H, cx, cy, 0.3, MAT.beige(), 0.3).material.color.set('#c9455b')
      break
    case 'header': {
      box(model, w, h, 2.5, cx, cy, 0, MAT.black(), 0.15)
      for (const p of g.pads) box(model, 0.64, 0.64, 11.5, p.x, p.y, -3, MAT.gold())
      if (mk) markMats.push(box(model, 1.2, 1.2, 0.02, mk.x, mk.y, 2.5, MAT.dimple()).material)
      break
    }
    case 'switch':
      box(model, w, h, H, cx, cy, 0, MAT.steel(), 0.2)
      cyl(model, Math.min(w, h) * 0.29, 1.5, cx, cy, H, MAT.black())
      break
    case 'usb':
      box(model, w, h, H, cx, cy, 0, MAT.steel(), Math.min(H, w, h) * 0.3)
      break
    case 'fpc': {
      const deep = h < w
      box(model, w, h, H * 0.7, cx, cy, 0, MAT.beige(), 0.05)
      box(model, deep ? w * 0.96 : w * 0.4, deep ? h * 0.4 : h * 0.96, H * 0.3, deep ? cx : cx - w * 0.28, deep ? cy - h * 0.28 : cy, H * 0.7, MAT.black(), 0.04)
      if (mk) markMats.push(cyl(model, 0.2, 0.02, mk.x, mk.y, H, MAT.dimple()).material)
      break
    }
    default:
      box(model, w, h, H, cx, cy, 0, ['connector'].includes(g.style) ? MAT.black() : MAT.grey(), 0.08)
      if (mk) markMats.push(cyl(model, Math.max(0.18, Math.min(w, h) * 0.08), 0.02, mk.x, mk.y, H, MAT.dimple()).material)
  }
  return { model, markMats }
}

// Real 3D models from the KiCad library (CC-BY-SA 4.0), for footprints named "Library:Footprint".
// jsDelivr serves the GitHub mirror with CORS. VRML units are 0.1 inch.
const KICAD_3D = 'https://cdn.jsdelivr.net/gh/KiCad/kicad-packages3D@master'
const vrmlCache = new Map()
function kicadModel(footprint) {
  const m = /^([A-Za-z0-9_.-]+):([A-Za-z0-9_.,+-]+)$/.exec(String(footprint ?? '').trim())
  if (!m) return null
  const url = `${KICAD_3D}/${m[1]}.3dshapes/${m[2]}.wrl`
  if (!vrmlCache.has(url)) {
    vrmlCache.set(
      url,
      new Promise((resolve) => new VRMLLoader().load(url, (scene) => resolve(scene), undefined, () => resolve(null))).then((scene) => {
        if (!scene) return null
        scene.scale.setScalar(2.54)
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true
            o.receiveShadow = true
          }
        })
        return scene
      }),
    )
  }
  return vrmlCache.get(url)
}

async function svgTexture(svg, vb, maxPx, renderer) {
  const [, , vw, vh] = vb
  const s = maxPx / Math.max(vw, vh)
  const W = Math.round(vw * s)
  const H = Math.round(vh * s)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', `<svg width="${W}" height="${H}" `))}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  canvas.getContext('2d').drawImage(img, 0, 0, W, H)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
  return tex
}

/** Texture for boards without Gerbers: soldermask with each part's pads. */
function padsTexture(board, vb, side, renderer) {
  const [vx, vy, vw, vh] = vb
  const s = 1600 / Math.max(vw, vh)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vw * s)
  canvas.height = Math.round(vh * s)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0d3a2b'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#d8b45a'
  for (const p of Object.values(board.parts)) {
    if (!p.loc) continue
    const g = packageGeometry(p)
    for (const pad of g.pads) {
      if (!pad.drill && (p.loc.side === 'bottom') !== (side === 'bottom')) continue
      const c = toBoard(pad, p.loc)
      const px = side === 'bottom' ? vx + vw - c.x + vx : c.x // bottom view is mirrored
      const X = (px - vx) * s
      const Y = (-c.y - vy) * s
      const r = Math.max(pad.w, pad.h) * s * 0.5
      ctx.fillRect(X - r * (pad.w / Math.max(pad.w, pad.h)), Y - r * (pad.h / Math.max(pad.w, pad.h)), 2 * r * (pad.w / Math.max(pad.w, pad.h)), 2 * r * (pad.h / Math.max(pad.w, pad.h)))
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
  return tex
}

/** A rounded rectangular outline around a part's footprint (its highlight). */
function frameGeometry(w, h, boardSpan) {
  const t = Math.min(0.6, Math.max(0.14, boardSpan * 0.005)) // line width
  const m = Math.max(0.25, Math.min(w, h) * 0.15) // gap to the part
  const rr = (W, H, r) => {
    const sh = new THREE.Shape()
    const x = -W / 2
    const y = -H / 2
    sh.moveTo(x + r, y)
    sh.lineTo(x + W - r, y)
    sh.quadraticCurveTo(x + W, y, x + W, y + r)
    sh.lineTo(x + W, y + H - r)
    sh.quadraticCurveTo(x + W, y + H, x + W - r, y + H)
    sh.lineTo(x + r, y + H)
    sh.quadraticCurveTo(x, y + H, x, y + H - r)
    sh.lineTo(x, y + r)
    sh.quadraticCurveTo(x, y, x + r, y)
    return sh
  }
  const W = w + 2 * (m + t)
  const H = h + 2 * (m + t)
  const outer = rr(W, H, Math.min(W, H) * 0.25)
  outer.holes.push(rr(W - 2 * t, H - 2 * t, Math.max(0.01, Math.min(W, H) * 0.25 - t)))
  return new THREE.ShapeGeometry(outer, 6)
}

/** Dispose geometry and materials, except shared library models (cached across boards). */
function disposeTree(obj) {
  if (obj.userData.shared) return
  obj.geometry?.dispose?.()
  if (obj.material) [].concat(obj.material).forEach((m) => (m.map?.dispose?.(), m.dispose?.()))
  for (const c of obj.children) disposeTree(c)
}

const easeOutBack = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2

export default function BoardView3D({ project, side = 'top', highlightRef = null, activeRef = null, calibrateRef = null, reviewItems = null, viewCmd = null, onPick, onFlip, compact = false }) {
  const mountRef = useRef(null)
  const labelsRef = useRef(null)
  const eng = useRef(null)
  const props = useRef({})
  props.current = { project, side, highlightRef, activeRef, calibrateRef, reviewItems, onPick }

  const { board, render } = project
  const vb = render.viewBox
  const boardKey = `${board.id}:${vb.join(',')}:${render.svg?.length ?? 0}:${render.svgBottom?.length ?? 0}`

  // ---------- renderer, camera, controls, loop ----------
  useEffect(() => {
    const el = mountRef.current
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping // keeps soldermask green and pads gold
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.add(new THREE.HemisphereLight('#ffffff', '#30343a', 0.3))
    const key = new THREE.DirectionalLight('#ffffff', 1.25)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    scene.add(key, key.target)
    const under = new THREE.DirectionalLight('#ffffff', 0.9)
    scene.add(under, under.target)

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 5000)
    camera.up.set(0, 0, 1)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.screenSpacePanning = true
    controls.zoomToCursor = true
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }

    const e = { renderer, scene, camera, controls, key, under, parts: new Map(), hits: [], boardGroup: null, anim: null, clock: new THREE.Clock(), fit: 50, center: new THREE.Vector3(), prevStatus: {}, labels: new Map() }
    eng.current = e

    const resize = () => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      renderer.setSize(r.width, r.height, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      camera.aspect = r.width / r.height
      camera.updateProjectionMatrix()
      if (e.size && !e.userMoved) frame(e, e.side ?? 'top', props.current.project.settings.viewRotation ?? 0, false)
    }
    controls.addEventListener('start', () => (e.userMoved = true))
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    // click = pick, double-click = zoom to that part
    let down = null
    const pickAt = (ev) => {
      const r = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects(e.hits, false)[0]
      return hit?.object.userData.ref ?? null
    }
    const onDown = (ev) => (down = { x: ev.clientX, y: ev.clientY })
    const onUp = (ev) => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return
      const ref = pickAt(ev)
      if (ref) props.current.onPick?.(ref)
    }
    const onDbl = (ev) => {
      const ref = pickAt(ev)
      if (ref) focusPart(e, ref)
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('dblclick', onDbl)

    let raf
    const loop = () => {
      raf = requestAnimationFrame(loop)
      tick(e, props.current, labelsRef.current)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('dblclick', onDbl)
      disposeTree(scene)
      pmrem.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
      eng.current = null
    }
  }, [])

  // ---------- board slab and part models ----------
  useEffect(() => {
    const e = eng.current
    if (!e) return
    let cancelled = false
    if (e.boardGroup) {
      e.scene.remove(e.boardGroup)
      disposeTree(e.boardGroup)
    }
    const group = new THREE.Group()
    e.boardGroup = group
    e.scene.add(group)
    e.parts.clear()
    e.hits = []

    const [vx, vy, vw, vh] = vb
    const cx = vx + vw / 2
    const cy = -(vy + vh / 2)
    e.center.set(cx, cy, 0)
    e.size = { w: vw, h: vh }
    const edge = new THREE.MeshStandardMaterial({ color: '#36412f', roughness: 0.8 })
    const top = new THREE.MeshStandardMaterial({ color: '#0d3a2b', roughness: 0.62, metalness: 0, envMapIntensity: 0.35, alphaTest: 0.5, transparent: true })
    const bottom = top.clone()
    const slab = new THREE.Mesh(new THREE.BoxGeometry(vw, vh, T), [edge, edge, edge, edge, top, bottom])
    slab.position.set(cx, cy, 0)
    slab.receiveShadow = true
    group.add(slab)
    ;(async () => {
      try {
        const tTop = render.svg ? await svgTexture(render.svg, vb, 2048, e.renderer) : padsTexture(board, vb, 'top', e.renderer)
        const tBot = render.svgBottom ? await svgTexture(render.svgBottom, vb, 2048, e.renderer) : padsTexture(board, vb, 'bottom', e.renderer)
        if (cancelled) return
        top.map = tTop
        bottom.map = tBot
        top.color.set('#ffffff')
        bottom.color.set('#ffffff')
        top.needsUpdate = bottom.needsUpdate = true
      } catch {
        // keep the plain soldermask colour
      }
    })()

    for (const p of Object.values(board.parts)) {
      if (!p.loc) continue
      const g = packageGeometry(p)
      const ex = packageExtent(g)
      const place = new THREE.Group()
      place.position.set(p.loc.x, p.loc.y, p.loc.side === 'bottom' ? -T / 2 : T / 2)
      place.rotation.z = (p.loc.rot * Math.PI) / 180
      if (p.loc.side === 'bottom') place.scale.set(-1, 1, -1)
      const { model, markMats } = buildModel(p, g)
      place.add(model)
      const r = Math.max(Math.hypot(ex.w, ex.h) / 2, 0.8)
      const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
      const ring = new THREE.Mesh(frameGeometry(ex.w, ex.h, Math.max(vw, vh)), ringMat)
      ring.position.set(ex.cx, ex.cy, 0.04)
      place.add(ring)
      const hit = new THREE.Mesh(new THREE.BoxGeometry(ex.w + 0.6, ex.h + 0.6, Math.max(g.height, 0.6) + HOVER), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }))
      hit.position.set(ex.cx, ex.cy, (Math.max(g.height, 0.6) + HOVER) / 2)
      hit.userData.ref = p.ref
      place.add(hit)
      e.hits.push(hit)
      group.add(place)
      const entry = { place, model, ring, ringMat, markMats, g, ex, r, side: p.loc.side, landing: null }
      e.parts.set(p.ref, entry)
      // Swap in the KiCad library model when there is one; keep the built model otherwise.
      kicadModel(p.footprint)?.then((scene) => {
        if (!scene || cancelled) return
        const clone = scene.clone(true)
        clone.userData.shared = true
        entry.model.clear()
        entry.model.add(clone)
        entry.markMats = []
        entry.real3d = true
      })
    }

    // Lights and shadow camera sized to the board.
    const span = Math.max(vw, vh)
    e.key.position.set(cx - span * 0.6, cy - span * 0.9, span * 1.6)
    e.key.target.position.set(cx, cy, 0)
    e.under.position.set(cx + span * 0.5, cy - span * 0.6, -span * 1.6)
    e.under.target.position.set(cx, cy, 0)
    const sc = e.key.shadow.camera
    sc.left = sc.bottom = -span
    sc.right = sc.top = span
    sc.near = 1
    sc.far = span * 5
    sc.updateProjectionMatrix()
    e.fit = fitDistance(e)
    e.controls.minDistance = 3
    e.controls.maxDistance = e.fit * 4
    e.prevStatus = { ...project.status }
    frame(e, props.current.side, project.settings.viewRotation ?? 0, false)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey])

  // ---------- part states ----------
  useEffect(() => {
    const e = eng.current
    if (!e) return
    const now = performance.now()
    const review = Object.fromEntries((reviewItems ?? []).map((i) => [i.ref, i.status]))
    for (const [ref, pt] of e.parts) {
      const st = project.status[ref]
      const isCur = ref === project.current
      const wasPlaced = e.prevStatus[ref] === STATUS.placed
      pt.model.visible = st === STATUS.placed || isCur
      if (st === STATUS.placed && !wasPlaced) pt.landing = now
      if (st !== STATUS.placed) pt.landing = null
      const v = project.verifications[ref]
      const rv = review[ref]
      let color = null
      if (rv === 'ok') color = '#30d158'
      else if (rv === 'problem') color = '#ff453a'
      else if (rv === 'unclear' || rv === 'error') color = '#ffc61a'
      else if (v?.verdict === 'problem' && v.user !== 'ok') color = '#ff453a'
      else if (st === STATUS.skipped) color = '#ffc61a'
      if (isCur) color = '#ffffff'
      if (ref === highlightRef || ref === calibrateRef) color = '#ffffff'
      if (ref === activeRef) color = '#ffffff'
      pt.ringColor = color
      if (color) pt.ringMat.color.set(color)
      pt.pulse = isCur || ref === highlightRef || ref === calibrateRef || ref === activeRef
      for (const m of pt.markMats) m.emissive?.set(isCur ? '#ffd60a' : '#000000')
    }
    e.prevStatus = { ...project.status }
  }, [project.status, project.current, project.verifications, highlightRef, activeRef, calibrateRef, reviewItems, boardKey])

  // ---------- side and orientation ----------
  useEffect(() => {
    if (eng.current) frame(eng.current, side, project.settings.viewRotation ?? 0, true)
  }, [side, project.settings.viewRotation])

  // ---------- view commands (buttons, voice) ----------
  useEffect(() => {
    const e = eng.current
    if (!e || !viewCmd) return
    if (viewCmd.type === 'zoom-in') dolly(e, 0.6)
    if (viewCmd.type === 'zoom-out') dolly(e, 1.6)
    if (viewCmd.type === 'fit') frame(e, side, project.settings.viewRotation ?? 0, true)
    if (viewCmd.type === 'focus') focusPart(e, viewCmd.ref ?? project.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewCmd?.nonce])

  const cmd = (type) => (ev) => {
    ev.stopPropagation()
    const e = eng.current
    if (!e) return
    if (type === 'zoom-in') dolly(e, 0.6)
    if (type === 'zoom-out') dolly(e, 1.6)
    if (type === 'fit') frame(e, side, project.settings.viewRotation ?? 0, true)
  }

  return (
    <div className="board3d">
      <div ref={mountRef} className="board3d-canvas" />
      <div ref={labelsRef} className="board3d-labels" />
      <div className="corner bl zoom-ctl">
        <button className="btn icon sm" onClick={cmd('zoom-in')} aria-label="Zoom in" title="Zoom in (scroll / pinch)">
          <Icon name="plus" />
        </button>
        <button className="btn icon sm" onClick={cmd('zoom-out')} aria-label="Zoom out" title="Zoom out">
          <Icon name="minus" />
        </button>
        <button className="btn icon sm" onClick={cmd('fit')} aria-label="Whole board" title="Whole board">
          <Icon name="fit" />
        </button>
        {!compact && onFlip && (
          <button className="btn icon sm" onClick={onFlip} aria-label={side === 'top' ? 'Show back' : 'Show front'} title={side === 'top' ? 'Show back' : 'Show front'}>
            <Icon name="flip" />
          </button>
        )}
      </div>
      {!compact && <div className="corner tl side-chip chip">{side === 'top' ? 'Front' : 'Back'}</div>}
    </div>
  )
}

function fitDistance(e) {
  // Fit the board's width against the horizontal field of view and its height against the vertical one.
  const tanHalf = Math.tan((e.camera.fov * Math.PI) / 360)
  return (Math.max(e.size.w / Math.max(0.2, e.camera.aspect), e.size.h) / (2 * tanHalf)) * 1.4
}

/** Look at the whole board from the given side, turned by the view rotation, slightly tilted. */
function frame(e, side, rotationDeg, animate) {
  e.fit = fitDistance(e)
  e.userMoved = false
  const tilt = 0.32
  const az = (-rotationDeg * Math.PI) / 180
  const dir = new THREE.Vector3(0, -Math.sin(tilt), side === 'bottom' ? -Math.cos(tilt) : Math.cos(tilt)).applyAxisAngle(new THREE.Vector3(0, 0, 1), az)
  const to = e.center.clone().add(dir.multiplyScalar(e.fit))
  moveCamera(e, to, e.center.clone(), animate)
  e.side = side
}

function focusPart(e, ref) {
  const pt = e.parts.get(ref)
  if (!pt) return
  const c = pt.place.localToWorld(new THREE.Vector3(pt.ex.cx, pt.ex.cy, 0))
  const dist = Math.max(10, pt.r * 9)
  const dir = e.camera.position.clone().sub(e.controls.target).normalize()
  moveCamera(e, c.clone().add(dir.multiplyScalar(dist)), c, true)
}

function dolly(e, factor) {
  const target = e.controls.target.clone()
  const off = e.camera.position.clone().sub(target).multiplyScalar(factor)
  const len = Math.min(e.controls.maxDistance, Math.max(e.controls.minDistance, off.length()))
  moveCamera(e, target.clone().add(off.setLength(len)), target, true)
}

function moveCamera(e, pos, target, animate) {
  if (!animate) {
    e.camera.position.copy(pos)
    e.controls.target.copy(target)
    e.anim = null
    return
  }
  e.anim = { t0: performance.now(), dur: 650, fromPos: e.camera.position.clone(), toPos: pos, fromT: e.controls.target.clone(), toT: target }
}

const _v = new THREE.Vector3()
function tick(e, props, labelsEl) {
  const now = performance.now()
  const t = e.clock.getElapsedTime()
  if (e.anim) {
    const k = Math.min(1, (now - e.anim.t0) / e.anim.dur)
    const s = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
    e.camera.position.lerpVectors(e.anim.fromPos, e.anim.toPos, s)
    e.controls.target.lerpVectors(e.anim.fromT, e.anim.toT, s)
    if (k >= 1) e.anim = null
  }
  for (const [ref, pt] of e.parts) {
    const isCur = ref === props.project.current
    if (isCur) pt.model.position.z = HOVER + Math.sin(t * 3) * 0.35
    else if (pt.landing) {
      const k = Math.min(1, (now - pt.landing) / 520)
      pt.model.position.z = HOVER * (1 - easeOutBack(k))
      if (k >= 1) pt.landing = null
    } else pt.model.position.z = 0
    if (pt.ringColor) {
      pt.ringMat.opacity = pt.pulse ? 0.55 + 0.4 * Math.sin(t * 4) : 0.9
      pt.ring.scale.set(1, 1, 1)
    } else pt.ringMat.opacity = 0
    for (const m of pt.markMats) if (isCur && m.emissive) m.emissiveIntensity = 0.6 + 0.5 * Math.sin(t * 5)
  }
  // Labels for the parts that matter right now.
  if (!labelsEl) return
  const want = [props.project.current, props.highlightRef, props.activeRef, props.calibrateRef].filter(Boolean)
  const r = e.renderer.domElement.getBoundingClientRect()
  for (const [ref, div] of e.labels) if (!want.includes(ref)) (div.remove(), e.labels.delete(ref))
  for (const ref of new Set(want)) {
    const pt = e.parts.get(ref)
    if (!pt) continue
    let div = e.labels.get(ref)
    if (!div) {
      div = document.createElement('div')
      div.className = 'board3d-label'
      div.textContent = ref
      labelsEl.appendChild(div)
      e.labels.set(ref, div)
    }
    pt.place.localToWorld(_v.set(pt.ex.cx, pt.ex.cy + pt.ex.h / 2, pt.g.height + (ref === props.project.current ? HOVER + 0.8 : 0.6)))
    _v.project(e.camera)
    const hidden = _v.z > 1 || (e.side === 'top') !== (pt.side !== 'bottom') // not on the visible side
    div.style.display = hidden && pt.g.style !== 'header' ? 'none' : 'block'
    div.style.transform = `translate(-50%, -110%) translate(${((_v.x + 1) / 2) * r.width}px, ${((1 - _v.y) / 2) * r.height}px)`
  }
}
