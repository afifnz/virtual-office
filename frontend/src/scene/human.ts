import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Look } from '../lib/agents'
import type { FaceLandmarks } from './face'
import { addOutline, smoothGeometry, toToon } from './toon'

/**
 * Quaternius "Ultimate Modular" humans, CC0 1.0.
 *
 * The women's pack ships as .glb; the men's pack ships as .gltf with the
 * buffer inlined as base64, so it was repacked to .glb byte-for-byte (see
 * public/models/LICENSE-quaternius.txt). Both packs share one 62-bone rig and
 * the same 24 clips, so one pose/retarget layer serves every model.
 */

export type HumanModel =
  | 'men-suit'
  | 'men-casual'
  | 'men-hoodie'
  | 'women-casual'
  | 'women-formal'

export const MODEL_URL: Record<HumanModel, string> = {
  'men-suit': '/models/men-suit.glb',
  'men-casual': '/models/men-casual.glb',
  'men-hoodie': '/models/men-hoodie.glb',
  'women-casual': '/models/women-casual.glb',
  'women-formal': '/models/women-formal.glb',
}

/** Which body each agent wears. Keyed by the profile id in lib/agents.ts. */
export const MODEL_FOR_AGENT: Record<string, HumanModel> = {
  default: 'men-suit',
  dev: 'men-suit',
  planner: 'men-casual',
  uiux: 'women-formal',
  coder: 'men-hoodie',
  reviewer: 'men-suit',
  tester: 'women-casual',
  edu: 'women-formal',
  'edu-designer': 'women-casual',
  'edu-writer': 'men-casual',
  'edu-reviewer': 'men-hoodie',
}

export function modelForAgent(id: string): HumanModel {
  return MODEL_FOR_AGENT[id] ?? 'men-casual'
}

/* ------------------------------------------------------------------ *
 * materials: one palette role per material name, per pack
 * ------------------------------------------------------------------ */

type Role = 'skin' | 'skinDark' | 'hair' | 'brow' | 'eye' | 'shirt' | 'pants' | 'shoes' | 'trim' | 'accent'

const ROLES: Record<HumanModel, Record<string, Role>> = {
  'men-suit': {
    Skin: 'skin',
    Hair: 'hair',
    Eyebrows: 'brow',
    Eye: 'eye',
    Suit: 'shirt',
    Tie: 'accent',
    White: 'trim',
    DarkBrown: 'shoes',
    Grey: 'shoes',
    Black: 'shoes',
  },
  'men-casual': {
    Skin: 'skin',
    'Skin_Darker': 'skinDark',
    Hair: 'hair',
    Eyebrows: 'brow',
    Eye: 'eye',
    LightBrown: 'shirt',
    White: 'trim',
    Red_Dark: 'shoes',
    LightBlue: 'pants',
  },
  'men-hoodie': {
    Skin: 'skin',
    Hair: 'hair',
    Eyebrows: 'brow',
    Eye: 'eye',
    Purple: 'shirt',
    White: 'trim',
    LightBlue: 'pants',
  },
  'women-casual': {
    Skin: 'skin',
    'Hair_Blond': 'hair',
    'Hair_Brown': 'brow',
    Brown: 'eye',
    White: 'shirt',
    Grey: 'shoes',
    Orange: 'pants',
  },
  'women-formal': {
    Skin: 'skin',
    Red: 'hair',
    Brown: 'eye',
    LimeGreen: 'shirt',
    Gold: 'accent',
    'Formal_Feet/Red': 'shoes',
  },
}

/** Roles whose meshes are hair (hidden under the sculpted head). */
const HAIR_ROLES: ReadonlySet<Role> = new Set(['hair'])

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex)
  return '#' + c.multiplyScalar(k).getHexString()
}

function mixHex(a: string, b: string, t: number): string {
  const c = new THREE.Color(a).lerp(new THREE.Color(b), t)
  return '#' + c.getHexString()
}

function roleColor(role: Role, look: Look): string {
  switch (role) {
    case 'skin':
      return look.skin
    case 'skinDark':
      return shade(look.skin, 0.9)
    case 'hair':
      return look.hair
    case 'brow':
      return mixHex(look.hair, '#241a17', 0.4)
    case 'eye':
      return '#2b1f1a'
    case 'shirt':
      // a touch lighter than the authored colour: at dashboard distance the
      // torso has to separate from the teak desk and the dark rattan chair
      return mixHex(look.shirt, '#ffffff', 0.14)
    case 'pants':
      return mixHex(look.pants, '#ffffff', 0.08)
    case 'shoes':
      return shade(look.pants, 0.55)
    case 'trim':
      return shade(look.shirt, 0.82)
    case 'accent':
      return look.accent
  }
}

/**
 * A whisper of self-illumination per role. The office lights are warm and low;
 * without this the darker outfits vanish into the chair back at overview scale.
 * Kept small enough that the figure still reads as lit, not glowing.
 */
