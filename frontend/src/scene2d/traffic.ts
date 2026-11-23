/**
 * Street life for the GEDUNG view: two lanes of traffic, the pedestrian light
 * and its crossing, plus the slow sky (clouds, birds, blinking neighbour
 * windows).
 *
 * This module is PURE — no DOM, no canvas, no `Math.random` — so the painter,
 * the browser probe and `verify/traffic_check.ts` read the same numbers, and
 * every position is a function of the frame time `t`:
 *
 *   - `trafficAt(t)` replays a fixed-step lane simulation (1/60 s) from t = 0
 *     and returns the SAME numbers for the same t, so `?still=1` (t frozen by
 *     the rAF loop) parks on one phase and a screenshot is repeatable.
 *   - The renderer calls it with a monotone `t`, so the replay only advances a
 *     few steps per frame; the returned frame is a reused buffer (no per-frame
 *     allocation, no GC in the loop).
 *
 * The road is a loop that runs 70 px past both canvas edges: a vehicle that
 * leaves the sheet re-enters on the other side while it is still off-screen,
 * so the wrap is never a pop in the middle of the frame.
 */
import { BLD_STREET, buildingCityRects } from './building'

// ---------------------------------------------------------------- geometry

/** The road band of the building sheet (`BLD_STREET.walk … road`). */
export const ROAD = {
  /** loop coordinates: 70 px past each canvas edge */
  x0: -70,
  x1: 1070,
  top: BLD_STREET.walk, // 578
  bottom: BLD_STREET.road, // 640
  /** wheels line of each lane (side view: y at the bottom of the vehicle) */
  nearBase: 638,
  farBase: 605,
  /** dashed centre line */
  centre: (BLD_STREET.walk + BLD_STREET.road) / 2, // 609
  /** minimum bumper-to-bumper gap, design px */
  minGap: 16,
} as const

const LOOP = ROAD.x1 - ROAD.x0 // 1140

/** The zebra crossing under the tower entrance (painted by the static sheet). */
export const ZEBRA = { x0: 420, x1: 580 } as const

/**
 * Where each lane stops for the light: the front bumper sits 8 px clear of the
 * zebra. In loop coordinates both stop lines land on the same number, which
 * keeps the gate arithmetic simple.
 */
export const STOP_LINE = { near: ZEBRA.x0 - 8, far: ZEBRA.x1 + 8 } as const
export const STOP_S = { near: STOP_LINE.near - ROAD.x0, far: ROAD.x1 - STOP_LINE.far } as const

/** Signal heads on the near sidewalk, right of the zebra (never over the facade). */
export const SIGNAL = { x: 588, y: 561, w: 24, h: 16 } as const

/** Sidewalk walking bands (feet line). */
export const WALK = {
  near: { feet: 576, top: BLD_STREET.top }, // 560…578
  far: { feet: 658, top: BLD_STREET.road }, // 640…660
} as const

/**
 * One light for both lanes: green 6 s, yellow 2 s, red 6 s (14 s cycle). The
 * pedestrian light walks during the red phase, so nobody crosses while a car
 * is moving — and a car never enters the zebra once the light leaves green.
 */
export const LIGHT = { green: 6, yellow: 2, red: 6, cycle: 14 } as const
/** Start of the red phase inside a cycle (green + yellow). */
export const RED_START = LIGHT.green + LIGHT.yellow

export type LightPhase = 'green' | 'yellow' | 'red'

export interface LightState {
  phase: LightPhase
  /** seconds since the phase began */
  since: number
  /** seconds until the next phase */
  remaining: number
  /** index of the 14 s cycle this frame is in */
  cycle: number
  /** the pedestrian light is green exactly while the vehicle light is red */
  pedWalk: boolean
}

/** Pure phase lookup — the sim only needs the string, the painter needs all. */
export function phaseAt(t: number): LightPhase {
  const p = ((t % LIGHT.cycle) + LIGHT.cycle) % LIGHT.cycle
  if (p < LIGHT.green) return 'green'
  if (p < RED_START) return 'yellow'
  return 'red'
}

