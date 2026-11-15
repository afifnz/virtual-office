import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Comm } from '../lib/types'
import { agentMeta } from '../lib/roster'
import { labelTexture } from '../lib/label'

interface Packet {
  key: string
  from: THREE.Vector3
  to: THREE.Vector3
  t: number
  kind: string
}

const TTL = 1.9

function anchor(id: string): THREE.Vector3 {
  if (id === 'user') return new THREE.Vector3(0, 1.5, 15.2)
  const m = agentMeta(id)
  return new THREE.Vector3(m.desk.x, 1.45, m.desk.z)
}

const KIND_COLOR: Record<string, string> = {
  delegate: '#efc07a',
  result: '#8fd0a0',
  failed: '#e2705f',
  steer: '#9bb8e0',
  request: '#d9c7a8',
}

/** Envelopes arc from sender to receiver when a delegate/result/steer appears. */
export function Envelopes({ comms, since }: { comms: Comm[]; since: number }) {
  const group = useRef<THREE.Group>(null)
  const packets = useRef<Packet[]>([])
  const seen = useRef(new Set<string>())

  const tex = useMemo(
    () =>
      labelTexture({
        text: '✉',
        color: '#2a2018',
        bg: 'rgba(246,232,204,0.96)',
        border: 'rgba(120,90,60,0.9)',
        px: 96,
      }).tex,
    [],
  )

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.12)
    // pick up new comms
    for (const c of comms) {
      if (c.ts < since - 30) continue
      const key = `${c.ts}|${c.from}|${c.to}|${c.kind}`
      if (seen.current.has(key)) continue
      seen.current.add(key)
      if (c.kind === 'request' && c.from === 'user') continue
      packets.current.push({
        key,
        from: anchor(c.from),
        to: anchor(c.to),
        t: 0,
        kind: c.kind,
      })
    }
    if (seen.current.size > 400) seen.current.clear()

    if (!group.current) return
    const g = group.current
    packets.current = packets.current.filter((p) => p.t < 1)
    // rebuild the visible sprites (<= 6 at a time)
    const live = packets.current.slice(-6)
    while (g.children.length < live.length) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
      )
      sprite.scale.set(0.34, 0.26, 1)
      g.add(sprite)
    }
    while (g.children.length > live.length) {
      const child = g.children[g.children.length - 1]!
      g.remove(child)
    }

    live.forEach((p, i) => {
      p.t += dt / TTL
      const t = Math.min(1, p.t)
      const sprite = g.children[i] as THREE.Sprite
      const mid = new THREE.Vector3()
        .addVectors(p.from, p.to)
        .multiplyScalar(0.5)
      mid.y = Math.max(p.from.y, p.to.y) + 1.5
      const a = new THREE.Vector3().lerpVectors(p.from, mid, t)
      const b = new THREE.Vector3().lerpVectors(mid, p.to, t)
      sprite.position.copy(new THREE.Vector3().lerpVectors(a, b, t))
      const mat = sprite.material as THREE.SpriteMaterial
      mat.color = new THREE.Color(KIND_COLOR[p.kind] ?? '#efc07a')
      mat.opacity = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1
      sprite.scale.setScalar(0.28 + Math.sin(t * Math.PI) * 0.1)
    })
    void state
  })

  return <group ref={group} />
}
