import { AGENTS } from './agents'
import { deskObstacle as deskFootprint, type Edge, type Obstacle } from './layout'
import { setFloorContext, setFurniture } from './roster'

/** The floor is 40 x 30 in world units (1 unit ~ 1 m): 4:3, not a corridor. */
export const FLOOR = { w: 40, d: 30, y: 0 } as const
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
 * Room split — Pendopo across the front (z 3..15, 40 x 12), Tim Dev back-left
 * (x -20..0, z -15..3) and Tim Edu back-right (x 0..20, z -15..3), both 20 x 18.
 * Doors: main entrance at x = 0 / z = 15, two symmetric team doors at x = +-10
 * on the z = 3 partition, one doorway between the teams at x = 0.
 */
export const WALLS: WallSeg[] = [
  // outer shell
  { axis: 'x', at: -15, from: -20, to: 20 }, // back
  { axis: 'z', at: -20, from: -15, to: 15 }, // left
  { axis: 'z', at: 20, from: -15, to: 15 }, // right
  // front wall with the main entrance gap (x -2.2 .. 2.2)
  { axis: 'x', at: 15, from: -20, to: -2.2 },
  { axis: 'x', at: 15, from: 2.2, to: 20 },
  // pendopo / team rooms partition, two symmetric doorways at x -12.2..-7.8 and 7.8..12.2
  { axis: 'x', at: 3, from: -20, to: -12.2 },
  { axis: 'x', at: 3, from: -7.8, to: 7.8 },
  { axis: 'x', at: 3, from: 12.2, to: 20 },
  // dev | edu divider, doorway at z -1.4 .. 1.4
  { axis: 'z', at: 0, from: -15, to: -1.4 },
  { axis: 'z', at: 0, from: 1.4, to: 3 },
]

export interface Door {
  x: number
  z: number
  /** 0 = the frame runs along x (opening faces +-z) */
  rot: number
  label: string
  /** clear opening width, the wall gap is the same size */
  w: number
}

export const DOORS: Door[] = [
  { x: 0, z: 15, rot: 0, label: 'MASUK', w: 4.4 },
  { x: -10, z: 3, rot: 0, label: 'TIM DEV', w: 4.4 },
  { x: 10, z: 3, rot: 0, label: 'TIM EDU', w: 4.4 },
  { x: 0, z: 0, rot: Math.PI / 2, label: '', w: 2.8 },
]

export interface DeskSpot {
  id: string
  x: number
  z: number
  rot: number
}

export type { Obstacle }

/** One desk per agent, on a 4.5 x 4.0 grid (see lib/agents.ts). */
export const DESKS: DeskSpot[] = AGENTS.map((a) => ({ id: a.id, ...a.desk }))

/** Where a seated agent stands up to: 2.0 behind the chair, never through the desk. */
export const DESK_EXIT: Record<string, [number, number]> = Object.fromEntries(
  DESKS.map((d) => {
    const fx = Math.sin(d.rot)
    const fz = Math.cos(d.rot)
    return [d.id, [d.x + fx * 2.0, d.z + fz * 2.0] as [number, number]]
  }),
)

/** Where a seated agent stands up to: 2.0 behind the chair, never through the desk. */
export function deskExit(spot: { x: number; z: number; rot: number }): [number, number] {
  return [spot.x + Math.sin(spot.rot) * 2.0, spot.z + Math.cos(spot.rot) * 2.0]
}

/** Camera presets; the HUD jumps between them. */
export interface Spot {
  id: string
  label: string
  pos: [number, number, number]
  target: [number, number, number]
  fov: number
}

export const SPOTS: Record<string, Spot> = {
  lobby: { id: 'lobby', label: 'Pendopo', pos: [1.6, 1.95, 13.0], target: [-6.8, 0.95, 9.2], fov: 55 },
  dev: { id: 'dev', label: 'Tim Dev', pos: [-10.0, 4.6, 1.4], target: [-10.0, 0.35, -9.0], fov: 58 },
  edu: { id: 'edu', label: 'Tim Edu', pos: [10.0, 4.6, 1.4], target: [10.0, 0.35, -9.0], fov: 58 },
  tampak: { id: 'tampak', label: 'Tampak', pos: [0, 22, 28], target: [0, 0, -1], fov: 42 },
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
  { id: 'kopi', name: 'warung kopi', pos: [-17.5, 8.0], act: 'sip', team: 'lobby' },
  { id: 'jendela', name: 'jendela', pos: [-15.0, 14.2], act: 'gaze', team: 'lobby' },
  { id: 'kucing', name: 'kucing oren', pos: [3.6, 11.7], act: 'pet', team: 'lobby' },
  { id: 'resepsionis', name: 'meja resepsionis', pos: [-7.0, 13.3], act: 'chat', team: 'lobby' },
  { id: 'gamelan', name: 'gamelan', pos: [-17.2, -5.6], act: 'gamelan', team: 'dev' },
  { id: 'server', name: 'rak server', pos: [-17.2, -13.2], act: 'check', team: 'dev' },
  { id: 'papan', name: 'papan sprint', pos: [-10.0, -13.7], act: 'read', team: 'dev' },
  { id: 'buku', name: 'rak buku', pos: [18.2, -11.0], act: 'read', team: 'edu' },
  { id: 'lesehan', name: 'lesehan', pos: [14.2, -6.2], act: 'sit', team: 'edu' },
]