export function lightAt(t: number): LightState {
  const p = ((t % LIGHT.cycle) + LIGHT.cycle) % LIGHT.cycle
  const phase = phaseAt(t)
  const start = phase === 'green' ? 0 : phase === 'yellow' ? LIGHT.green : RED_START
  const len = phase === 'green' ? LIGHT.green : phase === 'yellow' ? LIGHT.yellow : LIGHT.red
  return {
    phase,
    since: p - start,
    remaining: start + len - p,
    cycle: Math.floor(t / LIGHT.cycle),
    pedWalk: phase === 'red',
  }
}

// ----------------------------------------------------------------- vehicles

export type VehicleKind = 'car' | 'van' | 'bus' | 'moto'
export type LaneId = 'near' | 'far'

/** Side-view box per kind: w × h in design px, plus the free-flow speed. */
export const VEHICLE = {
  car: { w: 40, h: 18, speed: 78, accel: 150 },
  van: { w: 46, h: 21, speed: 70, accel: 130 },
  bus: { w: 66, h: 24, speed: 58, accel: 90 },
  moto: { w: 20, h: 12, speed: 86, accel: 180 },
} as const

/** One deterministic fleet per lane. */
const FLEET: Record<LaneId, readonly VehicleKind[]> = {
  near: ['car', 'bus', 'car', 'moto', 'van'],
  far: ['van', 'car', 'moto', 'bus', 'car'],
}

/** Speed window the design promises for a free-flowing car (px/s at zoom 1). */
export const SPEED_RANGE = { min: 45, max: 95 } as const

const DT = 1 / 60
/**
 * Braking strength used by the approach curve (design px/s²). Low enough that
 * a car visibly rolls to a stop over ~40 px instead of snapping in one frame.
 */
const DECEL = 70

export interface VehicleView {
  id: string
  lane: LaneId
  kind: VehicleKind
  dir: 1 | -1
  /** centre x, design px */
  x: number
  /** top y (bbox top; the wheels sit at y + h) */
  y: number
  w: number
  h: number
  /** current speed, px/s (0 while the light holds it) */
  speed: number
  /** true when the light holds it in front of the zebra */
  held: boolean
}

interface LaneCar {
  kind: VehicleKind
  /** loop coordinate, increasing along the direction of travel */
  s: number
  v: number
}

interface LaneSim {
  id: LaneId
  dir: 1 | -1
  base: number
  cars: LaneCar[]
}

function makeLane(id: LaneId): LaneSim {
  const defs = FLEET[id]
  return {
    id,
    dir: id === 'near' ? 1 : -1,
    base: id === 'near' ? ROAD.nearBase : ROAD.farBase,
    // even spacing plus a small deterministic stagger so the two lanes never
    // look like a mirrored train
    cars: defs.map((kind, i) => ({
      kind,
      s: (i + 0.5) * (LOOP / defs.length) + (id === 'near' ? i * 3 : -i * 4) + (id === 'far' ? 26 : 0),
      v: VEHICLE[kind].speed * (1 + ((i % 3) - 1) * 0.04),
    })),
  }
}

/**
 * One fixed step for a whole lane. The leader of a car is the nearest car
 * ahead on the loop (modular distance), so no sort is needed and the wrap can
 * never reorder anything. `stopS` is the loop coordinate of the stop line while
 * the light is yellow/red, `null` on green: a car whose bumper has already
 * passed it is clearing the zebra and is not held.
 */
