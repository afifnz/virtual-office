import { useMemo } from 'react'
import * as THREE from 'three'
import { DOORS, FLOOR, WALL_H, WALL_T, WALLS, type WallSeg } from '../lib/rooms'
import { anyamanTexture, floorTexture, plasterTexture, rugTexture } from '../lib/textures'
import { labelTexture } from '../lib/label'

function wallBox(seg: WallSeg) {
  const h = seg.h ?? WALL_H
  const len = Math.abs(seg.to - seg.from)
  const mid = (seg.from + seg.to) / 2
  if (seg.axis === 'x') {
    return { pos: [mid, h / 2, seg.at] as [number, number, number], size: [len, h, WALL_T] as [number, number, number] }
  }
  return { pos: [seg.at, h / 2, mid] as [number, number, number], size: [WALL_T, h, len] as [number, number, number] }
}

/** Floor, walls with a teak wainscot, roof, door frames and room signs. */
export function Room() {
  const floor = useMemo(floorTexture, [])
  const plaster = useMemo(plasterTexture, [])
  const rug = useMemo(rugTexture, [])
  const weave = useMemo(anyamanTexture, [])

  const sign = (text: string, accent: string) =>
    labelTexture({
      text,
      color: '#f6ecdb',
      bg: 'rgba(46,31,23,0.92)',
      border: accent,
      bar: accent,
      px: 54,
    })

  const signs = {
    lobby: sign('PENDOPO', '#d4805c'),
  }

  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[FLOOR.w, FLOOR.d]} />
        <meshStandardMaterial map={floor} roughness={0.9} metalness={0.02} />
      </mesh>
      {/* pendopo rug under the reception corner: Ndoro Kakung's desk and the counter */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-6.9, 0.012, 6.4]}>
        <planeGeometry args={[6.4, 4.4]} />
        <meshStandardMaterial map={rug} roughness={0.95} />
      </mesh>

      {WALLS.map((seg, i) => {
        const { pos, size } = wallBox(seg)
        const h = seg.h ?? WALL_H
        return (
          <group key={i}>
            <mesh position={pos}>
              <boxGeometry args={size} />
              <meshStandardMaterial map={plaster} color="#efe6d4" roughness={0.94} />
            </mesh>
            {/* wainscot */}
            <mesh position={[pos[0], 0.42, pos[2]]}>
              <boxGeometry args={[size[0] + 0.02, 0.84, size[2] + 0.02]} />
              <meshStandardMaterial color="#7a563a" roughness={0.78} />
            </mesh>
            {/* top rail */}
            <mesh position={[pos[0], h - 0.06, pos[2]]}>
              <boxGeometry args={[size[0] + 0.06, 0.08, size[2] + 0.06]} />
              <meshStandardMaterial color="#5b3f2b" roughness={0.8} />
            </mesh>
          </group>
        )
      })}

      {/* door frames — one per DOORS entry, width matches the wall gap */}
      {DOORS.map((d, i) => {
        const horizontal = d.rot === 0
        const w = d.w
        return (
          <group key={i} position={[d.x, 0, d.z]}>
            {[-1, 1].map((s) => (
              <mesh key={s} position={horizontal ? [s * (w / 2), 1.35, 0] : [0, 1.35, s * (w / 2)]}>
                <boxGeometry args={horizontal ? [0.22, 2.7, 0.36] : [0.36, 2.7, 0.22]} />
                <meshStandardMaterial color="#5f422c" roughness={0.72} />
              </mesh>
            ))}
            <mesh position={[0, 2.72, 0]}>
              <boxGeometry args={horizontal ? [w + 0.5, 0.22, 0.36] : [0.36, 0.22, w + 0.5]} />
              <meshStandardMaterial color="#4d3625" roughness={0.72} />
            </mesh>
          </group>
        )
      })}

      {/* the pendopo's name plate, beside the entrance */}
      <sprite position={[5.4, 2.55, 9.78]} scale={[3.0, 3.0 / signs.lobby.aspect, 1]}>
        <spriteMaterial map={signs.lobby.tex} transparent depthWrite={false} />
      </sprite>

      {/* no roof: the overview camera looks into the rooms like a dollhouse */}

      {/* hanging lamps, one per desk row / cluster centre */}
      {LAMPS.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, WALL_H - 0.42, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.5, 6]} />
            <meshStandardMaterial color="#2b2119" roughness={0.8} />
          </mesh>
          <mesh position={[0, WALL_H - 0.72, 0]}>
            {/* woven bamboo shade (kap anyaman) */}
            <coneGeometry args={[0.36, 0.32, 18, 1, true]} />
            <meshStandardMaterial map={weave} color="#f2e2c0" roughness={0.85} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, WALL_H - 0.86, 0]}>
            <sphereGeometry args={[0.12, 12, 10]} />
            <meshStandardMaterial color="#ffe3b0" emissive="#ffcf85" emissiveIntensity={1.2} />
          </mesh>
          <pointLight position={[0, WALL_H - 0.95, 0]} intensity={6} distance={11} color="#ffd9a0" decay={2} />
        </group>
      ))}

      {/* plants in the corners, clear of every walking line */}
      {PLANTS.map(([x, z], i) => (
        <Plant key={i} x={x} z={z} />
      ))}
    </group>
  )
}