const GLOW: Record<Role, number> = {
  skin: 0.05,
  skinDark: 0.04,
  hair: 0.02,
  brow: 0.02,
  eye: 0.0,
  shirt: 0.13,
  pants: 0.09,
  shoes: 0.03,
  trim: 0.1,
  accent: 0.1,
}

/** Bone names shared by both packs (the men's and women's rigs match). */
export const BONES = {
  hips: 'Hips',
  abdomen: 'Abdomen',
  chest: 'Chest',
  neck: 'Neck',
  head: 'Head',
  armL: 'UpperArmL',
  armR: 'UpperArmR',
  foreL: 'LowerArmL',
  foreR: 'LowerArmR',
  wristL: 'WristL',
  wristR: 'WristR',
  thighL: 'UpperLegL',
  thighR: 'UpperLegR',
  shinL: 'LowerLegL',
  shinR: 'LowerLegR',
} as const

/** three.js strips dots from glTF node names ("UpperArm.L" → "UpperArmL"). */
function normBone(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '')
}

interface FootRest {
  bone: THREE.Bone
  shin: THREE.Bone
  /** ankle position in the shin's local frame, so it can follow the knee */
  offset: THREE.Vector3
  restPos: THREE.Vector3
  restWorldQuat: THREE.Quaternion
}

export interface Rig {
  /** the cloned glTF scene, already rotated to face -Z and scaled to 1.7 m */
  root: THREE.Group
  bones: Record<string, THREE.Bone>
  rest: Map<string, THREE.Quaternion>
  eyeMeshes: THREE.Mesh[]
  hairMeshes: THREE.Mesh[]
  headSkinMeshes: THREE.Mesh[]
  /** every pack mesh that lives above the collar: brows, eye quads, hair, skull */
  headMeshes: THREE.Mesh[]
  feet: FootRest[]
  /** face measurements in model space, used by the face/head/glasses builders */
  landmarks: FaceLandmarks
  /** model space → head-bone space, captured at rest */
  headMountMatrix: THREE.Matrix4
  height: number
  /** measured joint lengths and the seat geometry derived from them */
  metrics: RigMetrics
}

/**
 * Everything the seated pose needs, measured from the model itself: the packs
 * normalise to 1.7 m but their legs differ, so a single hard-coded hip drop
 * leaves one body floating above the chair and the next sunk into it.
 */
export interface RigMetrics {
  thigh: number
  shin: number
  upperArm: number
  foreArm: number
  /** hip joint height in the bind pose, above the floor */
  hipBindY: number
  /** hip joint height once seated (chair seat + pelvis) */
  hipY: number
  /** how far the body group sinks so the hips land on the seat */
  seatDrop: number
  headTopY: number
  /** head height in model space, for proportion checks */
  headH: number
}

/** A world-space box re-expressed in an object's local space. */
function boxInRoot(b: THREE.Box3, root: THREE.Object3D): THREE.Box3 {
  const out = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
    out.expandByPoint(root.worldToLocal(v.clone()))
  }
  return out
}

/**
 * Deep-clone a loaded glTF for one agent: geometry is shared, the skeleton and
 * every material are not (SkeletonUtils.clone rebuilds the bone graph, so two
 * agents can never drive the same bones).
 */
