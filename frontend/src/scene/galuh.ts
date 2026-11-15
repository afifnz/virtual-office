import * as THREE from 'three'
import type { Look } from '../lib/agents'
import type { FaceLandmarks, Lid } from './face'
import { BONES, type Rig } from './human'

/**
 * Galuh's head, built from scratch instead of painted onto the Quaternius
 * skull. The pack's head is a wide, flat cartoon skull whose skin mesh sits
 * 14 mm off the neck axis, so every feature laid on top of it read slightly
 * wrong. Here the head, the face, the hijab and the drape all come from ONE
 * ellipsoid: the cloth is that surface pushed out by 10 mm, and the face
 * window is a smooth dent in the cloth that dives behind the face. There is
 * no hole in the shell anywhere, so the hairline, the ear and the throat can
 * never show a sliver of skin.
 *
 * All coordinates are model space (the unscaled pack space the landmarks are
 * measured in); human.ts mounts the group on the head bone.
 */

/* ------------------------------------------------------------------ *
 * the canonical head
 * ------------------------------------------------------------------ */

interface HeadShape {
  cx: number
  cy: number
  cz: number
  rx: number
  ryUp: number
  ryDown: number
  rz: number
}

const RATIO = {
  rx: 0.0785,
  ryUp: 0.098,
  ryDown: 0.086,
  rz: 0.0905,
}

function headShape(l: FaceLandmarks): HeadShape {
  const k = THREE.MathUtils.clamp(l.headW / 0.187, 0.85, 1.15)
  return {
    cx: l.headCenterX,
    cy: l.headTopY - 0.085 * k,
    cz: l.headCenterZ,
    rx: RATIO.rx * k,
    ryUp: RATIO.ryUp * k,
    ryDown: RATIO.ryDown * k,
    rz: RATIO.rz * k,
  }
}

interface Features {
  eyeY: number
  eyeSep: number
  browY: number
  mouthY: number
  chinY: number
}

function features(h: HeadShape): Features {
  return {
    eyeY: h.cy + 0.012,
    eyeSep: h.rx * 0.382,
    browY: h.cy + 0.034,
    mouthY: h.cy - 0.036,
    chinY: h.cy - h.ryDown,
  }
}

/** jaw and chin narrow below the cheekbones; the cheeks stay full */
function taper(y: number, h: HeadShape): { x: number; z: number } {
  const t = THREE.MathUtils.clamp((h.cy - y) / h.ryDown, 0, 1)
  return { x: 1 - 0.30 * Math.pow(t, 1.8), z: 1 - 0.18 * Math.pow(t, 1.95) }
}

function skullPoint(h: HeadShape, theta: number, phi: number, out: THREE.Vector3): THREE.Vector3 {
  const sy = Math.cos(phi)
  const sp = Math.sin(phi)
  const y = h.cy + sy * (sy >= 0 ? h.ryUp : h.ryDown)
  const tp = taper(y, h)
  out.set(h.cx + Math.sin(theta) * sp * h.rx * tp.x, y, h.cz + Math.cos(theta) * sp * h.rz * tp.z)
  return out
}

function skullNormal(h: HeadShape, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const tp = taper(p.y, h)
  out.set(
    (p.x - h.cx) / (h.rx * tp.x) ** 2,
    (p.y - h.cy) / (p.y > h.cy ? h.ryUp : h.ryDown) ** 2,
    (p.z - h.cz) / (h.rz * tp.z) ** 2,
  )
  return out.normalize()
}

/* ------------------------------------------------------------------ *
 * facial relief: smooth gaussians on the skull, so the face shades
 * softly instead of showing a seam where a nose mesh was glued on
 * ------------------------------------------------------------------ */

const G = (d: number, s: number) => Math.exp(-(d * d) / (2 * s * s))

function relief(h: HeadShape, f: Features, p: THREE.Vector3): number {
  const x = p.x - h.cx
  const y = p.y - h.cy
  const z = p.z - h.cz
  if (z <= 0) return 0
  const front = THREE.MathUtils.smoothstep(z / h.rz, 0.05, 0.5)
  if (front <= 0) return 0

  const eyeDy = y - (f.eyeY - h.cy)
  const mouthDy = y - (f.mouthY - h.cy)
  const browDy = y - (f.browY - h.cy)
  const noseDy = y + 0.0180

  let d = 0

  // nose: a narrow bridge that swells into a small round tip
  const ramp = THREE.MathUtils.clamp((0.010 - y) / 0.030, 0, 1)
  d += 0.0098 * G(x, 0.0058) * Math.pow(ramp, 0.65) * G(noseDy + 0.005, 0.021)
  d += 0.0060 * G(x, 0.0066) * G(noseDy, 0.0062)
  d += 0.0036 * (G(x - 0.0100, 0.0050) + G(x + 0.0100, 0.0050)) * G(noseDy + 0.005, 0.0060)
  // the crease where the alae meet the cheek
  d -= 0.0016 * (G(x - 0.0130, 0.0030) + G(x + 0.0130, 0.0030)) * G(noseDy + 0.006, 0.0055)

  // brow shelf
  d += 0.0030 * G(browDy - 0.004, 0.0070) * (G(x - 0.036, 0.024) + G(x + 0.036, 0.024))

  // eye sockets
  d -= 0.0058 * (G(x - f.eyeSep, 0.0165) + G(x + f.eyeSep, 0.0165)) * G(eyeDy, 0.0115)

  // cheek apples
  d += 0.0050 * (G(x - 0.047, 0.023) + G(x + 0.047, 0.023)) * G(y + 0.028, 0.021)

  // mouth mound + philtrum
  d += 0.0040 * G(x, 0.019) * G(mouthDy + 0.004, 0.0115)
  d -= 0.0017 * G(x, 0.0042) * G(mouthDy + 0.017, 0.009)

  // chin boss
  d += 0.0060 * G(x, 0.017) * G(y + h.ryDown - 0.020, 0.016)

  // temples
  d -= 0.0020 * (G(x - 0.062, 0.014) + G(x + 0.062, 0.014)) * G(y - 0.004, 0.020)

  return d * front
}

