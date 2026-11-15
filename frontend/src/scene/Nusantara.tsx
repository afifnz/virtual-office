import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DOORS, EXTERIOR, WALL_H, WALL_T, WALLS } from '../lib/rooms'
import { gununganTexture, kawungTexture, ukirTexture } from '../lib/textures'

/**
 * Local accents. Everything here hangs on a wall or stands outside the
 * building, so nothing enters the walking floor: OBSTACLES, NAV and the
 * layout check are untouched.
 *
 *  - batik kawung frieze under the top rail of every wall
 *  - carved gebyok transom over every doorway
 *  - wayang kulit gunungan: pendopo, over the gamelan, over the lesehan
 *  - Merah Putih on a wall bracket beside the entrance
 *  - kentongan on the porch post
 *  - umbul-umbul at the gapura and two coconut palms in the yard
 */
export function Nusantara() {
  return (
    <group>
      <BatikFrieze />
      <Transoms />
      <Gunungan pos={[0, 1.95, 3.14]} ry={0} w={1.3} />
      <Gunungan pos={[-19.87, 2.05, -5.65]} ry={Math.PI / 2} w={1.0} />
      <Gunungan pos={[19.87, 1.9, -6.2]} ry={-Math.PI / 2} w={1.2} />
      <Bendera />
      <Kentongan />
      <UmbulUmbul />
      <Kelapa x={-9} z={25} lean={0.12} />
      <Kelapa x={-26} z={20} lean={-0.1} />
    </group>
  )
}

const FRIEZE_H = 0.3
const FRIEZE_Y = WALL_H - 0.42