function stepLane(lane: LaneSim, stopS: number | null, dt: number): void {
  const cars = lane.cars
  const n = cars.length
  for (let i = 0; i < n; i++) {
    const car = cars[i]!
    const spec = VEHICLE[car.kind]
    const half = spec.w / 2
    // nearest car ahead, modular in the loop
    let gap = Infinity
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const other = cars[j]!
      const d = (((other.s - car.s) % LOOP) + LOOP) % LOOP - half - VEHICLE[other.kind].w / 2
      if (d < gap) gap = d
    }
    if (!Number.isFinite(gap)) gap = LOOP
    let allowed = gap - ROAD.minGap
    if (allowed < 0) allowed = 0
    if (stopS !== null && car.s + half <= stopS) {
      const toLine = stopS - half - car.s
      if (toLine < allowed) allowed = toLine < 0 ? 0 : toLine
    }
    const brake = Math.sqrt(2 * DECEL * allowed)
    let v = car.v + spec.accel * dt
    if (v > spec.speed) v = spec.speed
    if (v > brake) v = brake
    if (v < 0) v = 0
    const advance = v * dt < allowed ? v * dt : allowed
    car.v = advance / dt
    car.s = (car.s + advance) % LOOP
  }
}

// -------------------------------------------------------------- pedestrians

export interface PedView {
  id: string
  /** centre x */
  x: number
  /** feet y */
  y: number
  w: number
  h: number
  /** 0/1 walk cycle */
  frame: number
  /** inside the road (on the zebra) right now */
  crossing: boolean
  /** walking direction, -1/1 */
  facing: 1 | -1
  /** deterministic coat index 0…3 */
  coat: number
}

/** Three sidewalk walkers plus two crossers; all positions are pure in `t`. */
export const PED_SPECS = [
  { id: 'ped-1', kind: 'walk', side: 'near', from: 96, to: 380, speed: 16, phase: 0, coat: 0 },
  { id: 'ped-2', kind: 'walk', side: 'near', from: 780, to: 946, speed: 13, phase: 5, coat: 1 },
  { id: 'ped-3', kind: 'walk', side: 'far', from: 300, to: 560, speed: 15, phase: 9, coat: 2 },
  { id: 'ped-x1', kind: 'cross', side: 'near', from: 470, to: 470, speed: 0, phase: 0, coat: 3 },
  { id: 'ped-x2', kind: 'cross', side: 'near', from: 534, to: 534, speed: 0, phase: 14, coat: 1 },
] as const

export const CROSS_PERIOD = LIGHT.cycle * 2
/** Kerb lines: the two pavement edges the crossing spans. */
export const CURB = { near: BLD_STREET.walk, far: BLD_STREET.road } as const
/**
 * Start 2.8 s into the red phase: the last car that entered on yellow needs
 * ~2.7 s to clear the 160 px zebra, so the walker never walks through one. The
 * 3 s that remain carry the figure over both kerbs (pavement to pavement),
 * which is a brisk but readable walk at this scale.
 */
export const CROSS_START = RED_START + 2.8 // 10.8 s into the first cycle
const CROSS_END = LIGHT.cycle - 0.2 // 13.8 s
const CROSS_DUR = CROSS_END - CROSS_START // 3.0 s
const CROSS_BACK = RED_START + LIGHT.cycle + 2.8 // 24.8 s

/**
 * Feet position of a crosser: pure in `t`, in the road only during the
 * pedestrian window (vehicle red). Between crossings the figure paces at the
 * curb, so restarting the 28 s loop never teleports it.
 */
function crosserAt(t: number, phaseOffset: number, curbX: number): { x: number; y: number; crossing: boolean; facing: 1 | -1 } {
  const p = (((t + phaseOffset) % CROSS_PERIOD) + CROSS_PERIOD) % CROSS_PERIOD
  const near = WALK.near.feet
  const far = WALK.far.feet
  const pace = Math.sin((p / 1.9) * Math.PI * 2) * 2
  if (p >= CROSS_START && p < CROSS_END) {
    const k = (p - CROSS_START) / CROSS_DUR
    return { x: curbX + pace * 0.2, y: near + (far - near) * k, crossing: true, facing: 1 }
  }
  if (p >= CROSS_BACK && p < CROSS_BACK + CROSS_DUR) {
    const k = (p - CROSS_BACK) / CROSS_DUR
    return { x: curbX + pace * 0.2, y: far + (near - far) * k, crossing: true, facing: -1 }
  }
  const onFar = p >= CROSS_END && p < CROSS_BACK
  return { x: curbX + pace, y: onFar ? far : near, crossing: false, facing: 1 }
}

