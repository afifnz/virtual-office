import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Look } from '../lib/agents'
import type { AgentStatus } from '../lib/types'
import { walkerPositions } from '../lib/presence'
import {
  MODEL_URL,
  HEAD_SCALE,
  buildGlasses,
  buildHeadphones,
  headMount,
  instantiate,
  lookHead,
  modelForAgent,
  pose,
} from './human'
import { buildFace, type Lid } from './face'
import { buildHijabHead, buildSleeves } from './galuh'

export type AvatarMode = 'seated' | 'walk' | 'stand'

export interface AvatarProps {
  id: string
  look: Look
  status: AgentStatus
  mode: AvatarMode
  /** walk cycle accumulator, mutated by the actor every frame */
  motion?: React.MutableRefObject<{ phase: number }>
  headYaw?: number
  lean?: number
  /** seated agents glance at colleagues who walk past */
  lookAround?: boolean
}

/** ?front=1 is the verification portrait: hold the head still so left/right
 *  symmetry can be judged instead of catching a mid-bob frame. */
const STILL =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('front') === '1'

const CLIPS = {
  idle: 'Idle',
  neutral: 'Idle_Neutral',
  walk: 'Walk',
} as const

function clipByName(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip | undefined {
  return clips.find((c) => c.name === name || c.name.endsWith(`|${name}`))
}

/**
 * One agent's body: a Quaternius CC0 human, cloned per agent (own skeleton,
 * own materials), scaled to 1.7 m and driven by its own AnimationMixer.
 *
 * The pack has no Sit clip, so the seated pose is built by bending the hip,
 * knee and shoulder bones about the model's X axis after the mixer writes the
 * Idle pose — the legs fold under the desk, the hands land on the keyboard,
 * and the upper body keeps the idle breathing from the clip.
 */
export function Avatar({ id, look, status, mode, motion, headYaw = 0, lean = 0, lookAround = false }: AvatarProps) {
  const model = modelForAgent(id)
  const { scene, animations } = useGLTF(MODEL_URL[model])
  const rig = useMemo(() => instantiate(scene, look, model), [scene, look, model])

  const bodyRef = useRef<THREE.Group>(null)
  const sitW = useRef(mode === 'seated' ? 1 : 0)
  const glance = useRef(0)
  const blinkAt = useRef(1.4)
  const lids = useRef<Lid[]>([])
  const [ready, setReady] = useState(false)

  // ---- accessories: hijab / glasses / headphones ride on the head bone
  useEffect(() => {
    const mount = headMount(rig)
    if (!mount) return
    rig.root.updateMatrixWorld(true)
    const lm = rig.landmarks

    const added: THREE.Object3D[] = []
    if (look.hijab) {
      // A hijab hides the whole head, so the pack's skull (and its 14 mm
      // off-axis skin mesh) is replaced by our own head: the face, the cloth
      // and the drape are one surface and cannot leave a gap.
      for (const m of rig.headMeshes) m.visible = false
      const head = buildHijabHead(look, lm)
      mount.group.add(head.group)
      added.push(head.group)
      lids.current = head.lids
      // a long-sleeve top: the pack only ships a tee, so the sleeves are
      // grown along the arm bones (they follow the seated IK for free)
      for (const sleeve of buildSleeves(rig, look.shirt)) {
        added.push(sleeve)
      }
    } else {
      if (look.glasses) {
        const glasses = buildGlasses(lm)
        mount.group.add(glasses)
        added.push(glasses)
      }
      if (look.headphones) {
        const hp = buildHeadphones(look.headphones, lm)
        mount.group.add(hp)
        added.push(hp)
      }

      // ---- face: eyeballs, lids, nostrils, lips measured off the model itself
      const face = buildFace(look, lm)
      mount.group.add(face.group)
      added.push(face.group)
      lids.current = face.lids
      // the pack's eye quads are flat black rectangles; the new eyeballs
      // replace them instead of sitting on top of them
      for (const e of rig.eyeMeshes) e.visible = false
    }
    setReady(true)

    return () => {
      for (const o of added) {
        o.parent?.remove(o)
        o.traverse((c) => {
          const m = c as THREE.Mesh
          if (m.geometry) m.geometry.dispose()
          const mat = m.material as THREE.Material | THREE.Material[] | undefined
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
          else mat?.dispose()
        })
      }
      lids.current = []
    }
  }, [rig, look])

  // ---- animation graph
  const mixer = useMemo(() => {
    const m = new THREE.AnimationMixer(rig.root)
    const actions: Record<string, THREE.AnimationAction> = {}
    for (const [key, name] of Object.entries(CLIPS)) {
      const clip = clipByName(animations, name)
      if (!clip) continue
      const a = m.clipAction(clip)
      a.setLoop(THREE.LoopRepeat, Infinity)
      a.enabled = true
      a.setEffectiveWeight(0)
      a.play()
      actions[key] = a
    }
    return { m, actions }
  }, [rig, animations])

  const wantClip = (m: AvatarMode, s: AgentStatus): keyof typeof CLIPS => {
    if (m === 'walk') return 'walk'
    if (m === 'stand') return 'neutral'
    if (s === 'blocked') return 'neutral'
    if (s === 'working' || s === 'reviewing') return 'idle'
    return 'neutral'
  }

  const activeClip = useRef<string>('')

  useEffect(() => {
    return () => {
      mixer.m.stopAllAction()
      mixer.m.uncacheRoot(rig.root)
    }
  }, [mixer, rig])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const t = state.clock.elapsedTime
    const target = mode === 'seated' ? 1 : 0
    sitW.current = THREE.MathUtils.damp(sitW.current, target, 7, dt)
    if (sitW.current < 0.002) sitW.current = 0

    // crossfade the clip when the agent changes activity
    const want = wantClip(mode, status)
    if (want !== activeClip.current) {
      const from = mixer.actions[activeClip.current]
      const to = mixer.actions[want]
      if (to) {
        to.reset()
        to.setEffectiveWeight(1)
        to.fadeIn(0.35)
        if (from) from.fadeOut(0.35)
      }
      activeClip.current = want
    }

    // walk clip follows the distance actually travelled, so the feet do not skate
    const walkAction = mixer.actions.walk
    if (walkAction && mode === 'walk' && walkAction.getClip()) {
      const dur = walkAction.getClip().duration
      const phase = motion?.current.phase ?? 0
      walkAction.time = ((phase / (Math.PI * 2)) % 1) * dur
      walkAction.setEffectiveTimeScale(1)
    }

    mixer.m.update(dt)

    // the pack's clip never touches scale, but re-assert it anyway: the head
    // proportion is the one thing that must not drift between frames
    if (rig.bones.Head) rig.bones.Head.scale.setScalar(HEAD_SCALE)

    // drop onto the chair before posing: the legs are solved against the
    // floor, so the body group has to be in its final place first
    if (bodyRef.current) bodyRef.current.position.y = -rig.metrics.seatDrop * sitW.current

    // head turn + glance
    let glanceTarget = 0
    if (!STILL && lookAround && mode === 'seated' && bodyRef.current && walkerPositions.size > 0) {
      const world = new THREE.Vector3()
      bodyRef.current.getWorldPosition(world)
      let best: THREE.Vector3 | null = null
      let bestD = 3.2
      for (const p of walkerPositions.values()) {
        if (p.x === world.x && p.z === world.z) continue
        const d = Math.hypot(p.x - world.x, p.z - world.z)
        if (d < bestD) {
          bestD = d
          best = new THREE.Vector3(p.x, 0.6, p.z)
        }
      }
      if (best) {
        const local = bodyRef.current.worldToLocal(best.clone())
        glanceTarget = THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z), -0.95, 0.95)
      }
    }
    glance.current = THREE.MathUtils.damp(glance.current, glanceTarget, 3.2, dt)

    pose(rig, {
      seated: mode === 'seated',
      weight: sitW.current,
      headYaw: 0,
      lean,
      typing: status === 'working' ? 1 : status === 'reviewing' ? 0.5 : 0.2,
      t,
    })
    const yaw = STILL ? 0 : headYaw + glance.current + Math.sin(t * 0.6 + 0.4) * 0.04
    const pitch = (status === 'blocked' ? 0.16 : 0) + (STILL ? 0 : Math.sin(t * 0.9) * 0.015)
    lookHead(rig, yaw, pitch)

    // blink: the upper lid rolls down over the eyeball
    if (!STILL && t > blinkAt.current) {
      const close = Math.max(0, 1 - Math.abs(t - blinkAt.current) / 0.11)
      for (const lid of lids.current) lid.mesh.rotation.x = THREE.MathUtils.lerp(lid.open, lid.shut, close)
      if (t > blinkAt.current + 0.22) blinkAt.current = t + 2.6 + Math.random() * 3.4
    } else if (lids.current.length) {
      for (const lid of lids.current) lid.mesh.rotation.x = lid.open
    }

    // breathing: the chest bone gets a whisper of lift, nothing more
    const chest = rig.bones.Chest
    if (chest) {
      const base = rig.rest.get('Chest')
      if (base) {
        chest.quaternion.copy(base)
        chest.rotateX(Math.sin(t * 1.5) * 0.012 + (status === 'reviewing' ? 0.03 : 0))
      }
    }
  })

  return (
    <group ref={bodyRef} visible={ready}>
      <primitive object={rig.root} />
    </group>
  )
}

