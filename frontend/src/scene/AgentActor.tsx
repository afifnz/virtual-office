import { Suspense, useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { AgentMeta } from '../lib/agents'
import type { Agent } from '../lib/types'
import { POIS, type Poi } from '../lib/rooms'
import { avoid, homeward, onward, retrace, seatPoint } from '../lib/routes'
import type { Pt } from '../lib/nav'
import { labelTexture } from '../lib/label'
import { statusLabel, toolLabel } from '../lib/format'
import { poiTaken, walkerPositions } from '../lib/presence'
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
  /** position on the route; the body is drawn at this plus a sidestep */
  x: number
  z: number
  /** sidestep offset (world x/z), eased so turns do not jerk the body */
  ox: number
  oz: number
  /** seconds spent giving way, so two walkers can never wait on each other forever */
  yielded: number
  poi: string | null
}

export interface AgentActorProps {
  meta: AgentMeta
  agent: Agent | undefined
  now: number
  slots: { count: number; max: number }
  onPick: (id: string) => void
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
    x: seat[0],
    z: seat[1],
    ox: 0,
    oz: 0,
    yielded: 0,
    poi: null,
  })

  // an actor removed mid-errand must not keep its POI or its ghost position
  useEffect(
    () => () => {
      const id = meta.id
      walkerPositions.delete(id)
      for (const [poi, who] of poiTaken) if (who === id) poiTaken.delete(poi)
    },
    [meta.id],
  )

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
          poiTaken.set(poi.id, meta.id)
          w.poi = poi.id
          w.x = seat[0]
          w.z = seat[1]
          w.ox = 0
          w.oz = 0
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
      // Mid-errand the agent can be anywhere on a route leg, and a straight
      // line from there to the nearest nav node may cut through a desk.
      // Retracing the legs already walked is always clear.
      w.path = w.state === 'out' ? retrace(meta, w.path, w.idx) : homeward(meta, [w.x, w.z])
      w.idx = 0
      w.state = 'back'
      w.speed = 2.35
      setMode('walk')
    }

    if (w.state === 'poi') {
      w.wait -= step
      if (w.wait <= 0) {
        // from where the agent actually stands (the POI), not from the seat:
        // starting at the seat made the walk home a straight line through desks
        w.path = homeward(meta, [w.x, w.z])
        w.idx = 0
        w.state = 'back'
        w.speed = 1.0
        setMode('walk')
      }
      w.phase += step * 0.6
      return
    }

    // ---- follow the polyline, giving way to colleagues
    const tgt = w.path[w.idx]
    let dirX = 0
    let dirZ = 0
    if (tgt) {
      const d0 = Math.hypot(tgt[0] - w.x, tgt[1] - w.z)
      if (d0 > 1e-4) {
        dirX = (tgt[0] - w.x) / d0
        dirZ = (tgt[1] - w.z) / d0
      }
    }
    const av = avoid(meta.id, w, dirX, dirZ, walkerPositions)
    // Sidestep only on nav-graph legs, the ones verify/layout_check.ts proves
    // wide enough. The first leg (chair -> desk exit, or POI -> graph) and the
    // last ones (graph -> POI, desk exit -> chair) only have room for the body.
    // out:  [exit, node, ..., node, poi]   graph legs end at idx 2 .. len-2
    // back: [node, ..., node, exit, seat]  graph legs end at idx 1 .. len-3
    const onGraph =
      w.state === 'back' ? w.idx >= 1 && w.idx < w.path.length - 2 : w.idx >= 2 && w.idx < w.path.length - 1
    const sideT = onGraph ? av.side : 0
    // keep right: right of the heading is (-dirZ, dirX)
    w.ox = THREE.MathUtils.damp(w.ox, -dirZ * sideT, 4, step)
    w.oz = THREE.MathUtils.damp(w.oz, dirX * sideT, 4, step)
    if (av.hold) w.yielded += step
    else w.yielded = Math.max(0, w.yielded - step * 0.5)

    let budget = w.speed * step * av.speed
    while (budget > 0 && w.idx < w.path.length) {
      const target = w.path[w.idx]!
      const dx = target[0] - w.x
      const dz = target[1] - w.z
      const d = Math.hypot(dx, dz)
      if (d < 1e-4) {
        w.idx++
        continue
      }
      const move = Math.min(budget, d)
      w.x += (dx / d) * move
      w.z += (dz / d) * move
      w.yaw = Math.atan2(-dx, -dz)
      w.phase += move * 7.6
      budget -= move
      if (move >= d - 1e-3) w.idx++
    }
    g.position.x = w.x + w.ox
    g.position.z = w.z + w.oz
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
        if (w.poi && poiTaken.get(w.poi) === meta.id) poiTaken.delete(w.poi)
        w.poi = null
        w.x = seat[0]
        w.z = seat[1]
        w.ox = 0
        w.oz = 0
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
        name={`agent:${meta.id}`}
        userData={{ agentId: meta.id, team: meta.team }}
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
  const pool = POIS.filter((p) => p.team === meta.team && !poiTaken.has(p.id))
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}




function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * (1 - Math.exp(-lambda * dt))
}
