import { useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import type { StatusPayload } from '../lib/types'
import { agentMeta, agentsFor, resolveAgentId, rosterAgents } from '../lib/roster'
import { Room } from './Room'
import { Exterior } from './Exterior'
import { Furniture } from './Furniture'
import { AgentActor } from './AgentActor'
import { Envelopes } from './Envelopes'
import { CameraRig, type MoveIntent, type RigCommand } from './CameraRig'

export interface OfficeProps {
  status: StatusPayload | null
  command: RigCommand
  moveIntent: React.MutableRefObject<MoveIntent>
  onNear: (id: string | null) => void
  onMove: () => void
  onPick: (id: string) => void
  dpr?: [number, number]
}

/** The 3D office scene. */
export function Office({ status, command, moveIntent, onNear, onMove, onPick, dpr = [1, 1.8] }: OfficeProps) {
  const slots = useRef({ count: 0, max: 3 })
  // ?face=<id> is the portrait view: keep the room, drop the other agents so
  // nobody can wander between the camera and the face being photographed
  const solo = useMemo(() => {
    const q = new URLSearchParams(window.location.search).get('face')
    return q ? resolveAgentId(q) : null
  }, [])
  const byId = useMemo(() => {
    const m = new Map<string, StatusPayload['agents'][number]>()
    for (const a of status?.agents ?? []) m.set(a.id, a)
    return m
  }, [status])
  const now = status?.now ?? Date.now() / 1000
  const mountedAt = useRef(now)
  // Every desk the roster knows about, plus any agent /api/status reports that
  // /api/config did not list (a desk is created on the lattice for it).
  const metas = useMemo(() => agentsFor((status?.agents ?? []).map((a) => a.id)), [status])

  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      camera={{ fov: 55, near: 0.08, far: 140, position: [1.6, 1.95, 13.0] }}
      onPointerMissed={() => onPick('')}
      onCreated={({ gl, scene, camera }) => {
        // diagnostics hooks used by verify/*.py and the perf probe
        const w = window as unknown as {
          __officeScene?: THREE.Scene
          __officeCamera?: THREE.Camera
          __officeRenderer?: THREE.WebGLRenderer
        }
        w.__officeScene = scene
        w.__officeCamera = camera
        w.__officeRenderer = gl
      }}
    >
      <fog attach="fog" args={['#241a13', 30, 85]} />
      <ambientLight intensity={0.62} color="#fff1dc" />
      <hemisphereLight args={['#ffe9c9', '#3a2b21', 0.75]} />
      <directionalLight position={[14, 20, 12]} intensity={1.15} color="#fff4e0" />
      <directionalLight position={[-16, 12, -10]} intensity={0.35} color="#c8d6ff" />

      <Exterior showRoof={command.spot === 'luar'} />
      <Room />
      <Furniture agents={status?.agents ?? []} />

      {metas.filter((meta) => !solo || meta.id === solo).map((meta) => (
        <AgentActor
          key={meta.id}
          meta={meta}
          agent={byId.get(meta.id)}
          now={now}
          slots={slots.current}
          onPick={onPick}
        />
      ))}

      <Envelopes comms={status?.comms ?? []} since={mountedAt.current} />
      <CameraRig command={command} moveIntent={moveIntent} onNear={onNear} onMove={onMove} />
    </Canvas>
  )
}

export function agentFocus(id: string): RigCommand['focus'] {
  const meta = agentMeta(id)
  return { x: meta.desk.x, z: meta.desk.z, rot: meta.desk.rot }
}

/** Helper used by the HUD to know where a team sits. */
export function teamCenter(team: 'lobby' | 'dev' | 'edu'): THREE.Vector3 {
  const members = rosterAgents().filter((a) => a.team === team)
  const v = new THREE.Vector3()
  for (const m of members) v.add(new THREE.Vector3(m.desk.x, 0, m.desk.z))
  return v.multiplyScalar(1 / Math.max(1, members.length))
}