function BatikFrieze() {
  const base = kawungTexture()
  const strips = useMemo(
    () =>
      WALLS.map((w) => {
        const len = Math.abs(w.to - w.from)
        const mid = (w.from + w.to) / 2
        const tex = base.clone()
        tex.needsUpdate = true
        tex.repeat.set(len / FRIEZE_H, 1)
        const pos: [number, number, number] = w.axis === 'x' ? [mid, FRIEZE_Y, w.at] : [w.at, FRIEZE_Y, mid]
        const size: [number, number, number] =
          w.axis === 'x' ? [len, FRIEZE_H, WALL_T + 0.03] : [WALL_T + 0.03, FRIEZE_H, len]
        return { pos, size, tex }
      }),
    [base],
  )
  return (
    <group>
      {strips.map((s, i) => (
        <mesh key={i} position={s.pos}>
          <boxGeometry args={s.size} />
          <meshStandardMaterial map={s.tex} roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}

/** Carved teak panel filling the gap between the door lintel and the top rail. */
function Transoms() {
  const tex = ukirTexture()
  const top = WALL_H - 0.1
  const bottom = 2.85
  const h = top - bottom
  return (
    <group>
      {DOORS.map((d, i) => {
        const along = d.rot === 0
        return (
          <group key={i} position={[d.x, bottom + h / 2, d.z]} rotation={[0, along ? 0 : Math.PI / 2, 0]}>
            <mesh>
              <planeGeometry args={[d.w + 0.2, h]} />
              <meshStandardMaterial map={tex} transparent alphaTest={0.4} side={THREE.DoubleSide} roughness={0.7} />
            </mesh>
            <mesh position={[0, h / 2 + 0.03, 0]}>
              <boxGeometry args={[d.w + 0.5, 0.06, 0.3]} />
              <meshStandardMaterial color="#4d3625" roughness={0.72} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

function Gunungan({ pos, ry, w }: { pos: [number, number, number]; ry: number; w: number }) {
  const tex = gununganTexture()
  return (
    <group position={pos} rotation={[0, ry, 0]}>
      <mesh>
        <planeGeometry args={[w, w * 1.5]} />
        <meshStandardMaterial map={tex} transparent alphaTest={0.4} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/** Merah Putih on an angled pole, bracketed to the front wall west of the entrance. */
function Bendera() {
  const flag = useRef<THREE.Group>(null)
  useFrame((state) => {
    if (flag.current) flag.current.rotation.y = Math.sin(state.clock.elapsedTime * 1.3) * 0.12
  })
  return (
    <group position={[-3.2, 2.25, 14.86]} rotation={[-0.6, 0, 0]}>
      <mesh position={[0, 0.65, 0]}>
        <cylinderGeometry args={[0.018, 0.022, 1.3, 8]} />
        <meshStandardMaterial color="#d8d2c4" roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[0, 1.32, 0]}>
        <sphereGeometry args={[0.035, 10, 8]} />
        <meshStandardMaterial color="#d9aa4e" roughness={0.3} metalness={0.6} />
      </mesh>
      <group ref={flag} position={[0, 1.04, 0]}>
        <mesh position={[0.38, 0.125, 0]}>
          <planeGeometry args={[0.75, 0.25]} />
          <meshStandardMaterial color="#d22630" roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0.38, -0.125, 0]}>
          <planeGeometry args={[0.75, 0.25]} />
          <meshStandardMaterial color="#f5f2ea" roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  )
}

/** Bamboo slit drum on the east porch post, with its beater. */
function Kentongan() {
  return (
    <group position={[2.5, 1.55, 16.38]}>
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.004, 0.004, 0.3, 4]} />
        <meshStandardMaterial color="#3a2a1c" />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.075, 0.08, 0.56, 12]} />
        <meshStandardMaterial color="#b48a4e" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0, 0.07]}>
        <boxGeometry args={[0.025, 0.36, 0.03]} />
        <meshStandardMaterial color="#20150d" />
      </mesh>
      <mesh position={[0.16, -0.12, 0.04]} rotation={[0, 0, 0.5]}>
        <cylinderGeometry args={[0.012, 0.012, 0.3, 6]} />
        <meshStandardMaterial color="#6b4a30" />
      </mesh>
    </group>
  )
}

const UMBUL = ['#d22630', '#e8b92f', '#2f7d4f', '#f5f2ea', '#2a5d9b']

/** Tall bamboo poles with long festival banners flanking the gapura. */
function UmbulUmbul() {
  const banners = useRef<THREE.Group[]>([])
  useFrame((state) => {
    const t = state.clock.elapsedTime
    banners.current.forEach((b, i) => {
      if (b) b.rotation.z = Math.sin(t * 0.9 + i * 0.8) * 0.05
    })
  })
  const z = EXTERIOR.gapuraZ
  const poles = [-7.2, -5.2, 5.2, 7.2]
  return (
    <group position={[0, EXTERIOR.ground.y, z]}>
      {poles.map((x, i) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 3.6, 0]}>
            <cylinderGeometry args={[0.045, 0.07, 7.2, 8]} />
            <meshStandardMaterial color="#c8a868" roughness={0.7} />
          </mesh>
          <group
            ref={(g) => {
              if (g) banners.current[i] = g
            }}
            position={[0.04, 7.0, 0]}
          >
            <mesh position={[0.3, -1.9, 0]}>
              <planeGeometry args={[0.55, 3.6]} />
              <meshStandardMaterial color={UMBUL[i % UMBUL.length]} side={THREE.DoubleSide} roughness={0.85} />
            </mesh>
            <mesh position={[0.3, -0.5, 0.002]}>
              <planeGeometry args={[0.55, 0.22]} />
              <meshStandardMaterial color={UMBUL[(i + 1) % UMBUL.length]} side={THREE.DoubleSide} roughness={0.85} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}

/** Coconut palm: a gently curved trunk, drooping fronds, a few coconuts. */
function Kelapa({ x, z, lean }: { x: number; z: number; lean: number }) {
  const fronds = useRef<THREE.Group>(null)
  useFrame((state) => {
    if (fronds.current) fronds.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.4 + x) * 0.06
  })
  const segs = 6
  const segH = 1.15
  const trunk = Array.from({ length: segs }, (_, i) => ({
    x: Math.sin((i / segs) * 1.2) * lean * 6,
    y: segH * (i + 0.5),
    r: 0.2 - i * 0.015,
  }))
  const top = trunk[segs - 1]!
  return (
    <group position={[x, EXTERIOR.ground.y, z]}>
      {trunk.map((s, i) => (
        <mesh key={i} position={[s.x, s.y, 0]} rotation={[0, 0, -lean * 0.6]}>
          <cylinderGeometry args={[s.r - 0.015, s.r, segH * 1.02, 8]} />
          <meshStandardMaterial color={i % 2 ? '#7b6247' : '#6e563d'} roughness={0.9} />
        </mesh>
      ))}
      <group ref={fronds} position={[top.x, segH * segs, 0]}>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2
          return (
            <group key={i} rotation={[0, a, 0]}>
              {/* pivot at the crown so the frond droops outward from it */}
              <group rotation={[0.5 + (i % 3) * 0.12, 0, 0]}>
                <mesh position={[0, 0, 1.2]}>
                  <boxGeometry args={[0.36, 0.03, 2.4]} />
                  <meshStandardMaterial color={i % 2 ? '#3f6b2c' : '#4f7d34'} roughness={0.9} />
                </mesh>
              </group>
            </group>
          )
        })}
        {[0, 2.1, 4.2].map((a, i) => (
          <mesh key={i} position={[Math.cos(a) * 0.2, -0.3, Math.sin(a) * 0.2]}>
            <sphereGeometry args={[0.13, 10, 8]} />
            <meshStandardMaterial color="#5a6b2a" roughness={0.7} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
