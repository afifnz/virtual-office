import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EXTERIOR, FLOOR } from '../lib/rooms'

/**
 * The building seen from outside: a stone batur (plinth) with a front stair, a
 * covered emper (veranda) on wooden saka posts, windows on the outer walls, a
 * yard with a path, a gapura and trees, and a two-tier joglo roof.
 *
 * The roof (and the posts that carry it) only shows on the "Luar" spot while
 * the camera is outside the building; every other view keeps the open
 * dollhouse look.
 */
export function Exterior({ showRoof }: { showRoof: boolean }) {
  return (
    <group>
      <Grounds />
      <Windows />
      <Trees />
      <Gapura />
      <Roof show={showRoof} />
    </group>
  )
}

const STONE = '#8d8273'
const WOOD = '#5a3d29'

function Grounds() {
  const { batur, ground } = EXTERIOR
  const baseH = -ground.y
  return (
    <group>
      {/* yard */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ground.y, 0]}>
        <planeGeometry args={[ground.size, ground.size]} />
        <meshStandardMaterial color="#56633a" roughness={1} />
      </mesh>
      {/* batur: the raised stone base under the building and its veranda */}
      <mesh position={[0, ground.y + (baseH - 0.012) / 2, 0]}>
        <boxGeometry args={[batur.w, baseH - 0.012, batur.d]} />
        <meshStandardMaterial color={STONE} roughness={0.9} />
      </mesh>
      {/* front stair down to the path */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, ground.y + (baseH * (3 - i)) / 6, batur.d / 2 + 0.35 + i * 0.7]}>
          <boxGeometry args={[6.4, (baseH * (3 - i)) / 3, 0.7]} />
          <meshStandardMaterial color="#9a8e7d" roughness={0.9} />
        </mesh>
      ))}
      {/* stone path to the gapura */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ground.y + 0.01, (batur.d / 2 + 2.4 + EXTERIOR.gapuraZ) / 2]}>
        <planeGeometry args={[4.2, EXTERIOR.gapuraZ - batur.d / 2 - 2.4]} />
        <meshStandardMaterial color="#a39580" roughness={0.95} />
      </mesh>
    </group>
  )
}

