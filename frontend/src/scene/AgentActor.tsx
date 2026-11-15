import { Suspense, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { AgentMeta } from '../lib/agents'
import type { Agent } from '../lib/types'
import { DESK_EXIT, POIS, nearestNode, type Poi } from '../lib/rooms'
import { navPath, type Pt } from '../lib/nav'
import { labelTexture } from '../lib/label'
import { statusLabel, toolLabel } from '../lib/format'
import { walkerPositions } from '../lib/presence'
import { Avatar, type AvatarMode } from './Avatar'
import { Chair, Desk, STATUS_COLOR } from './Desk'

type WalkState = 'seated' | 'out' | 'poi' | 'back'

interface WalkStateData {
  state: WalkState
  path: Pt[]
  idx: number
  phase: number
  yaw: number
  wait: number
  nextTrip: number
  speed: number
  away: boolean
}

export interface AgentActorProps {
  meta: AgentMeta
  agent: Agent | undefined
  now: number
  slots: { count: number; max: number }
  onPick: (id: string) => void
}

/** Seat point in world space (the avatar's hip sits this far behind the desk). */
function seatPoint(meta: AgentMeta): Pt {
  return [
    meta.desk.x + Math.sin(meta.desk.rot) * 0.42,
    meta.desk.z + Math.cos(meta.desk.rot) * 0.42,
  ]
}

/**
 * One desk + one agent. Seated while working/reviewing/blocked, wandering the
 * waypoint graph while idle, and straight back to the chair on a status change.
 */
export function AgentActor({ meta, agent, now, slots, onPick }: AgentActorProps) {
  const status = agent?.status ?? 'offline'
  const root = useRef<THREE.Group>(null)
  const [mode, setMode] = useState<AvatarMode>('seated')
  const seat = seatPoint(meta)
  const walk = useRef<WalkStateData>({
    state: 'seated',
    path: [],
    idx: 0,
    phase: 0,
    yaw: meta.desk.rot,
    wait: 0,
    nextTrip: 18 + Math.random() * 60,
    speed: 1.0,
    away: false,
  })

  const plate = labelTexture({
    text: meta.name,
    sub:
      status === 'working' || status === 'reviewing'
        ? toolLabel(agent?.current?.tools ?? []) || statusLabel(status)
        : status === 'blocked'
          ? (agent?.blocked?.reason ?? 'terblokir')
          : status === 'offline'
            ? 'offline'
            : `menganggur · ${Math.max(0, Math.round(now - (agent?.last_active ?? now)))}s`,
    color: '#f7efe2',
    subColor: STATUS_COLOR[status],
    bg: 'rgba(26,19,15,0.8)',
    border: STATUS_COLOR[status],
    bar: STATUS_COLOR[status],
    px: 46,
  })

  useFrame((state, dt) => {
    const g = root.current
    if (!g) return
    const w = walk.current
    const t = state.clock.elapsedTime
    // a portrait never catches the agent mid-errand
    const portrait =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('face') !== null
    // verify/ screenshots pin everyone to their desk: ?still=1
    const still =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('still') === '1'
    const idle = status === 'idle' && !portrait && !still
    const step = Math.min(dt, 0.1)

    // ---- decide whether to leave the desk
    if (w.state === 'seated') {
      if (idle && t > w.nextTrip && now - (agent?.last_active ?? 0) > 10 && slots.count < slots.max) {
        const poi = pickPoi(meta)
        if (poi) {
          slots.count++
          w.path = onward(meta, poi.pos)
          w.idx = 0
          w.state = 'out'
          w.away = true
          setMode('walk')
        }
      } else if (idle && t > w.nextTrip) {
        w.nextTrip = t + 12
      }
      if (w.state === 'seated') {
        g.position.set(seat[0], 0, seat[1])
        g.rotation.y = meta.desk.rot
        walkerPositions.delete(meta.id)
        return
      }
    }

    // ---- a status change always sends the agent home, in a hurry
    if (!idle && w.state !== 'back') {
      w.path = homeward(meta, [g.position.x, g.position.z])
      w.idx = 0
      w.state = 'back'
      w.speed = 2.35
      setMode('walk')
    }

    if (w.state === 'poi') {
      w.wait -= step
      if (w.wait <= 0) {
        w.path = homeward(meta, seat)
        w.idx = 0
        w.state = 'back'
        w.speed = 1.0
        setMode('walk')
      }
      w.phase += step * 0.6
      return
    }

    // ---- follow the polyline
    let budget = w.speed * step
    while (budget > 0 && w.idx < w.path.length) {
      const target = w.path[w.idx]!
      const dx = target[0] - g.position.x
      const dz = target[1] - g.position.z
      const d = Math.hypot(dx, dz)
      if (d < 1e-4) {
        w.idx++
        continue
      }
      const move = Math.min(budget, d)
      g.position.x += (dx / d) * move
      g.position.z += (dz / d) * move
      w.yaw = Math.atan2(-dx, -dz)
      w.phase += move * 7.6
      budget -= move
      if (move >= d - 1e-3) w.idx++
    }
    g.rotation.y = dampAngle(g.rotation.y, w.yaw, 9, step)
    walkerPositions.set(meta.id, { x: g.position.x, z: g.position.z })

    if (w.idx >= w.path.length) {
      if (w.state === 'out') {
        w.state = 'poi'
        w.wait = 8 + Math.random() * 12
        setMode('stand')
      } else if (w.state === 'back') {
        w.state = 'seated'
        w.idx = 0
        w.speed = 1.0
        w.nextTrip = t + 26 + Math.random() * 55
        if (w.away) {
          w.away = false
          slots.count = Math.max(0, slots.count - 1)
        }
        setMode('seated')
        walkerPositions.delete(meta.id)
      }
    }
  })

  return (
    <>
      {/* desk, chair and lamp stay put */}
      <group position={[meta.desk.x, 0, meta.desk.z]} rotation={[0, meta.desk.rot, 0]}>
        <Desk status={status} dim={status === 'offline'} />
        <group position={[0, 0, 0.42]}>
          <Chair dim={status === 'offline'} />
        </group>
        <mesh position={[0.66, 0.79, 0.42]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.16, 18]} />
          <meshBasicMaterial color="#000" transparent opacity={0.1} depthWrite={false} />
        </mesh>
      </group>

      {/* the person can move */}
      <group
        ref={root}
        position={[seat[0], 0, seat[1]]}
        rotation={[0, meta.desk.rot, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onPick(meta.id)
        }}
      >
        <Suspense fallback={null}>
          <Avatar
            id={meta.id}
            look={meta.look}
            status={status}
            mode={mode}
            motion={walk}
            lookAround={status === 'idle' || status === 'reviewing'}
          />
        </Suspense>
        <sprite position={[0, mode === 'seated' ? 1.46 : 1.98, 0]} scale={[0.3 * plate.aspect, 0.3, 1]}>
          <spriteMaterial map={plate.tex} transparent depthWrite={false} />
        </sprite>
        {status === 'blocked' ? <BlockedRing walking={mode !== 'seated'} /> : null}
        {mode === 'seated' ? <SeatShadow /> : null}
      </group>
    </>
  )
}

