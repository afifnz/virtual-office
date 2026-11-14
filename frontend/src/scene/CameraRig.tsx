import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { AGENTS } from '../lib/agents'
import { FLOOR, SPOTS, WALLS } from '../lib/rooms'

export interface RigCommand {
  spot: string
  nonce: number
  /** fly to an agent's desk instead of a named spot */
  focus?: { x: number; z: number; rot: number; seated?: boolean }
  /** portrait mode: get close enough to read the face */
  tight?: boolean
}

export interface MoveIntent {
  x: number
  z: number
}

const EYE = 1.72
const SPEED = 4.2

function blocked(x: number, z: number): boolean {
  if (x < -FLOOR.w / 2 + 0.5 || x > FLOOR.w / 2 - 0.5) return true
  if (z < -FLOOR.d / 2 + 0.5 || z > FLOOR.d / 2 - 0.5) return true
  for (const seg of WALLS) {
    const pad = 0.34
    if (seg.axis === 'x') {
      const lo = Math.min(seg.from, seg.to)
      const hi = Math.max(seg.from, seg.to)
      if (x > lo - pad && x < hi + pad && Math.abs(z - seg.at) < pad) return true
    } else {
      const lo = Math.min(seg.from, seg.to)
      const hi = Math.max(seg.from, seg.to)
      if (z > lo - pad && z < hi + pad && Math.abs(x - seg.at) < pad) return true
    }
  }
  return false
}

/**
 * First-person walk controls: WASD/arrows or the on-screen pad, drag to look.
 * HUD buttons fly to a spot. Camera reports the nearest agent for the card.
 */
