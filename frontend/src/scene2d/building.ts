/**
 * Whole-building view: the three-floor section standing in a city block.
 *
 * This file is pure geometry — no DOM, no canvas — so the painter, the camera
 * and `verify/building_check.ts` all read the same numbers:
 *
 *   78–94    roof (coping + fascia)
 *   94–244   L3 Tim Dev     (band 150, floor line 234)
 *   244–252  slab
 *   252–402  L2 Tim Edu     (band 150, floor line 392)
 *   402–410  slab
 *   410–560  L1 Lobby       (band 150, floor line 550)
 *   560–688  street: near sidewalk, road, far sidewalk, foreground
 *
 * The building is 480 px wide and centred on the 1000 px sheet (x 260–740), so
 * its centre IS the canvas centre — the difference is 0, well inside the 2 %
 * gate. One row of desks per floor keeps all 13 agents, desks and nameplates
 * readable at overview scale: a 0.38 desk scale (48.6 px wide) and a 42 px
 * avatar, both far smaller than the per-floor 150 px avatar on purpose.
 */
import type { AgentMeta } from '../lib/agents'
import { FLOORS, type FloorId } from '../lib/rooms'
import { measureSans, shortName } from './labels'

export const BUILDING_W = 1000
export const BUILDING_H = 688

/** Facade rectangle — the city must never intersect it (gate d). */
export const BLD = {
  x0: 260,
  x1: 740,
  cx: 500,
  roofOverhangX: 252,
  roofTop: 70,
  roofH: 24,
  baseY: 560,
} as const

export interface BuildingBand {
  floor: FloorId
  /** top of the band (under the slab above) */
  y0: number
  /** bottom of the band (the floor slab edge) */
  y1: number
  /** feet line: avatars stand here */
  floorY: number
}

/** Top → bottom, exactly as painted. */
export const BLD_BANDS: Record<FloorId, BuildingBand> = {
  3: { floor: 3, y0: 94, y1: 244, floorY: 234 },
  2: { floor: 2, y0: 252, y1: 402, floorY: 392 },
  1: { floor: 1, y0: 410, y1: 560, floorY: 550 },
}
export const BLD_BAND_ORDER: FloorId[] = [3, 2, 1]
export const BLD_BAND_H = 150
export const BLD_SLAB_H = 8

/** Street bands under the building base. */
export const BLD_STREET = {
  top: 560,
  walk: 578,
  road: 640,
  far: 660,
  bottom: 688,
} as const

/** One shaft through all three floors, in the east bay. */
export const BLD_LIFT = { x: 692, w: 32, top: 120, bottom: 556 } as const
/** Car height; its centre rides between `floorY - 18` values. */
export const BLD_CAR_H = 36

/** The row of desks inside the facade, clear of the lift bay. */
export const BLD_DESK = { x0: 276, x1: 684, maxPitch: 56, scale: 0.38 } as const
export const BLD_AVATAR_H = 42

export interface BuildingSeat {
  meta: AgentMeta
  floor: FloorId
  /** index inside the floor row, left → right */
  index: number
  /** design-space centre x */
  cx: number
  floorY: number
  avatarH: number
  headTop: number
  headW: number
  headH: number
  /** desk drawing scale (0.38) */
  scale: number
}

/** Desk footprint in design px, shared by the painter and the gate. */
export function buildingDeskRect(seat: BuildingSeat): { x: number; y: number; w: number; h: number } {
  const w = 128 * seat.scale
  return { x: seat.cx - w / 2, y: seat.floorY - 58 * seat.scale, w, h: 58 * seat.scale + 2 }
}

/**
 * One row per floor, ordered left → right by world x. `pitch` is capped at
 * 56 px so the four-agent edu row stays a block instead of stretching across
 * the whole facade; L3's eight desks use the full 408 px row.
 */
export function buildingSeats(metas: readonly AgentMeta[]): BuildingSeat[] {
  const out: BuildingSeat[] = []
  const mid = (BLD_DESK.x0 + BLD_DESK.x1) / 2
  for (const floor of BLD_BAND_ORDER) {
    const band = BLD_BANDS[floor]
    const group = metas
      .filter((m) => m.desk.floor === floor)
      .sort((a, b) => a.desk.x - b.desk.x || a.desk.z - b.desk.z || a.id.localeCompare(b.id))
    const n = group.length
    if (!n) continue
    const pitch = Math.min(BLD_DESK.maxPitch, (BLD_DESK.x1 - BLD_DESK.x0) / n)
    const rowW = pitch * n
    group.forEach((meta, i) => {
      out.push({
        meta,
        floor,
        index: i,
        cx: mid - rowW / 2 + pitch * (i + 0.5),
        floorY: band.floorY,
        avatarH: BLD_AVATAR_H,
        headTop: band.floorY - BLD_AVATAR_H,
        headW: BLD_AVATAR_H * (15.6 / 44),
        headH: BLD_AVATAR_H * (16.8 / 44),
        scale: BLD_DESK.scale,
      })
    })
  }
  return out
}

