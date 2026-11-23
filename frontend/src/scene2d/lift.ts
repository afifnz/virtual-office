/**
 * The one lift — a deterministic service clock, pure and state-free.
 *
 * Both views read THIS module: the GEDUNG shaft (three floors in one column)
 * and the floor view (one landing in the east core) map the same `level` onto
 * their own geometry, so there is never a second truth about where the car is
 * or how far its doors are open.
 *
 * The service is a fixed, replayable cycle — no `Math.random`, no mutable
 * schedule state. `liftAt(clock)` is a pure function of the clock:
 *
 *   clock 0                car at L1, doors closed, arrival flash just fired
 *   0.50…1.10              doors open  (0.6 s)
 *   1.10…2.70              hold       (1.6 s)
 *   2.70…3.30              doors close (0.6 s)
 *   3.30…4.30              ready      (1.0 s, doors shut)
 *   4.30…8.90              travel L1 → L2 (4.6 s, eased both ends)
 *   …                      L2 → L3 → L2 → L1, then the cycle repeats
 *
 * Dwell per stop is 3.8–4.3 s (pattern requirement: 3–6 s), hold 1.2–1.8 s,
 * the whole cycle 34.7 s (requirement: 30–45 s) with 4 floor changes — one
 * every 8.7 s on average, which is what makes the building feel alive.
 *
 * A rider always wins: while an agent is really inside the lift
 * (`journey.ts` sets `inLift`/`liftTo`), `liftAt()` ignores the idle cycle and
 * follows the rider's journey for exactly `LIFT_RIDER_LEG` (2.6 s = the
 * journey's dwell). The runtime (`liftStep`) then hands the idle clock back at
 * the stop of the floor the rider left the car on, so the service resumes from
 * where the car stands instead of snapping back to a stale phase.
 *
 * Everything here is geometry-free on purpose: this module knows metres of
 * time and floor numbers, never pixels.
 */
import type { FloorId } from '../lib/rooms'

export interface LiftRider {
  id: string
  floor: FloorId
  inLift: boolean
  liftTo: FloorId | null
  /**
   * Progress through the rider's own lift leg (0…1), straight from the journey.
   * When omitted the car falls back to `clock % LIFT_RIDER_LEG` — the old
   * free-running dwell, which the gates use to probe a single instant.
   */
  phase?: number
}

/** Where the car is and what it is doing, at one instant. */
export interface LiftFrame {
  /** the clock this frame was evaluated at */
  clock: number
  /** continuous floor number, 1 (lobby) … 3 (Tim Dev); e.g. 2.37 mid-ride */
  level: number
  /** the floor the car serves now (== liftFloorAt(level)) */
  floor: FloorId
  /** floor it left, while travelling */
  from: FloorId | null
  /** floor it is heading to (or the floor it is parked at) */
  to: FloorId | null
  /** eased progress of the current travel, 0…1 */
  progress: number
  moving: boolean
  /** +1 up, -1 down, 0 standing with the doors open */
  dir: -1 | 0 | 1
  /** door opening, 0 shut … 1 fully open. NEVER > 0 while `moving` */
  door: number
  /** arrival flash ("ding"), 1 → 0 over LIFT_DING_S */
  ding: number
  /** id of the rider that took the service over, null when idle */
  rider: string | null
  /** call-panel lamp per floor (1 = lit) */
  call1: number
  call2: number
  call3: number
}

// ---------------------------------------------------------------- parameters

/** Seconds the car spends between two floors (3.4 m at ≈0.74 m/s average). */
export const LIFT_LEG_S = 4.6
/** Rider dwell: the journey's lift step, and the leg the car follows it for. */
export const LIFT_RIDER_LEG = 2.6
/** Length of the arrival flash, seconds (3 frames at 60 Hz). */
export const LIFT_DING_S = 0.05
/** Door motion, seconds — open and close are symmetric by design. */
export const LIFT_DOOR_S = 0.6

interface StopSpec {
  floor: FloorId
  /** levelling: stopped, doors still shut */
  pre: number
  open: number
  hold: number
  close: number
  /** doors shut again, motor/brake before departure */
  post: number
}

/**
 * The fixed pattern: lobby → Tim Edu → Tim Dev → Tim Edu → lobby. Four stops,
 * four travels per cycle. Dwells (3.8–4.3 s) and holds (1.2–1.8 s) differ per
 * floor so the service reads as "someone called it", but they are constants —
 * the same numbers on every reload.
 */