export function CameraRig({
  command,
  moveIntent,
  onNear,
  onMove,
}: {
  command: RigCommand
  moveIntent: React.MutableRefObject<MoveIntent>
  onNear: (id: string | null) => void
  onMove: () => void
}) {
  const { camera, gl, scene } = useThree()
  const pCam = camera as THREE.PerspectiveCamera
  const state = useRef({
    yaw: 0.0,
    pitch: -0.06,
    /** true once the player walks: only then does the eye height take over */
    free: true,
    tween: null as null | {
      from: THREE.Vector3
      to: THREE.Vector3
      lookFrom: THREE.Vector3
      lookTo: THREE.Vector3
      started: number
      dur: number
      fovFrom: number
      fovTo: number
    },
  })
  const keys = useRef(new Set<string>())
  const drag = useRef<{ x: number; y: number; id: number } | null>(null)
  const near = useRef<string | null>(null)
  const lookAt = useRef(new THREE.Vector3())

  // read-only debug handle, used by the screenshot script
  useEffect(() => {
    ;(window as unknown as { __officeCamera?: THREE.Camera }).__officeCamera = camera
    ;(window as unknown as { __officeScene?: THREE.Scene }).__officeScene = scene
  }, [camera])

  const positions = useMemo(
    () => AGENTS.map((a) => ({ id: a.id, x: a.desk.x, z: a.desk.z })),
    [],
  )

  /** ?cam=x,y,z&aim=x,y,z — a fixed lens for the verification screenshots. */
  const fixedCam = useMemo(() => {
    if (typeof window === 'undefined') return null
    const q = new URLSearchParams(window.location.search)
    const cam = q.get('cam')
    const aim = q.get('aim')
    if (!cam || !aim) return null
    const a = cam.split(',').map(Number)
    const b = aim.split(',').map(Number)
    if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((n) => !Number.isFinite(n))) return null
    return { pos: new THREE.Vector3(a[0]!, a[1]!, a[2]!), aim: new THREE.Vector3(b[0]!, b[1]!, b[2]!) }
  }, [])

  // start on the lobby spot
  useEffect(() => {
    const spot = SPOTS.lobby!
    camera.position.set(...spot.pos)
    const target = new THREE.Vector3(...spot.target)
    camera.lookAt(target)
    const dir = target.clone().sub(camera.position).normalize()
    state.current.yaw = Math.atan2(-dir.x, -dir.z)
    state.current.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))
    lookAt.current.copy(target)
  }, [camera])

  // fly to a HUD spot or to one agent's face
  useEffect(() => {
    const f = command.focus
    let pos: THREE.Vector3
    let target: THREE.Vector3
    if (f) {
      // A seated agent faces the desk, so a straight-on shot would be blocked
      // by the monitor. Stand beside them, 60 degrees off the facing, and pick
      // whichever side has more free space.
      // seated eye line: hips land on the chair (0.47), so the head sits at
      // ~1.09 and the middle of the face is around 1.19
      const headY = f.seated === false ? 1.6 : 1.19
      const seatX = f.x + Math.sin(f.rot) * 0.42
      const seatZ = f.z + Math.cos(f.rot) * 0.42
      const fx = -Math.sin(f.rot)
      const fz = -Math.cos(f.rot)
      const rx = Math.cos(f.rot)
      const rz = -Math.sin(f.rot)
      // In portrait mode stand 1.3 m away at 28 degrees off the face, the way a
      // long lens would: the head keeps its real proportions and both eyes read.
      // 60 degrees off the face: in front enough to read both eyes, far enough
      // to the side that the monitor never fills the lens.
      // Portraits stand on the +right side (the monitor is offset to -right) and
      // look slightly down, like a visitor standing over a seated colleague.
      const near = command.tight === true
      // verification portraits can ask for a straight-on shot with ?front=1
      const frontal =
        near && new URLSearchParams(window.location.search).get('front') === '1'
      const dist = frontal ? 0.95 : near ? 1.45 : 2.05
      const ang = frontal ? 0.3 : near ? 0.42 : 0.62
      const lift = frontal ? 0.05 : near ? 0.17 : 0.14
      const candidates = [1, -1].map((sgn) =>
        new THREE.Vector3(
          seatX + (fx * Math.cos(ang) + rx * Math.sin(ang) * sgn) * dist,
          headY + lift,
          seatZ + (fz * Math.cos(ang) + rz * Math.sin(ang) * sgn) * dist,
        ),
      )
      const clearance = (p: THREE.Vector3) => {
        let min = 99
        for (const other of positions) {
          if (Math.abs(other.x - f.x) < 0.01 && Math.abs(other.z - f.z) < 0.01) continue
          min = Math.min(min, Math.hypot(other.x - p.x, other.z - p.z))
        }
        return min
      }
      // the monitor sits at desk-local (-0.4, -0.17): shoot from the other side
      const monX = f.x + (-0.4 * Math.cos(f.rot) - 0.17 * Math.sin(f.rot))
      const monZ = f.z + (0.4 * Math.sin(f.rot) - 0.17 * Math.cos(f.rot))
      candidates.sort((a, b) => {
        const da = Math.hypot(a.x - monX, a.z - monZ)
        const db = Math.hypot(b.x - monX, b.z - monZ)
        const ca = clearance(a)
        const cb = clearance(b)
        return near ? db + cb - (da + ca) : cb - ca
      })
      pos = candidates[0]!
      target = new THREE.Vector3(seatX, headY - (frontal ? 0.015 : near ? 0.01 : 0.02), seatZ)
    } else {
      const spot = SPOTS[command.spot]
      if (!spot) return
      pos = new THREE.Vector3(...spot.pos)
      target = new THREE.Vector3(...spot.target)
    }
    state.current.free = false
    const frontal =
      f != null && command.tight === true &&
      new URLSearchParams(window.location.search).get('front') === '1'
    const wantFov = f
      ? frontal
        ? 30
        : command.tight === true
          ? 30
          : 42
      : (SPOTS[command.spot]?.fov ?? 55)
    state.current.tween = {
      from: camera.position.clone(),
      to: pos,
      lookFrom: lookAt.current.clone(),
      lookTo: target,
      started: performance.now(),
      dur: 1100,
      fovFrom: pCam.fov,
      fovTo: wantFov,
    }
  }, [command, camera])

  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      d.x = e.clientX
      d.y = e.clientY
      state.current.yaw -= dx * 0.0032
      state.current.pitch = THREE.MathUtils.clamp(state.current.pitch - dy * 0.0026, -0.9, 0.7)
      state.current.tween = null
      state.current.free = true
      onMove()
    }
    const up = (e: PointerEvent) => {
      if (drag.current?.id === e.pointerId) drag.current = null
    }
    const keydown = (e: KeyboardEvent) => {
      keys.current.add(e.key.toLowerCase())
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        state.current.tween = null
      }
    }
    const keyup = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
    }
  }, [gl, onMove])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const s = state.current

    // verify/ hooks: ?cam=x,y,z&aim=x,y,z pins the lens for a screenshot
    if (fixedCam) {
      camera.position.copy(fixedCam.pos)
      camera.lookAt(fixedCam.aim)
      return
    }

    if (s.tween) {
      const tw = s.tween
      // wall-clock driven: a slow device still gets the same 1.1 s flight
      const k = Math.min(1, (performance.now() - tw.started) / tw.dur)
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
      camera.position.lerpVectors(tw.from, tw.to, e)
      lookAt.current.lerpVectors(tw.lookFrom, tw.lookTo, e)
      camera.lookAt(lookAt.current)
      if (Math.abs(pCam.fov - tw.fovTo) > 0.01) {
        pCam.fov = tw.fovFrom + (tw.fovTo - tw.fovFrom) * e
        camera.updateProjectionMatrix()
      }
      if (k >= 1) {
        const dir = tw.lookTo.clone().sub(tw.to).normalize()
        s.yaw = Math.atan2(-dir.x, -dir.z)
        s.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))
        s.tween = null
      }
      return
    }

    const k = keys.current
    let fwd = 0
    let side = 0
    if (k.has('w') || k.has('arrowup')) fwd += 1
    if (k.has('s') || k.has('arrowdown')) fwd -= 1
    if (k.has('a') || k.has('arrowleft')) side -= 1
    if (k.has('d') || k.has('arrowright')) side += 1

    const intent = moveIntent.current
    fwd += intent.z
    side += intent.x

    if (fwd !== 0 || side !== 0) {
      s.free = true
      const len = Math.hypot(fwd, side) || 1
      const nf = fwd / len
      const ns = side / len
      const sinY = Math.sin(s.yaw)
      const cosY = Math.cos(s.yaw)
      const dx = (-sinY * nf + cosY * ns) * SPEED * dt
      const dz = (-cosY * nf - sinY * ns) * SPEED * dt
      const nx = camera.position.x + dx
      const nz = camera.position.z + dz
      if (!blocked(nx, camera.position.z)) camera.position.x = nx
      if (!blocked(camera.position.x, nz)) camera.position.z = nz
      onMove()
    }

    // Only a walking player is pinned to eye height; a HUD jump keeps its
    // framing until someone actually moves.
    if (s.free) {
      camera.position.y = THREE.MathUtils.damp(camera.position.y, EYE, 6, dt)
      // walking always returns to the normal lens
      if (Math.abs(pCam.fov - 55) > 0.05) {
        pCam.fov = THREE.MathUtils.damp(pCam.fov, 55, 5, dt)
        camera.updateProjectionMatrix()
      }
    }
    camera.rotation.order = 'YXZ'
    camera.rotation.y = s.yaw
    camera.rotation.x = s.pitch
    camera.rotation.z = 0

    // nearest agent for the proximity card
    let bestId: string | null = null
    let bestD = 3.4
    for (const p of positions) {
      const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z)
      if (d < bestD) {
        bestD = d
        bestId = p.id
      }
    }
    if (bestId !== near.current) {
      near.current = bestId
      onNear(bestId)
    }
  })

  return null
}
