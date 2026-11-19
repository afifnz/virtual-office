import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Agent } from '../lib/types'
import { agentMeta } from '../lib/roster'
import { labelTexture } from '../lib/label'
import { contactShadowTexture } from '../lib/textures'
import { statusLabel } from '../lib/format'

/** Everything in the office that is not a desk or a person. */
export function Furniture({ agents }: { agents: Agent[] }) {
  return (
    <group>
      <Reception />
      <MeetingTable />
      <Lounge />
      <KopiCorner />
      <CafeTable />
      <Gamelan />
      <ServerRack />
      <TaskBoard
        x={-10.0}
        z={-14.7}
        title="SPRINT TIM DEV"
        accent="#82aac8"
        agents={agents.filter((a) => agentMeta(a.id).team === 'dev')}
      />
      <TaskBoard
        x={10.0}
        z={-14.7}
        title="PAPAN ADDIE"
        accent="#deb860"
        agents={agents.filter((a) => agentMeta(a.id).team === 'edu')}
      />
      <Bookshelf />
      <Lesehan />
      <Cat />
      <Entrance />
      <Rug shadows={[[-5.4, 10.6], [18.4, 8.8], [8.0, 12.0]]} />
    </group>
  )
}

/** Soft contact shadows to ground the furniture without shadow maps. */
function Rug({ shadows }: { shadows: Array<[number, number]> }) {
  const tex = contactShadowTexture()
  return (
    <group>
      {shadows.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.008, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[4.6, 3.2]} />
          <meshBasicMaterial map={tex} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function Reception() {
  const plate = labelTexture({
    text: 'RESEPSIONIS',
    color: '#f6ecdb',
    bg: 'rgba(46,31,23,0.9)',
    border: '#d4805c',
    px: 44,
  })
  return (
    // beside Ndoro Kakung's desk, its front turned to the entrance path (+x), so a
    // visitor walking in sees the plate and nobody sits staring at its back
    <group position={[-3.9, 0, 10.8]} rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, 0.52, 0]}>
        <boxGeometry args={[2.6, 1.04, 0.62]} />
        <meshStandardMaterial color="#7c5638" roughness={0.72} />
      </mesh>
      <mesh position={[0, 1.06, 0]}>
        <boxGeometry args={[2.76, 0.07, 0.74]} />
        <meshStandardMaterial color="#a9805a" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.52, 0.315]}>
        <boxGeometry args={[2.4, 0.7, 0.03]} />
        <meshStandardMaterial color="#8d6544" roughness={0.7} />
      </mesh>
      <sprite position={[0, 1.28, 0.1]} scale={[0.9, 0.9 / plate.aspect, 1]}>
        <spriteMaterial map={plate.tex} transparent depthWrite={false} />
      </sprite>
      {/* vase */}
      <mesh position={[-1.0, 1.16, 0]}>
        <cylinderGeometry args={[0.07, 0.1, 0.2, 10]} />
        <meshStandardMaterial color="#c9b79c" roughness={0.6} />
      </mesh>
      <mesh position={[-1.0, 1.36, 0]}>
        <sphereGeometry args={[0.14, 10, 8]} />
        <meshStandardMaterial color="#5c7d4a" roughness={0.9} />
      </mesh>
    </group>
  )
}