/** Waypoint graph — every edge is walkable and clear of furniture. */
export interface NavNode {
  id: string
  x: number
  z: number
}

export const NAV: NavNode[] = [
  // pendopo
  { id: 'gate', x: 0, z: 13.6 },
  { id: 'lobby-n', x: -6.0, z: 13.4 },
  { id: 'lobby-win', x: -13.0, z: 13.2 },
  { id: 'lobby-nw', x: -12.0, z: 12.0 },
  { id: 'lobby-c', x: 0, z: 9.6 },
  { id: 'lobby-desk', x: -7.0, z: 7.2 },
  { id: 'lobby-w', x: -12.0, z: 7.2 },
  { id: 'lobby-kopi', x: -16.2, z: 8.0 },
  { id: 'lobby-cat', x: 3.6, z: 10.6 },
  { id: 'lobby-e', x: 12.0, z: 9.6 },
  { id: 'lobby-lounge', x: 16.2, z: 8.8 },
  { id: 'lobby-sw', x: -10.0, z: 4.8 },
  { id: 'lobby-se', x: 10.0, z: 4.8 },
  { id: 'inner-door', x: 0, z: 0 },
  // dev room
  { id: 'dev-door', x: -10.0, z: 1.8 },
  { id: 'dev-front', x: -10.0, z: -2.6 },
  { id: 'dev-open-w', x: -17.3, z: -2.4 },
  { id: 'dev-open-e', x: -2.4, z: -2.4 },
  { id: 'dev-gam', x: -16.6, z: -5.2 },
  { id: 'dev-mid-w', x: -17.3, z: -8.4 },
  { id: 'dev-mid1', x: -12.25, z: -8.4 },
  { id: 'dev-mid2', x: -7.75, z: -8.4 },
  { id: 'dev-mid-e', x: -2.4, z: -8.4 },
  { id: 'dev-back-w', x: -16.2, z: -12.4 },
  { id: 'dev-back1', x: -12.25, z: -12.4 },
  { id: 'dev-back-c', x: -10.0, z: -12.4 },
  { id: 'dev-back2', x: -7.75, z: -12.4 },
  { id: 'dev-back-e', x: -3.0, z: -12.4 },
  // edu room
  { id: 'edu-door', x: 10.0, z: 1.8 },
  { id: 'edu-front', x: 10.0, z: -2.6 },
  { id: 'edu-open-w', x: 3.2, z: -2.4 },
  { id: 'edu-open-e', x: 14.0, z: -2.4 },
  { id: 'edu-mid-w', x: 3.5, z: -8.4 },
  { id: 'edu-mid-c', x: 10.0, z: -8.4 },
  { id: 'edu-mid-e', x: 14.0, z: -8.4 },
  { id: 'edu-back-w', x: 3.5, z: -12.4 },
  { id: 'edu-back-c', x: 10.0, z: -12.4 },
  { id: 'edu-back-e', x: 15.5, z: -12.4 },
]

/** Wall footprints, so a new desk never lands inside a partition. */
export const WALL_OBSTACLES: Obstacle[] = WALLS.map((w, i) => {
  const t = WALL_T / 2
  return w.axis === 'x'
    ? { id: `wall-x${i}`, x1: Math.min(w.from, w.to), z1: w.at - t, x2: Math.max(w.from, w.to), z2: w.at + t }
    : { id: `wall-z${i}`, x1: w.at - t, z1: Math.min(w.from, w.to), x2: w.at + t, z2: Math.max(w.from, w.to) }
})

