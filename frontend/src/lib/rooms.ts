import { AGENTS } from './agents'
import { deskObstacle as deskFootprint, type Edge, type Obstacle } from './layout'
import { setFloorContext, setFurniture } from './roster'

/**
 * The floor is 28 x 20 world units (1 unit ~ 1 m): 7:5, not a corridor.
 *
 * Sized from the furniture, not the other way round: the dev block is
 * 3 x 1.62 + 2 x 1.03 = 4.86 x 2.08 plus the lead's 1.62-wide desk on its west
 * face, the edu block 2 x 1.62 + 2 x 1.03 = 3.24 x 2.08, and every desk keeps a
 * 1.6-unit aisle to the walls and to the furniture around its block. Lobby
 * 28 x 8, team rooms 14 x 12 each.
 */
export const FLOOR = { w: 28, d: 20, y: 0 } as const
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
 * Room split — Pendopo across the front (z 2..10, 28 x 8), Tim Dev back-left
 * (x -14..0, z -10..2) and Tim Edu back-right (x 0..14, z -10..2), both 14 x 12.
 * Doors: main entrance at x = 0 / z = 10, two team doors at x = +-7.5 on the
 * z = 2 partition, one doorway between the teams at x = 0.
 */
export const WALLS: WallSeg[] = [
  // outer shell
  { axis: 'x', at: -10, from: -14, to: 14 }, // back
  { axis: 'z', at: -14, from: -10, to: 10 }, // left
  { axis: 'z', at: 14, from: -10, to: 10 }, // right
  // front wall with the main entrance gap (x -2.2 .. 2.2)
  { axis: 'x', at: 10, from: -14, to: -2.2 },
  { axis: 'x', at: 10, from: 2.2, to: 14 },
  // pendopo / team rooms partition, two symmetric doorways at x -9.7..-5.3 and 5.3..9.7
  { axis: 'x', at: 2, from: -14, to: -9.7 },
  { axis: 'x', at: 2, from: -5.3, to: 5.3 },
  { axis: 'x', at: 2, from: 9.7, to: 14 },
  // dev | edu divider, doorway at z -1.4 .. 1.4
  { axis: 'z', at: 0, from: -10, to: -1.4 },
  { axis: 'z', at: 0, from: 1.4, to: 2 },
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
  { x: 0, z: 10, rot: 0, label: 'MASUK', w: 4.4 },
  { x: -7.5, z: 2, rot: 0, label: 'TIM DEV', w: 4.4 },
  { x: 7.5, z: 2, rot: 0, label: 'TIM EDU', w: 4.4 },
  { x: 0, z: 0, rot: Math.PI / 2, label: '', w: 2.8 },
]

export interface DeskSpot {
  id: string
  x: number
  z: number
  rot: number
}

export type { Obstacle }

/**
 * One desk per agent. Team desks sit in touching blocks (see CLUSTERS): the dev
 * six in a 3 x 2 island with the lead's desk flush against its west face, the
 * edu four in a 2 x 2, the devops desk on its own by the server rack. Desk tops
 * are 1.62 wide and 1.03 deep, so a 1.62 column pitch and a 0.78 row pitch make
 * the tops meet with no seam at all.
 */
export const DESKS: DeskSpot[] = AGENTS.map((a) => ({ id: a.id, ...a.desk }))

/** Desks that form one touching block; every other pair keeps a 1.6 aisle. */
export const CLUSTERS: Record<string, string[]> = {
  dev: ['coder2', 'planner', 'uiux', 'coder', 'reviewer', 'tester'],
  edu: ['edu', 'edu-designer', 'edu-writer', 'edu-reviewer'],
}

/**
 * A lead desk stands on the short side of its block, flush against it and
 * turned a quarter turn so the lead faces the team instead of the wall: it
 * shares the block's floor, so no aisle runs between them. `side` is the block
 * face it touches ('w' = the west edge).
 */
export const LEAD_DESKS: Record<string, { id: string; cluster: string; side: 'w' | 'e' }> = {
  dev: { id: 'dev', cluster: 'dev', side: 'w' },
}