/** front z of the sculpted face at (x, y) */
function faceZ(h: HeadShape, f: Features, x: number, y: number): number {
  const dx = (x - h.cx) / h.rx
  const dy = (y - h.cy) / (y > h.cy ? h.ryUp : h.ryDown)
  const k = 1 - dx * dx - dy * dy
  const z = h.cz + h.rz * Math.sqrt(Math.max(0, k))
  return z + relief(h, f, new THREE.Vector3(x, y, z))
}

/* ------------------------------------------------------------------ *
 * geometry helpers
 * ------------------------------------------------------------------ */

/** concatenate position/normal/uv of several geometries, non-indexed */
function mergeParts(parts: Array<{ g: THREE.BufferGeometry; m?: THREE.Matrix4 }>): THREE.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const v = new THREE.Vector3()
  const nm = new THREE.Matrix3()
  for (const part of parts) {
    const mat = part.m ?? new THREE.Matrix4()
    nm.getNormalMatrix(mat)
    const p = part.g.getAttribute('position') as THREE.BufferAttribute
    const n = part.g.getAttribute('normal') as THREE.BufferAttribute | undefined
    const t = part.g.getAttribute('uv') as THREE.BufferAttribute | undefined
    const idx = part.g.getIndex()
    const count = idx ? idx.count : p.count
    for (let i = 0; i < count; i++) {
      const j = idx ? idx.getX(i) : i
      v.fromBufferAttribute(p, j).applyMatrix4(mat)
      pos.push(v.x, v.y, v.z)
      if (n) {
        v.fromBufferAttribute(n, j).applyMatrix3(nm).normalize()
        nor.push(v.x, v.y, v.z)
      } else nor.push(0, 0, 1)
      uv.push(t ? t.getX(j) : 0, t ? t.getY(j) : 0)
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return out
}

/** a tapered ribbon through `points`, each `widths[i]` tall along `up` */
function ribbon(points: THREE.Vector3[], widths: number[], up: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const w = widths[i]! * 0.5
    pos.push(p.x - up.x * w, p.y - up.y * w, p.z - up.z * w)
    pos.push(p.x + up.x * w, p.y + up.y * w, p.z + up.z * w)
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/* ------------------------------------------------------------------ *
 * textures
 * ------------------------------------------------------------------ */

let irisTex: THREE.CanvasTexture | null = null

/** iris: v = 1 is the pupil, v = 0 the limbal ring (three flips the canvas) */
function irisTexture(): THREE.CanvasTexture {
  if (irisTex) return irisTex
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const ctx = c.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0.0, '#241309')
  grad.addColorStop(0.27, '#2a170c')
  grad.addColorStop(0.33, '#6d4322')
  grad.addColorStop(0.56, '#8a5a2e')
  grad.addColorStop(0.76, '#a2703c')
  grad.addColorStop(0.9, '#5a3418')
  grad.addColorStop(1.0, '#3a2110')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 64, 128)
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 64
    ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(190,145,90,0.30)' : 'rgba(60,32,14,0.28)'
    ctx.lineWidth = 0.8 + Math.random() * 1.1
    ctx.beginPath()
    ctx.moveTo(x, 40 + Math.random() * 8)
    ctx.lineTo(x + (Math.random() - 0.5) * 5, 104 + Math.random() * 12)
    ctx.stroke()
  }
  irisTex = new THREE.CanvasTexture(c)
  irisTex.colorSpace = THREE.SRGBColorSpace
  irisTex.wrapS = THREE.RepeatWrapping
  return irisTex
}

let blushTex: THREE.CanvasTexture | null = null

function blushTexture(): THREE.CanvasTexture {
  if (blushTex) return blushTex
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31)
  g.addColorStop(0, 'rgba(206,98,96,0.72)')
  g.addColorStop(0.45, 'rgba(206,98,96,0.36)')
  g.addColorStop(1, 'rgba(208,104,100,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  blushTex = new THREE.CanvasTexture(c)
  blushTex.colorSpace = THREE.SRGBColorSpace
  return blushTex
}