export function instantiate(source: THREE.Object3D, look: Look, model: HumanModel): Rig {
  const root = skeletonClone(source) as THREE.Group

  // The pack is a shooter kit: men-suit carries a Pistol node in the right
  // hand. Nobody in this office is armed — drop every prop before measuring,
  // so it can neither show nor skew the height/landmark boxes.
  const props: THREE.Object3D[] = []
  root.traverse((o) => {
    if (WEAPON.test(o.name) && !(o as THREE.Bone).isBone) props.push(o)
  })
  for (const o of props) o.parent?.remove(o)

  const roles = ROLES[model]
  const eyeMeshes: THREE.Mesh[] = []
  const hairMeshes: THREE.Mesh[] = []
  const skinMeshes: THREE.Mesh[] = []

  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    const name = mat?.name ?? ''
    const role = roles[`${mesh.name}/${name}`] ?? roles[name]
    const clone = mat.clone()
    clone.metalness = 0
    clone.roughness = role === 'skin' || role === 'skinDark' ? 0.62 : 0.78
    if (role) {
      clone.color.set(roleColor(role, look))
      clone.emissive = new THREE.Color(roleColor(role, look)).multiplyScalar(GLOW[role])
      clone.emissiveIntensity = 1
    }
    mesh.material = clone
    mesh.userData.role = role
    if (role === 'eye') eyeMeshes.push(mesh)
    if (role === 'skin') skinMeshes.push(mesh)
    if (role && HAIR_ROLES.has(role)) hairMeshes.push(mesh)
    mesh.castShadow = false
    mesh.receiveShadow = false
  })

  // rest pose, captured before any mixer touches the bones
  const rest = new Map<string, THREE.Quaternion>()
  const bones: Record<string, THREE.Bone> = {}
  root.traverse((o) => {
    const b = o as THREE.Bone
    if (!b.isBone) return
    rest.set(b.name, b.quaternion.clone())
    const key = normBone(b.name)
    if (BONE_LOOKUP.has(key)) bones[key] = b
  })

  /**
   * A wider frame. Inflating the skin thickens a limb but leaves the shoulder
   * and hip joints where the pack put them, so the figure only gets deeper, not
   * broader. Nudging the two top joints of each limb outwards widens the
   * shoulder line and the stance; the pose solver aims from the joints, so the
   * hands still land on the keys and the feet on the floor.
   */
  const spread = (bone: THREE.Bone | undefined, dx: number) => {
    const parent = bone?.parent
    if (!bone || !parent) return
    parent.updateWorldMatrix(true, false)
    const at = bone.getWorldPosition(new THREE.Vector3())
    at.x += dx
    bone.position.copy(parent.worldToLocal(at))
  }
  spread(bones[BONES.armL], SHOULDER_SPREAD)
  spread(bones[BONES.armR], -SHOULDER_SPREAD)
  spread(bones[BONES.thighL], HIP_SPREAD)
  spread(bones[BONES.thighR], -HIP_SPREAD)

  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const height = box.max.y - box.min.y
  const scale = 1.7 / height
  root.scale.setScalar(scale)
  root.position.y = -box.min.y * scale
  // the pack is authored facing +Z; the office faces its agents toward -Z
  root.rotation.y = Math.PI

  root.updateMatrixWorld(true)
  // the head skin is the skin mesh that reaches highest; the body skin also
  // reaches into the neck, so only meshes that start above 80% of the body
  // height count as head
  const skinBoxes = skinMeshes.map((m) => ({ m, b: new THREE.Box3().setFromObject(m) }))
  const top = skinBoxes.reduce((a, b) => (b.b.max.y > a.b.max.y ? b : a), skinBoxes[0]!)
  const headSkinMeshes = top
    ? [top.m, ...skinBoxes.filter((x) => x !== top && x.b.min.y > box.max.y * 0.8).map((x) => x.m)]
    : []

  // everything above the collar. The stylized head replaces all of it, so the
  // pack's own eyebrow quads and eye rectangles have to go too, not just the
  // skull and the hair.
  const headMeshes: THREE.Mesh[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const b = boxInRoot(new THREE.Box3().setFromObject(mesh), root)
    if (b.min.y > box.max.y * 0.8) headMeshes.push(mesh)
  })

  // face landmarks, measured in model space (root-local, +Z = facing)
  const headBox = new THREE.Box3()
  for (const m of headSkinMeshes) headBox.union(boxInRoot(new THREE.Box3().setFromObject(m), root))
  const eyeBox = new THREE.Box3()
  for (const m of eyeMeshes) eyeBox.union(boxInRoot(new THREE.Box3().setFromObject(m), root))
  const eyeSize = eyeBox.getSize(new THREE.Vector3())
  const eyeCenter = eyeBox.getCenter(new THREE.Vector3())

  // head skin vertices in model space: used to find the real surface depth at
  // the mouth and nose instead of guessing an offset from the nose tip
  const verts: THREE.Vector3[] = []
  for (const m of headSkinMeshes) {
    const pos = m.geometry.attributes.position
    if (!pos) continue
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i)
      verts.push(root.worldToLocal(m.localToWorld(v.clone())))
    }
  }
  const surfaceZ = (y: number, halfX: number, tol = 0.012): number => {
    let best = -Infinity
    for (const v of verts) {
      if (Math.abs(v.y - y) > tol || Math.abs(v.x) > halfX) continue
      if (v.z > best) best = v.z
    }
    return Number.isFinite(best) ? best : headBox.max.z - 0.02
  }
  const mouthY = eyeCenter.y - 0.108
  const noseY = eyeCenter.y - 0.07

  const landmarks: FaceLandmarks = {
    eyeY: eyeCenter.y,
    eyeZ: eyeBox.max.z,
    eyeX: Math.max(0.03, eyeSize.x * 0.24),
    eyeW: Math.max(0.02, eyeSize.x * 0.42),
    eyeH: Math.max(0.012, eyeSize.y),
    faceZ: headBox.max.z,
    chinY: headBox.min.y,
    headTopY: headBox.max.y,
    headW: headBox.max.x - headBox.min.x,
    headCenterX: (headBox.max.x + headBox.min.x) / 2,
    headCenterY: (headBox.max.y + headBox.min.y) / 2,
    headCenterZ: (headBox.max.z + headBox.min.z) / 2,
    mouthY,
    mouthZ: surfaceZ(mouthY, 0.02),
    noseY,
    noseZ: surfaceZ(noseY, 0.012, 0.008),
  }

  // face/head/glasses are authored in model space and mounted on the head
  // bone through this fixed matrix, so they ride the animation exactly
  const head = bones[BONES.head]
  const headMountMatrix = new THREE.Matrix4()
  if (head) {
    headMountMatrix.copy(head.matrixWorld).invert().multiply(root.matrixWorld)
  }

  // The pack's heads are a shade over a fifth of the body, which reads as a
  // mascot at dashboard distance. Shrink the head bone a little: the skull,
  // the face overlay and the hair all scale about the same joint, so the
  // neck seam stays put. Applied only after headMountMatrix is captured, so
  // the model-space mount inherits the new scale instead of cancelling it.
  if (head) head.scale.setScalar(HEAD_SCALE)

  const dist = (a?: THREE.Object3D, b?: THREE.Object3D): number => {
    if (!a || !b) return 0
    return a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()))
  }

  const thighBone = bones[BONES.thighL]
  const kneeBone = bones[BONES.shinL]
  const footBone = root.getObjectByName('FootL') as THREE.Bone | undefined
  const elbowBone = bones[BONES.foreL]
  const wristBone = bones[BONES.wristL]

  const thigh = dist(thighBone, kneeBone) || 0.45
  const shin = dist(kneeBone, footBone) || 0.46
  const hipBindY = thighBone ? thighBone.getWorldPosition(new THREE.Vector3()).y : 0.95

  // how far the sole hangs below the ankle joint: the seated ankle target has
  // to include it or the shoes hover over the floor. The packs name their
  // meshes differently (Cube204 in the men's pack), so measure the whole body
  // in the bind pose instead of hunting for a "feet" mesh: it stands on y = 0.
  const ankleBindY = footBone ? footBone.getWorldPosition(new THREE.Vector3()).y : 0.012
  const soleDrop = Math.max(0, ankleBindY)

  // shin straight down puts the sole on the floor with the knee at 90 degrees;
  // never drop the hips so far that the pelvis sinks into the chair
  const hipY = Math.max(SIT.minHipY, SIT.ankleY + soleDrop + shin)

  const metrics: RigMetrics = {
    thigh,
    shin,
    upperArm: dist(bones[BONES.armL], elbowBone) || 0.2,
    foreArm: dist(elbowBone, wristBone) || 0.22,
    hipBindY,
    hipY,
    seatDrop: hipBindY - hipY,
    headTopY: headBox.max.y,
    headH: headBox.max.y - headBox.min.y,
  }
  // read back by verify/pose_check.py; no runtime cost
  root.userData.metrics = metrics

  const feet: FootRest[] = []
  for (const [shinName, footName] of [
    [BONES.shinL, 'FootL'],
    [BONES.shinR, 'FootR'],
  ] as const) {
    const shin = bones[shinName]
    const foot = root.getObjectByName(footName) as THREE.Bone | undefined
    if (!shin || !foot) continue
    const world = foot.getWorldPosition(new THREE.Vector3())
    feet.push({
      bone: foot,
      shin,
      offset: shin.worldToLocal(world.clone()),
      restPos: foot.position.clone(),
      restWorldQuat: foot.getWorldQuaternion(new THREE.Quaternion()),
    })
  }

  // ---- smooth 2D look: welded normals, soft toon ramp, thin ink outline.
  // Done last so every measurement above sees the pack's own geometry.
  root.updateMatrixWorld(true)
  const packMeshes: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) packMeshes.push(o as THREE.Mesh)
  })
  const ws = new THREE.Vector3()
  for (const mesh of packMeshes) {
    mesh.geometry = smoothGeometry(mesh.geometry)
    // then give the body its volume, before the outline is grown from the normals
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.geometry = fullerGeometry(mesh as THREE.SkinnedMesh)
    const old = mesh.material as THREE.Material
    mesh.material = toToon(old)
    if (mesh.material !== old) old.dispose()
    const role = mesh.userData.role as Role | undefined
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh && role !== 'eye' && role !== 'brow') {
      mesh.getWorldScale(ws)
      addOutline(mesh as THREE.SkinnedMesh, OUTLINE_M / Math.max(1e-6, ws.x))
    }
  }

  return {
    root,
    bones,
    rest,
    eyeMeshes,
    hairMeshes,
    headSkinMeshes,
    headMeshes,
    feet,
    landmarks,
    headMountMatrix,
    height: 1.7,
    metrics,
  }
}