export const LIFT_PATTERN: readonly StopSpec[] = [
  { floor: 1, pre: 0.5, open: LIFT_DOOR_S, hold: 1.6, close: LIFT_DOOR_S, post: 1.0 },
  { floor: 2, pre: 0.4, open: LIFT_DOOR_S, hold: 1.8, close: LIFT_DOOR_S, post: 0.6 },
  { floor: 3, pre: 0.4, open: LIFT_DOOR_S, hold: 1.2, close: LIFT_DOOR_S, post: 1.4 },
  { floor: 2, pre: 0.4, open: LIFT_DOOR_S, hold: 1.4, close: LIFT_DOOR_S, post: 0.8 },
]

/** Frozen phase for `?still=1`: car at L1, doors shut, no flash. */
export const LIFT_STILL_CLOCK = 0.5
/** Frozen phase for `?lift=open`: car at L1 with the doors fully open. */
export const LIFT_OPEN_CLOCK = LIFT_PATTERN[0]!.pre + LIFT_PATTERN[0]!.open + LIFT_PATTERN[0]!.hold / 2

interface LiftStop {
  floor: FloorId
  t0: number
  /** doors start to open */
  doorT: number
  /** doors start to close */
  closeT: number
  /** doors fully shut */
  shutT: number
  dur: number
  /** the floor this stop departs to (sets the arrow) */
  next: FloorId
}

interface LiftLeg {
  from: FloorId
  to: FloorId
  t0: number
  dur: number
}

/** The cycle, built once at module load (never inside a frame). */
const STOPS: LiftStop[] = []
const LEGS: LiftLeg[] = []
{
  let at = 0
  LIFT_PATTERN.forEach((s, i) => {
    const next = LIFT_PATTERN[(i + 1) % LIFT_PATTERN.length]!.floor
    const dur = s.pre + s.open + s.hold + s.close + s.post
    STOPS.push({
      floor: s.floor,
      t0: at,
      doorT: at + s.pre,
      closeT: at + s.pre + s.open + s.hold,
      shutT: at + s.pre + s.open + s.hold + s.close,
      dur,
      next,
    })
    at += dur
    LEGS.push({ from: s.floor, to: next, t0: at, dur: LIFT_LEG_S })
    at += LIFT_LEG_S
  })
}

/** One full idle cycle, seconds (34.7). */
export const LIFT_CYCLE_S = STOPS.reduce((n, s) => n + s.dur, 0) + LEGS.length * LIFT_LEG_S
/** Idle floor changes per cycle (4). */
export const LIFT_LEGS_PER_CYCLE = LEGS.length
/** Stops in the pattern, for the report/HUD. */
export const LIFT_STOPS = STOPS.map((s) => ({ floor: s.floor, t0: s.t0, dur: s.dur }))

// ------------------------------------------------------------------ helpers

const mod = (v: number, m: number): number => ((v % m) + m) % m

/** Smoothstep: zero velocity at both ends, so the car never starts or stops hard. */
export function liftEase(p: number): number {
  const k = p < 0 ? 0 : p > 1 ? 1 : p
  return k * k * (3 - 2 * k)
}

/** The floor a continuous level belongs to (nearest floor). */
export function liftFloorAt(level: number): FloorId {
  const f = Math.round(level)
  return (f < 1 ? 1 : f > 3 ? 3 : f) as FloorId
}

function lamp(frame: LiftFrame, floor: FloorId): number {
  return floor === 1 ? frame.call1 : floor === 2 ? frame.call2 : frame.call3
}

function setCall(frame: LiftFrame, floor: FloorId, v: number): void {
  if (floor === 1) frame.call1 = v
  else if (floor === 2) frame.call2 = v
  else frame.call3 = v
}

/** Call-panel lamp of one floor, 0…1 (read-only helper for the painters). */
export function liftCall(frame: LiftFrame, floor: FloorId): number {
  return lamp(frame, floor)
}

/** The direction arrow the landing indicator shows. */
export function liftArrowGlyph(dir: -1 | 0 | 1): string {
  return dir > 0 ? '▲' : dir < 0 ? '▼' : '·'
}

/**
 * The one string painted above the landing door: the floor the car serves plus
 * the way it is going ("▲L2"). The painters and the gate both call this, so the
 * indicator can never disagree with `frame.floor`.
 */