const CLUSTER_OF: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(CLUSTERS).flatMap(([name, ids]) => ids.map((id) => [id, name])),
  ),
  ...Object.fromEntries(Object.values(LEAD_DESKS).map((l) => [l.id, l.cluster])),
}

/** Cluster a desk belongs to, or null for a free-standing desk. */
export function clusterOf(id: string): string | null {
  return CLUSTER_OF[id] ?? null
}

/** Every desk that shares one block's floor: its rows plus its lead desks. */
export function blockMembers(name: string): string[] {
  const leads = Object.values(LEAD_DESKS).filter((l) => l.cluster === name).map((l) => l.id)
  return [...(CLUSTERS[name] ?? []), ...leads]
}

/** Two desks of the same block are allowed to touch; 0 here, 0.02 in the checks. */
export const BLOCK_GAP = 0.02

/** Where a seated agent stands up to: 2.0 behind the chair, never through the desk. */
export const DESK_EXIT: Record<string, [number, number]> = Object.fromEntries(
  DESKS.map((d) => [d.id, deskExit(d)]),
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
  lobby: { id: 'lobby', label: 'Pendopo', pos: [-9.8, 2.4, 9.2], target: [-4.9, 1.0, 6.8], fov: 55 },
  dev: { id: 'dev', label: 'Tim Dev', pos: [-2.2, 5.6, 2.2], target: [-8.6, 0.3, -4.6], fov: 60 },
  edu: { id: 'edu', label: 'Tim Edu', pos: [12.4, 5.4, 2.6], target: [6.6, 0.3, -6.2], fov: 60 },
  tampak: { id: 'tampak', label: 'Tampak', pos: [0, 17, 18], target: [0, 0, -0.5], fov: 42 },
  luar: { id: 'luar', label: 'Luar', pos: [18, 13, 36], target: [0, 2.4, 4], fov: 44 },
}

/**
 * Outside the building: the stone batur (28 x 20 floor + a 3-unit veranda on
 * every side), the yard below it, the roof eave height, the gapura on the path
 * and the trees ([x, z, scale]) — all clear of the path and the "luar" camera.
 */
export const EXTERIOR = {
  batur: { w: FLOOR.w + 6, d: FLOOR.d + 6 },
  ground: { y: -0.4, size: 130 },
  eaveY: 3.0,
  gapuraZ: 25,
  trees: [
    [-22, 6, 1.2],
    [-20, -10, 1.0],
    [-24, 16, 1.1],
    [22, -8, 1.2],
    [23, 11, 1.0],
    [27, 19, 1.1],
    [-9, -19, 1.0],
    [9, -20, 1.15],
    [-12, 24, 0.9],
    [-19, 27, 0.9],
  ] as Array<[number, number, number]>,
} as const

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
  { id: 'kopi', name: 'warung kopi', pos: [-12.4, 5.4], act: 'sip', team: 'lobby' },
  { id: 'jendela', name: 'jendela', pos: [-10.4, 9.2], act: 'gaze', team: 'lobby' },
  { id: 'kucing', name: 'kucing oren', pos: [2.6, 7.4], act: 'pet', team: 'lobby' },
  { id: 'resepsionis', name: 'meja resepsionis', pos: [-3.0, 6.6], act: 'chat', team: 'lobby' },
  { id: 'rapat', name: 'meja rapat', pos: [7.4, 4.6], act: 'chat', team: 'lobby' },
  { id: 'meja-kopi', name: 'meja kopi', pos: [-10.4, 4.2], act: 'sip', team: 'lobby' },
  { id: 'gamelan', name: 'gamelan', pos: [-11.2, -8.7], act: 'gamelan', team: 'dev' },
  { id: 'server', name: 'rak server', pos: [-1.9, -8.0], act: 'check', team: 'dev' },
  { id: 'buku', name: 'rak buku', pos: [10.6, -8.9], act: 'read', team: 'edu' },
  { id: 'lesehan', name: 'lesehan', pos: [11.5, -2.6], act: 'sit', team: 'edu' },
]

