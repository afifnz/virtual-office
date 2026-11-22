import { AGENTS } from './agents'
import { deskObstacle as deskFootprint, type Obstacle } from './layout'

/**
 * The office is a 3-storey building, one floor on screen at a time:
 *
 *  - L1 Lobby   28 x 20 — reception, lounge, meeting room, pantry (1 desk)
 *  - L2 Tim Edu 20 x 16 — the 2 x 2 edu block, bookshelf, printer (4 desks)
 *  - L3 Tim Dev 24 x 18 — the 3 x 2 dev island + lead, server rack (8 desks)
 *
 * Every desk, wall, door, POI, nav node and obstacle carries its `floor`, and
 * the accessors below (`wallsOf`, `navOf`, ...) are the single source of
 * coordinates per floor (AGENTS.md §1.5). Floor sizes were chosen from the
 * furniture, not the other way round: each block keeps its 1.6-unit aisle on
 * every side, and the lift core sits in the east of each floor with the same
 * rule — shaft 2.6 x 3.2 at `halfWidth-2.8 .. halfWidth-0.2`, z -1.0..2.2,
 * door facing west, walk node 1.0 west of the door at z = 0.6.
 *
 * Convention: +z grows south (down screen), the north wall sits at z = -d/2.
 */
export type FloorId = 1 | 2 | 3
export const FLOOR_IDS: FloorId[] = [1, 2, 3]

export const FLOORS: Record<FloorId, { id: FloorId; w: number; d: number; name: string; label: string; sub: string }> = {
  1: { id: 1, w: 28, d: 20, name: 'Lobby', label: 'LOBBY', sub: 'penerima tamu' },
  2: { id: 2, w: 20, d: 16, name: 'Tim Edu', label: 'TIM EDU', sub: 'materi kuliah & pelatihan' },
  3: { id: 3, w: 24, d: 18, name: 'Tim Dev', label: 'TIM DEV', sub: 'pengembangan aplikasi' },
}

export const WALL_T = 0.22

export interface WallSeg {
  /** the floor this wall segment belongs to */
  floor: FloorId
  /** axis 'x' = runs along x at a fixed z, 'z' = runs along z at a fixed x */
  axis: 'x' | 'z'
  at: number
  from: number
  to: number
  h?: number
}

/** The outer shell + partitions, flat with a floor field. */
export const WALLS: WallSeg[] = [
  // ---- L1 28x20: shell + the glass wall of the north-east meeting room
  { floor: 1, axis: 'x', at: -10, from: -14, to: 14 }, // north
  { floor: 1, axis: 'z', at: -14, from: -10, to: 10 }, // west
  { floor: 1, axis: 'z', at: 14, from: -10, to: 10 }, // east
  // south wall with the main entrance gap (x -2.2 .. 2.2)
  { floor: 1, axis: 'x', at: 10, from: -14, to: -2.2 },
  { floor: 1, axis: 'x', at: 10, from: 2.2, to: 14 },
  // meeting-room glass: z=-3.5 with a doorway at x 6.6..9.4, plus x=3.2 return
  { floor: 1, axis: 'x', at: -3.5, from: 3.2, to: 6.6 },
  { floor: 1, axis: 'x', at: -3.5, from: 9.4, to: 14 },
  { floor: 1, axis: 'z', at: 3.2, from: -10, to: -3.5 },
  // ---- L2 20x16: plain shell (bookshelf & whiteboard hug the north wall)
  { floor: 2, axis: 'x', at: -8, from: -10, to: 10 },
  { floor: 2, axis: 'z', at: -10, from: -8, to: 8 },
  { floor: 2, axis: 'z', at: 10, from: -8, to: 8 },
  { floor: 2, axis: 'x', at: 8, from: -10, to: 10 },
  // ---- L3 24x18: plain shell (sprint board & server rack hug the north wall)
  { floor: 3, axis: 'x', at: -9, from: -12, to: 12 },
  { floor: 3, axis: 'z', at: -12, from: -9, to: 9 },
  { floor: 3, axis: 'z', at: 12, from: -9, to: 9 },
  { floor: 3, axis: 'x', at: 9, from: -12, to: 12 },
]

export interface Door {
  floor: FloorId
  x: number
  z: number
  /** 0 = the frame runs along x (opening faces +-z) */
  rot: number
  label: string
  /** clear opening width, the wall gap is the same size */
  w: number
}

export const DOORS: Door[] = [
  { floor: 1, x: 0, z: 10, rot: 0, label: 'MASUK', w: 4.4 },
]

