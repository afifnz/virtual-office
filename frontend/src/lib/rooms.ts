import { AGENTS } from './agents'

/** The floor is 60 x 32 in world units (1 unit ~ 1 m). */
export const FLOOR = { w: 60, d: 32, y: 0 } as const
export const WALL_H = 3.4
export const WALL_T = 0.22

export interface WallSeg {
  /** axis 'x' = runs along x at a fixed z, 'z' = runs along z at a fixed x */
  axis: 'x' | 'z'
  at: number
  from: number
  to: number
  h?: number
}

/**
 * Room split — Pendopo across the front (z > 4), Tim Dev back-left (x < 0),
 * Tim Edu back-right (x > 0). Doors: two to the pendopo, one between teams.
 */
export const WALLS: WallSeg[] = [
  // outer shell
  { axis: 'x', at: -16, from: -30, to: 30 }, // back
  { axis: 'z', at: -30, from: -16, to: 16 }, // left
  { axis: 'z', at: 30, from: -16, to: 16 }, // right
  // front wall with the main entrance gap (x -2.5 .. 2.5)
  { axis: 'x', at: 16, from: -30, to: -2.5 },
  { axis: 'x', at: 16, from: 2.5, to: 30 },
  // pendopo / team rooms partition, with two doorways
  { axis: 'x', at: 4, from: -30, to: -10.2 },
  { axis: 'x', at: 4, from: -5.8, to: 5.8 },
  { axis: 'x', at: 4, from: 10.2, to: 30 },
  // dev | edu divider, doorway at z -1.4 .. 1.4
  { axis: 'z', at: 0, from: -16, to: -1.4 },
  { axis: 'z', at: 0, from: 1.4, to: 4 },
]

export const DOORS = [
  { x: 0, z: 16, rot: 0, label: 'MASUK' },
  { x: -8, z: 4, rot: 0, label: 'TIM DEV' },
  { x: 8, z: 4, rot: 0, label: 'TIM EDU' },
  { x: 0, z: 0, rot: Math.PI / 2, label: '' },
]

export interface DeskSpot {
  id: string
  x: number
  z: number
  rot: number
}

/** One desk per agent, using the same coordinates as the p5 office. */
export const DESKS: DeskSpot[] = AGENTS.map((a) => ({ id: a.id, ...a.desk }))

/** Where a seated agent stands up to (just behind their chair). */
export const DESK_EXIT: Record<string, [number, number]> = Object.fromEntries(
  DESKS.map((d) => {
    const fx = Math.sin(d.rot)
    const fz = Math.cos(d.rot)
    return [d.id, [d.x - fx * 1.9, d.z - fz * 1.9] as [number, number]]
  }),
)

/** Camera presets; the HUD jumps between them. */
export interface Spot {
  id: string
  label: string
  pos: [number, number, number]
  target: [number, number, number]
  fov: number
}

export const SPOTS: Record<string, Spot> = {
  lobby: { id: 'lobby', label: 'Pendopo', pos: [1.2, 1.95, 12.6], target: [-6, 1.05, 7.8], fov: 52 },
  dev: { id: 'dev', label: 'Tim Dev', pos: [-8.6, 2.1, 0.4], target: [-16.5, 0.95, -9.6], fov: 48 },
  edu: { id: 'edu', label: 'Tim Edu', pos: [9.4, 2.1, 0.4], target: [17, 0.95, -9.6], fov: 48 },
  tampak: { id: 'tampak', label: 'Tampak', pos: [0, 16, 29], target: [0, 0, -2], fov: 42 },
}

export const START_SPOT: Spot = SPOTS.lobby!

export interface Poi {
  id: string
  name: string
  pos: [number, number]
  act: 'sip' | 'gamelan' | 'pet' | 'read' | 'check' | 'sit' | 'gaze' | 'chat'
  team: 'lobby' | 'dev' | 'edu'
}

