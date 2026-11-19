import * as THREE from 'three'
import type { Look } from '../lib/agents'
import type { FaceLandmarks, Lid } from './face'

/**
 * Ndoro Kakung's head, built from scratch instead of painted onto the
 * Quaternius skull. The pack's head is a wide, flat cartoon skull whose skin
 * mesh sits 14 mm off the neck axis, so every feature laid on top of it read
 * slightly wrong. Here the head, the face and the hair all come from ONE
 * ellipsoid: the hair is that surface pushed out by a few millimetres down to a
 * hairline that is high over the brow and low at the nape, and the face is
 * sculpted relief on the skull itself. There is no separate shell with a hole
 * in it, so the hairline and the ears can never show a sliver of skin.
 *
 * The head is male: squarer jaw, thicker brows, a short crop instead of the
 * hijab the file used to build, and a jaw that sits down at the shirt collar so
 * the neck stays short. The eye and mouth construction fixed in #21/#22 is
 * untouched — same lids, same lash, same two symmetric lip bands — only the
 * identity around it changed.
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

/**
 * The pack's skull is a shade over a fifth of the body, which reads as a mascot
 * next to a 1.7 m suit. GROW fills that head out: the top stays where the pack
 * put it, so the extra height goes into the jaw, and the chin ends up 2 cm lower
 * — right at the shirt collar, which is what keeps the neck short.
 */
const GROW = 1.14

/** how far the jaw is sunk into the shirt collar (model space) */
const DROP = 0.022