/** Meja rapat: a teak table for six on the pendopo's east side. */
function MeetingTable() {
  const wood = '#4f3726'
  const chairs: Array<[number, number, number]> = [-1.0, 0, 1.0].flatMap((x) => [
    [x, -0.8, Math.PI] as [number, number, number],
    [x, 0.8, 0] as [number, number, number],
  ])
  return (
    <group position={[8.0, 0, 12.0]}>
      <mesh position={[0, 0.745, 0]}>
        <boxGeometry args={[3.0, 0.06, 1.1]} />
        <meshStandardMaterial color="#8a6142" roughness={0.6} />
      </mesh>
      {[
        [-1.38, -0.45],
        [1.38, -0.45],
        [-1.38, 0.45],
        [1.38, 0.45],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x!, 0.36, z!]}>
          <boxGeometry args={[0.08, 0.72, 0.08]} />
          <meshStandardMaterial color="#5a3d29" roughness={0.72} />
        </mesh>
      ))}
      {/* papers and a clay kendi in the middle */}
      {[-0.7, 0.55].map((x, i) => (
        <mesh key={x} position={[x, 0.782, i ? 0.12 : -0.1]} rotation={[0, i ? -0.2 : 0.15, 0]}>
          <boxGeometry args={[0.3, 0.012, 0.22]} />
          <meshStandardMaterial color="#efe6d4" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 0.87, 0]}>
        <sphereGeometry args={[0.11, 14, 12]} />
        <meshStandardMaterial color="#a8603e" roughness={0.75} />
      </mesh>
      <mesh position={[0, 1.0, 0]}>
        <cylinderGeometry args={[0.03, 0.045, 0.1, 10]} />
        <meshStandardMaterial color="#a8603e" roughness={0.75} />
      </mesh>
      {chairs.map(([x, z, r], i) => (
        <group key={i} position={[x, 0, z]} rotation={[0, r, 0]}>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.46, 0.045, 0.44]} />
            <meshStandardMaterial color={wood} roughness={0.78} />
          </mesh>
          <mesh position={[0, 0.74, 0.215]}>
            <boxGeometry args={[0.44, 0.5, 0.04]} />
            <meshStandardMaterial color={wood} roughness={0.78} />
          </mesh>
          {[
            [-0.19, -0.18],
            [0.19, -0.18],
            [-0.19, 0.18],
            [0.19, 0.18],
          ].map(([lx, lz], j) => (
            <mesh key={j} position={[lx!, 0.22, lz!]}>
              <boxGeometry args={[0.04, 0.45, 0.04]} />
              <meshStandardMaterial color={wood} roughness={0.78} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

/** A round bistro table with two stools, a step away from the warung kopi. */
function CafeTable() {
  return (
    <group position={[-15.5, 0, 5.2]}>
      <mesh position={[0, 0.74, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 0.05, 20]} />
        <meshStandardMaterial color="#8a6142" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.37, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.72, 8]} />
        <meshStandardMaterial color="#3a2b20" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.22, 0.24, 0.04, 14]} />
        <meshStandardMaterial color="#3a2b20" roughness={0.6} />
      </mesh>
      {/* two cups of kopi tubruk */}
      {[-0.14, 0.16].map((x) => (
        <mesh key={x} position={[x, 0.8, x > 0 ? 0.08 : -0.06]}>
          <cylinderGeometry args={[0.045, 0.038, 0.08, 12]} />
          <meshStandardMaterial color="#dfd3bd" roughness={0.5} />
        </mesh>
      ))}
      {[-0.72, 0.72].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 0.46, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.06, 14]} />
            <meshStandardMaterial color="#8c6a44" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.035, 0.05, 0.44, 8]} />
            <meshStandardMaterial color="#6d4f31" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Lounge() {
  return (
    <group position={[19.4, 0, 8.8]} rotation={[0, Math.PI / 2, 0]}>
      {/* sofa */}
      <group position={[0, 0, 0]}>
        <mesh position={[0, 0.24, 0]}>
          <boxGeometry args={[2.4, 0.36, 0.9]} />
          <meshStandardMaterial color="#8a5f4a" roughness={0.92} />
        </mesh>
        <mesh position={[0, 0.58, 0.34]}>
          <boxGeometry args={[2.4, 0.72, 0.22]} />
          <meshStandardMaterial color="#96684f" roughness={0.92} />
        </mesh>
        {[-0.75, 0, 0.75].map((x) => (
          <mesh key={x} position={[x, 0.5, 0.06]}>
            <boxGeometry args={[0.7, 0.16, 0.72]} />
            <meshStandardMaterial color="#a5765a" roughness={0.95} />
          </mesh>
        ))}
        {[-1.2, 1.2].map((x) => (
          <mesh key={x} position={[x, 0.44, 0]}>
            <boxGeometry args={[0.18, 0.4, 0.9]} />
            <meshStandardMaterial color="#7d5541" roughness={0.92} />
          </mesh>
        ))}
      </group>
      {/* coffee table */}
      <group position={[0, 0, -1.6]}>
        <mesh position={[0, 0.42, 0]}>
          <boxGeometry args={[1.3, 0.07, 0.7]} />
          <meshStandardMaterial color="#8a6142" roughness={0.65} />
        </mesh>
        {[
          [-0.55, -0.28],
          [0.55, -0.28],
          [-0.55, 0.28],
          [0.55, 0.28],
        ].map(([x, z], i) => (
          <mesh key={i} position={[x!, 0.21, z!]}>
            <boxGeometry args={[0.06, 0.42, 0.06]} />
            <meshStandardMaterial color="#6b4a32" roughness={0.7} />
          </mesh>
        ))}
        <mesh position={[0.2, 0.47, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.03, 14]} />
          <meshStandardMaterial color="#d8c9ae" roughness={0.6} />
        </mesh>
      </group>
      {/* rattan chairs */}
      {[
        [-2.2, -1.6, 0.6],
        [2.2, -1.6, -0.6],
      ].map(([x, z, r], i) => (
        <group key={i} position={[x!, 0, z!]} rotation={[0, r!, 0]}>
          <mesh position={[0, 0.42, 0]}>
            <cylinderGeometry args={[0.36, 0.32, 0.1, 14]} />
            <meshStandardMaterial color="#b08b5e" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.7, 0.3]}>
            <cylinderGeometry args={[0.34, 0.34, 0.5, 14, 1, true, -0.5, Math.PI + 1]} />
            <meshStandardMaterial color="#bd9668" roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
          {[
            [-0.24, -0.24],
            [0.24, -0.24],
            [-0.24, 0.24],
            [0.24, 0.24],
          ].map(([lx, lz], j) => (
            <mesh key={j} position={[lx!, 0.19, lz!]}>
              <cylinderGeometry args={[0.03, 0.03, 0.38, 6]} />
              <meshStandardMaterial color="#8e6c45" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

function KopiCorner() {
  const plate = labelTexture({
    text: 'WARUNG KOPI',
    color: '#f6ecdb',
    bg: 'rgba(46,31,23,0.88)',
    border: '#c08a52',
    px: 40,
  })
  return (
    <group position={[-19.3, 0, 8.0]} rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, 0.52, 0]}>
        <boxGeometry args={[2.8, 1.04, 0.6]} />
        <meshStandardMaterial color="#6f4c32" roughness={0.75} />
      </mesh>
      <mesh position={[0, 1.06, 0]}>
        <boxGeometry args={[2.94, 0.06, 0.72]} />
        <meshStandardMaterial color="#b08a5c" roughness={0.6} />
      </mesh>
      <sprite position={[0, 1.55, 0.05]} scale={[1.5, 1.5 / plate.aspect, 1]}>
        <spriteMaterial map={plate.tex} transparent depthWrite={false} />
      </sprite>
      {/* jars of kerupuk */}
      {[-0.9, -0.5, 0.9].map((x, i) => (
        <group key={x} position={[x, 1.1, 0]}>
          <mesh position={[0, 0.16, 0]}>
            <cylinderGeometry args={[0.13, 0.13, 0.32, 12]} />
            <meshStandardMaterial color="#cfd8cf" roughness={0.25} transparent opacity={0.6} />
          </mesh>
          <mesh position={[0, 0.14, 0]}>
            <cylinderGeometry args={[0.115, 0.115, 0.24, 12]} />
            <meshStandardMaterial color={i === 1 ? '#e0a35c' : '#c98d52'} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* kettle + cups */}
      <group position={[0.3, 1.09, 0]}>
        <mesh position={[0, 0.13, 0]}>
          <cylinderGeometry args={[0.11, 0.13, 0.24, 12]} />
          <meshStandardMaterial color="#3d3a36" roughness={0.4} metalness={0.4} />
        </mesh>
        <mesh position={[0.14, 0.16, 0]} rotation={[0, 0, -0.5]}>
          <cylinderGeometry args={[0.02, 0.02, 0.16, 6]} />
          <meshStandardMaterial color="#3d3a36" roughness={0.4} metalness={0.4} />
        </mesh>
      </group>
      {[-0.3, 0.05].map((x) => (
        <mesh key={x} position={[x, 1.13, 0.2]}>
          <cylinderGeometry args={[0.05, 0.042, 0.07, 10]} />
          <meshStandardMaterial color="#e4d8c2" roughness={0.55} />
        </mesh>
      ))}
      {/* stools */}
      {[-0.9, 0, 0.9].map((x) => (
        <group key={x} position={[x, 0, 1.05]}>
          <mesh position={[0, 0.44, 0]}>
            <cylinderGeometry args={[0.22, 0.22, 0.06, 12]} />
            <meshStandardMaterial color="#8c6a44" roughness={0.85} />
          </mesh>
          {[
            [-0.13, -0.13],
            [0.13, -0.13],
            [-0.13, 0.13],
            [0.13, 0.13],
          ].map(([lx, lz], i) => (
            <mesh key={i} position={[lx!, 0.22, lz!]}>
              <cylinderGeometry args={[0.022, 0.022, 0.44, 6]} />
              <meshStandardMaterial color="#6d4f31" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

function Gamelan() {
  return (
    <group position={[-19.1, 0, -5.6]} rotation={[0, Math.PI / 2, 0]}>
      {/* gong frame */}
      <group position={[0, 0, -0.6]}>
        {[-0.9, 0.9].map((x) => (
          <mesh key={x} position={[x, 0.95, 0]}>
            <boxGeometry args={[0.1, 1.9, 0.1]} />
            <meshStandardMaterial color="#5c3f28" roughness={0.8} />
          </mesh>
        ))}
        <mesh position={[0, 1.86, 0]}>
          <boxGeometry args={[2.0, 0.12, 0.14]} />
          <meshStandardMaterial color="#5c3f28" roughness={0.8} />
        </mesh>
        {[-0.55, 0.0, 0.55].map((x, i) => (
          <group key={x} position={[x, 1.2 + i * 0.12, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.26 - i * 0.03, 0.28 - i * 0.03, 0.06, 18]} />
              <meshStandardMaterial color="#b79a52" roughness={0.35} metalness={0.65} />
            </mesh>
            <mesh position={[0, 0, 0.12]} rotation={[Math.PI / 2, 0, 0]}>
              <sphereGeometry args={[0.07, 10, 8]} />
              <meshStandardMaterial color="#c8a95c" roughness={0.35} metalness={0.6} />
            </mesh>
          </group>
        ))}
      </group>
      {/* saron on a low stand */}
      <group position={[0, 0, 0.8]}>
        <mesh position={[0, 0.62, 0]}>
          <boxGeometry args={[1.5, 0.1, 0.6]} />
          <meshStandardMaterial color="#5c3f28" roughness={0.8} />
        </mesh>
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i} position={[-0.6 + i * 0.2, 0.7, 0]}>
            <boxGeometry args={[0.14, 0.05, 0.42]} />
            <meshStandardMaterial color="#b79a52" roughness={0.32} metalness={0.7} />
          </mesh>
        ))}
      </group>
      {/* kendang */}
      <mesh position={[1.1, 0.32, 0.9]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.26, 0.6, 14]} />
        <meshStandardMaterial color="#7a5230" roughness={0.7} />
      </mesh>
    </group>
  )
}

function ServerRack() {
  const leds = useRef<THREE.Group>(null)
  useFrame((s) => {
    if (!leds.current) return
    const t = s.clock.elapsedTime
    leds.current.children.forEach((c, i) => {
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial
      m.emissiveIntensity = 0.35 + Math.abs(Math.sin(t * (2 + (i % 5)) + i)) * 0.8
    })
  })
  return (
    <group position={[-17.2, 0, -14.4]}>
      <mesh position={[0, 1.0, 0]}>
        <boxGeometry args={[1.1, 2.0, 0.8]} />
        <meshStandardMaterial color="#2b2b2e" roughness={0.6} metalness={0.35} />
      </mesh>
      <group ref={leds}>
        {Array.from({ length: 16 }).map((_, i) => (
          <mesh key={i} position={[-0.38 + (i % 8) * 0.11, 1.72 - Math.floor(i / 8) * 0.24, 0.41]}>
            <sphereGeometry args={[0.022, 8, 6]} />
            <meshStandardMaterial
              color={i % 3 === 0 ? '#7fe0a0' : i % 3 === 1 ? '#ffcf6a' : '#8fbcff'}
              emissive={i % 3 === 0 ? '#4fc47a' : i % 3 === 1 ? '#e0a030' : '#4f86d0'}
              emissiveIntensity={0.6}
            />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 2.06, 0]}>
        <boxGeometry args={[1.2, 0.1, 0.9]} />
        <meshStandardMaterial color="#1e1e21" roughness={0.7} />
      </mesh>
    </group>
  )
}

function TaskBoard({
  x,
  z,
  title,
  accent,
  agents,
}: {
  x: number
  z: number
  title: string
  accent: string
  agents: Agent[]
}) {
  const live = agents
    .filter((a) => a.status === 'working' || a.status === 'reviewing' || a.status === 'blocked')
    .slice(0, 5)
    .map((a) => {
      const m = agentMeta(a.id)
      const tool = a.current?.tools?.[0]
      return `${m.name} · ${a.status === 'blocked' ? 'terblokir' : tool ? tool : statusLabel(a.status)}`
    })
  const running = agents.filter((a) => a.status === 'working' || a.status === 'reviewing').length
  const plate = labelTexture({
    text: title,
    sub: live.length ? live.join('   /   ') : 'tidak ada yang bekerja',
    color: '#f4ead7',
    subColor: 'rgba(244,234,215,0.72)',
    bg: '#28201b',
    border: accent,
    bar: accent,
    px: 40,
  })
  return (
    <group position={[x, 1.75, z]}>
      <mesh>
        <boxGeometry args={[3.6, 1.5, 0.08]} />
        <meshStandardMaterial color="#2c231d" roughness={0.85} />
      </mesh>
      <sprite position={[0, 0.05, 0.12]} scale={[3.3, 3.3 / plate.aspect, 1]}>
        <spriteMaterial map={plate.tex} transparent depthWrite={false} />
      </sprite>
      <mesh position={[-1.55, 0.62, 0.06]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={running ? 0.9 : 0.15} />
      </mesh>
    </group>
  )
}

function Bookshelf() {
  const books = [
    '#8e4b3f', '#3f5c78', '#6b7a4a', '#a8843c', '#5a4a6b', '#7a5340',
    '#3f6b64', '#8c5a6b', '#4a5a3c', '#a06a3c', '#4b4b6b', '#6b4a3a',
  ]
  return (
    <group position={[19.5, 0, -11.0]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh position={[0, 1.1, 0]}>
        <boxGeometry args={[2.6, 2.2, 0.42]} />
        <meshStandardMaterial color="#6b4a30" roughness={0.78} />
      </mesh>
      {[0.32, 0.85, 1.38, 1.9].map((y, r) => (
        <group key={y}>
          <mesh position={[0, y, 0.22]}>
            <boxGeometry args={[2.4, 0.04, 0.06]} />
            <meshStandardMaterial color="#8a6142" roughness={0.7} />
          </mesh>
          {Array.from({ length: 9 }).map((_, i) => (
            <mesh key={i} position={[-1.0 + i * 0.24, y + 0.17, 0.08]}>
              <boxGeometry args={[0.05, 0.32 - (i % 3) * 0.04, 0.24]} />
              <meshStandardMaterial color={books[(i + r * 3) % books.length]} roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

function Lesehan() {
  return (
    <group position={[16.6, 0, -6.2]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <planeGeometry args={[3.4, 2.6]} />
        <meshStandardMaterial color="#b99b6a" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.28, 0]}>
        <boxGeometry args={[1.5, 0.1, 0.9]} />
        <meshStandardMaterial color="#7a5638" roughness={0.75} />
      </mesh>
      {[
        [-0.6, -0.35],
        [0.6, -0.35],
        [-0.6, 0.35],
        [0.6, 0.35],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x!, 0.13, z!]}>
          <boxGeometry args={[0.08, 0.26, 0.08]} />
          <meshStandardMaterial color="#66452c" roughness={0.8} />
        </mesh>
      ))}
      {/* cushions */}
      {[
        [-1.05, 0.9],
        [1.05, 0.9],
        [0, -0.95],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x!, 0.09, z!]} scale={[1, 0.5, 1]}>
          <sphereGeometry args={[0.3, 12, 10]} />
          <meshStandardMaterial color={i === 1 ? '#7a4a4a' : '#4a5a6b'} roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function Cat() {
  const tail = useRef<THREE.Mesh>(null)
  const head = useRef<THREE.Group>(null)
  useFrame((s) => {
    const t = s.clock.elapsedTime
    if (tail.current) tail.current.rotation.z = Math.sin(t * 1.6) * 0.35
    if (head.current) head.current.rotation.y = Math.sin(t * 0.7) * 0.3
  })
  return (
    <group position={[3.6, 0, 12.6]} rotation={[0, -0.5, 0]}>
      <mesh position={[0, 0.16, 0]} scale={[1, 0.9, 1.5]}>
        <sphereGeometry args={[0.19, 14, 12]} />
        <meshStandardMaterial color="#d68a3f" roughness={0.95} />
      </mesh>
      <group ref={head} position={[0, 0.28, 0.26]}>
        <mesh>
          <sphereGeometry args={[0.13, 14, 12]} />
          <meshStandardMaterial color="#dc9448" roughness={0.95} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.07, 0.11, 0]} rotation={[0, 0, s * 0.3]}>
            <coneGeometry args={[0.045, 0.09, 4]} />
            <meshStandardMaterial color="#d68a3f" roughness={0.95} />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <mesh key={`e${s}`} position={[s * 0.05, 0.02, 0.11]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshStandardMaterial color="#2a2018" />
          </mesh>
        ))}
      </group>
      <mesh ref={tail} position={[0, 0.2, -0.26]} rotation={[0.6, 0, 0]}>
        <capsuleGeometry args={[0.03, 0.26, 4, 8]} />
        <meshStandardMaterial color="#d68a3f" roughness={0.95} />
      </mesh>
    </group>
  )
}

function Entrance() {
  return (
    <group position={[0, 0, 15.6]}>
      <mesh position={[0, 0.09, 0]}>
        <boxGeometry args={[5.6, 0.18, 1.8]} />
        <meshStandardMaterial color="#9a8f7c" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.26, 0.7]}>
        <boxGeometry args={[5.8, 0.16, 0.5]} />
        <meshStandardMaterial color="#8a8069" roughness={0.95} />
      </mesh>
      {/* porch posts */}
      {[-2.5, 2.5].map((x) => (
        <mesh key={x} position={[x, 1.5, 0.6]}>
          <cylinderGeometry args={[0.11, 0.13, 3.0, 10]} />
          <meshStandardMaterial color="#6b4a30" roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}
