import * as THREE from 'three'
import type { Look } from '../lib/agents'

/**
 * The Quaternius faces are pure low-poly: eyes are two black quads, there is no
 * mouth, and the nose is a wedge with no nostrils. This module adds the
 * features a reader expects to see in a portrait — eyeball with sclera, iris,
 * pupil and catchlight, lids that blink, nostrils, and lips — as small meshes
 * parented to the Head bone so they follow the animation.
 *
 * Everything is measured from the model's own eye quads and head bounding box,
 * so it lands on the face for both packs without per-model numbers.
 */

/** A lid that blinks: `open` and `shut` are rotations about the eye's X axis. */
export interface Lid {
  mesh: THREE.Mesh
  open: number
  shut: number
}

export interface FaceLandmarks {
  /** centre of the two eye quads, in model space */
  eyeY: number
  eyeZ: number
  /** distance from the centre to one eye */
  eyeX: number
  eyeW: number
  eyeH: number
  /** front of the face (nose tip) */
  faceZ: number
  chinY: number
  headTopY: number
  headW: number
  /** the head is not always centred on the root; this is its real x */
  headCenterX: number
  headCenterY: number
  headCenterZ: number
  /** measured surface depth at the mouth and at the nose base */
  mouthY: number
  mouthZ: number
  noseY: number
  noseZ: number
}

const SKIN = (color: string) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0 })

export function buildFace(look: Look, l: FaceLandmarks): { group: THREE.Group; lids: Lid[] } {
  const g = new THREE.Group()
  const lids: Lid[] = []
  const skin = SKIN(look.skin)
  const irisColor = new THREE.Color(look.hair).lerp(new THREE.Color('#5a3b22'), 0.55)
  // The sclera carries a little self-illumination: the room has one key light
  // from the side, and without it the eye in the shadow of the nose reads
  // narrower than its twin. Both eyes share these materials, so they always
  // read at the same brightness.
  const sclera = new THREE.MeshStandardMaterial({
    color: '#f3ece4',
    roughness: 0.28,
    metalness: 0,
    emissive: new THREE.Color('#f3ece4').multiplyScalar(0.38),
    emissiveIntensity: 1,
  })
  const iris = new THREE.MeshStandardMaterial({
    color: irisColor,
    roughness: 0.25,
    metalness: 0,
    emissive: new THREE.Color(irisColor).multiplyScalar(0.22),
    emissiveIntensity: 1,
  })
  const pupil = new THREE.MeshStandardMaterial({ color: '#140f0d', roughness: 0.2 })
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff' })
  const lash = new THREE.MeshStandardMaterial({ color: '#241713', roughness: 0.8 })
  const lip = new THREE.MeshStandardMaterial({
    color: new THREE.Color(look.skin).lerp(new THREE.Color('#7d3f3a'), 0.62),
    roughness: 0.55,
  })

  const eyeR = Math.min(0.0142, l.eyeW * 0.5)
  for (const s of [-1, 1]) {
    const cx = s * l.eyeX
    // eyeball: a squashed sphere, so the iris sits in a socket rather than on it
    const ball = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 20, 16), sclera)
    ball.position.set(cx, l.eyeY, l.eyeZ - eyeR * 0.30)
    ball.scale.set(1.0, 0.9, 0.55)
    g.add(ball)
    // iris and pupil caps grow along local +Y and are turned to +Z below, so
    // the ball's (x, y, z) squash maps to the cap's (x, z, y). Copying the
    // ball scale verbatim pushed the iris out of the socket and flattened it.
    const capScale = new THREE.Vector3(ball.scale.x, ball.scale.z, ball.scale.y)

    // iris and pupil are spherical caps on the eyeball, so they follow its
    // curvature instead of hovering in front of it
    const irisMesh = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 1.004, 22, 10, 0, Math.PI * 2, 0, 0.62), iris)
    irisMesh.position.copy(ball.position)
    irisMesh.scale.copy(capScale)
    irisMesh.rotation.x = Math.PI / 2
    g.add(irisMesh)

    const pupilMesh = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 1.008, 18, 8, 0, Math.PI * 2, 0, 0.3), pupil)
    pupilMesh.position.copy(ball.position)
    pupilMesh.scale.copy(capScale)
    pupilMesh.rotation.x = Math.PI / 2
    g.add(pupilMesh)

    const glintMesh = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.11, 8, 6), glint)
    // same corner of both eyes, the way one lamp lights a face: mirroring the
    // catchlight would make the two eyes disagree about where the light is
    glintMesh.position.set(cx - eyeR * 0.16, l.eyeY + eyeR * 0.18, ball.position.z + eyeR * 0.58)
    g.add(glintMesh)

    // upper lid: a skin cap that rolls down over the eyeball
    const lid = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 1.08, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), skin)
    lid.position.copy(ball.position)
    lid.scale.set(1.08, 1.0, 0.72)
    lid.rotation.x = -0.3
    g.add(lid)
    // legacy geometry closes by rotating further negative
    lids.push({ mesh: lid, open: -0.3, shut: -1.35 })

    // lash line: a half ring sitting on the upper lid edge. A half arc is
    // mirror-symmetric about the eye's own vertical axis, so both eyes get
    // byte-identical geometry, material and rotation — only the x offset
    // differs, which is the whole point of the pair.
    const lashLine = new THREE.Mesh(new THREE.TorusGeometry(eyeR * 0.96, eyeR * 0.06, 6, 24, Math.PI), lash)
    lashLine.position.set(cx, l.eyeY + eyeR * 0.16, ball.position.z + eyeR * 0.46)
    g.add(lashLine)
  }

  // nostrils: two dark dimples at the base of the nose wedge, on the measured
  // surface so they never float in front of the face
  const nostril = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.skin).multiplyScalar(0.42), roughness: 0.8 })
  for (const s of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), nostril)
    n.position.set(s * l.headW * 0.072, l.noseY, l.noseZ + 0.0015)
    n.scale.set(1.2, 0.5, 0.42)
    g.add(n)
  }

  // lips: two soft volumes and a mouth line, sunk 2 mm into the surface
  const mouthW = Math.min(0.058, l.headW * 0.32)
  const z = l.mouthZ
  const upper = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), lip)
  upper.position.set(0, l.mouthY + 0.0045, z + 0.0035)
  upper.scale.set(mouthW * 0.5, 0.0068, 0.007)
  g.add(upper)

  const lower = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), lip)
  lower.position.set(0, l.mouthY - 0.006, z + 0.003)
  lower.scale.set(mouthW * 0.44, 0.0082, 0.008)
  g.add(lower)

  const line = new THREE.Mesh(
    new THREE.BoxGeometry(mouthW * 0.82, 0.0022, 0.0022),
    new THREE.MeshStandardMaterial({ color: '#4a2a26', roughness: 0.7 }),
  )
  line.position.set(0, l.mouthY - 0.0012, z + 0.0062)
  g.add(line)

  return { group: g, lids }
}