/**
 * How much fuller each bone's flesh is than the pack's own (1 = untouched).
 * The packs are authored as skinny mannequins: at dashboard distance the
 * shoulders read narrower than the head and the forearms are sticks. Adding
 * volume to the *skin* rather than to the bones keeps every joint where the
 * pose solver put it — hands still land on the keys, feet still on the floor.
 */
const VOLUME: ReadonlyArray<readonly [RegExp, number]> = [
  [/^hips$/i, 1.24],
  [/^abdomen$/i, 1.23],
  [/^torso$/i, 1.23],
  [/^chest$/i, 1.23],
  [/^shoulder[lr]$/i, 1.3],
  [/^upperarm[lr]$/i, 1.3],
  [/^lowerarm[lr]$/i, 1.24],
  [/^upperleg[lr]$/i, 1.22],
  [/^lowerleg[lr]$/i, 1.22],
  [/^foot[lr]$/i, 1.1],
]

function volumeFor(bone: string): number {
  const name = normBone(bone)
  for (const [re, k] of VOLUME) if (re.test(name)) return k
  return 1
}

const fullerCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()

/**
 * Push every vertex away from the bone it is weighted to, perpendicular to
 * that bone's own axis. A limb gets thicker around its bone, the torso gets
 * wider and deeper, and no bone gets longer: vertex offsets along the bone are
 * left alone, so rig lengths, the seated IK and the floor contact are all
 * unaffected. Weights are blended per vertex, so joints stay smooth.
 *
 * The result is cached per source geometry: every clone of a pack shares its
 * geometry, and boneInverses (the bind pose) are identical for all of them.
 */
