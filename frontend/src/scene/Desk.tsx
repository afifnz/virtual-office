import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { AgentStatus } from '../lib/types'

const STATUS_COLOR: Record<AgentStatus, string> = {
  working: '#f0b25a',
  reviewing: '#a98ce0',
  blocked: '#e2705f',
  idle: '#6f9fd8',
  offline: '#6b6a66',
}

/** Teak desk with drawers, a monitor, a keyboard, a mug and a status lamp. */
export function Desk({ status, dim = false }: { status: AgentStatus; dim?: boolean }) {
  const screen = useRef<THREE.MeshStandardMaterial>(null)
  const lamp = useRef<THREE.MeshStandardMaterial>(null)
  const cursor = useRef<THREE.Mesh>(null)
  const color = STATUS_COLOR[status]
  const off = status === 'offline'
  const working = status === 'working' || status === 'reviewing'

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (screen.current) {
      const base = off ? 0.02 : working ? 0.55 : 0.22
      screen.current.emissiveIntensity = base + (off ? 0 : Math.sin(t * (working ? 6 : 1.4)) * 0.08)
    }
    if (lamp.current) {
      const pulse = status === 'blocked' ? 0.4 + Math.abs(Math.sin(t * 2.4)) * 0.6 : 0.55
      lamp.current.emissiveIntensity = off ? 0.06 : pulse
    }
    if (cursor.current && working) {
      cursor.current.position.x = -0.05 + (Math.sin(t * 2.2) > 0 ? 0.02 : 0)
    }
  })

  return (
    <group>
      {/* top */}
      <mesh position={[0, 0.745, 0]}>
        <boxGeometry args={[1.62, 0.055, 0.78]} />
        <meshStandardMaterial color={dim ? '#5c4632' : '#8a6142'} roughness={0.62} />
      </mesh>
      {/* front lip: a thin apron, not a full drawer block — the seated
          avatar's thighs pass under it, so the lap never enters the desk */}
      <mesh position={[0, 0.6885, 0.345]}>
        <boxGeometry args={[1.5, 0.058, 0.09]} />
        <meshStandardMaterial color="#6f4c34" roughness={0.7} />
      </mesh>
      <mesh position={[-0.36, 0.6885, 0.393]}>
        <boxGeometry args={[0.28, 0.02, 0.014]} />
        <meshStandardMaterial color="#b08a52" roughness={0.4} metalness={0.45} />
      </mesh>
      <mesh position={[0.36, 0.6885, 0.393]}>
        <boxGeometry args={[0.28, 0.02, 0.014]} />
        <meshStandardMaterial color="#b08a52" roughness={0.4} metalness={0.45} />
      </mesh>
      {/* legs */}
      {[
        [-0.72, -0.32],
        [0.72, -0.32],
        [-0.72, 0.32],
        [0.72, 0.32],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x!, 0.36, z!]}>
          <boxGeometry args={[0.07, 0.72, 0.07]} />
          <meshStandardMaterial color="#5a3d29" roughness={0.72} />
        </mesh>
      ))}

      {/* laptop, set to the side and opened flat: at dashboard distance a
          taller lid hides the chest, and the chest is what says "working" */}
      <group position={[-0.47, 0.775, -0.04]} rotation={[0, 0.75, 0]}>
        <mesh position={[0, 0.008, 0]}>
          <boxGeometry args={[0.34, 0.016, 0.24]} />
          <meshStandardMaterial color="#3b3833" roughness={0.55} metalness={0.25} />
        </mesh>
        <mesh position={[0, 0.02, 0.02]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.3, 0.17]} />
          <meshStandardMaterial color="#2a2723" roughness={0.7} />
        </mesh>
        <group position={[0, 0.012, -0.115]} rotation={[-0.5, 0, 0]}>
          <mesh position={[0, 0.085, 0]}>
            <boxGeometry args={[0.31, 0.175, 0.012]} />
            <meshStandardMaterial color="#34312c" roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.085, 0.008]}>
            <planeGeometry args={[0.285, 0.15]} />
            <meshStandardMaterial
              ref={screen}
              color="#1b2430"
              emissive={off ? '#0a0d12' : '#3d6b8c'}
              emissiveIntensity={off ? 0.02 : 0.5}
              roughness={0.3}
            />
          </mesh>
          {!off ? (
            <group position={[0, 0.085, 0.012]}>
              {[0.05, 0.018, -0.014, -0.046].map((y, i) => (
                <mesh key={i} position={[-0.05 + i * 0.011, y, 0]}>
                  <planeGeometry args={[0.09 + i * 0.045, 0.009]} />
                  <meshBasicMaterial color={i % 2 ? '#8fc4e0' : '#c9d8e0'} transparent opacity={0.4} />
                </mesh>
              ))}
              <mesh ref={cursor} position={[-0.02, -0.062, 0]}>
                <planeGeometry args={[0.01, 0.022]} />
                <meshBasicMaterial color="#e8c07a" />
              </mesh>
            </group>
          ) : null}
        </group>
      </group>

      {/* keyboard + mouse, centred on the seated avatar's hands */}
      <mesh position={[0.04, 0.777, 0.16]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.42, 0.018, 0.14]} />
        <meshStandardMaterial color="#2f2c29" roughness={0.7} />
      </mesh>
      <mesh position={[0.32, 0.777, 0.16]} scale={[1, 0.6, 1]}>
        <sphereGeometry args={[0.038, 12, 8]} />
        <meshStandardMaterial color="#2f2c29" roughness={0.6} />
      </mesh>

      {/* mug */}
      <group position={[-0.62, 0.775, 0.16]}>
        <mesh position={[0, 0.045, 0]}>
          <cylinderGeometry args={[0.045, 0.04, 0.09, 14, 1, true]} />
          <meshStandardMaterial color="#dfd3bd" roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.045, 0]}>
          <cylinderGeometry args={[0.038, 0.036, 0.088, 14]} />
          <meshStandardMaterial color="#4a3226" roughness={0.35} />
        </mesh>
        <mesh position={[0.052, 0.045, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.026, 0.008, 6, 12, Math.PI * 1.4]} />
          <meshStandardMaterial color="#dfd3bd" roughness={0.5} />
        </mesh>
      </group>

      {/* status lamp */}
      <group position={[0.66, 0.775, -0.24]}>
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.012, 0.02, 0.1, 8]} />
          <meshStandardMaterial color="#3a332c" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.11, 0]}>
          <sphereGeometry args={[0.032, 12, 10]} />
          <meshStandardMaterial
            ref={lamp}
            color={color}
            emissive={color}
            emissiveIntensity={off ? 0.06 : 0.55}
            roughness={0.3}
            transparent
            opacity={0.92}
          />
        </mesh>
      </group>
    </group>
  )
}

/** Rattan chair; the seated avatar covers the seat. Deliberately darker than
 *  any outfit in lib/agents.ts so the silhouette separates at overview scale. */
export function Chair({ dim = false }: { dim?: boolean }) {
  const wood = dim ? '#3a2b20' : '#4f3726'
  return (
    <group>
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
      ].map(([x, z], i) => (
        <mesh key={i} position={[x!, 0.22, z!]}>
          <boxGeometry args={[0.04, 0.45, 0.04]} />
          <meshStandardMaterial color={wood} roughness={0.78} />
        </mesh>
      ))}
    </group>
  )
}

export { STATUS_COLOR }