/** Triangle wave: a sidewalk walker turns around at its bounds, never pops. */
function walkerX(from: number, to: number, speed: number, phase: number, t: number): { x: number; dir: 1 | -1 } {
  const span = Math.abs(to - from)
  const period = (span / speed) * 2
  const p = ((((t + phase) % period) + period) % period) / period
  const up = p < 0.5
  const k = up ? p * 2 : (1 - p) * 2
  const lo = Math.min(from, to)
  const dir: 1 | -1 = from < to ? (up ? 1 : -1) : up ? -1 : 1
  return { x: lo + span * k, dir }
}

// -------------------------------------------------------------- the frame

export interface TrafficFrame {
  t: number
  light: LightState
  vehicles: VehicleView[]
  peds: PedView[]
  counts: { vehicles: number; peds: number; near: number; far: number; crossers: number }
}

const vehicleViews: VehicleView[] = []
for (const lane of ['far', 'near'] as const) {
  FLEET[lane].forEach((kind, i) => {
    const spec = VEHICLE[kind]
    vehicleViews.push({
      id: `${lane}-${i}`,
      lane,
      kind,
      dir: lane === 'near' ? 1 : -1,
      x: 0,
      y: 0,
      w: spec.w,
      h: spec.h,
      speed: 0,
      held: false,
    })
  })
}

const pedViews: PedView[] = PED_SPECS.map((spec) => ({
  id: spec.id,
  x: spec.from,
  y: WALK[spec.side].feet,
  w: spec.kind === 'cross' ? 7 : 8,
  h: spec.kind === 'cross' ? 15 : 14,
  frame: 0,
  crossing: false,
  facing: 1,
  coat: spec.coat % 4,
}))

const lanes: Record<LaneId, LaneSim> = { near: makeLane('near'), far: makeLane('far') }
let simStep = 0
/** Hard ceiling on one catch-up replay (≈ 3 h at 60 fps): keeps a bad call bounded. */
const MAX_REPLAY = 60 * 60 * 60 * 3

export function resetTraffic(): void {
  lanes.near = makeLane('near')
  lanes.far = makeLane('far')
  simStep = 0
}

const frame: TrafficFrame = {
  t: 0,
  light: lightAt(0),
  vehicles: vehicleViews,
  peds: pedViews,
  counts: { vehicles: vehicleViews.length, peds: pedViews.length, near: 0, far: 0, crossers: 0 },
}