function fullerGeometry(mesh: THREE.SkinnedMesh): THREE.BufferGeometry {
  const src = mesh.geometry
  const hit = fullerCache.get(src)
  if (hit) return hit
  const g = src.clone()
  const skel = mesh.skeleton
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const sw = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  if (!pos || !si || !sw || !skel) return src

  const n = skel.bones.length
  const pivot: THREE.Vector3[] = []
  const axis: THREE.Vector3[] = []
  const k: number[] = []
  const bind = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  for (let i = 0; i < n; i++) {
    // boneInverses are the inverse bind matrices, so inverting them gives the
    // bone's own place in the geometry's bind space
    bind.copy(skel.boneInverses[i]!).invert()
    pivot.push(new THREE.Vector3().setFromMatrixPosition(bind))
    q.setFromRotationMatrix(bind)
    axis.push(new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize())
    k.push(volumeFor(skel.bones[i]!.name))
  }

  const v = new THREE.Vector3()
  const out = new THREE.Vector3()
  const o = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    let wsum = 0
    out.set(0, 0, 0)
    for (let j = 0; j < 4; j++) {
      const w = sw.getComponent(i, j)
      if (w <= 0) continue
      const b = si.getComponent(i, j)
      const kk = k[b] ?? 1
      // the part of the offset that runs along the bone is kept as it is;
      // the rest grows by kk around the bone
      o.copy(v).sub(pivot[b]!)
      const par = o.dot(axis[b]!)
      o.addScaledVector(axis[b]!, -par).multiplyScalar(kk).addScaledVector(axis[b]!, par)
      out.addScaledVector(o, w).addScaledVector(pivot[b]!, w)
      wsum += w
    }
    if (wsum > 0) out.divideScalar(wsum)
    else out.copy(v)
    pos.setXYZ(i, out.x, out.y, out.z)
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  g.computeBoundingSphere()
  fullerCache.set(src, g)
  return g
}

/** How far the shoulder joints move outwards, in model metres. */
const SHOULDER_SPREAD = 0.013
/** ... and the hip joints, so the stance is not a pair of sticks. */
const HIP_SPREAD = 0.007

/** Props the pack ships on its characters that an office has no use for. */
const WEAPON = /pistol|gun|rifle|sword|knife|weapon/i

/** Ink outline width in metres per metre of camera distance (~1.5 px at 55° fov). */
const OUTLINE_M = 0.0022

const BONE_LOOKUP: ReadonlySet<string> = new Set(Object.values(BONES))

/* ------------------------------------------------------------------ *
 * posing: the packs have no Sit / Type clip, so the seated pose is
 * solved against the furniture instead of guessed with bone angles.
 * Every joint is aimed at a point derived from the chair seat, the
 * floor and the keyboard, which keeps the two legs symmetric and makes
 * the result checkable numerically (see verify/pose_check.py).
 * ------------------------------------------------------------------ */

const _axis = new THREE.Vector3()
const _pq = new THREE.Quaternion()
const _dq = new THREE.Quaternion()
const _target = new THREE.Quaternion()
const _mq = new THREE.Quaternion()
const MODEL_X = new THREE.Vector3(1, 0, 0)
const UP = new THREE.Vector3(0, 1, 0)

/**
 * The packs ship a head a shade over a fifth of the body, which reads as a
 * mascot at dashboard distance. 0.94 keeps a believable adult silhouette
 * without turning the face into a pinhead in the portrait view.
 */
export const HEAD_SCALE = 0.94