/** Seats of one floor, painter order (left → right). */
export function buildingSeatsFor(seats: readonly BuildingSeat[], floor: FloorId): BuildingSeat[] {
  return seats.filter((s) => s.floor === floor)
}

// ------------------------------------------------------------- nameplates

/** Compact plates: first name + status dot, no chip, no team word. */
export const B_PLATE_H = 16
export const B_PLATE_FONT = 9
export const B_PLATE_PAD = 4
export const B_PLATE_DOT = 5
export const B_PLATE_DOT_GAP = 4
export const B_PLATE_GAP = 4
export const B_PLATE_STEP = 17

export function buildingPlateWidth(name: string): number {
  return Math.ceil(measureSans(shortName(name), B_PLATE_FONT, 700) + B_PLATE_PAD * 2 + B_PLATE_DOT + B_PLATE_DOT_GAP)
}

export interface BuildingPlate {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** stacked above the ideal slot (always drawn with a connector) */
  connector: boolean
}

/**
 * Plates sit 4 px above the head. With 8 agents on a 51 px pitch a single
 * level cannot hold five-letter names, so neighbours alternate between two
 * 17 px levels (plate height + 1) — same row, same-level neighbours are two
 * pitches apart. A connector is drawn whenever a plate left its ideal slot.
 */
export function layoutBuildingPlates(seats: readonly BuildingSeat[]): {
  plates: BuildingPlate[]
  violations: string[]
} {
  const plates: BuildingPlate[] = []
  const violations: string[] = []
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  for (const seat of seats) {
    const w = buildingPlateWidth(seat.meta.name)
    const idealX = Math.round(seat.cx - w / 2)
    const idealBottom = seat.headTop - B_PLATE_GAP
    let placed: BuildingPlate | null = null

    for (let level = 0; level <= 3 && !placed; level++) {
      const y = Math.round(idealBottom - B_PLATE_H - level * B_PLATE_STEP)
      for (const dx of [0, -6, 6, -12, 12]) {
        const x = Math.round(idealX + dx)
        const box = { x, y, w, h: B_PLATE_H }
        if (x < 1 || y < 1 || x + w > BUILDING_W - 1 || y + B_PLATE_H > BUILDING_H - 1) continue
        if (plates.some((p) => overlap(box, p))) continue
        // never cover another agent's head
        if (
          seats.some(
            (o) =>
              o.meta.id !== seat.meta.id &&
              overlap(box, { x: o.cx - o.headW / 2, y: o.headTop, w: o.headW, h: o.headH }),
          )
        ) {
          continue
        }
        placed = { id: seat.meta.id, x, y, w, h: B_PLATE_H, connector: level > 0 }
        break
      }
    }
    if (!placed) {
      violations.push(`${seat.meta.id}: no free plate slot`)
      placed = {
        id: seat.meta.id,
        x: Math.max(1, Math.min(idealX, BUILDING_W - 1 - w)),
        y: Math.max(1, Math.round(idealBottom - B_PLATE_H)),
        w,
        h: B_PLATE_H,
        connector: false,
      }
    }
    plates.push(placed)
  }
  return { plates, violations }
}

// ------------------------------------------------------------------- city

/** Deterministic PRNG — the skyline is identical on every reload. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface CityRect {
  x: number
  y: number
  w: number
  h: number
  /** 0 = far, 1 = mid, 2 = near */
  layer: 0 | 1 | 2
}

/** Keep the skyline clear of the facade by 8 design px on each side. */
export const CITY_GAP = 8
export const CITY_LEFT_X1 = BLD.x0 - CITY_GAP
export const CITY_RIGHT_X0 = BLD.x1 + CITY_GAP

/** Buildings stand on the same street line as ours (y = 560). */
export function buildingCityRects(): CityRect[] {
  const rand = rng(0x51ed_270b)
  const rects: CityRect[] = []
  const sides: Array<[number, number]> = [
    [0, CITY_LEFT_X1],
    [CITY_RIGHT_X0, BUILDING_W],
  ]
  for (const [bayX0, bayX1] of sides) {
    // one anchor tower per side, taller than our roof, so the skyline really
    // straddles the building instead of all sitting below it
    let tallPlaced = false
    for (let layer = 0; layer < 3; layer++) {
      const minH = 96 + layer * 58
      const maxH = 300 + layer * 100
      let x = bayX0 - 24 - layer * 14
      while (x < bayX1 + 20) {
        const w = 38 + rand() * 54
        let h = minH + rand() * (maxH - minH)
        if (layer === 2 && !tallPlaced) {
          h = 506 + rand() * 14 // top 40…54, above the roof at 70
          tallPlaced = true
        }
        // clip into this bay: nothing may reach the facade bay
        const rx0 = Math.max(bayX0, x)
        const rx1 = Math.min(bayX1, x + w)
        if (rx1 > rx0) rects.push({ x: rx0, y: BLD.baseY - h, w: rx1 - rx0, h, layer: layer as 0 | 1 | 2 })
        x += w + 3 + rand() * 6
      }
    }
  }
  return rects
}