export function liftIndicatorLabel(frame: LiftFrame): string {
  return `${liftArrowGlyph(frame.dir)}L${frame.floor}`
}

export function emptyLiftFrame(): LiftFrame {
  return {
    clock: 0,
    level: 1,
    floor: 1,
    from: null,
    to: null,
    progress: 0,
    moving: false,
    dir: 0,
    door: 0,
    ding: 0,
    rider: null,
    call1: 0,
    call2: 0,
    call3: 0,
  }
}

/** First rider by id — two simultaneous riders can never make the car flicker. */
export function pickRider(riders: readonly LiftRider[]): LiftRider | null {
  let best: LiftRider | null = null
  for (const r of riders) {
    if (!r.inLift) continue
    if (!best || r.id < best.id) best = r
  }
  return best
}

// -------------------------------------------------------------- the service

/**
 * Evaluate the lift at `clock` seconds. Pure: same clock → same frame, and it
 * writes into `out` so the render loop allocates nothing.
 *
 * `rider` (optional) takes the service over: the car follows that agent from
 * its floor to `liftTo` over `LIFT_RIDER_LEG`, doors shut while it moves.
 */
export function liftAt(out: LiftFrame, clock: number, rider: LiftRider | null = null): LiftFrame {
  out.clock = clock
  out.ding = 0
  out.rider = rider ? rider.id : null
  out.call1 = 0
  out.call2 = 0
  out.call3 = 0

  if (rider) return riderFrame(out, clock, rider)

  const c = mod(clock, LIFT_CYCLE_S)

  // a stop (levelling, doors, hold)
  for (const s of STOPS) {
    if (c < s.t0 || c >= s.t0 + s.dur) continue
    const tau = c - s.t0
    const pre = s.doorT - s.t0
    out.level = s.floor
    out.floor = s.floor
    out.from = null
    out.to = s.floor
    out.progress = 0
    out.moving = false
    // the arrow shows the way the car will leave (up/down/down/up per stop) —
    // and turns into `·` while the doors are open: it is not going anywhere yet
    const leaving = s.next > s.floor ? 1 : -1
    const openFrom = s.doorT - s.t0
    const openTo = s.shutT - s.t0
    out.dir = tau >= openFrom && tau < openTo ? 0 : leaving
    out.door = doorCurve(tau - pre, s)
    out.ding = tau >= 0 && tau < LIFT_DING_S ? 1 - tau / LIFT_DING_S : 0
    setCall(out, s.floor, 1)
    return out
  }

  // a travel
  for (const leg of LEGS) {
    if (c < leg.t0 || c >= leg.t0 + leg.dur) continue
    const p = (c - leg.t0) / leg.dur
    const q = liftEase(p)
    out.from = leg.from
    out.to = leg.to
    out.progress = q
    out.level = leg.from + (leg.to - leg.from) * q
    out.floor = liftFloorAt(out.level)
    out.moving = true
    out.dir = leg.to > leg.from ? 1 : -1
    out.door = 0
    // "called": the destination lights up, the floor just left fades out
    setCall(out, leg.to, 1)
    setCall(out, leg.from, q < 0.35 ? 0.55 : 0)
    return out
  }

  // unreachable with a consistent table; keep the frame valid anyway
  out.level = 1
  out.floor = 1
  out.from = null
  out.to = 1
  out.progress = 0
  out.moving = false
  out.dir = 1
  out.door = 0
  out.ding = 0
  return out
}

/** 0 → 1 over `open`, flat for `hold`, 1 → 0 over `close` (u = time since levelling). */
function doorCurve(u: number, s: LiftStop): number {
  if (u <= 0) return 0
  if (u < LIFT_DOOR_S) return u / LIFT_DOOR_S
  const holdEnd = s.closeT - s.doorT // open + hold
  if (u < holdEnd) return 1
  if (u < holdEnd + LIFT_DOOR_S) return 1 - (u - holdEnd) / LIFT_DOOR_S
  return 0
}

/**
 * Rider frame. The journey hands the lift 2.6 s per leg; inside it the car
 * waits with the doors open (0–6 %), shuts them (6–14 %), travels with an
 * eased profile (14–86 %), and stands at the destination (86–100 %) where the
 * idle service picks the clock up again. Doors are shut for the whole travel:
 * the door gate is arithmetic here, not a correction.
 */