/** Idle agents walk to one of these, do the act, then walk home. */
export const POIS: Poi[] = [
  { id: 'kopi', name: 'warung kopi', pos: [-13, 6.4], act: 'sip', team: 'lobby' },
  { id: 'jendela', name: 'jendela', pos: [-26, 14.2], act: 'gaze', team: 'lobby' },
  { id: 'kucing', name: 'kucing oren', pos: [3.6, 11.6], act: 'pet', team: 'lobby' },
  { id: 'resepsionis', name: 'meja resepsionis', pos: [-7.4, 5.6], act: 'chat', team: 'lobby' },
  { id: 'gamelan', name: 'gamelan', pos: [-25.4, -5.2], act: 'gamelan', team: 'dev' },
  { id: 'server', name: 'rak server', pos: [-7.4, -14.2], act: 'check', team: 'dev' },
  { id: 'papan', name: 'papan sprint', pos: [-16.5, -14.6], act: 'read', team: 'dev' },
  { id: 'buku', name: 'rak buku', pos: [25.2, -14.4], act: 'read', team: 'edu' },
  { id: 'lesehan', name: 'lesehan', pos: [24.2, -10.4], act: 'sit', team: 'edu' },
]

/** Waypoint graph — every edge is walkable and clear of furniture. */
export interface NavNode {
  id: string
  x: number
  z: number
}

export const NAV: NavNode[] = [
  // pendopo
  { id: 'gate', x: 0, z: 14.4 },
  { id: 'lobby-c', x: -1.5, z: 10.6 },
  { id: 'lobby-w', x: -9.5, z: 9.6 },
  { id: 'lobby-e', x: 6.6, z: 9.4 },
  { id: 'door-dev', x: -8, z: 5.2 },
  { id: 'door-edu', x: 8, z: 5.2 },
  { id: 'window', x: -24, z: 12.4 },
  { id: 'cat', x: 3.6, z: 9.4 },
  // dev room
  { id: 'dev-in', x: -8, z: 1.6 },
  { id: 'dev-mid', x: -11.6, z: -4.6 },
  { id: 'dev-front', x: -16.5, z: -6.2 },
  { id: 'dev-west', x: -21.4, z: -6.2 },
  { id: 'dev-back', x: -16.5, z: -12.9 },
  { id: 'dev-server', x: -8.6, z: -12.4 },
  { id: 'dev-east', x: -4.6, z: -6.6 },
  { id: 'dev-gamelan', x: -24.6, z: -4.0 },
  { id: 'inner-door', x: 0, z: 0 },
  // edu room
  { id: 'edu-in', x: 8, z: 1.6 },
  { id: 'edu-mid', x: 11.4, z: -5.2 },
  { id: 'edu-front', x: 17, z: -5.4 },
  { id: 'edu-west', x: 11.6, z: -9.5 },
  { id: 'edu-back', x: 17, z: -13.2 },
  { id: 'edu-east', x: 22.2, z: -9.5 },
  { id: 'edu-books', x: 24.4, z: -13.6 },
  { id: 'edu-lesehan', x: 22.6, z: -10.6 },
]

export const NAV_EDGES: Array<[string, string]> = [
  ['gate', 'lobby-c'],
  ['lobby-c', 'lobby-w'],
  ['lobby-c', 'lobby-e'],
  ['lobby-c', 'cat'],
  ['lobby-w', 'door-dev'],
  ['lobby-w', 'window'],
  ['lobby-e', 'door-edu'],
  ['door-dev', 'dev-in'],
  ['door-edu', 'edu-in'],
  ['dev-in', 'dev-mid'],
  ['dev-mid', 'dev-front'],
  ['dev-mid', 'dev-east'],
  ['dev-mid', 'dev-west'],
  ['dev-mid', 'dev-server'],
  ['dev-front', 'dev-back'],
  ['dev-front', 'dev-west'],
  ['dev-back', 'dev-server'],
  ['dev-west', 'dev-gamelan'],
  ['dev-east', 'inner-door'],
  ['inner-door', 'edu-mid'],
  ['edu-in', 'edu-mid'],
  ['edu-mid', 'edu-front'],
  ['edu-mid', 'edu-west'],
  ['edu-front', 'edu-back'],
  ['edu-front', 'edu-east'],
  ['edu-west', 'edu-lesehan'],
  ['edu-east', 'edu-lesehan'],
  ['edu-back', 'edu-books'],
  ['edu-books', 'edu-lesehan'],
]

/** Nearest nav node to a point, used to enter/exit the graph from a desk. */
export function nearestNode(x: number, z: number): NavNode {
  let best = NAV[0]!
  let bestD = Infinity
  for (const n of NAV) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return best
}