export interface DeskSpot {
  id: string
  x: number
  z: number
  rot: number
  floor: FloorId
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

export interface Poi {
  id: string
  /** the floor this POI lives on ('rapat' & 'kopi' exist on more than one) */
  floor: FloorId
  name: string
  pos: [number, number]
  act: 'sip' | 'pet' | 'read' | 'check' | 'sit' | 'gaze' | 'chat'
  team: 'lobby' | 'dev' | 'edu'
}

/** Idle agents walk to one of these on their own floor, do the act, then walk home. */
export const POIS: Poi[] = [
  // L1 — lobby
  { floor: 1, id: 'resepsionis', name: 'meja resepsionis', pos: [-3.0, 6.6], act: 'chat', team: 'lobby' },
  { floor: 1, id: 'lounge', name: 'sofa lounge', pos: [10.6, 5.4], act: 'sit', team: 'lobby' },
  { floor: 1, id: 'rapat', name: 'meja rapat', pos: [8.0, -4.9], act: 'chat', team: 'lobby' },
  { floor: 1, id: 'kopi', name: 'warung kopi', pos: [-12.4, 5.4], act: 'sip', team: 'lobby' },
  { floor: 1, id: 'meja-kopi', name: 'meja kopi', pos: [-10.4, 4.2], act: 'sip', team: 'lobby' },
  { floor: 1, id: 'jendela', name: 'jendela', pos: [-10.4, 9.2], act: 'gaze', team: 'lobby' },
  // L2 — Tim Edu
  { floor: 2, id: 'buku', name: 'rak buku', pos: [-2.5, -7.0], act: 'read', team: 'edu' },
  { floor: 2, id: 'papan-edu', name: 'papan tulis', pos: [2.5, -7.0], act: 'read', team: 'edu' },
  { floor: 2, id: 'rapat', name: 'nook rapat', pos: [-6.5, 4.4], act: 'chat', team: 'edu' },
  { floor: 2, id: 'printer', name: 'printer', pos: [5.0, 6.5], act: 'check', team: 'edu' },
  // L3 — Tim Dev
  { floor: 3, id: 'papan', name: 'papan sprint', pos: [-2.0, -8.0], act: 'read', team: 'dev' },
  { floor: 3, id: 'server', name: 'rak server', pos: [7.9, -7.4], act: 'check', team: 'dev' },
  { floor: 3, id: 'kopi', name: 'pantry kopi', pos: [-10.4, 0.6], act: 'sip', team: 'dev' },
  { floor: 3, id: 'standup', name: 'meja standup', pos: [7.0, 5.4], act: 'chat', team: 'dev' },
]

/** Waypoint graph — every edge is walkable and clear of furniture. Node ids
 * carry an `l<f>-` prefix, so a path can never cross floors by construction. */
export interface NavNode {
  id: string
  floor: FloorId
  x: number
  z: number
}

export const NAV: NavNode[] = [
  // ---- L1: the ring round reception, pantry, lounge and the meeting room
  { id: 'l1-gate', floor: 1, x: 0, z: 9.3 },
  { id: 'l1-south-w', floor: 1, x: -8.6, z: 9.3 },
  { id: 'l1-south-e', floor: 1, x: 8.6, z: 9.3 },
  { id: 'l1-pantry-s', floor: 1, x: -12.3, z: 8.6 },
  { id: 'l1-pantry', floor: 1, x: -12.3, z: 5.4 },
  { id: 'l1-west', floor: 1, x: -12.3, z: 3.5 },
  { id: 'l1-wm', floor: 1, x: -8.6, z: 3.5 },
  { id: 'l1-c', floor: 1, x: -2.0, z: 3.5 },
  { id: 'l1-sc', floor: 1, x: 2.6, z: 3.5 },
  { id: 'l1-e', floor: 1, x: 10.2, z: 3.5 },
  { id: 'l1-recep', floor: 1, x: -2.2, z: 6.6 },
  { id: 'l1-lounge', floor: 1, x: 10.2, z: 5.4 },
  { id: 'l1-meet-door', floor: 1, x: 8.0, z: -2.6 },
  { id: 'l1-meet-in', floor: 1, x: 8.0, z: -4.4 },
  { id: 'l1-lift', floor: 1, x: 10.2, z: 0.6 },
  // ---- L2: two corridors (z 3.4 south, z -2.2 north) joined west and east;
  // no s<->n edge — the x=0 line would cross the edu block
  { id: 'l2-lift', floor: 2, x: 6.2, z: 0.6 },
  { id: 'l2-s', floor: 2, x: 0, z: 3.4 },
  { id: 'l2-sw', floor: 2, x: -4.5, z: 3.4 },
  { id: 'l2-se', floor: 2, x: 4.5, z: 3.4 },
  { id: 'l2-n', floor: 2, x: 0, z: -2.2 },
  { id: 'l2-nw', floor: 2, x: -4.5, z: -2.2 },
  { id: 'l2-ne', floor: 2, x: 4.5, z: -2.2 },
  { id: 'l2-shelf', floor: 2, x: -2.5, z: -6.6 },
  { id: 'l2-board', floor: 2, x: 2.5, z: -6.6 },
  { id: 'l2-nook', floor: 2, x: -6.5, z: 3.9 },
  { id: 'l2-printer', floor: 2, x: 4.6, z: 6.0 },
  // ---- L3: front corridor (z 2.6), back corridor (z -3.4), west aisle past
  // the lead desk; the server rack is reached via ops-e, not straight from ne
  { id: 'l3-lift', floor: 3, x: 8.2, z: 0.6 },
  { id: 'l3-s', floor: 3, x: 0, z: 2.6 },
  { id: 'l3-sw', floor: 3, x: -4.8, z: 2.6 },
  { id: 'l3-se', floor: 3, x: 4.8, z: 2.6 },
  { id: 'l3-n', floor: 3, x: 0, z: -3.4 },
  { id: 'l3-nw', floor: 3, x: -4.8, z: -3.4 },
  { id: 'l3-ne', floor: 3, x: 4.8, z: -3.4 },
  { id: 'l3-w', floor: 3, x: -4.8, z: -0.39 },
  { id: 'l3-ops-e', floor: 3, x: 7.4, z: -3.4 },
  { id: 'l3-rack', floor: 3, x: 7.9, z: -7.2 },
  { id: 'l3-board', floor: 3, x: -2.0, z: -7.6 },
  { id: 'l3-pantry', floor: 3, x: -10.4, z: 0.6 },
  { id: 'l3-standup', floor: 3, x: 7.0, z: 5.0 },
]

/** Wall footprints, so a new desk never lands inside a partition. */
export const WALL_OBSTACLES: Obstacle[] = WALLS.map((w, i) => {
  const t = WALL_T / 2
  const base =
    w.axis === 'x'
      ? { x1: Math.min(w.from, w.to), z1: w.at - t, x2: Math.max(w.from, w.to), z2: w.at + t }
      : { x1: w.at - t, z1: Math.min(w.from, w.to), x2: w.at + t, z2: Math.max(w.from, w.to) }
  return { id: `wall-l${w.floor}-${i}`, floor: w.floor, ...base }
})

export const NAV_EDGES: Array<[string, string]> = [
  // L1: the southern ring + spurs to reception, lounge, meeting room and lift
  ['l1-gate', 'l1-south-w'],
  ['l1-south-w', 'l1-pantry-s'],
  ['l1-pantry-s', 'l1-pantry'],
  ['l1-pantry', 'l1-west'],
  ['l1-west', 'l1-wm'],
  ['l1-wm', 'l1-c'],
  ['l1-c', 'l1-sc'],
  ['l1-sc', 'l1-e'],
  ['l1-e', 'l1-south-e'],
  ['l1-south-e', 'l1-gate'],
  ['l1-c', 'l1-recep'],
  ['l1-sc', 'l1-lounge'],
  ['l1-e', 'l1-lift'],
  ['l1-e', 'l1-meet-door'],
  ['l1-meet-door', 'l1-meet-in'],
  ['l1-lift', 'l1-meet-door'],
  // L2: south corridor, north corridor, joined at both ends — never through the block
  ['l2-s', 'l2-sw'],
  ['l2-sw', 'l2-nook'],
  ['l2-s', 'l2-se'],
  ['l2-se', 'l2-printer'],
  ['l2-n', 'l2-nw'],
  ['l2-nw', 'l2-shelf'],
  ['l2-n', 'l2-ne'],
  ['l2-ne', 'l2-board'],
  ['l2-sw', 'l2-nw'],
  ['l2-se', 'l2-ne'],
  ['l2-se', 'l2-lift'],
  ['l2-ne', 'l2-lift'],
  // L3: one ring + spurs; rack via ops-e (ne->rack would graze the devops desk)
  ['l3-s', 'l3-sw'],
  ['l3-sw', 'l3-w'],
  ['l3-w', 'l3-nw'],
  ['l3-nw', 'l3-n'],
  ['l3-n', 'l3-ne'],
  ['l3-ne', 'l3-se'],
  ['l3-se', 'l3-s'],
  ['l3-nw', 'l3-board'],
  ['l3-ne', 'l3-ops-e'],
  ['l3-ops-e', 'l3-rack'],
  ['l3-sw', 'l3-pantry'],
  ['l3-se', 'l3-standup'],
  ['l3-se', 'l3-lift'],
  ['l3-ne', 'l3-lift'],
]

/** Nearest nav node to a point on one floor, used to enter/exit the graph. */
export function nearestNode(x: number, z: number, floor: FloorId): NavNode {
  let best = NAV.find((n) => n.floor === floor)!
  let bestD = Infinity
  for (const n of NAV) {
    if (n.floor !== floor) continue
    const d = (n.x - x) ** 2 + (n.z - z) ** 2
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return best
}

/** The per-floor accessors: one source of coordinates, filtered by floor. */
export const wallsOf = (f: FloorId): WallSeg[] => WALLS.filter((w) => w.floor === f)
export const doorsOf = (f: FloorId): Door[] => DOORS.filter((d) => d.floor === f)
export const poisOf = (f: FloorId): Poi[] => POIS.filter((p) => p.floor === f)
export const navOf = (f: FloorId): NavNode[] => NAV.filter((n) => n.floor === f)
export const edgesOf = (f: FloorId): Array<[string, string]> =>
  NAV_EDGES.filter(([a, b]) => {
    const na = NAV.find((n) => n.id === a)
    const nb = NAV.find((n) => n.id === b)
    return na?.floor === f && nb?.floor === f
  })
export const obstaclesOf = (f: FloorId): Obstacle[] => OBSTACLES.filter((o) => o.floor === f)

/** Desk + chair footprint, from the local box (1.62 wide, 0.39 front, 0.64 back). */
function deskObstacle(d: DeskSpot): Obstacle {
  return { ...deskFootprint(d, d.id), floor: d.floor }
}

/**
 * The lift core: identical rule on every floor — shaft 2.6 wide x 3.2 deep in
 * the east, door facing west (at `doorX`), walk node 1.0 west of the door.
 */
export const LIFT: Record<FloorId, { shaft: Obstacle; doorX: number; node: NavNode }> = {
  1: {
    shaft: { id: 'lift-1', floor: 1, x1: 11.2, z1: -1.0, x2: 13.8, z2: 2.2 },
    doorX: 11.2,
    node: { id: 'l1-lift', floor: 1, x: 10.2, z: 0.6 },
  },
  2: {
    shaft: { id: 'lift-2', floor: 2, x1: 7.2, z1: -1.0, x2: 9.8, z2: 2.2 },
    doorX: 7.2,
    node: { id: 'l2-lift', floor: 2, x: 6.2, z: 0.6 },
  },
  3: {
    shaft: { id: 'lift-3', floor: 3, x1: 9.2, z1: -1.0, x2: 11.8, z2: 2.2 },
    doorX: 9.2,
    node: { id: 'l3-lift', floor: 3, x: 8.2, z: 0.6 },
  },
}

/** The walkable lift node on one floor (west of the door, z = 0.6). */
export function liftNode(f: FloorId): NavNode {
  return LIFT[f].node
}

/**
 * Everything on the floors a walker must not enter. Kept in one place so the
 * nav graph, the POIs and the layout check all agree with the scene.
 */
export const OBSTACLES: Obstacle[] = [
  ...DESKS.map(deskObstacle),
  // L1 — lobby: reception counter, meeting table, lounge, pantry, lift
  { id: 'resepsionis', floor: 1, x1: -4.27, z1: 5.62, x2: -3.53, z2: 8.38 },
  { id: 'meja-rapat', floor: 1, x1: 6.4, z1: -7.6, x2: 9.6, z2: -5.4 },
  { id: 'sofa', floor: 1, x1: 12.95, z1: 4.2, x2: 13.85, z2: 6.6 },
  { id: 'sofa-table', floor: 1, x1: 11.15, z1: 5.05, x2: 12.45, z2: 5.75 },
  { id: 'kopi', floor: 1, x1: -13.9, z1: 3.9, x2: -13.2, z2: 6.9 },
  { id: 'meja-kopi', floor: 1, x1: -11.35, z1: 4.7, x2: -9.45, z2: 6.5 },
  LIFT[1].shaft,
  // L2 — Tim Edu: bookshelf, whiteboard, meeting nook, printer, lift
  { id: 'buku', floor: 2, x1: -4.0, z1: -7.9, x2: -1.0, z2: -7.5 },
  { id: 'papan-edu', floor: 2, x1: 1.0, z1: -7.85, x2: 4.0, z2: -7.65 },
  { id: 'meja-nook', floor: 2, x1: -7.3, z1: 4.9, x2: -5.7, z2: 6.1 },
  { id: 'printer', floor: 2, x1: 5.6, z1: 6.2, x2: 6.4, z2: 6.8 },
  LIFT[2].shaft,
  // L3 — Tim Dev: sprint board, server rack, pantry, standup table, lift
  { id: 'papan', floor: 3, x1: -4.0, z1: -8.85, x2: 0.0, z2: -8.65 },
  { id: 'server', floor: 3, x1: 7.5, z1: -8.9, x2: 8.4, z2: -8.0 },
  { id: 'kopi', floor: 3, x1: -11.9, z1: -1.5, x2: -11.2, z2: 1.5 },
  { id: 'standup', floor: 3, x1: 6.2, z1: 6.0, x2: 7.8, z2: 6.8 },
  LIFT[3].shaft,
]

// The static geometry is handed to the roster planner by roster.ts itself at
// module load (roster imports rooms, never the other way round — no cycle).