function headShape(l: FaceLandmarks): HeadShape {
  const k = THREE.MathUtils.clamp(l.headW / 0.187, 0.85, 1.15) * GROW
  return {
    cx: l.headCenterX,
    cy: l.headTopY - 0.085 * k - DROP,
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
  return { x: 1 - 0.19 * Math.pow(t, 1.8), z: 1 - 0.14 * Math.pow(t, 1.95) }
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
  d += 0.0068 * G(x, 0.020) * G(y + h.ryDown - 0.020, 0.016)
  // jaw corners: the one thing a round cartoon skull never has
  d += 0.0034 * (G(x - 0.046, 0.014) + G(x + 0.046, 0.014)) * G(y + h.ryDown - 0.052, 0.016)

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

/* ------------------------------------------------------------------ *
 * hair: a short crop, the skull pushed out to a hairline
 * ------------------------------------------------------------------ */

/** how far the hair floats off the skull where it is thickest */
const HAIR = 0.0064

/**
 * Hairline height at theta (0 = front, PI = back): high over the forehead,
 * dropping past the temples to just above the eye, lowest at the nape. That is
 * the profile of a short crop, and it keeps the brow, the eyes and the ears
 * clear, so the face still reads at dashboard distance.
 */
function hairlineY(h: HeadShape, f: Features, theta: number): number {
  const c = Math.cos(theta)
  const front = f.browY + 0.030
  const temple = f.eyeY + 0.026
  const nape = h.cy - h.ryDown * 0.58
  const wf = Math.pow(Math.max(0, c), 1.6)
  const wb = Math.pow(Math.max(0, -c), 1.1)
  return temple + (front - temple) * wf + (nape - temple) * wb
}

/**
 * The crop itself: rows from the crown down to the hairline, each column
 * stopping at its own height. Thickness tapers to nothing exactly on the last
 * row, so the edge meets skin instead of floating above it, and the crown keeps
 * a few millimetres of lift even at the pole (a shell that starts at the skull
 * would let the scalp poke through the parting).
 */
function buildHair(h: HeadShape, f: Features, base: THREE.Color, deep: THREE.Color): {
  hair: THREE.BufferGeometry
  hem: THREE.Vector3[]
} {
  const SEG = 144
  const ROWS = 30
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  const hem: THREE.Vector3[] = []
  const tmp = new THREE.Color()

  // crest: extra lift over the crown, biased to the front, so the crop has a
  // mass instead of reading as a painted-on cap
  const crest = (theta: number, t: number) =>
    0.0068 * Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.90)) ** 0.8 *
    (0.58 + 0.42 * Math.cos(theta - 0.30) ** 2)
  // clumps: broad shallow waves; a smooth shell would read as a moulded dome
  const clump = (theta: number, t: number) =>
    (Math.cos(7 * theta + 1.1) * 0.62 + Math.cos(11 * theta - 0.4) * 0.38) * 0.0018 *
    THREE.MathUtils.smoothstep(t, 0.18, 1.0)
  // a combed side part: a shallow groove running from the hairline to the crown
  const part = (theta: number, t: number) =>
    -0.0044 * Math.exp(-((theta - 0.62) ** 2) / 0.045) * THREE.MathUtils.smoothstep(t, 0.04, 0.55)

  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS
    // full thickness over the skull, tapering to nothing at the hairline
    const edge = 1 - THREE.MathUtils.smoothstep(t, 0.84, 1.0)
    for (let s = 0; s <= SEG; s++) {
      const theta = (s / SEG) * Math.PI * 2
      const yHem = hairlineY(h, f, theta)
      const ryHem = yHem > h.cy ? h.ryUp : h.ryDown
      const phiHem = Math.acos(THREE.MathUtils.clamp((yHem - h.cy) / ryHem, -1, 1))
      const phi = 0.02 + (phiHem - 0.02) * Math.pow(t, 0.92)
      skullPoint(h, theta, phi, p)
      skullNormal(h, p, n)
      p.addScaledVector(n, (HAIR + crest(theta, t) + clump(theta, t) + part(theta, t)) * edge)
      if (r === ROWS) hem.push(p.clone())
      pos.push(p.x, p.y, p.z)
      // shading: the crown catches the key light, the sides and the hairline sit
      // a stop deeper, which is what makes it read as hair rather than felt
      const k = 0.92 + 0.30 * (1 - t) - 0.10 * Math.pow(Math.abs(Math.sin(theta)), 2)
      tmp.copy(base).multiplyScalar(THREE.MathUtils.clamp(k, 0.55, 1.35))
      tmp.lerp(deep, 0.35 * THREE.MathUtils.smoothstep(t, 0.7, 1.0))
      col.push(tmp.r, tmp.g, tmp.b)
    }
  }
  const stride = SEG + 1
  for (let r = 0; r < ROWS; r++) {
    for (let s = 0; s < SEG; s++) {
      const a = r * stride + s
      const b = a + 1
      const c = a + stride
      const d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  const hair = new THREE.BufferGeometry()
  hair.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  hair.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  hair.setIndex(idx)
  hair.computeVertexNormals()
  // weld the seam: column 0 and column SEG are the same place
  const nor = hair.getAttribute('normal') as THREE.BufferAttribute
  for (let r = 0; r <= ROWS; r++) {
    const a = r * stride
    const b = a + SEG
    const nx = (nor.getX(a) + nor.getX(b)) * 0.5
    const ny = (nor.getY(a) + nor.getY(b)) * 0.5
    const nz = (nor.getZ(a) + nor.getZ(b)) * 0.5
    const l = Math.hypot(nx, ny, nz) || 1
    nor.setXYZ(a, nx / l, ny / l, nz / l)
    nor.setXYZ(b, nx / l, ny / l, nz / l)
  }
  return { hair, hem }
}

/* ------------------------------------------------------------------ *
 * the face
 * ------------------------------------------------------------------ */

export interface StylizedHead {
  group: THREE.Group
  lids: Lid[]
}

export function buildNdoroHead(look: Look, l: FaceLandmarks): StylizedHead {
  const h = headShape(l)
  const f = features(h)
  const group = new THREE.Group()
  group.name = 'ndoroHead'

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
  skullMesh.name = 'ndoroSkull'
  group.add(skullMesh)

  /* ---- neck stub: never a hole under the jaw -------------------- */
  {
    // narrow at the top: a wide stub surfaces at the jaw line as a skin lobe
    // that pokes out under the jaw
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.034, 0.050, 20, 1, true), skin)
    m.position.set(h.cx, f.chinY - 0.012, h.cz - 0.012)
    group.add(m)
  }

  /* ---- eyes ---------------------------------------------------- */
  const eyeR = h.rx * 0.190
  const eyeZ = faceZ(h, f, h.cx + f.eyeSep, f.eyeY)
  const eyeScale = new THREE.Vector3(1, 0.78, 0.6)
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
      const ny = f.mouthY + 0.0150
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
      wid.push(0.0031 + 0.0046 * Math.sin(Math.PI * Math.min(1, t * 1.02)))
    }
    browParts.push({ g: ribbon(pts, wid, new THREE.Vector3(0, 1, 0)), m: new THREE.Matrix4() })
  }
  group.add(new THREE.Mesh(mergeParts(browParts), browMat))

  /* ---- moustache: the one cue that settles "man" at a glance ---- */
  if (look.mustache) {
    const pts: THREE.Vector3[] = []
    const wid: number[] = []
    const N = 28
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * 2 - 1 // -1 .. 1 across the lip
      const x = h.cx + u * 0.033
      // one continuous band: full under the nose, drooping and tapering outwards
      const y = f.mouthY + 0.0100 - Math.abs(u) * 0.0014 - Math.pow(Math.abs(u), 2.6) * 0.0038
      pts.push(new THREE.Vector3(x, y, faceZ(h, f, x, y) + 0.0017))
      wid.push(0.0040 * Math.pow(Math.max(0, 1 - u * u), 0.35) + 0.0011)
    }
    const stache = new THREE.Mesh(ribbon(pts, wid, new THREE.Vector3(0, 1, 0)), browMat)
    stache.name = 'ndoroMustache'
    group.add(stache)
  }

  /* ---- lips ----------------------------------------------------
   * The lips are a patch laid ON the face surface, not two volumes stuck in
   * front of it: every vertex is placed at faceZ(x, y) plus at most 1.6 mm, so
   * from the side the mouth can never break the profile, and the two halves are
   * generated from the same |u| profile, so they are symmetric by construction.
   * The shape is a painter's mouth: thin upper lip with a soft cupid's bow, a
   * fuller lower lip, and a hairline crease where they meet.
   */
  const lipColor = new THREE.Color(look.skin).lerp(new THREE.Color('#8a4941'), 0.58)
  const lipMat = new THREE.MeshStandardMaterial({
    color: lipColor,
    roughness: 0.46,
    metalness: 0,
    side: THREE.DoubleSide,
    emissive: lipColor.clone().multiplyScalar(0.07),
    emissiveIntensity: 1,
  })
  const creaseMat = new THREE.MeshStandardMaterial({
    color: lipColor.clone().multiplyScalar(0.78),
    roughness: 0.65,
    metalness: 0,
    side: THREE.DoubleSide,
    // the crease lies 0.2 mm above lips that start at 0 mm: without the offset
    // the two patches fight over the same depth and speckle
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const mouthW = h.rx * 0.335
  // the line between the lips: a shallow smile, its corners a hair higher
  const lineY = (u: number) => f.mouthY - 0.0012 * (1 - u * u)
  // both lips taper to nothing at the corners, so there is no visible edge
  const taper = (u: number, p: number) => Math.pow(Math.max(0, 1 - u * u), p)
  const upperH = (u: number) => (0.0040 - 0.0008 * Math.exp(-(u * u) / 0.018)) * taper(u, 0.60)
  const lowerH = (u: number) => 0.0064 * taper(u, 0.72)

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
  lipLower.name = 'ndoroLipsLower'
  const lipUpper = new THREE.Mesh(faceBand(lineY, (u) => lineY(u) + upperH(u), 0.0008, 5), lipMat)
  lipUpper.name = 'ndoroLipsUpper'
  // the crease: a darker hairline, flush with the skin under both lips
  const crease = new THREE.Mesh(
    faceBand((u) => lineY(u) - 0.00065, (u) => lineY(u) + 0.00065, 0.0002, 2),
    creaseMat,
  )
  crease.name = 'ndoroMouthLine'
  group.add(lipLower, lipUpper, crease)

  /* ---- ears: a short crop leaves them in view ------------------ */
  {
    for (const s of [-1, 1] as const) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.017, 18, 14), skin)
      ear.position.set(h.cx + s * h.rx * 0.985, f.eyeY - 0.002, h.cz - 0.004)
      ear.scale.set(0.50, 1.10, 0.82)
      ear.rotation.y = -s * 0.22
      group.add(ear)
    }
  }

  /* ---- hair ---------------------------------------------------- */
  const base = new THREE.Color(look.hair)
  const deep = base.clone().multiplyScalar(0.62).lerp(new THREE.Color('#120d0a'), 0.30)
  const hairMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
    emissive: base.clone().multiplyScalar(0.04),
    emissiveIntensity: 1,
  })
  const built = buildHair(h, f, base, deep)
  const hairMesh = new THREE.Mesh(built.hair, hairMat)
  hairMesh.name = 'ndoroHair'
  group.add(hairMesh)

  return {
    group,
    lids: [{ mesh: lid, open: LID_OPEN, shut: LID_SHUT }],
  }
}