/** Waypoint graph — every edge is walkable and clear of furniture. */
export interface NavNode {
  id: string
  x: number
  z: number
}

export const NAV: NavNode[] = [
  // pendopo: a ring round the reception, meeting table and kopi corner
  { id: 'gate', x: 0, z: 9.3 },
  { id: 'lobby-nw', x: -8.6, z: 9.3 },
  { id: 'lobby-ne', x: 10.2, z: 9.3 },
  { id: 'lobby-nwc', x: -12.3, z: 8.6 },
  { id: 'lobby-kopi', x: -12.3, z: 5.4 },
  { id: 'lobby-sw', x: -7.5, z: 3.5 },
  { id: 'lobby-c', x: -2.0, z: 3.5 },
  { id: 'lobby-sc', x: 2.6, z: 3.5 },
  { id: 'lobby-se', x: 7.5, z: 3.5 },
  { id: 'lobby-e', x: 10.2, z: 3.5 },
  { id: 'lobby-wc', x: -12.3, z: 3.5 },
  { id: 'lobby-wm', x: -8.6, z: 3.5 },
  { id: 'lobby-recep-back', x: -6.2, z: 7.2 },
  { id: 'lobby-recep', x: -2.2, z: 6.6 },
  { id: 'lobby-cat', x: 2.6, z: 6.6 },
  // dev room: front aisle (z -1.6), west aisle (x -12.42, behind the lead's
  // chair), east aisle (x -1.8), back aisle (z -6.4), gamelan spur
  { id: 'inner-door', x: 0, z: 0 },
  { id: 'dev-door', x: -7.5, z: 1.0 },
  { id: 'dev-front-w', x: -12.42, z: -1.6 },
  { id: 'dev-front', x: -7.5, z: -1.6 },
  { id: 'dev-front-e', x: -1.8, z: -1.6 },
  { id: 'dev-west', x: -12.42, z: -4.4 },
  { id: 'dev-back-w', x: -12.42, z: -6.4 },
  { id: 'dev-back', x: -7.6, z: -6.4 },
  { id: 'dev-back-e', x: -1.8, z: -6.4 },
  { id: 'dev-shelf', x: -11.2, z: -6.6 },
  { id: 'dev-gam', x: -11.2, z: -8.6 },
  // edu room: same pattern, wider block aisle
  { id: 'edu-door', x: 7.5, z: 1.0 },
  { id: 'edu-front-w', x: 3.0, z: -1.6 },
  { id: 'edu-front', x: 7.5, z: -1.6 },
  { id: 'edu-front-e', x: 9.4, z: -1.6 },
  { id: 'edu-front-r', x: 11.9, z: -1.6 },
  { id: 'edu-back-w', x: 3.0, z: -6.6 },
  { id: 'edu-back', x: 7.0, z: -6.6 },
  { id: 'edu-back-e', x: 9.4, z: -6.6 },
  { id: 'edu-shelf', x: 12.4, z: -6.6 },
]

/** Wall footprints, so a new desk never lands inside a partition. */
export const WALL_OBSTACLES: Obstacle[] = WALLS.map((w, i) => {
  const t = WALL_T / 2
  return w.axis === 'x'
    ? { id: `wall-x${i}`, x1: Math.min(w.from, w.to), z1: w.at - t, x2: Math.max(w.from, w.to), z2: w.at + t }
    : { id: `wall-z${i}`, x1: w.at - t, z1: Math.min(w.from, w.to), x2: w.at + t, z2: Math.max(w.from, w.to) }
})