/** Reused buffer: copy what you need, never keep the reference. */
export function trafficAt(t: number): TrafficFrame {
  const target = Math.min(Math.max(0, Math.floor(t / DT + 1e-6)), MAX_REPLAY)
  if (target < simStep) resetTraffic()
  while (simStep < target) {
    simStep++
    const phase = phaseAt(simStep * DT)
    const stop = phase === 'green'
    stepLane(lanes.far, stop ? null : STOP_S.far, DT)
    stepLane(lanes.near, stop ? null : STOP_S.near, DT)
  }

  frame.t = t
  frame.light = lightAt(t)
  for (let i = 0; i < vehicleViews.length; i++) {
    const view = vehicleViews[i]!
    const lane = lanes[view.lane]
    const idx = view.lane === 'far' ? i : i - FLEET.far.length
    const car = lane.cars[idx]!
    const x = view.dir > 0 ? ROAD.x0 + car.s : ROAD.x1 - car.s
    view.x = x
    view.y = lane.base - view.h
    view.speed = car.v
    const front = view.dir > 0 ? x + view.w / 2 : x - view.w / 2
    const stopX = view.dir > 0 ? STOP_LINE.near : STOP_LINE.far
    view.held = car.v < 0.5 && (view.dir > 0 ? front <= stopX + 1 : front >= stopX - 1)
  }

  let crossers = 0
  for (let i = 0; i < pedViews.length; i++) {
    const spec = PED_SPECS[i]!
    const p = pedViews[i]!
    if (spec.kind === 'cross') {
      const c = crosserAt(t, spec.phase, spec.from)
      p.x = c.x
      p.y = c.y
      p.crossing = c.crossing
      p.facing = c.facing
      p.frame = c.crossing ? Math.floor(t * 3.4 + i) % 2 : 0
      if (c.crossing) crossers++
    } else {
      const w = walkerX(spec.from, spec.to, spec.speed, spec.phase, t)
      p.x = w.x
      p.y = WALK[spec.side].feet
      p.crossing = false
      p.facing = w.dir
      p.frame = Math.floor(t * 3.1 + i * 0.7) % 2
    }
  }
  frame.counts.crossers = crossers
  frame.counts.near = FLEET.near.length
  frame.counts.far = FLEET.far.length
  return frame
}

/** Plain-number copy of one frame (gates, probes, screenshots). */
export function trafficSnapshot(t: number): TrafficFrame {
  const f = trafficAt(t)
  return {
    t: f.t,
    light: { ...f.light },
    vehicles: f.vehicles.map((v) => ({ ...v })),
    peds: f.peds.map((p) => ({ ...p })),
    counts: { ...f.counts },
  }
}

// -------------------------------------------------------------------- sky

export interface CloudDef {
  x0: number
  y: number
  w: number
  speed: number
  alpha: number
}

/** Day sky, slow drift (px/s). Wraps well outside the sheet. */
export const CLOUDS: readonly CloudDef[] = [
  { x0: -60, y: 18, w: 96, speed: 4.2, alpha: 0.88 },
  { x0: 300, y: 34, w: 66, speed: 3.1, alpha: 0.72 },
  { x0: 560, y: 12, w: 124, speed: 5.4, alpha: 0.92 },
  { x0: 860, y: 40, w: 78, speed: 3.6, alpha: 0.76 },
  { x0: 150, y: 40, w: 56, speed: 2.4, alpha: 0.62 },
]

const SKY_LO = -170
const SKY_HI = 1170
const SKY_SPAN = SKY_HI - SKY_LO

export function cloudX(c: CloudDef, t: number): number {
  return SKY_LO + ((((c.x0 - SKY_LO + c.speed * t) % SKY_SPAN) + SKY_SPAN) % SKY_SPAN)
}

export interface BirdDef {
  y: number
  period: number
  offset: number
  speed: number
  size: number
}

/** Sparse fly-bys: each bird crosses the sky once per 37…71 s, day only. */
export const BIRDS: readonly BirdDef[] = [
  { y: 96, period: 37, offset: 0, speed: 82, size: 4 },
  { y: 118, period: 53, offset: 21, speed: 66, size: 3.2 },
  { y: 84, period: 71, offset: 44, speed: 96, size: 3.6 },
]

export interface BirdState {
  visible: boolean
  x: number
  y: number
  /** wing offset in px (0 or -size * 0.6) */
  flap: number
}

const birdState: BirdState = { visible: false, x: 0, y: 0, flap: 0 }

/** Shared buffer (the painter draws it immediately). */
export function birdAt(b: BirdDef, t: number): BirdState {
  const p = (((t + b.offset) % b.period) + b.period) % b.period
  const flight = (SKY_SPAN - 120) / b.speed
  if (p > flight) {
    birdState.visible = false
    birdState.x = 0
    birdState.y = 0
    birdState.flap = 0
    return birdState
  }
  birdState.visible = true
  birdState.x = -40 + b.speed * p
  birdState.y = b.y + Math.sin(p * 1.7) * 3
  birdState.flap = Math.floor(p * 7) % 2 === 0 ? 0 : -b.size * 0.6
  return birdState
}