/** The facade rect the city must not touch. */
export function buildingRect(): { x: number; y: number; w: number; h: number } {
  return { x: BLD.x0, y: BLD.roofTop, w: BLD.x1 - BLD.x0, h: BLD.baseY - BLD.roofTop }
}

/** True when any city rect overlaps the facade (gate d must report 0). */
export function cityOverlapsBuilding(rects: readonly CityRect[] = buildingCityRects()): CityRect[] {
  const b = buildingRect()
  return rects.filter((r) => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h)
}

// ------------------------------------------------------------------- lift

export interface BuildingLiftRider {
  id: string
  floor: FloorId
  inLift: boolean
  liftTo: FloorId | null
}

export interface BuildingLiftState {
  x: number
  y: number
  w: number
  h: number
  /** source floor while moving, null when parked */
  from: FloorId | null
  to: FloorId | null
  /** 0 at the source, 1 at the target */
  progress: number
  moving: boolean
  riderId: string | null
}

/** Car centre y at a floor (bottom of the car on the floor line). */
export function buildingLiftY(floor: FloorId): number {
  return BLD_BANDS[floor].floorY - 18
}

/** Smoothstep: no jerk at either floor. */
function smooth(p: number): number {
  const k = Math.min(1, Math.max(0, p))
  return k * k * (3 - 2 * k)
}

/**
 * The one car. Riders dwell in the lift for LIFT_DWELL seconds; over that
 * dwell it travels from their floor to the destination, so mid-dwell it is
 * visibly BETWEEN two bands (gate c). No rider → parked at L1 with the doors
 * closed. Rider order is by id, so two simultaneous riders never flicker.
 */
export function buildingLift(
  riders: readonly BuildingLiftRider[],
  t: number,
  dwell = 2.6,
): BuildingLiftState {
  const sorted = [...riders].filter((r) => r.inLift).sort((a, b) => a.id.localeCompare(b.id))
  const rider = sorted[0]
  if (!rider) {
    return {
      x: BLD_LIFT.x,
      y: buildingLiftY(1),
      w: BLD_LIFT.w,
      h: BLD_CAR_H,
      from: null,
      to: null,
      progress: 0,
      moving: false,
      riderId: null,
    }
  }
  const to = rider.liftTo ?? rider.floor
  const phase = (((t % dwell) + dwell) % dwell) / dwell
  const p = smooth(phase)
  const y = buildingLiftY(rider.floor) + (buildingLiftY(to) - buildingLiftY(rider.floor)) * p
  return {
    x: BLD_LIFT.x,
    y,
    w: BLD_LIFT.w,
    h: BLD_CAR_H,
    from: rider.floor,
    to,
    progress: p,
    moving: to !== rider.floor,
    riderId: rider.id,
  }
}

// ------------------------------------------------------------ whole report

/**
 * Everything the gates and the debug hook need, in one pure object. The
 * painter draws from these same seats/plates, never from a second copy.
 */
export function buildingGeometry(metas: readonly AgentMeta[], riders: readonly BuildingLiftRider[] = [], t = 0) {
  const seats = buildingSeats(metas)
  const { plates, violations } = layoutBuildingPlates(seats)
  const bands = BLD_BAND_ORDER.map((floor) => {
    const b = BLD_BANDS[floor]
    const row = seats.filter((s) => s.floor === floor)
    return {
      floor,
      name: FLOORS[floor].name,
      y0: b.y0,
      y1: b.y1,
      floorY: b.floorY,
      desks: row.length,
      pitch: row.length > 1 ? Math.round((row[row.length - 1]!.cx - row[0]!.cx) / (row.length - 1) * 100) / 100 : 0,
    }
  })
  const building = buildingRect()
  return {
    mode: 'building' as const,
    stage: { w: BUILDING_W, h: BUILDING_H },
    building,
    /** |building centre − sheet centre| in px (gate b allows ≤ 2 % of width) */
    centreOffset: Math.abs(building.x + building.w / 2 - BUILDING_W / 2),
    bands,
    seats: seats.map((s) => ({
      id: s.meta.id,
      floor: s.floor,
      cx: s.cx,
      floorY: s.floorY,
      avatarH: s.avatarH,
      headTop: s.headTop,
      desk: buildingDeskRect(s),
    })),
    plates,
    plateViolations: violations,
    lift: buildingLift(riders, t),
    liftShaft: { x: BLD_LIFT.x, y: BLD_LIFT.top, w: BLD_LIFT.w, h: BLD_LIFT.bottom - BLD_LIFT.top },
    city: { rects: buildingCityRects().length, overlaps: cityOverlapsBuilding().length },
  }
}

/** Map a world x on a floor to the building row (walkers). */
export function buildingWorldX(floor: FloorId, x: number): number {
  const half = Math.max(1, FLOORS[floor].w / 2)
  const k = Math.max(-1, Math.min(1, x / half))
  const mid = (BLD_DESK.x0 + BLD_DESK.x1) / 2
  const span = (BLD_DESK.x1 - BLD_DESK.x0) / 2 - 18
  return mid + k * span
}
