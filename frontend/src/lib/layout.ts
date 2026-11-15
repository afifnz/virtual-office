/**
 * Desk placement on the office floor.
 *
 * Every desk sits on a 4.5 x 4.0 lattice (the one the hand-placed desks in
 * agents.ts already use) and must keep a 1.6-unit aisle to its neighbours, the
 * walls and the furniture. A profile that has no hand-placed desk — a new
 * Hermes profile, or an agent a remote office reports — gets a place in the
 * nearest free lattice block of its own team, so adding an agent never means
 * editing the scene.
 *
 * Everything here is pure and deterministic: same input, same office.
 */

export interface DeskPoint {
  x: number
  z: number
  rot: number
}

export interface DeskSpot extends DeskPoint {
  id: string
}

export interface Obstacle {
  id: string
  x1: number
  z1: number
  x2: number
  z2: number
}

/** A straight walkable segment the desk must not block. */
export interface Edge {
  a: [number, number]
  b: [number, number]
}

export interface GridSpec {
  dx: number
  dz: number
  aisle: number
}

export const DEFAULT_GRID: GridSpec = { dx: 4.5, dz: 4.0, aisle: 1.6 }

/** Desk footprint: 1.62 wide, 0.39 in front of the seat, 0.64 behind it. */
export const DESK_FOOTPRINT = { halfW: 0.81, front: 0.39, back: 0.64 }

/** Default room centre per team, used when a team has no desk yet. */
export const TEAM_CENTRE: Record<string, [number, number]> = {
  lobby: [0, 9.2],
  dev: [-10, -6.4],
  edu: [10, -6.4],
}

/** A desk's axis-aligned footprint on the floor (rotation is always PI). */
export function deskObstacle(d: DeskPoint, id?: string): Obstacle {
  const cos = Math.cos(d.rot)
  const sin = Math.sin(d.rot)
  const corners: Array<[number, number]> = [
    [-DESK_FOOTPRINT.halfW, -DESK_FOOTPRINT.front],
    [DESK_FOOTPRINT.halfW, -DESK_FOOTPRINT.front],
    [DESK_FOOTPRINT.halfW, DESK_FOOTPRINT.back],
    [-DESK_FOOTPRINT.halfW, DESK_FOOTPRINT.back],
  ].map(([lx, lz]) => [d.x + lx! * cos + lz! * sin, d.z - lx! * sin + lz! * cos])
  const xs = corners.map((c) => c[0]!)
  const zs = corners.map((c) => c[1]!)
  return {
    id: `desk-${id ?? `${d.x},${d.z}`}`,
    x1: Math.min(...xs),
    z1: Math.min(...zs),
    x2: Math.max(...xs),
    z2: Math.max(...zs),
  }
}

/** Shortest distance between two footprints (0 when they overlap). */
export function rectGap(a: Obstacle, b: Obstacle): number {
  const dx = Math.max(b.x1 - a.x2, a.x1 - b.x2, 0)
  const dz = Math.max(b.z1 - a.z2, a.z1 - b.z2, 0)
  return Math.hypot(dx, dz)
}

/** Shortest distance from a point to a footprint. */
function pointRectDist(x: number, z: number, o: Obstacle): number {
  const dx = Math.max(o.x1 - x, x - o.x2, 0)
  const dz = Math.max(o.z1 - z, z - o.z2, 0)
  return Math.hypot(dx, dz)
}

/** Distance from a point to a segment. */
function pointSegDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}

/** Shortest distance between a segment and a footprint (0 when they cross). */
export function segRectDist(a: [number, number], b: [number, number], o: Obstacle): number {
  // Sample-free slab clip: does the segment enter the box?
  let t0 = 0
  let t1 = 1
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  if (
    clip(-dx, a[0] - o.x1) &&
    clip(dx, o.x2 - a[0]) &&
    clip(-dz, a[1] - o.z1) &&
    clip(dz, o.z2 - a[1]) &&
    t0 <= t1
  ) {
    return 0
  }
  // Not crossing: the closest approach is either an endpoint or a corner.
  return Math.min(
    pointRectDist(a[0], a[1], o),
    pointRectDist(b[0], b[1], o),
    pointSegDist([o.x1, o.z1], a, b),
    pointSegDist([o.x2, o.z1], a, b),
    pointSegDist([o.x2, o.z2], a, b),
    pointSegDist([o.x1, o.z2], a, b),
  )
}

export interface ClearanceInput {
  spot: DeskPoint
  /** id of the desk being measured, so its own footprint is ignored */
  id?: string
  obstacles: Obstacle[]
  floor: { w: number; d: number }
  wallT: number
}

/**
 * Free space around a desk: the smallest gap to a wall or to any other
 * footprint. The layout check in verify/ uses the same number.
 */