export const NAV_EDGES: Array<[string, string]> = [
  ['gate', 'lobby-n'],
  ['gate', 'lobby-c'],
  ['lobby-n', 'lobby-win'],
  ['lobby-win', 'lobby-nw'],
  ['lobby-nw', 'lobby-w'],
  ['lobby-c', 'lobby-desk'],
  ['lobby-c', 'lobby-cat'],
  ['lobby-c', 'lobby-e'],
  ['lobby-c', 'lobby-sw'],
  ['lobby-c', 'lobby-se'],
  ['lobby-desk', 'lobby-w'],
  ['lobby-w', 'lobby-kopi'],
  ['lobby-e', 'lobby-lounge'],
  ['lobby-sw', 'dev-door'],
  ['lobby-se', 'edu-door'],
  ['dev-door', 'dev-front'],
  ['dev-front', 'dev-open-w'],
  ['dev-front', 'dev-open-e'],
  ['dev-open-w', 'dev-gam'],
  ['dev-gam', 'dev-mid-w'],
  ['dev-open-w', 'dev-mid-w'],
  ['dev-open-e', 'dev-mid-e'],
  ['dev-mid-w', 'dev-mid1'],
  ['dev-mid1', 'dev-mid2'],
  ['dev-mid2', 'dev-mid-e'],
  ['dev-mid-w', 'dev-back-w'],
  ['dev-mid1', 'dev-back1'],
  ['dev-mid2', 'dev-back2'],
  ['dev-mid-e', 'dev-back-e'],
  ['dev-back-w', 'dev-back1'],
  ['dev-back1', 'dev-back-c'],
  ['dev-back-c', 'dev-back2'],
  ['dev-back2', 'dev-back-e'],
  ['dev-open-e', 'inner-door'],
  ['inner-door', 'edu-open-w'],
  ['edu-open-w', 'edu-front'],
  ['edu-front', 'edu-open-e'],
  ['edu-open-w', 'edu-mid-w'],
  ['edu-open-e', 'edu-mid-e'],
  ['edu-mid-w', 'edu-mid-c'],
  ['edu-mid-c', 'edu-mid-e'],
  ['edu-mid-c', 'edu-back-c'],
  ['edu-mid-w', 'edu-back-w'],
  ['edu-mid-e', 'edu-back-e'],
  ['edu-back-w', 'edu-back-c'],
  ['edu-back-c', 'edu-back-e'],
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

/** Desk + chair footprint, from the local box (1.62 wide, 0.39 front, 0.64 back). */
function deskObstacle(d: DeskSpot): Obstacle {
  return deskFootprint(d, d.id)
}

/**
 * Everything on the floor a walker must not enter. Kept in one place so the
 * nav graph, the POIs and the layout check all agree with the scene.
 */
export const OBSTACLES: Obstacle[] = [
  ...DESKS.map(deskObstacle),
  // pendopo — big pieces hug the walls
  { id: 'resepsionis', x1: -8.3, z1: 11.69, x2: -5.7, z2: 12.31 },
  { id: 'kopi', x1: -19.6, z1: 6.6, x2: -18.03, z2: 9.4 },
  { id: 'sofa', x1: 17.44, z1: 6.24, x2: 19.85, z2: 11.36 },
  { id: 'kucing', x1: 3.36, z1: 12.36, x2: 3.84, z2: 12.84 },
  // dev room
  { id: 'gamelan', x1: -19.77, z1: -6.7, x2: -18.0, z2: -4.6 },
  { id: 'server', x1: -17.75, z1: -14.8, x2: -16.65, z2: -14.0 },
  { id: 'papan-dev', x1: -11.8, z1: -14.78, x2: -8.2, z2: -14.62 },
  // edu room
  { id: 'buku', x1: 19.29, z1: -12.3, x2: 19.71, z2: -9.7 },
  { id: 'lesehan', x1: 14.9, z1: -7.5, x2: 18.3, z2: -4.9 },
  { id: 'papan-edu', x1: 8.2, z1: -14.78, x2: 11.8, z2: -14.62 },
]

/**
 * Hand the static geometry to the roster planner: a new agent is placed against
 * the same walls, furniture and walkways the hand-drawn office uses.
 */
const NAV_SEGMENTS: Edge[] = NAV_EDGES.flatMap(([a, b]) => {
  const na = NAV.find((n) => n.id === a)
  const nb = NAV.find((n) => n.id === b)
  return na && nb ? [{ a: [na.x, na.z] as [number, number], b: [nb.x, nb.z] as [number, number] }] : []
})
setFloorContext(WALLS, NAV_SEGMENTS)
setFurniture(OBSTACLES.filter((o) => !o.id.startsWith('desk-')))