/* ------------------------------------------------------------------ *
 * the hijab
 * ------------------------------------------------------------------ */

/** how far the cloth floats off the skull */
const CLOTH = 0.0125

interface Ring {
  y: number
  rx: number
  rz: number
  cz: number
  fold: number
  tone: number
}

/**
 * Cloth profile, crown to hem: the skull pushed out by CLOTH down to the
 * jaw, then a tuck under the chin, then the neck and the shoulders.
 */
function hijabRings(h: HeadShape, f: Features): Ring[] {
  const rings: Ring[] = []
  const phiJaw = Math.acos(THREE.MathUtils.clamp(-0.62, -1, 1))
  // enough rows that the window edge (which curves in theta) resolves into a
  // clean line instead of a stair-step of alternating vertices
  const N = 56
  for (let i = 0; i <= N; i++) {
    const phi = (i / N) * phiJaw
    const p = skullPoint(h, 0, phi, new THREE.Vector3())
    const tp = taper(p.y, h)
    const s = Math.sin(phi)
    rings.push({
      y: p.y,
      rx: h.rx * s * tp.x + CLOTH,
      rz: h.rz * s * tp.z + CLOTH,
      cz: h.cz,
      // gathers: none at the crown (the cloth is pulled taut there), then a
      // few broad folds down the sides of the head. The old profile ramped to
      // a single number for the whole cap, which left the skull a smooth shell.
      fold: 0.0025 + 0.0075 * THREE.MathUtils.smoothstep(phi, 0.20, 0.95) ** 1.2,
      tone: 0,
    })
  }

  // under the jaw the cloth does NOT hug the neck: it falls away from the
  // jaw and widens onto the shoulders, which is what stops the silhouette
  // reading as a giraffe neck
  const neck: Array<[number, number, number, number, number]> = [
    // y, rx, rz, cz offset, fold
    [-0.074, 0.056, 0.063, 0.004, 0.006],
    [-0.090, 0.062, 0.068, 0.004, 0.008],
    [-0.112, 0.070, 0.074, 0.003, 0.010],
    [-0.140, 0.080, 0.080, 0.001, 0.012],
    [-0.170, 0.094, 0.088, -0.002, 0.013],
    [-0.200, 0.112, 0.098, -0.005, 0.014],
    [-0.228, 0.132, 0.108, -0.008, 0.015],
    [-0.250, 0.148, 0.117, -0.010, 0.016],
    [-0.268, 0.158, 0.124, -0.011, 0.016],
  ]
  for (const [dy, rx, rz, dz, fold] of neck) {
    rings.push({ y: h.cy + dy, rx, rz, cz: h.cz + dz, fold, tone: 1 })
  }
  void f
  return rings
}

/**
 * The cloth's relief in metres. Three things live here, all of them sums of
 * broad gaussians and low harmonics so the result stays soft:
 *  - gathers pulled down from the crown (they exist at the crown too, which is
 *    what stops the top of the head reading as a moulded dome);
 *  - one deeper fold on the left, the way a scarf is tucked over one shoulder;
 *  - two long folds running down the front of the drape.
 */
function clothFold(theta: number, dy: number, droop: number, amp: number): number {
  // `amp` is in metres: a couple of millimetres over the skull, a centimetre
  // and a half where the cloth hangs. Radii are untouched, so the head keeps
  // its shape and only the surface breathes.
  const gather = 0.55 * Math.cos(3 * theta + 0.7 + dy * 2.2) + 0.45 * Math.cos(5 * theta + 2.3 - dy * 1.5)
  const asym = 0.45 * Math.cos(2 * theta - 0.85) * (0.35 + 0.65 * droop)
  const G = (d: number, s: number) => Math.exp(-(d * d) / (2 * s * s))
  // two long folds over the chest, either side of the centre
  const chest = -0.95 * (G(theta - 0.62, 0.22) + G(theta + 0.62, 0.22)) * droop ** 1.5
  return THREE.MathUtils.clamp(amp * (gather + asym + chest), -0.018, 0.018)
}

/**
 * Where the face window sits, as a signed distance in metres: positive
 * inside. The window is widest at the cheekbones, its top edge arches over the
 * brow and it closes under the chin.
 */
function windowDist(h: HeadShape, f: Features, theta: number, y: number): number {
  // The cloth edge follows a hairline: it rides up over the middle of the
  // forehead and dips at the temples, which is what gives the head a brow
  // instead of a helmet brim.
  const yTop = f.browY + 0.014 + 0.0070 * Math.cos(theta) * Math.abs(Math.cos(theta))
  const yBot = f.chinY + 0.013
  const t = (yTop - y) / (yTop - yBot) // 0 at the top edge, 1 at the chin
  if (t < 0 || t > 1) {
    return -Math.min(Math.abs(t), Math.abs(t - 1)) * (yTop - yBot) - 0.0005
  }
  // slightly wider across the cheekbones than at the forehead
  const gw = 0.95 * (0.90 + 0.10 * Math.sin(Math.PI * t))
  const halfW = Math.sin(gw) * (h.rx * Math.sin(Math.acos(THREE.MathUtils.clamp((y - h.cy) / (y > h.cy ? h.ryUp : h.ryDown), -1, 1))))
  const dSide = (halfW - Math.abs(theta) * h.rx * 0.9) // rough arc length
  const dTop = (1 - t) * (yTop - yBot)
  return Math.min(dSide, dTop, 0.05)
}