export function clearance({ spot, id, obstacles, floor, wallT }: ClearanceInput): number {
  const own = deskObstacle(spot, id)
  const inner = wallT / 2
  let clear = Math.min(
    floor.w / 2 - inner - own.x2,
    own.x1 + floor.w / 2 - inner,
    floor.d / 2 - inner - own.z2,
    own.z1 + floor.d / 2 - inner,
  )
  for (const o of obstacles) {
    // Skip our own footprint.
    if (o.id === own.id) continue
    clear = Math.min(clear, rectGap(own, o))
  }
  return clear
}

export interface PlanInput {
  /** team the new desks belong to */
  team: string
  /** ids to place, in roster order */
  ids: string[]
  /** desks that team already has (they define the preferred lattice origin) */
  anchors: DeskPoint[]
  /** every footprint already on the floor, including other new desks */
  obstacles: Obstacle[]
  /** walkable segments a desk must not cover */
  edges: Edge[]
  floor: { w: number; d: number }
  grid?: GridSpec
  wallT: number
  /** half-width of a walker, so a desk never sits on the path */
  walker?: number
  rot?: number
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

function centroid(points: DeskPoint[]): [number, number] | null {
  if (!points.length) return null
  const x = points.reduce((s, p) => s + p.x, 0) / points.length
  const z = points.reduce((s, p) => s + p.z, 0) / points.length
  return [x, z]
}

/** Lattice points around an origin, in rings, so a block grows compactly. */
function latticePoints(origin: [number, number], grid: GridSpec): Array<[number, number]> {
  const out: Array<{ x: number; z: number; ring: number }> = []
  for (let k = -4; k <= 4; k++) {
    for (let r = -3; r <= 3; r++) {
      out.push({ x: round(origin[0] + grid.dx * k), z: round(origin[1] + grid.dz * r), ring: Math.abs(k) + Math.abs(r) })
    }
  }
  out.sort((a, b) => a.ring - b.ring || a.x - b.x || a.z - b.z)
  return out.map(({ x, z }) => [x, z])
}

/**
 * Grid origins to try, nearest to the team first: the team's own lattice (so a
 * new desk lines up with the hand-placed ones), then a floor-wide sweep.
 */
function origins(input: PlanInput, centre: [number, number]): Array<[number, number]> {
  const seen = new Set<string>()
  const out: Array<{ o: [number, number]; d: number }> = []
  const push = (x: number, z: number) => {
    const key = `${round(x)},${round(z)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ o: [round(x), round(z)], d: Math.hypot(x - centre[0], z - centre[1]) })
  }

  const anchor = centroid(input.anchors)
  if (anchor) push(anchor[0], anchor[1])
  // A 1.5-unit sweep of the floor: dense enough to find a free block, cheap
  // enough to run once at boot.
  const halfW = input.floor.w / 2
  const halfD = input.floor.d / 2
  for (let x = -halfW + 3; x <= halfW - 3; x += 1.5) {
    for (let z = -halfD + 3; z <= halfD - 3; z += 1.5) {
      push(x, z)
    }
  }
  out.sort((a, b) => a.d - b.d || a.o[0] - b.o[0] || a.o[1] - b.o[1])
  return out.map((e) => e.o)
}

/** Try to seat every id on one lattice; returns the desks that fit. */
function tryLattice(input: PlanInput, origin: [number, number], grid: GridSpec): DeskSpot[] {
  const rot = input.rot ?? Math.PI
  const walker = input.walker ?? 0.35
  const points = latticePoints(origin, grid)
  const obstacles = [...input.obstacles]
  const placed: DeskSpot[] = []

  for (const id of input.ids) {
    let chosen: DeskSpot | null = null
    for (const [x, z] of points) {
      const spot: DeskSpot = { id, x, z, rot }
      if (clearance({ spot, id, obstacles, floor: input.floor, wallT: input.wallT }) < grid.aisle) continue
      const own = deskObstacle(spot, id)
      if (input.edges.some((e) => segRectDist(e.a, e.b, own) < walker)) continue
      chosen = spot
      break
    }
    if (!chosen) break
    placed.push(chosen)
    obstacles.push(deskObstacle(chosen, id))
  }
  return placed
}

/**
 * Place `ids` in the nearest free 4.5 x 4.0 block: the origin that seats the
 * most of them wins, ties go to the one closest to the team.
 */
export function planDesks(input: PlanInput): DeskSpot[] {
  if (!input.ids.length) return []
  const grid = input.grid ?? DEFAULT_GRID
  const centre = TEAM_CENTRE[input.team] ?? centroid(input.anchors) ?? [0, 0]

  let best: DeskSpot[] = []
  for (const origin of origins(input, centre)) {
    const spots = tryLattice(input, origin, grid)
    if (spots.length > best.length) best = spots
    if (best.length === input.ids.length) break
  }
  return best
}

/** Candidates for a single desk, exposed for tests and the layout check. */
export function candidates(team: string, anchors: DeskPoint[], grid: GridSpec): Array<{ x: number; z: number }> {
  const centre = TEAM_CENTRE[team] ?? centroid(anchors) ?? [0, 0]
  const anchor = centroid(anchors) ?? centre
  return latticePoints([round(anchor[0]), round(anchor[1])], grid).map(([x, z]) => ({ x, z }))
}