// --------------------------------------------------- neighbour windows

/**
 * Lit windows of the procedural skyline, at the exact grid the static sheet
 * paints (same formula as `windows()` in `render-building.ts`). The night pass
 * blinks a deterministic subset on top of the cached sheet.
 */
export interface NeighbourWindow {
  x: number
  y: number
  /** 0…1 blink phase */
  phase: number
  /** blink period in seconds */
  period: number
}

let windowCache: NeighbourWindow[] | null = null

/**
 * The window grid of one skyline rect, at the exact numbers the static sheet
 * paints. Shared with `windows()` in `render-building.ts` so a blinking window
 * always sits on a window that was really painted.
 */
export interface WindowCell {
  x: number
  y: number
  /** 0…1 texture value (below 0.42 the window stays dark at night) */
  v: number
}

export function cityWindowCells(rect: { x: number; y: number; w: number; h: number }): WindowCell[] {
  const cols = Math.max(2, Math.floor((rect.w - 6) / 8))
  const rows = Math.max(2, Math.floor((rect.h - 8) / 10))
  const seed = (rect.x * 13 + rect.h) | 0
  const out: WindowCell[] = []
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      out.push({
        x: rect.x + 3 + c * ((rect.w - 6) / cols),
        y: rect.y + 4 + r * ((rect.h - 8) / rows),
        v: ((c * 73 + r * 41 + seed * 97) % 100) / 100,
      })
    }
  }
  return out
}

export function neighbourWindows(): NeighbourWindow[] {
  if (windowCache) return windowCache
  const out: NeighbourWindow[] = []
  for (const rect of buildingCityRects()) {
    const cells = cityWindowCells(rect)
    const seed = (rect.x * 13 + rect.h) | 0
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!
      if (cell.v < 0.42) continue // dark window: nothing to blink
      // every 9th lit window blinks, so the wall shimmers without a strobe
      if ((i + seed) % 9 !== 0) continue
      out.push({
        x: cell.x,
        y: cell.y,
        phase: (i * 31 + seed) % 97 / 97,
        period: 3.2 + ((i * 13 + seed) % 61) / 10,
      })
    }
  }
  windowCache = out
  return out
}

/** 0…1 brightness multiplier for one neighbour window at time `t`. */
export function blinkAt(w: NeighbourWindow, t: number): number {
  const s = Math.sin((t / w.period + w.phase) * Math.PI * 2)
  if (s > -0.15) return 0.5 + 0.45 * Math.min(1, s + 0.35)
  return 0.04
}

// --------------------------------------------------------------- report

/** Everything the browser probe and the gate want, in one plain object. */
export function trafficReport(t: number) {
  const f = trafficSnapshot(t)
  let moving = 0
  let slowest = Infinity
  let fastest = 0
  for (const v of f.vehicles) {
    if (v.speed > 0.5) moving++
    slowest = Math.min(slowest, v.speed)
    fastest = Math.max(fastest, v.speed)
  }
  return {
    t: Math.round(t * 1000) / 1000,
    light: f.light,
    vehicles: f.counts.vehicles,
    perLane: { near: f.counts.near, far: f.counts.far },
    peds: f.counts.peds,
    crossers: f.counts.crossers,
    moving,
    speed: {
      min: Math.round((Number.isFinite(slowest) ? slowest : 0) * 10) / 10,
      max: Math.round(fastest * 10) / 10,
    },
    pedsOnRoad: f.peds.filter((p) => p.crossing).length,
    clouds: CLOUDS.length,
    birds: BIRDS.length,
    blinkWindows: neighbourWindows().length,
    zebra: ZEBRA,
    road: { top: ROAD.top, bottom: ROAD.bottom },
  }
}