/** aim scratch, kept out of the bend()/placeFoot() temporaries */
const _a0 = new THREE.Vector3()
const _a1 = new THREE.Vector3()
const _a2 = new THREE.Vector3()
const _a3 = new THREE.Vector3()
const _a4 = new THREE.Vector3()
const _aimHead = new THREE.Vector3()
const _aimDir = new THREE.Vector3()
const _aimNow = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _q0 = new THREE.Quaternion()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _q3 = new THREE.Quaternion()

/**
 * Rotate a bone about one or more of the model's own axes, applied on top of
 * its rest pose. Working in parent space keeps the pose correct no matter how
 * the bone was oriented in the source FBX (these leg bones are not axis-aligned).
 */
function bend(
  bone: THREE.Bone | undefined,
  rest: THREE.Quaternion | undefined,
  deltas: ReadonlyArray<readonly [THREE.Vector3, number]>,
  weight: number,
  modelQuat: THREE.Quaternion,
) {
  if (!bone || !rest) return
  const parent = bone.parent
  if (!parent) return
  parent.updateWorldMatrix(true, false)
  parent.getWorldQuaternion(_pq)
  _pq.invert()
  _target.copy(rest)
  for (const [axis, angle] of deltas) {
    if (!angle) continue
    _axis.copy(axis).applyQuaternion(modelQuat).applyQuaternion(_pq)
    _dq.setFromAxisAngle(_axis, angle)
    _target.premultiply(_dq)
  }
  if (weight >= 1) bone.quaternion.copy(_target)
  else bone.quaternion.slerp(_target, weight)
}

/**
 * Point a bone at a world position. The pack's bones run along their local +Y,
 * so the world delta between "where the bone points now" and "where it should
 * point" is re-expressed in the parent's frame and premultiplied. Unlike a
 * fixed X rotation this lands the joint exactly, whatever roll the bone has.
 */
function aim(bone: THREE.Bone | undefined, target: THREE.Vector3, weight: number) {
  const parent = bone?.parent
  if (!bone || !parent) return
  parent.updateWorldMatrix(true, false)
  const head = _aimHead.setFromMatrixPosition(bone.matrixWorld)
  const want = _aimDir.copy(target).sub(head)
  if (want.lengthSq() < 1e-8) return
  want.normalize()
  const now = _aimNow.set(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(_q0)).normalize()
  if (now.dot(want) > 0.999999) return
  _q1.setFromUnitVectors(now, want)
  parent.getWorldQuaternion(_q2)
  const inv = _q3.copy(_q2).invert()
  _q1.premultiply(inv).multiply(_q2) // world delta → parent-local delta
  _q0.copy(bone.quaternion)
  bone.quaternion.premultiply(_q1)
  if (weight < 1) bone.quaternion.slerpQuaternions(_q0, bone.quaternion, weight)
}

/**
 * Seated pose geometry, in metres in the actor's own frame (-Z faces the desk,
 * y = 0 is the floor). The numbers come from Desk.tsx: the chair seat top is
 * 0.4725, the keyboard top is 0.786 at desk-local z 0.16, and the actor sits
 * 0.42 behind the desk centre.
 */
export const SIT = {
  /** sole clearance above the floor, in metres */
  ankleY: 0.0,
  /** never sink the hips lower than this: the pelvis would enter the seat */
  minHipY: 0.505,
  /** knees tuck in a little instead of splaying */
  kneeIn: 0.022,
  /** thighs sit a hair below level, the way relaxed legs do */
  kneeDown: 0.012,
  /** keyboard centre, actor frame */
  keyX: 0.04,
  keyZ: -0.26,
  /** wrist target: over the keys, hands a touch above the keycaps */
  handX: 0.115,
  handY: 0.802,
  /** elbows out and slightly back, like someone actually typing */
  elbowOut: 1.0,
  elbowBack: 0.5,
  elbowDown: 0.25,
  /** torso leans toward the screen; the neck gives some of it back */
  spineLean: 0.11,
  neckLift: 0.06,
}

export interface PoseOptions {
  seated: boolean
  /** 0..1, eased by the caller */
  weight: number
  headYaw: number
  lean: number
  typing: number
  /** clock, for the small typing bob */
  t: number
}