function SeatShadow() {
  return (
    <mesh position={[0, 0.012, -0.02]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.34, 20]} />
      <meshBasicMaterial color="#000" transparent opacity={0.15} depthWrite={false} />
    </mesh>
  )
}

function BlockedRing({ walking }: { walking: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((state) => {
    const s = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.1
    if (ref.current) ref.current.scale.setScalar(s)
  })
  return (
    <mesh ref={ref} position={[0, 0.03, walking ? 0 : 0.0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.42, 0.5, 32]} />
      <meshBasicMaterial color="#e2705f" transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  )
}

function pickPoi(meta: AgentMeta): Poi | null {
  const pool = POIS.filter((p) => p.team === meta.team)
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}

/** exit → nav graph → destination */
function onward(meta: AgentMeta, to: Pt): Pt[] {
  const exit = DESK_EXIT[meta.id] ?? [seatPoint(meta)[0], seatPoint(meta)[1] + 1.3]
  const a = nearestNode(exit[0], exit[1]!)
  const b = nearestNode(to[0], to[1])
  return [[exit[0], exit[1]!], ...navPath(a.id, b.id), to]
}

/** current position → nav graph → seat, so the walk ends in the chair */
function homeward(meta: AgentMeta, from: Pt): Pt[] {
  const exit = DESK_EXIT[meta.id] ?? [seatPoint(meta)[0], seatPoint(meta)[1] + 1.3]
  const a = nearestNode(from[0], from[1])
  const b = nearestNode(exit[0], exit[1]!)
  const seat = seatPoint(meta)
  return [...navPath(a.id, b.id), [exit[0], exit[1]!], [seat[0], seat[1]]]
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * (1 - Math.exp(-lambda * dt))
}