function buildCloth(h: HeadShape, f: Features, base: THREE.Color, deep: THREE.Color): {
  cloth: THREE.BufferGeometry
  hem: THREE.Vector3[]
  rim: THREE.Vector3[]
  deep: THREE.Color
} {
  const rings = hijabRings(h, f)
  const SEG = 128
  const rows = rings.length
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  const colInside: number[] = []
  const colPos: number[] = []
  const hem: THREE.Vector3[] = []
  const _tmpCloth = new THREE.Vector3()
  // the point where the cloth crosses the skin, one per column: the rolled
  // edge of the opening is built from these
  const rim: THREE.Vector3[] = []

  for (let r = 0; r < rows; r++) {
    const ring = rings[r]!
    const last = r >= rows - 1
    // 0 at the crown, 1 at the hem: gathers grow as the cloth hangs
    const droop = THREE.MathUtils.clamp((h.cy + 0.02 - ring.y) / 0.28, 0, 1)
    for (let s = 0; s <= SEG; s++) {
      const theta = (s / SEG) * Math.PI * 2
      const x = h.cx + Math.sin(theta) * ring.rx
      const z = ring.cz + Math.cos(theta) * ring.rz
      let y = ring.y
      // the hem is not a level circle: one side hangs lower, the way a scarf
      // tucked over a shoulder does
      if (last) {
        y -= 0.022 * (0.5 + 0.5 * Math.cos(2 * theta - 0.7))
        y -= 0.010 * (0.5 + 0.5 * Math.cos(3 * theta + 1.4))
        y -= 0.006 * (0.5 + 0.5 * Math.cos(6 * theta + 0.3))
      }

      // face window: inside the opening the cloth does not shrink radially
      // (that left a skin gap under the chin and a flap over the brow) — it
      // dives straight behind the face surface, so the rim is exactly where the
      // two surfaces cross and nothing can float in front of the eyes.
      const d = windowDist(h, f, Math.atan2(x - h.cx, z - ring.cz), y)
      const inside = THREE.MathUtils.smoothstep(d, -0.0060, 0.0060)
      p.set(x, y, z)
      if (inside > 0) {
        // dive radially: the cloth slides *under the skull surface* along the
        // same direction, so it cannot fall behind the skin at the sides of the
        // opening (a z-only dive did, and the jaw came out through the cloth)
        const ux = x - h.cx
        const uy = y - h.cy
        const uz = z - h.cz
        const len = Math.hypot(ux, uy, uz)
        if (len > 1e-5) {
          const nx = ux / len
          const ny = uy / len
          const nz = uz / len
          const ry = y > h.cy ? h.ryUp : h.ryDown
          // radius of the head's ellipsoid in this direction
          const rr = 1 / Math.sqrt((nx / h.rx) ** 2 + (ny / ry) ** 2 + (nz / h.rz) ** 2)
          const under = Math.max(0.004, rr - 0.008)
          p.set(h.cx + nx * under, h.cy + ny * under, h.cz + nz * under)
          p.lerpVectors(_tmpCloth.set(x, y, z), p, inside)
        }
      }

      // gathers push the cloth out along its own normal, and they are held flat
      // where the cloth meets the face, so the rim stays a clean seam; a normal
      // fold (unlike a radius one) also survives at the crown, which is what
      // stops the top of the head reading as a moulded dome
      // over the crown the cloth may only swell outwards: a groove there would
      // dip below the skull's own pole and let a spot of skin poke through
      const raw = clothFold(theta, y - h.cy, droop, ring.fold)
      const fold = (y > h.cy ? Math.max(0, raw) : raw) * (1 - inside)
      skullNormal(h, p, n)
      p.addScaledVector(n, fold)
      if (last) hem.push(p.clone())
      colInside.push(inside)
      colPos.push(p.x, p.y, p.z)
      pos.push(p.x, p.y, p.z)

      // tone: the cap is lighter, the drape deeper; ridges catch light and the
      // valleys between them sit in shadow, which is what reads as cloth
      const tone = base.clone().lerp(deep, ring.tone * 0.55)
      const ridge = ring.fold > 0 ? THREE.MathUtils.clamp(fold / (ring.fold * 1.4), -1, 1) : 0
      const lipShade = 1 - 0.26 * inside * (1 - inside) * 4
      const occl = 1 - 0.14 * THREE.MathUtils.clamp((h.cy - 0.055 - y) / 0.20, 0, 1)
      const k = occl * (1 + 0.26 * ridge) * lipShade
      col.push(tone.r * k, tone.g * k, tone.b * k)
    }
  }
  const stride = SEG + 1
  for (let r = 0; r < rows - 1; r++) {
    for (let s = 0; s < SEG; s++) {
      const a = r * stride + s
      const b = a + 1
      const c = a + stride
      const d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  const cloth = new THREE.BufferGeometry()
  cloth.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  cloth.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  cloth.setIndex(idx)
  cloth.computeVertexNormals()
  // weld the seam: column 0 and column SEG are the same place
  {
    const nor = cloth.getAttribute('normal') as THREE.BufferAttribute
    for (let r = 0; r < rows; r++) {
      const a = r * stride
      const b = a + SEG
      const nx = (nor.getX(a) + nor.getX(b)) * 0.5
      const ny = (nor.getY(a) + nor.getY(b)) * 0.5
      const nz = (nor.getZ(a) + nor.getZ(b)) * 0.5
      const l = Math.hypot(nx, ny, nz) || 1
      nor.setXYZ(a, nx / l, ny / l, nz / l)
      nor.setXYZ(b, nx / l, ny / l, nz / l)
    }
  }
  // the rim: for every column, walk down from the crown to the first vertex the
  // window swallows and interpolate the crossing. Those points are the top edge
  // of the opening; a thin tube along them gives the cloth a visible thickness
  // instead of a painted-on boundary. Columns are visited from the nape so the
  // arc over the brow comes out as one contiguous run.
  const left: THREE.Vector3[] = []
  for (let k = 0; k < SEG; k++) {
    const s2 = (SEG / 2 + k) % SEG
    for (let r = 1; r < rows; r++) {
      const v0 = colInside[(r - 1) * stride + s2]!
      const v1 = colInside[r * stride + s2]!
      if (v1 <= 0.5) continue
      const t = v0 >= 0.5 ? 0 : (0.5 - v0) / Math.max(1e-6, v1 - v0)
      const a = ((r - 1) * stride + s2) * 3
      const b = (r * stride + s2) * 3
      left.push(new THREE.Vector3(
        colPos[a]! + (colPos[b]! - colPos[a]!) * t,
        colPos[a + 1]! + (colPos[b + 1]! - colPos[a + 1]!) * t,
        colPos[a + 2]! + (colPos[b + 2]! - colPos[a + 2]!) * t,
      ))
      break
    }
  }
  if (left.length > 6) rim.push(...left)
  return { cloth, hem, rim, deep }
}

/* ------------------------------------------------------------------ *
 * the face
 * ------------------------------------------------------------------ */

export interface StylizedHead {
  group: THREE.Group
  lids: Lid[]
}

export function buildHijabHead(look: Look, l: FaceLandmarks): StylizedHead {
  const h = headShape(l)
  const f = features(h)
  const group = new THREE.Group()
  group.name = 'galuhHead'

  const skin = new THREE.MeshStandardMaterial({
    color: look.skin,
    roughness: 0.56,
    metalness: 0,
    emissive: new THREE.Color(look.skin).multiplyScalar(0.035),
    emissiveIntensity: 1,
  })

  /* ---- skull + face relief ------------------------------------- */
  const skullGeo = new THREE.SphereGeometry(1, 88, 60)
  {
    const p = skullGeo.getAttribute('position') as THREE.BufferAttribute
    const v = new THREE.Vector3()
    const n = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize()
      const theta = Math.atan2(v.x, v.z)
      const phi = Math.acos(THREE.MathUtils.clamp(v.y, -1, 1))
      skullPoint(h, theta, phi, v)
      skullNormal(h, v, n)
      const d = relief(h, f, v)
      p.setXYZ(i, v.x + n.x * d, v.y + n.y * d, v.z + n.z * d)
    }
    skullGeo.computeVertexNormals()
  }
  const skullMesh = new THREE.Mesh(skullGeo, skin)
  skullMesh.name = 'galuhSkull'
  group.add(skullMesh)

  /* ---- neck stub: never a hole under the jaw -------------------- */
  {
    // narrow at the top: a wide stub surfaces at the jaw line as a skin lobe
    // that pokes out over the hijab edge
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.044, 0.12, 20, 1, true), skin)
    m.position.set(h.cx, f.chinY - 0.040, h.cz - 0.014)
    group.add(m)
  }

  /* ---- eyes ---------------------------------------------------- */
  const eyeR = h.rx * 0.215
  const eyeZ = faceZ(h, f, h.cx + f.eyeSep, f.eyeY)
  const eyeScale = new THREE.Vector3(1, 0.84, 0.6)
  const eyeCz = eyeZ - eyeR * 0.52

  const scleraMat = new THREE.MeshStandardMaterial({
    color: '#f7f0e7',
    roughness: 0.22,
    metalness: 0,
    emissive: new THREE.Color('#f7f0e7').multiplyScalar(0.26),
    emissiveIntensity: 1,
  })
  const irisMat = new THREE.MeshStandardMaterial({
    map: irisTexture(),
    roughness: 0.16,
    metalness: 0,
    emissive: new THREE.Color('#7a4f2a').multiplyScalar(0.16),
    emissiveIntensity: 1,
  })
  const lashMat = new THREE.MeshStandardMaterial({
    color: '#2c1a13',
    roughness: 0.72,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const glintMat = new THREE.MeshBasicMaterial({ color: '#ffffff' })

  const ballGeos: Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> = []
  const irisGeos: Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> = []
  const glintGeos: Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> = []
  const lowerGeos: Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> = []

  for (const s of [-1, 1] as const) {
    const cx = h.cx + s * f.eyeSep
    const base = new THREE.Matrix4().compose(
      new THREE.Vector3(cx, f.eyeY, eyeCz),
      new THREE.Quaternion(),
      eyeScale,
    )
    ballGeos.push({ g: new THREE.SphereGeometry(eyeR, 26, 18), m: base.clone() })

    const cap = new THREE.SphereGeometry(eyeR * 1.004, 30, 12, 0, Math.PI * 2, 0, 0.60)
    cap.rotateX(Math.PI / 2)
    irisGeos.push({ g: cap, m: base.clone() })

    const low = new THREE.SphereGeometry(eyeR * 1.05, 26, 14, 0, Math.PI * 2, Math.PI * 0.63, Math.PI * 0.37)
    lowerGeos.push({
      g: low,
      m: new THREE.Matrix4().compose(
        new THREE.Vector3(cx, f.eyeY, eyeCz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, 0, 0)),
        eyeScale,
      ),
    })

    glintGeos.push({
      g: new THREE.SphereGeometry(eyeR * 0.125, 8, 6),
      m: new THREE.Matrix4().makeTranslation(
        cx - eyeR * 0.20,
        f.eyeY + eyeR * 0.21,
        eyeCz + eyeR * 0.585,
      ),
    })
  }

  group.add(new THREE.Mesh(mergeParts(ballGeos), scleraMat))
  group.add(new THREE.Mesh(mergeParts(irisGeos), irisMat))
  group.add(new THREE.Mesh(mergeParts(glintGeos), glintMat))
  group.add(new THREE.Mesh(mergeParts(lowerGeos), skin))

  /* ---- upper lids: one mesh, both eyes, one pivot on the eye axis */
  const LID_OPEN = -0.30
  const LID_SHUT = 1.02
  const LID_SPAN = 1.30
  const lidParts: Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> = []
  for (const s of [-1, 1] as const) {
    lidParts.push({
      g: new THREE.SphereGeometry(eyeR * 1.05, 26, 14, 0, Math.PI * 2, 0, LID_SPAN),
      m: new THREE.Matrix4().compose(
        new THREE.Vector3(h.cx + s * f.eyeSep, f.eyeY, eyeCz),
        new THREE.Quaternion(),
        eyeScale,
      ),
    })
  }
  const lidGeo = mergeParts(lidParts)
  lidGeo.translate(-h.cx, -f.eyeY, -eyeCz)
  const lid = new THREE.Mesh(lidGeo, skin)
  lid.position.set(h.cx, f.eyeY, eyeCz)
  lid.rotation.x = LID_OPEN
  group.add(lid)

  /* ---- lash line, riding the lid so it blinks with it ----------- */
  const rimY = Math.cos(LID_SPAN) * eyeR * 1.05 * eyeScale.y
  const rimR = Math.sin(LID_SPAN) * eyeR * 1.05
  const lashParts: Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> = []
  for (const s of [-1, 1] as const) {
    const pts: THREE.Vector3[] = []
    const wid: number[] = []
    for (let i = 0; i <= 18; i++) {
      const t = i / 18
      const a = -1.30 + t * 2.60
      const flick = Math.pow(Math.max(0, Math.abs(a) - 1.02) / 0.28, 2) * 0.0020
      pts.push(
        new THREE.Vector3(
          h.cx + s * f.eyeSep + Math.sin(a) * rimR * eyeScale.x,
          f.eyeY + rimY + flick,
          eyeCz + Math.cos(a) * rimR * eyeScale.z + eyeR * 0.03,
        ),
      )
      wid.push(0.0015 + 0.0033 * Math.pow(Math.abs(a) / 1.30, 0.85))
    }
    lashParts.push({ g: ribbon(pts, wid, new THREE.Vector3(0, 1, 0)), m: new THREE.Matrix4() })
  }
  const lash = new THREE.Mesh(mergeParts(lashParts), lashMat)
  lash.geometry.translate(-h.cx, -f.eyeY, -eyeCz)
  lid.add(lash)

  // eyelid crease: a shallow fold above the lash, in skin tone a touch
  // deeper than the face, which is what stops the eye reading as a decal
  {
    const creaseMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(look.skin).multiplyScalar(0.80),
      roughness: 0.7,
      metalness: 0,
      side: THREE.DoubleSide,
    })
    const parts: Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> = []
    for (const s of [-1, 1] as const) {
      const pts: THREE.Vector3[] = []
      const wid: number[] = []
      for (let i = 0; i <= 14; i++) {
        const t = i / 14
        const a = -1.12 + t * 2.24
        pts.push(
          new THREE.Vector3(
            h.cx + s * f.eyeSep + Math.sin(a) * rimR * 1.16,
            f.eyeY + rimY + 0.0072 + Math.abs(Math.sin(a)) * 0.0012,
            eyeCz + Math.cos(a) * rimR * 0.66 + eyeR * 0.05,
          ),
        )
        wid.push(0.0011 + 0.0011 * Math.sin(Math.PI * t))
      }
      parts.push({ g: ribbon(pts, wid, new THREE.Vector3(0, 1, 0)), m: new THREE.Matrix4() })
    }
    const crease = new THREE.Mesh(mergeParts(parts), creaseMat)
    crease.geometry.translate(-h.cx, -f.eyeY, -eyeCz)
    lid.add(crease)
  }

  /* ---- nostrils: two shadowed dimples under the tip ------------ */
  {
    const nostrilMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(look.skin).multiplyScalar(0.52),
      roughness: 0.8,
      metalness: 0,
    })
    const parts: Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> = []
    for (const s of [-1, 1] as const) {
      const nx = h.cx + s * 0.0104
      const ny = f.mouthY + 0.0136
      parts.push({
        g: new THREE.SphereGeometry(0.0042, 10, 8),
        m: new THREE.Matrix4().compose(
          new THREE.Vector3(nx, ny, faceZ(h, f, nx, ny) - 0.0022),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, 0)),
          new THREE.Vector3(1.15, 0.62, 0.55),
        ),
      })
    }
    group.add(new THREE.Mesh(mergeParts(parts), nostrilMat))
  }

  /* ---- brows --------------------------------------------------- */
  const browMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(look.hair).lerp(new THREE.Color('#3a2a22'), 0.35),
    roughness: 0.7,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const browParts: Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> = []
  for (const s of [-1, 1] as const) {
    const pts: THREE.Vector3[] = []
    const wid: number[] = []
    for (let i = 0; i <= 12; i++) {
      const t = i / 12
      const x = h.cx + s * (0.015 + t * 0.052)
      const arch = Math.sin(Math.PI * Math.min(1, t * 0.80 + 0.07)) ** 0.85
      const y = f.browY + arch * 0.0062 - t * 0.0022
      pts.push(new THREE.Vector3(x, y, faceZ(h, f, x, y) + 0.0013))
      wid.push(0.0026 + 0.0040 * Math.sin(Math.PI * Math.min(1, t * 1.02)))
    }
    browParts.push({ g: ribbon(pts, wid, new THREE.Vector3(0, 1, 0)), m: new THREE.Matrix4() })
  }
  group.add(new THREE.Mesh(mergeParts(browParts), browMat))

  /* ---- lips ----------------------------------------------------
   * The lips are a patch laid ON the face surface, not two volumes stuck in
   * front of it: every vertex is placed at faceZ(x, y) plus at most 1.6 mm, so
   * from the side the mouth can never break the profile, and the two halves are
   * generated from the same |u| profile, so they are symmetric by construction.
   * The shape is a painter's mouth: thin upper lip with a soft cupid's bow, a
   * fuller lower lip, and a hairline crease where they meet.
   */
  const lipMat = new THREE.MeshStandardMaterial({
    color: '#b3605f',
    roughness: 0.46,
    metalness: 0,
    side: THREE.DoubleSide,
    emissive: new THREE.Color('#b3605f').multiplyScalar(0.08),
    emissiveIntensity: 1,
  })
  const creaseMat = new THREE.MeshStandardMaterial({
    color: '#9b4a44',
    roughness: 0.65,
    metalness: 0,
    side: THREE.DoubleSide,
    // the crease lies 0.2 mm above lips that start at 0 mm: without the offset
    // the two patches fight over the same depth and speckle
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const mouthW = h.rx * 0.30
  // the line between the lips: a shallow smile, its corners a hair higher
  const lineY = (u: number) => f.mouthY - 0.0012 * (1 - u * u)
  // both lips taper to nothing at the corners, so there is no visible edge
  const taper = (u: number, p: number) => Math.pow(Math.max(0, 1 - u * u), p)
  const upperH = (u: number) => (0.0048 - 0.0009 * Math.exp(-(u * u) / 0.018)) * taper(u, 0.60)
  const lowerH = (u: number) => 0.0076 * taper(u, 0.72)

  /** a band of the face between two height profiles, lifted a hair off the skin */
  const faceBand = (
    y0: (u: number) => number,
    y1: (u: number) => number,
    lift: number,
    rows: number,
  ): THREE.BufferGeometry => {
    const cols = 28
    const pos: number[] = []
    const idx: number[] = []
    for (let iy = 0; iy <= rows; iy++) {
      const v = iy / rows
      for (let ix = 0; ix <= cols; ix++) {
        const u = (ix / cols) * 2 - 1
        const x = h.cx + u * mouthW
        const y = y0(u) + (y1(u) - y0(u)) * v
        // the lift peaks in the middle of the band and dies at both edges
        const d = lift * Math.sin(Math.PI * v) ** 0.85 * taper(u, 0.45)
        pos.push(x, y, faceZ(h, f, x, y) + d)
      }
    }
    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const a = iy * (cols + 1) + ix
        idx.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }

  // lower lip first (bottom edge up to the line), then the upper (line up to
  // its edge): both are built in rising y, so normals face the viewer
  const lipLower = new THREE.Mesh(faceBand((u) => lineY(u) - lowerH(u), lineY, 0.0012, 6), lipMat)
  lipLower.name = 'galuhLipsLower'
  const lipUpper = new THREE.Mesh(faceBand(lineY, (u) => lineY(u) + upperH(u), 0.0008, 5), lipMat)
  lipUpper.name = 'galuhLipsUpper'
  // the crease: a darker hairline, flush with the skin under both lips
  const crease = new THREE.Mesh(
    faceBand((u) => lineY(u) - 0.00065, (u) => lineY(u) + 0.00065, 0.0002, 2),
    creaseMat,
  )
  crease.name = 'galuhMouthLine'
  group.add(lipLower, lipUpper, crease)

  /* ---- blush: a soft decal on each cheek ----------------------- */
  {
  const blushMat = new THREE.MeshBasicMaterial({
    map: blushTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.46,
    side: THREE.DoubleSide,
  })
  for (const s of [-1, 1] as const) {
    const cxp = h.cx + s * 0.048
    const cyp = f.mouthY + 0.013
    const R = 0.024
    const N = 8
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    for (let iy = 0; iy <= N; iy++) {
      for (let ix = 0; ix <= N; ix++) {
        const u = ix / N
        const v = iy / N
        const x = cxp + (u - 0.5) * 2 * R
        const y = cyp + (v - 0.5) * 2 * R
        pos.push(x, y, faceZ(h, f, x, y) + 0.0014)
        uv.push(u, v)
      }
    }
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const a = iy * (N + 1) + ix
        idx.push(a, a + 1, a + N + 1, a + 1, a + N + 2, a + N + 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, blushMat)
    m.renderOrder = 2
    group.add(m)
  }
  }

  /* ---- the hijab ----------------------------------------------- */
  const base = new THREE.Color(look.hijab ?? '#b3797e')
  const deep = base.clone().multiplyScalar(0.80).lerp(new THREE.Color('#6d4348'), 0.35)
  const clothMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(base).multiplyScalar(0.05),
    emissiveIntensity: 1,
  })
  const built = buildCloth(h, f, base, deep)
  group.add(new THREE.Mesh(built.cloth, clothMat))
  // the edge of the opening, rolled like a hemmed seam: a thin tube fixes the
  // boundary where the cloth crosses the skin and gives it real thickness
  if (built.rim.length > 8) {
    const edgeCurve = new THREE.CatmullRomCurve3(built.rim, false, 'centripetal')
    const edgeMat = new THREE.MeshStandardMaterial({
      color: base.clone().multiplyScalar(0.94),
      roughness: 0.95,
      metalness: 0,
    })
    group.add(new THREE.Mesh(new THREE.TubeGeometry(edgeCurve, built.rim.length * 2, 0.0020, 6, false), edgeMat))
  }
  if (built.hem.length > 3) {
    const curve = new THREE.CatmullRomCurve3(built.hem, true, 'centripetal')
    const hemMat = new THREE.MeshStandardMaterial({
      color: built.deep,
      roughness: 0.95,
      metalness: 0,
      emissive: built.deep.clone().multiplyScalar(0.04),
      emissiveIntensity: 1,
    })
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, built.hem.length, 0.0055, 6, true), hemMat))
  }

  return {
    group,
    lids: [{ mesh: lid, open: LID_OPEN, shut: LID_SHUT }],
  }
}