/** Apply the seated/standing overlay after mixer.update(). */
export function pose(rig: Rig, o: PoseOptions) {
  const w = o.weight
  if (w <= 0.001) return
  const mq = _mq
  rig.root.getWorldQuaternion(mq)
  const m = rig.metrics

  // the actor group carries the seat translation and the desk rotation; work
  // in its frame so the targets can be written in plain "desk local" metres
  const actor = rig.root.parent?.parent ?? rig.root
  actor.updateWorldMatrix(true, false)
  const M = actor.matrixWorld
  const fwd = _fwd.set(0, 0, -1).transformDirection(M)
  const right = _right.set(1, 0, 0).transformDirection(M)

  // ---- torso: a slight lean into the desk, head still facing the screen
  bend(rig.bones[BONES.abdomen], rig.rest.get(BONES.abdomen), [[MODEL_X, -SIT.spineLean]], w, mq)
  bend(rig.bones[BONES.neck], rig.rest.get(BONES.neck), [[MODEL_X, SIT.neckLift]], w, mq)

  // ---- legs: thigh level, shin straight down, sole on the floor
  for (const side of [-1, 1] as const) {
    const thighBone = rig.bones[side < 0 ? BONES.thighL : BONES.thighR]
    const shinBone = rig.bones[side < 0 ? BONES.shinL : BONES.shinR]
    if (!thighBone || !shinBone) continue
    thighBone.updateWorldMatrix(true, false)
    const hip = _a0.setFromMatrixPosition(thighBone.matrixWorld).clone()
    const kneeT = _a1
      .copy(hip)
      .addScaledVector(fwd, m.thigh)
      .addScaledVector(right, -side * SIT.kneeIn)
    kneeT.y -= SIT.kneeDown
    aim(thighBone, kneeT, w)
    shinBone.updateWorldMatrix(true, false)
    const knee = _a2.setFromMatrixPosition(shinBone.matrixWorld)
    const ankleT = _a3.copy(knee)
    ankleT.y -= m.shin
    aim(shinBone, ankleT, w)
  }

  // ---- arms: wrists over the keys, elbows solved so both hands land
  const bob = Math.sin(o.t * 7.5) * 0.006 * o.typing
  for (const side of [-1, 1] as const) {
    const armBone = rig.bones[side < 0 ? BONES.armL : BONES.armR]
    const foreBone = rig.bones[side < 0 ? BONES.foreL : BONES.foreR]
    if (!armBone || !foreBone) continue
    armBone.updateWorldMatrix(true, false)
    const shoulder = _a0.setFromMatrixPosition(armBone.matrixWorld).clone()
    const wristT = _a1
      .set(SIT.keyX + side * SIT.handX, SIT.handY + bob * (side < 0 ? 1 : -1), SIT.keyZ)
      .applyMatrix4(M)
    const elbow = solveElbow(shoulder, wristT, m.upperArm, m.foreArm, side)
    aim(armBone, elbow, w)
    aim(foreBone, wristT, w)
  }

  for (const f of rig.feet) placeFoot(f, w)
}

/**
 * Two-bone IK: where the elbow has to sit so the upper arm (l1) and the
 * forearm (l2) reach from the shoulder to the wrist. The pole vector pulls the
 * elbow out to the side and a little back, which is what a typist's arm does.
 */
