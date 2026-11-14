import { useMemo } from 'react'
import * as THREE from 'three'
import { FLOOR, WALL_H, WALL_T, WALLS, type WallSeg } from '../lib/rooms'
import { floorTexture, plasterTexture, rugTexture } from '../lib/textures'
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
    dev: sign('RUANG TIM DEV', '#82aac8'),
    edu: sign('RUANG TIM EDU', '#deb860'),
  }

  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[FLOOR.w, FLOOR.d]} />
        <meshStandardMaterial map={floor} roughness={0.9} metalness={0.02} />
      </mesh>
      {/* pendopo rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-2.2, 0.012, 9.2]}>
        <planeGeometry args={[7.4, 4.8]} />
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

      {/* door frames */}
      {[
        { x: 0, z: 16, horizontal: true },
        { x: -8, z: 4, horizontal: true },
        { x: 8, z: 4, horizontal: true },
        { x: 0, z: 0, horizontal: false },
      ].map((d, i) => {
        const w = 4.4
        return (
          <group key={i} position={[d.x, 0, d.z]}>
            {[-1, 1].map((s) => (
              <mesh key={s} position={d.horizontal ? [s * (w / 2), 1.35, 0] : [0, 1.35, s * (w / 2)]}>
                <boxGeometry args={d.horizontal ? [0.22, 2.7, 0.36] : [0.36, 2.7, 0.22]} />
                <meshStandardMaterial color="#5f422c" roughness={0.72} />
              </mesh>
            ))}
            <mesh position={[0, 2.72, 0]}>
              <boxGeometry args={d.horizontal ? [w + 0.5, 0.22, 0.36] : [0.36, 0.22, w + 0.5]} />
              <meshStandardMaterial color="#4d3625" roughness={0.72} />
            </mesh>
          </group>
        )
      })}

      {/* room signs on the back walls */}
      <sprite position={[-16.5, 2.55, -15.78]} scale={[3.4, 3.4 / signs.dev.aspect, 1]}>
        <spriteMaterial map={signs.dev.tex} transparent depthWrite={false} />
      </sprite>
      <sprite position={[17, 2.55, -15.78]} scale={[3.4, 3.4 / signs.edu.aspect, 1]}>
        <spriteMaterial map={signs.edu.tex} transparent depthWrite={false} />
      </sprite>
      <sprite position={[-22, 2.5, 15.78]} scale={[3.0, 3.0 / signs.lobby.aspect, 1]}>
        <spriteMaterial map={signs.lobby.tex} transparent depthWrite={false} />
      </sprite>

      {/* no roof: the overview camera looks into the rooms like a dollhouse */}

      {/* hanging lamps */}
      {LAMPS.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, WALL_H - 0.42, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.5, 6]} />
            <meshStandardMaterial color="#2b2119" roughness={0.8} />
          </mesh>
          <mesh position={[0, WALL_H - 0.72, 0]}>
            <coneGeometry args={[0.34, 0.3, 16, 1, true]} />
            <meshStandardMaterial color="#c8a468" roughness={0.5} metalness={0.35} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, WALL_H - 0.86, 0]}>
            <sphereGeometry args={[0.12, 12, 10]} />
            <meshStandardMaterial color="#ffe3b0" emissive="#ffcf85" emissiveIntensity={1.2} />
          </mesh>
          <pointLight position={[0, WALL_H - 0.95, 0]} intensity={6} distance={11} color="#ffd9a0" decay={2} />
        </group>
      ))}

      {/* plants along the walls */}
      {PLANTS.map(([x, z], i) => (
        <Plant key={i} x={x} z={z} />
      ))}
    </group>
  )
}

const LAMPS: Array<[number, number]> = [
  [-6, 9],
  [10, 9],
  [-16, -1],
  [-16, -9],
  [17, -1],
  [17, -9],
]

const PLANTS: Array<[number, number]> = [
  [-28.5, 14.5],
  [28.5, 14.5],
  [-28.5, -14.5],
  [28.5, -14.5],
  [-2.6, 6.6],
  [2.4, -3.4],
]

function Plant({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.26, 0.2, 0.44, 12]} />
        <meshStandardMaterial color="#9c5a3c" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.44, 0]}>
        <cylinderGeometry args={[0.25, 0.25, 0.03, 12]} />
        <meshStandardMaterial color="#3b2a1f" roughness={0.95} />
      </mesh>
      {[
        [0, 0.85, 0, 0.42],
        [-0.2, 0.72, 0.14, 0.28],
        [0.19, 0.78, -0.12, 0.3],
        [0.05, 1.05, 0.05, 0.24],
      ].map(([px, py, pz, r], i) => (
        <mesh key={i} position={[px!, py!, pz!]} scale={[1, 1.25, 1]}>
          <sphereGeometry args={[r!, 10, 8]} />
          <meshStandardMaterial color={i % 2 ? '#3e6b3a' : '#4c7d43'} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}
