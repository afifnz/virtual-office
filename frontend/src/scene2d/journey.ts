/**
 * The delegate journey: where a walking agent is, on which floor, at clock `t`.
 * Pure — no DOM, no Math.random — so `verify/anim_check.ts` replays the whole
 * journey headless (plan §Lift).
 *
 * Two shapes:
 *
 *  - Same-floor delegation keeps the old loop as a degenerate journey:
 *    walk out, stand at the target, walk home, sit. No lift step, ever.
 *
 *  - Cross-floor delegation (the delegate's target desk sits on another floor)
 *    is a seven-segment round trip through the single lift core:
 *      A walk  desk → lift node        (home floor)
 *      B lift  dwell LIFT_DWELL        (home floor, doors open, chip "di lift · L<to>")
 *      C walk  lift node → target desk (target floor)
 *      D stand at the target           (existing 5 + seed·4 s)
 *      E walk  target desk → lift node (target floor)
 *      F lift  dwell LIFT_DWELL        (target floor, chip "di lift · L<home>")
 *      G walk  lift node → seat        (home floor)
 *
 * Everything is deterministic: paths come from the nav graph, the phase offset
 * and the stand/rest durations come from `hashId(agent id)`, and the clock `t`
 * is frozen under `?still=1`. An agent is therefore drawn on exactly one floor
 * at any instant — the journey's current `floor`.
 */
import type { AgentMeta } from '../lib/agents'
import { DESK_EXIT, LIFT, POIS, liftNode, nearestNode, type FloorId } from '../lib/rooms'
import { navPath, type Pt } from '../lib/nav'
import { hashId, rosterAgents } from '../lib/roster'
import { seatPoint } from '../lib/routes'
import type { WalkTarget } from './anim'

/** How long the lift waits at a floor with its doors open. */
export const LIFT_DWELL = 2.6
/** Walking speed, world units per second (unchanged from the old walkState). */
export const JOURNEY_SPEED = 1.8

export type JourneyStep =
  /** walk `path` on `floor`; `stand` seconds are waited at the path's end */
  | { kind: 'walk'; floor: FloorId; path: Pt[]; stand?: number }
  /** stand still at the lift node on `floor`, riding towards `to` */
  | { kind: 'lift'; floor: FloorId; to: FloorId; x: number; z: number; dur: number }

export interface Journey {
  steps: JourneyStep[]
  /** full round-trip period, including the walk home and the seated rest */
  total: number
}

/** Where one agent is right now. Exactly one `floor` at a time, always. */
export interface JourneyState {
  floor: FloorId
  x: number
  z: number
  walking: boolean
  /** true only while dwelling inside the lift (the doors are open) */
  inLift: boolean
  /** destination floor during a dwell; null on every walk/stand/sit segment */
  liftTo: FloorId | null
}

function pathLen(path: Pt[]): number {
  let L = 0
  for (let i = 0; i < path.length - 1; i++) L += Math.hypot(path[i + 1]![0] - path[i]![0], path[i + 1]![1] - path[i]![1])
  return L
}

function pointAt(path: Pt[], dist: number): Pt {
  if (path.length === 0) return [0, 0]
  if (path.length === 1) return path[0]!
  let rem = dist
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (rem <= seg || i === path.length - 2) {
      const k = seg > 0 ? Math.min(1, rem / seg) : 1
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
    }
    rem -= seg
  }
  return path[path.length - 1]!
}

/** nav-graph route between two points on one floor: [from, node, …, node, to]. */
function routeOnFloor(from: Pt, to: Pt, floor: FloorId): Pt[] {
  const a = nearestNode(from[0], from[1], floor)
  const b = nearestNode(to[0], to[1], floor)
  // navPath() leaves out its start node: walk to it first, or the leg from
  // `from` runs straight to the *second* node, through whatever is between
  return [from, [a.x, a.z], ...navPath(a.id, b.id), to]
}

/** The meeting fallback on the walker's own floor for an unknown desk target. */
function fallbackPoi(floor: FloorId): Pt {
  const id = floor === 3 ? 'standup' : 'rapat'
  return (POIS.find((p) => p.id === id && p.floor === floor)?.pos as Pt | undefined) ?? [0, 0]
}

/** Where a same-floor delegation walk is headed (target desk exit or POI). */
function sameFloorTarget(meta: AgentMeta, walkTo: WalkTarget): Pt {
  if (walkTo.kind === 'desk') {
    const target = rosterAgents().find((a) => a.id === walkTo.id)
    if (target && target.desk.floor === meta.desk.floor) {
      return (DESK_EXIT[walkTo.id] as Pt | undefined) ?? fallbackPoi(meta.desk.floor)
    }
  } else {
    const poi = POIS.find((p) => p.id === walkTo.id && p.floor === meta.desk.floor)
    if (poi) return poi.pos as Pt
  }
  return fallbackPoi(meta.desk.floor)
}

/**
 * Build the full journey for one delegate walk. `stand` keeps the existing
 * 5 + seed·4 s and the seated rest keeps the old 16 + seed·6 s budget, so a
 * same-floor journey plays exactly like the old out/stand/back loop.
 */