/** One pendant per desk cluster (its exact centroid) plus the pendopo zones. */
const LAMPS: Array<[number, number]> = [
  [-6.9, 6.4],
  [7.4, 6.6],
  [-11.5, 6.4],
  [12.6, 5.6],
  [-7.6, -4.4],
  [7.0, -4.4],
]

const PLANTS: Array<[number, number]> = [
  [-13.4, 9.3],
  [13.4, 9.3],
  [-13.4, -9.3],
  [13.4, -9.3],
  [-4.8, 2.7],
  [4.8, 2.7],
]

/** Terracotta gentong with lidah mertua (sansevieria) — a fixture of every Indonesian office. */
function Plant({ x, z }: { x: number; z: number }) {
  const leaves = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => {
        const a = i * 2.4
        const r = i === 0 ? 0 : 0.07 + (i % 3) * 0.03
        return { x: Math.cos(a) * r, z: Math.sin(a) * r, h: 0.75 + ((i * 37) % 5) * 0.09, tilt: r * 1.6, a }
      }),
    [],
  )
  return (
    <group position={[x, 0, z]}>
      {/* gentong: a wide-bellied clay jar */}
      <mesh position={[0, 0.27, 0]} scale={[1, 0.95, 1]}>
        <sphereGeometry args={[0.28, 18, 14]} />
        <meshStandardMaterial color="#a65a3a" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.2, 0.17, 0.1, 16]} />
        <meshStandardMaterial color="#8e4a2f" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.27, 0]} scale={[1.01, 0.12, 1.01]}>
        <sphereGeometry args={[0.28, 18, 6]} />
        <meshStandardMaterial color="#e3c38e" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.545, 0]}>
        <cylinderGeometry args={[0.19, 0.19, 0.02, 14]} />
        <meshStandardMaterial color="#3b2a1f" roughness={0.95} />
      </mesh>
      {leaves.map((l, i) => (
        <group key={i} position={[l.x, 0.55, l.z]} rotation={[Math.sin(l.a) * l.tilt, l.a, -Math.cos(l.a) * l.tilt]}>
          <mesh position={[0, l.h / 2, 0]} scale={[1, 1, 0.28]}>
            <coneGeometry args={[0.055, l.h, 6]} />
            <meshStandardMaterial color={i % 2 ? '#2f5d34' : '#3c6e3a'} roughness={0.8} />
          </mesh>
          <mesh position={[0, l.h * 0.42, 0]} scale={[1.08, 0.86, 0.2]}>
            <coneGeometry args={[0.055, l.h, 6]} />
            <meshStandardMaterial color="#c9b45a" roughness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