/* ------------------------------------------------------------------ *
 * sleeves: the pack's women wear a short-sleeve tee, so a cream long
 * sleeve is grown along each arm bone
 * ------------------------------------------------------------------ */

export function buildSleeves(rig: Rig, color: string): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = []
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0,
    emissive: new THREE.Color(color).multiplyScalar(0.10),
    emissiveIntensity: 1,
  })

  const along = (boneName: string, len: number, rTop: number, rBot: number) => {
    const bone = rig.bones[boneName]
    if (!bone) return
    const s = bone.getWorldScale(new THREE.Vector3()).x || 1
    const holder = new THREE.Group()
    holder.scale.setScalar(1 / s)
    bone.add(holder)
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 14, 1, true), mat)
    m.position.y = len * 0.5
    holder.add(m)
    meshes.push(holder)
  }

  for (const side of [-1, 1] as const) {
    // the arm flesh underneath is up to 30% thicker (human.ts VOLUME), so the
    // sleeve has to grow with it or the skin pokes through at the shoulder
    along(side < 0 ? BONES.armL : BONES.armR, rig.metrics.upperArm * 1.03, 0.061, 0.051)
    along(side < 0 ? BONES.foreL : BONES.foreR, rig.metrics.foreArm * 1.05, 0.050, 0.038)

    const elbow = rig.bones[side < 0 ? BONES.foreL : BONES.foreR]
    if (elbow) {
      const s = elbow.getWorldScale(new THREE.Vector3()).x || 1
      const holder = new THREE.Group()
      holder.scale.setScalar(1 / s)
      elbow.add(holder)
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 10), mat)
      holder.add(m)
      meshes.push(holder)
    }
  }
  return meshes
}