function solveElbow(
  shoulder: THREE.Vector3,
  wrist: THREE.Vector3,
  l1: number,
  l2: number,
  side: number,
): THREE.Vector3 {
  const dir = _a4.copy(wrist).sub(shoulder)
  const d = THREE.MathUtils.clamp(dir.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
  dir.normalize()
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
  const pole = _a3
    .copy(_right)
    .multiplyScalar(side * SIT.elbowOut)
    .addScaledVector(_fwd, -SIT.elbowBack)
    .addScaledVector(UP, -SIT.elbowDown)
  pole.addScaledVector(dir, -pole.dot(dir))
  if (pole.lengthSq() < 1e-6) pole.copy(_fwd)
  pole.normalize()
  return new THREE.Vector3()
    .copy(shoulder)
    .addScaledVector(dir, a)
    .addScaledVector(pole, h)
}

/**
 * The pack parents the foot bones to the Body node, not to the shin, so a bent
 * knee leaves them behind. Re-seat each ankle at the end of its shin and keep
 * the foot level with the floor.
 */
function placeFoot(f: FootRest, w: number) {
  const body = f.bone.parent
  if (!body) return
  f.shin.updateWorldMatrix(true, false)
  const target = f.shin.localToWorld(f.offset.clone())
  body.updateWorldMatrix(true, false)
  const local = body.worldToLocal(target)
  f.bone.position.copy(f.restPos).lerp(local, w)
  body.getWorldQuaternion(_pq)
  _dq.copy(_pq.invert()).multiply(f.restWorldQuat)
  f.bone.quaternion.slerp(_dq, w)
}

/** Turn the head about the model's Y axis (glancing at a passing colleague). */
export function lookHead(rig: Rig, yaw: number, pitch = 0) {
  const head = rig.bones[BONES.head]
  if (!head) return
  const parent = head.parent
  if (!parent) return
  parent.updateWorldMatrix(true, false)
  parent.getWorldQuaternion(_pq)
  const mq = _mq
  rig.root.getWorldQuaternion(mq)
  _axis.set(0, 1, 0).applyQuaternion(mq).applyQuaternion(_pq.clone().invert())
  _dq.setFromAxisAngle(_axis, yaw)
  _target.copy(_dq).multiply(rig.rest.get(BONES.head) ?? head.quaternion)
  head.quaternion.slerp(_target, 0.85)
  if (pitch !== 0) {
    _axis.set(1, 0, 0).applyQuaternion(_pq.clone().invert())
    _dq.setFromAxisAngle(_axis, pitch)
    head.quaternion.premultiply(_dq)
  }
}

/* ------------------------------------------------------------------ *
 * hijab: a cloth shell over the skull with a face opening, mounted on
 * the Head bone so it turns with the head.
 * ------------------------------------------------------------------ */

/**
 * A group parented to the head bone whose local space is the model's own, so
 * face/hijab/glasses geometry can be authored in plain model coordinates and
 * still turn with the head. The women's armature carries a 100x node scale and
 * the men's does not; the fixed matrix absorbs that difference.
 */
export function headMount(rig: Rig): { group: THREE.Group } | null {
  const head = rig.bones[BONES.head]
  if (!head) return null
  const group = new THREE.Group()
  group.name = 'headMount'
  group.matrixAutoUpdate = false
  group.matrix.copy(rig.headMountMatrix)
  head.add(group)
  return { group }
}

/**
 * Hijab: a crown cap plus a shell that wraps the sides and nape, leaving an
 * oval window over the face, and a drape that falls to the shoulders. All
 * coordinates are model space, so the same builder fits either pack.
 */
export function buildHijab(color: string, l: FaceLandmarks): THREE.Group {
  const g = new THREE.Group()
  const R = l.headW * 0.66
  const cloth = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const cy = l.headCenterY + 0.012
  const cz = l.headCenterZ

  const crown = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 18, 0, Math.PI * 2, 0, 0.98), cloth)
  crown.scale.set(1.0, 1.08, 1.02)
  crown.position.set(0, cy, cz)
  g.add(crown)

  const back = new THREE.Mesh(
    new THREE.SphereGeometry(R, 40, 24, Math.PI / 2 + 0.5, Math.PI * 2 - 1.0, 0.9, 1.2),
    cloth,
  )
  back.scale.set(1.03, 1.12, 1.06)
  back.position.set(0, cy, cz)
  g.add(back)

  // drape: from the jaw down over the shoulders
  const drapeTop = l.chinY + 0.02
  const drape = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.92, R * 2.1, 0.34, 36, 1, true), cloth)
  drape.position.set(0, drapeTop - 0.17, cz - 0.01)
  drape.scale.set(1.0, 1.0, 0.86)
  g.add(drape)

  const hem = new THREE.Mesh(new THREE.TorusGeometry(R * 2.06, 0.0065, 6, 44), cloth)
  hem.rotation.x = Math.PI / 2
  hem.position.set(0, drapeTop - 0.34, cz - 0.01)
  hem.scale.set(1, 0.86, 1)
  g.add(hem)
  return g
}

/** Glasses: two rimmed lenses plus a bridge, sized to the measured eyes. */
export function buildGlasses(l: FaceLandmarks): THREE.Group {
  const g = new THREE.Group()
  const frame = new THREE.MeshStandardMaterial({ color: '#33302c', roughness: 0.35, metalness: 0.6 })
  const glass = new THREE.MeshStandardMaterial({
    color: '#cfe0e8',
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  })
  const r = Math.max(0.024, l.eyeW * 0.78)
  const z = l.faceZ - 0.012
  for (const s of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0026, 8, 22), frame)
    rim.position.set(s * l.eyeX, l.eyeY + 0.004, z)
    rim.scale.set(1, 0.86, 1)
    g.add(rim)
    const lens = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 22), glass)
    lens.position.set(s * l.eyeX, l.eyeY + 0.004, z - 0.0012)
    lens.scale.set(1, 0.86, 1)
    g.add(lens)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.0026, 0.003, 0.08), frame)
    arm.position.set(s * (l.eyeX + r * 0.95), l.eyeY + 0.008, z - 0.042)
    arm.rotation.y = s * 0.38
    g.add(arm)
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(l.eyeX * 0.9, 0.0026, 0.0026), frame)
  bridge.position.set(0, l.eyeY + 0.008, z)
  g.add(bridge)
  return g
}

/** Headphones around the ears and over the crown. */
export function buildHeadphones(color: string, l: FaceLandmarks): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 })
  const cupX = l.headW * 0.52
  const cupY = l.eyeY - 0.006
  // The band is the upper half of a torus in the cups' own XY plane, so both
  // ends land on the cups, stretched vertically to clear the crown. Turning it
  // about Y (as before) swung the arc down through the face.
  const band = new THREE.Mesh(new THREE.TorusGeometry(cupX, 0.0085, 6, 26, Math.PI), mat)
  band.position.set(0, cupY, l.headCenterZ)
  band.scale.y = Math.max(1, (l.headTopY + 0.012 - cupY) / cupX)
  g.add(band)
  for (const s of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.026, 16), mat)
    cup.position.set(s * cupX, cupY, l.headCenterZ)
    cup.rotation.z = Math.PI / 2
    g.add(cup)
  }
  return g
}