export const NAV_EDGES: Array<[string, string]> = [
  // pendopo ring
  ['gate', 'lobby-nw'],
  ['gate', 'lobby-ne'],
  ['gate', 'lobby-c'],
  ['lobby-nw', 'lobby-nwc'],
  ['lobby-nwc', 'lobby-kopi'],
  ['lobby-kopi', 'lobby-wc'],
  ['lobby-wc', 'lobby-wm'],
  ['lobby-wm', 'lobby-sw'],
  ['lobby-nw', 'lobby-wm'] as [string, string],
  ['lobby-sw', 'lobby-c'],
  ['lobby-c', 'lobby-sc'],
  ['lobby-sc', 'lobby-se'],
  ['lobby-se', 'lobby-e'],
  ['lobby-e', 'lobby-ne'],
  ['lobby-wm', 'lobby-recep-back'],
  ['lobby-sw', 'lobby-recep-back'],
  ['lobby-c', 'lobby-recep'],
  ['lobby-sc', 'lobby-cat'],
  // into the team rooms
  ['lobby-sw', 'dev-door'],
  ['lobby-se', 'edu-door'],
  ['dev-door', 'dev-front'],
  ['edu-door', 'edu-front'],
  // dev front aisle
  ['dev-front-w', 'dev-front'],
  ['dev-front', 'dev-front-e'],
  ['dev-front-e', 'dev-back-e'],
  ['dev-front-w', 'dev-west'],
  ['dev-west', 'dev-back-w'],
  ['dev-back-w', 'dev-shelf'],
  ['dev-shelf', 'dev-back'],
  ['dev-shelf', 'dev-gam'],
  // dev back aisle
  ['dev-back-w', 'dev-back'],
  ['dev-back', 'dev-back-e'],
  // inner doorway between the rooms
  ['dev-front-e', 'inner-door'],
  ['inner-door', 'edu-front-w'],
  // edu front aisle
  ['edu-front-w', 'edu-front'],
  ['edu-front', 'edu-front-e'],
  ['edu-front-e', 'edu-front-r'],
  ['edu-front-e', 'edu-back-e'],
  // edu back aisle
  ['edu-back-w', 'edu-back'],
  ['edu-back', 'edu-back-e'],
  ['edu-back-e', 'edu-shelf'],
  ['edu-front-w', 'edu-back-w'],
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
const FURNITURE_DESKS = new Set(AGENTS.filter((a) => a.deskFromFurniture).map((a) => a.id))

export const OBSTACLES: Obstacle[] = [
  // A desk that is a piece of furniture borrows that furniture's footprint
  // instead of adding a second one on top of it.
  ...DESKS.filter((d) => !FURNITURE_DESKS.has(d.id)).map(deskObstacle),
  // pendopo — big pieces hug the walls
  // the reception counter is Ndoro Kakung's desk, not a separate obstacle
  { id: 'resepsionis', x1: -4.27, z1: 5.62, x2: -3.53, z2: 8.38 },
  { id: 'meja-rapat', x1: 5.8, z1: 5.5, x2: 9.0, z2: 7.7 },
  { id: 'meja-kopi', x1: -11.35, z1: 4.7, x2: -9.45, z2: 6.5 },
  { id: 'kopi', x1: -13.9, z1: 3.9, x2: -13.2, z2: 6.9 },
  { id: 'sofa', x1: 12.95, z1: 4.2, x2: 13.85, z2: 6.6 },
  { id: 'sofa-table', x1: 11.15, z1: 5.05, x2: 12.45, z2: 5.75 },
  { id: 'kucing', x1: 2.36, z1: 7.96, x2: 2.84, z2: 8.44 },
  { id: 'berkas', x1: -13.3, z1: 0.64, x2: -11.9, z2: 1.16 },
  { id: 'materi', x1: 11.3, z1: 0.64, x2: 12.7, z2: 1.16 },
  // dev room — the gamelan sits in the back-left corner, clear of the lead's desk
  { id: 'gamelan', x1: -13.885, z1: -9.85, x2: -12.115, z2: -7.75 },
  { id: 'server', x1: -1.0, z1: -9.85, x2: -0.1, z2: -8.75 },
  // edu room
  { id: 'buku', x1: 9.7, z1: -10.0, x2: 12.3, z2: -9.58 },
  { id: 'lesehan', x1: 10.4, z1: -5.7, x2: 13.8, z2: -3.1 },
  { id: 'papan-edu', x1: 5.2, z1: -9.78, x2: 8.8, z2: -9.62 },
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