const RIDER_TRAVEL0 = 0.14
const RIDER_TRAVEL1 = 0.86

function riderFrame(out: LiftFrame, clock: number, rider: LiftRider): LiftFrame {
  const p =
    rider.phase !== undefined
      ? Math.min(1, Math.max(0, rider.phase))
      : mod(clock, LIFT_RIDER_LEG) / LIFT_RIDER_LEG
  const from = rider.floor
  const to = rider.liftTo ?? rider.floor
  const q = (p - RIDER_TRAVEL0) / (RIDER_TRAVEL1 - RIDER_TRAVEL0)
  const e = liftEase(q)
  out.from = from
  out.to = to
  out.progress = e
  out.level = from + (to - from) * e
  out.floor = liftFloorAt(out.level)
  out.moving = q > 0 && q < 1 && from !== to
  out.dir = out.moving ? (to > from ? 1 : -1) : 0
  out.door = p < 0.06 ? 1 : p < RIDER_TRAVEL0 ? 1 - (p - 0.06) / (RIDER_TRAVEL0 - 0.06) : 0
  const arriveAt = RIDER_TRAVEL1
  out.ding = p >= arriveAt && p < arriveAt + LIFT_DING_S / LIFT_RIDER_LEG ? 1 - (p - arriveAt) / (LIFT_DING_S / LIFT_RIDER_LEG) : 0
  setCall(out, from, out.moving ? (e < 0.4 ? 0.55 : 0) : 1)
  setCall(out, to, 1)
  return out
}

/**
 * The clock at which the idle service starts the stop at `floor`. Used when a
 * rider gets out: the car carries on from where it stands (doors shut, then
 * opening on its own) instead of snapping back to a stale phase.
 */
export function liftResumeClock(floor: FloorId): number {
  for (const s of STOPS) if (s.floor === floor) return s.t0
  return 0
}

/** Allocating convenience for gates/probes (the render loop uses `liftAt`). */
export function liftFrame(clock: number, rider: LiftRider | null = null): LiftFrame {
  return liftAt(emptyLiftFrame(), clock, rider)
}

// ---------------------------------------------------------------- the runtime

/**
 * The smallest possible state: one clock, one "where did the car stop" floor,
 * one "a rider holds the service" bit. Mutated in place — no per-frame object,
 * no history — and every value in it is a function of the clock and of the
 * rider intervals the caller feeds in, so a replay is exact.
 */
export interface LiftRuntime {
  clock: number
  /** floor the car was left on by the last rider */
  park: FloorId
  held: boolean
  frame: LiftFrame
}

export function createLiftRuntime(clock = LIFT_STILL_CLOCK): LiftRuntime {
  return { clock, park: 1, held: false, frame: liftAt(emptyLiftFrame(), clock, null) }
}

/**
 * Advance the service by `dt` seconds with the riders of this frame.
 *
 * - a rider present → the car follows it, the idle clock is frozen;
 * - the rider gone → the clock restarts at that floor's stop (no jump);
 * - `dt = 0` (frozen clock, `?still=1`, reduced motion) → nothing advances.
 */
export function liftStep(rt: LiftRuntime, dt: number, rider: LiftRider | null, clock = rt.clock): LiftFrame {
  if (rider) {
    rt.held = true
    rt.park = rider.liftTo ?? rider.floor
    return liftAt(rt.frame, clock, rider)
  }
  if (rt.held) {
    rt.held = false
    rt.clock = liftResumeClock(rt.park)
  }
  rt.clock += dt
  return liftAt(rt.frame, rt.clock, null)
}

/** Frozen frame for `?still=1` / reduced motion: car at L1, doors per clock. */
export function liftStillFrame(clock = LIFT_STILL_CLOCK): LiftFrame {
  return liftAt(emptyLiftFrame(), clock, null)
}

/** The parameter table, for the report and `__office2dLift()`. */
export function liftParams() {
  return {
    legS: LIFT_LEG_S,
    riderLegS: LIFT_RIDER_LEG,
    doorS: LIFT_DOOR_S,
    dingS: LIFT_DING_S,
    cycleS: LIFT_CYCLE_S,
    legsPerCycle: LIFT_LEGS_PER_CYCLE,
    pattern: LIFT_PATTERN.map((s) => s.floor),
    stops: LIFT_STOPS,
    stillClock: LIFT_STILL_CLOCK,
    openClock: LIFT_OPEN_CLOCK,
  }
}