/** Veranda posts on the edge of the batur, carrying the roof's lower tier. */
function Saka() {
  const posts = useMemo(() => {
    const { batur } = EXTERIOR
    const hx = batur.w / 2 - 0.6
    const hz = batur.d / 2 - 0.6
    const out: Array<[number, number]> = []
    const along = (n: number, half: number) => Array.from({ length: n + 1 }, (_, i) => -half + (2 * half * i) / n)
    for (const x of along(8, hx)) {
      // leave the front stair open
      if (Math.abs(x) > 3.6) out.push([x, hz])
      out.push([x, -hz])
    }
    for (const z of along(6, hz).slice(1, -1)) {
      out.push([hx, z])
      out.push([-hx, z])
    }
    return out
  }, [])
  // the lower roof tier is ~0.34 above the eave line where the posts stand
  const h = EXTERIOR.eaveY + 0.32
  return (
    <group>
      {posts.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.12, 0]}>
            <boxGeometry args={[0.46, 0.24, 0.46]} />
            <meshStandardMaterial color={STONE} roughness={0.85} />
          </mesh>
          <mesh position={[0, h / 2, 0]}>
            <cylinderGeometry args={[0.15, 0.17, h, 10]} />
            <meshStandardMaterial color={WOOD} roughness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Window frames on the outer face of the shell walls. */
function Windows() {
  const list = useMemo(() => {
    const out: Array<{ x: number; z: number; ry: number }> = []
    const off = 0.14
    // every window is a fraction of the wall it sits on, so shrinking the floor
    // keeps them on the wall instead of leaving them in mid air
    const hx = FLOOR.w / 2
    const hz = FLOOR.d / 2
    for (const f of [-0.96, -0.56, 0.56, 0.96]) out.push({ x: f * hx, z: hz + off, ry: 0 })
    for (const f of [-0.96, -0.64, -0.32, 0.32, 0.64, 0.96]) out.push({ x: f * hx, z: -hz - off, ry: Math.PI })
    for (const f of [-0.8, -0.15, 0.45, 0.8]) {
      out.push({ x: -hx - off, z: f * hz, ry: -Math.PI / 2 })
      out.push({ x: hx + off, z: f * hz, ry: Math.PI / 2 })
    }
    return out
  }, [])
  return (
    <group>
      {list.map((w, i) => (
        <group key={i} position={[w.x, 1.75, w.z]} rotation={[0, w.ry, 0]}>
          <mesh>
            <boxGeometry args={[1.9, 1.5, 0.06]} />
            <meshStandardMaterial color="#4a3222" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0, 0.035]}>
            <planeGeometry args={[1.6, 1.22]} />
            <meshStandardMaterial color="#2b3a40" emissive="#e0a95c" emissiveIntensity={0.18} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0, 0.05]}>
            <boxGeometry args={[0.06, 1.22, 0.02]} />
            <meshStandardMaterial color="#4a3222" />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Trees() {
  return (
    <group>
      {EXTERIOR.trees.map(([x, z, s], i) => (
        <group key={i} position={[x, EXTERIOR.ground.y, z]} scale={s}>
          <mesh position={[0, 1.4, 0]}>
            <cylinderGeometry args={[0.22, 0.32, 2.8, 8]} />
            <meshStandardMaterial color="#4b3526" roughness={0.9} />
          </mesh>
          <mesh position={[0, 3.6, 0]}>
            <icosahedronGeometry args={[1.9, 0]} />
            <meshStandardMaterial color="#3f5a2c" roughness={0.95} flatShading />
          </mesh>
          <mesh position={[0.7, 4.6, 0.3]}>
            <icosahedronGeometry args={[1.2, 0]} />
            <meshStandardMaterial color="#4d6b33" roughness={0.95} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** A split brick gate (candi bentar) where the path meets the yard edge. */
function Gapura() {
  const z = EXTERIOR.gapuraZ
  return (
    <group position={[0, EXTERIOR.ground.y, z]}>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 2.9, 0, 0]}>
          <mesh position={[0, 1.6, 0]}>
            <boxGeometry args={[1.5, 3.2, 1.5]} />
            <meshStandardMaterial color="#9b5236" roughness={0.9} />
          </mesh>
          <mesh position={[0, 3.55, 0]}>
            <boxGeometry args={[1.1, 0.7, 1.1]} />
            <meshStandardMaterial color="#8a4830" roughness={0.9} />
          </mesh>
          <mesh position={[0, 4.25, 0]}>
            <coneGeometry args={[0.55, 0.9, 4]} />
            <meshStandardMaterial color="#7d4029" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** A closed four-sided frustum: bottom rect (bw x bd at by) up to top rect (tw x td at ty). */
function frustum(bw: number, bd: number, by: number, tw: number, td: number, ty: number): THREE.BufferGeometry {
  const b = [
    [-bw / 2, by, -bd / 2],
    [bw / 2, by, -bd / 2],
    [bw / 2, by, bd / 2],
    [-bw / 2, by, bd / 2],
  ]
  const t = [
    [-tw / 2, ty, -td / 2],
    [tw / 2, ty, -td / 2],
    [tw / 2, ty, td / 2],
    [-tw / 2, ty, td / 2],
  ]
  const pos: number[] = []
  const tri = (...v: number[][]) => v.forEach((p) => pos.push(p[0]!, p[1]!, p[2]!))
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    // outward-facing (counter-clockwise seen from outside)
    tri(b[j]!, b[i]!, t[i]!)
    tri(b[j]!, t[i]!, t[j]!)
  }
  // top cap
  tri(t[0]!, t[3]!, t[2]!)
  tri(t[0]!, t[2]!, t[1]!)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/**
 * Two-tier joglo roof: a shallow lower tier (penanggap) over the veranda and a
 * steep upper tier (brunjung) closing on a short ridge (molo).
 */
function Roof({ show }: { show: boolean }) {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const group = useRef<THREE.Group>(null)
  const fade = useRef(0)

  const parts = useMemo(() => {
    const { batur, eaveY } = EXTERIOR
    const tile = new THREE.MeshStandardMaterial({ color: '#8e4a32', roughness: 0.85, side: THREE.DoubleSide, transparent: true })
    const upper = new THREE.MeshStandardMaterial({ color: '#7a3d29', roughness: 0.85, side: THREE.DoubleSide, transparent: true })
    const wood = new THREE.MeshStandardMaterial({ color: '#4a3222', roughness: 0.75, transparent: true })
    return {
      mats: [tile, upper, wood],
      tile,
      upper,
      wood,
      // the tiers keep the proportions of the floor they cover, so the eave
      // still overhangs the walls after the room shrinks
      lower: frustum(batur.w + 1.4, batur.d + 1.4, eaveY, batur.w * 0.652, batur.d * 0.556, 5.3),
      top: frustum(batur.w * 0.522, batur.d * 0.389, 5.6, 9, 0.6, 11.6),
      band: {
        size: [batur.w * 0.548, 0.3, batur.d * 0.422] as [number, number, number],
        y: 5.45,
      },
    }
  }, [])

  useFrame((_, dt) => {
    const c = camera.position
    const outside = Math.abs(c.x) > EXTERIOR.batur.w / 2 || Math.abs(c.z) > EXTERIOR.batur.d / 2 || c.y > 13
    const target = show && outside ? 1 : 0
    fade.current = THREE.MathUtils.damp(fade.current, target, 5, dt)
    if (Math.abs(fade.current - target) < 0.002) fade.current = target
    const o = fade.current
    for (const m of parts.mats) {
      m.opacity = o
      // opaque once fully shown, so the tiers sort and shade like solid geometry
      m.transparent = o < 1
      m.depthWrite = o > 0.5
    }
    if (group.current) group.current.visible = o > 0.001


    // open the fog up for the outside view; the rooms keep their warm haze
    const fog = scene.fog as THREE.Fog | null
    if (fog) {
      fog.near = THREE.MathUtils.lerp(30, 60, o)
      fog.far = THREE.MathUtils.lerp(85, 160, o)
    }
  })

  return (
    <group ref={group} visible={false}>
      {/* the veranda posts belong to the roof: without it they read as a fence */}
      <Saka />
      <mesh geometry={parts.lower} material={parts.tile} />
      <mesh position={[0, parts.band.y, 0]} material={parts.wood}>
        <boxGeometry args={parts.band.size} />
      </mesh>
      <mesh geometry={parts.top} material={parts.upper} />
      {/* molo ridge with a mustoko at each end */}
      <mesh position={[0, 11.7, 0]} material={parts.wood}>
        <boxGeometry args={[9.4, 0.24, 0.5]} />
      </mesh>
      {[-4.8, 4.8].map((x) => (
        <mesh key={x} position={[x, 12.15, 0]} material={parts.wood}>
          <coneGeometry args={[0.28, 0.9, 6]} />
        </mesh>
      ))}
    </group>
  )
}