export function journeyFor(meta: AgentMeta, walkTo: WalkTarget): Journey {
  const home = meta.desk.floor
  const seed = (hashId(meta.id) % 1000) / 1000
  const stand = 5 + seed * 4
  const rest = Math.max(0, 16 + seed * 6 - stand)

  const target = walkTo.kind === 'desk' ? rosterAgents().find((a) => a.id === walkTo.id) : undefined
  const crossFloor = Boolean(target && target.desk.floor !== home)

  if (!crossFloor || !target) {
    // same-floor loop (or unknown target → meeting POI on the walker's floor)
    const out = routeOnFloor(DESK_EXIT[meta.id] ?? seatPoint(meta), sameFloorTarget(meta, walkTo), home)
    const tOut = pathLen(out) / JOURNEY_SPEED
    const back = [...out].reverse()
    back.push(seatPoint(meta))
    const steps: JourneyStep[] = [
      { kind: 'walk', floor: home, path: out, stand },
      { kind: 'walk', floor: home, path: back },
    ]
    // keep the old period exactly: the seated rest soaks up the remainder
    const total = Math.max(16 + seed * 6, tOut + stand + pathLen(back) / JOURNEY_SPEED)
    return { steps, total }
  }

  const dest = target.desk.floor
  const liftHome: Pt = [liftNode(home).x, liftNode(home).z]
  const liftDest: Pt = [liftNode(dest).x, liftNode(dest).z]
  const targetExit = (DESK_EXIT[target.id] as Pt | undefined) ?? liftDest

  const pathA = routeOnFloor(DESK_EXIT[meta.id] ?? seatPoint(meta), liftHome, home)
  const pathC = routeOnFloor(liftDest, targetExit, dest)
  const pathE = routeOnFloor(targetExit, liftDest, dest)
  const pathG = routeOnFloor(liftHome, seatPoint(meta), home)

  const steps: JourneyStep[] = [
    { kind: 'walk', floor: home, path: pathA },
    { kind: 'lift', floor: home, to: dest, x: liftHome[0], z: liftHome[1], dur: LIFT_DWELL },
    { kind: 'walk', floor: dest, path: pathC, stand },
    { kind: 'walk', floor: dest, path: pathE },
    { kind: 'lift', floor: dest, to: home, x: liftDest[0], z: liftDest[1], dur: LIFT_DWELL },
    { kind: 'walk', floor: home, path: pathG },
  ]
  const total =
    pathLen(pathA) / JOURNEY_SPEED +
    LIFT_DWELL +
    pathLen(pathC) / JOURNEY_SPEED +
    stand +
    pathLen(pathE) / JOURNEY_SPEED +
    LIFT_DWELL +
    pathLen(pathG) / JOURNEY_SPEED +
    rest
  return { steps, total }
}

/** Wrap a raw clock into a journey phase (deterministic; frozen under ?still=1). */
export function journeyClock(meta: AgentMeta, journey: Journey, t: number): number {
  const seed = (hashId(meta.id) % 1000) / 1000
  return (((t + seed * 97) % journey.total) + journey.total) % journey.total
}

/**
 * Evaluate one journey at `phase` seconds into its period. Returns the single
 * floor the agent is on plus its position; `inLift`/`liftTo` are set only
 * during a dwell. After the last step (the walk home) the agent sits at the
 * final path point until the period wraps.
 */
export function journeyAt(journey: Journey, phase: number): JourneyState {
  let t = (((phase % journey.total) + journey.total) % journey.total)
  for (const step of journey.steps) {
    if (step.kind === 'lift') {
      if (t < step.dur) {
        return { floor: step.floor, x: step.x, z: step.z, walking: false, inLift: true, liftTo: step.to }
      }
      t -= step.dur
      continue
    }
    const walkDur = pathLen(step.path) / JOURNEY_SPEED
    if (t < walkDur) {
      const p = pointAt(step.path, t * JOURNEY_SPEED)
      return { floor: step.floor, x: p[0], z: p[1], walking: true, inLift: false, liftTo: null }
    }
    t -= walkDur
    const standDur = step.stand ?? 0
    if (t < standDur) {
      const end = step.path[step.path.length - 1] ?? [0, 0]
      return { floor: step.floor, x: end[0], z: end[1], walking: false, inLift: false, liftTo: null }
    }
    t -= standDur
  }
  const last = journey.steps[journey.steps.length - 1]
  if (last?.kind === 'walk') {
    const end = last.path[last.path.length - 1] ?? [0, 0]
    return { floor: last.floor, x: end[0], z: end[1], walking: false, inLift: false, liftTo: null }
  }
  if (last?.kind === 'lift') {
    return { floor: last.floor, x: last.x, z: last.z, walking: false, inLift: false, liftTo: null }
  }
  return { floor: 1, x: 0, z: 0, walking: false, inLift: false, liftTo: null }
}

/**
 * The lift chip text: floor label only, never a message, title or task detail
 * (privacy, plan §R6). Rendered as a normal label plate through the stack
 * layout, so it can never overlap another plate.
 */
export function liftChip(to: FloorId): string {
  return `DI LIFT · L${to}`
}

/** Floors where at least one agent currently dwells in the lift (doors open). */
export function dwellFloors(states: ReadonlyArray<{ inLift: boolean; floor: FloorId }>): Set<FloorId> {
  const set = new Set<FloorId>()
  for (const s of states) if (s.inLift) set.add(s.floor)
  return set
}

/** Door geometry shared by the static painter and the dynamic open-door overlay. */
export function liftDoorRect(floor: FloorId): { x: number; z: number } {
  // the west face of the shaft, centred on the walk node (z = 0.6)
  return { x: LIFT[floor].doorX, z: 0.6 }
}
