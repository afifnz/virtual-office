/**
 * Whole-building view: the three-floor section standing in a city block.
 *
 * This file is pure geometry — no DOM, no canvas — so the painter, the camera
 * and `verify/building_check.ts` all read the same numbers:
 *
 *   0–46     sky strip above the roof
 *   46–70    roof (coping + fascia)
 *   70–153   L3 Tim Dev     (band 83, floor line 147)
 *   153–162  slab
 *   162–245  L2 Tim Edu     (band 83, floor line 239)
 *   245–254  slab
 *   254–337  L1 Lobby       (band 83, floor line 331)
 *   337–381  near sidewalk  44 px (1.8 m) — the building stands on its back edge
 *   381–553  road           172 px = 2 lanes × 86 px (2 × 3.5 m, true depth)
 *   553–573  far sidewalk   20 px (0.8 m) — 236 px = 9.6 m of street, 1:1
 *
 * ONE scale for the whole scene: `PX_PER_M = 24.5`, taken from the 42 px
 * overview avatar for a 1.7 m person. Every prop — floor band, desk, chair,
 * monitor, lift door, lift car, tree, lamp, lane marking, zebra, vehicle — is
 * `PX_PER_M × real metres`; `verify/*_check.ts` re-derives each one and fails
 * outside ±10 %. A floor band is 83 px = round(m2px(3.4)): 3.4 m
 * floor-to-floor = 3.0 m clear + 0.4 m slab/services, the midpoint of the real
 * 3.2–3.6 m office window.
 *
 * The scene is composed on a design sheet SMALLER than the stage and blown up
 * once by the painter: geometry lives in 0…SCENE_W × 0…SCENE_H and every draw
 * is multiplied by `SCENE_ZOOM`, so an 83 px band is 99.6 px on the 1000×688
 * canvas. 1.2 is the largest uniform zoom at which the realistic street still
 * fits: the composition is 573 design px tall (46 px sky + 337 px building +
 * 236 px street), and 573 × 1.2 = 687.6 ≤ 688. One step more (1.25) would
 * need 573 × 1.25 ≈ 716 px of canvas — 28 px of street or sky cropped.
 */
import type { AgentMeta } from '../lib/agents'
import { FLOORS, type FloorId } from '../lib/rooms'
import { measureSans, shortName } from './labels'

export const BUILDING_W = 1000
export const BUILDING_H = 688

// --------------------------------------------------------------- the camera

/**
 * Uniform zoom of the GEDUNG sheet: design px × 1.2 = stage px.
 *
 * All geometry below stays in design px (0…SCENE_W × 0…SCENE_H); the painter
 * applies `ctx.scale(SCENE_ZOOM, SCENE_ZOOM)` exactly once, and the gates
 * multiply every design rect by it before the 1000×688 (and phone) checks.
 */
export const SCENE_ZOOM = 1.2
/** Design sheet width: what 1000 stage px show at the zoom. */
export const SCENE_W = BUILDING_W / SCENE_ZOOM // 833.33
/** Design sheet height: what 688 stage px show at the zoom. */
export const SCENE_H = BUILDING_H / SCENE_ZOOM // 573.33
/** Design px → final stage px. */
export const stagePx = (v: number): number => v * SCENE_ZOOM

// --------------------------------------------------------------- the scale

/**
 * The single scale of the GEDUNG view: 24.5 design px per metre.
 *
 * It is not invented — it is the overview avatar (42 px) divided by a real
 * person (1.7 m), rounded to the nearest 0.5. Everything the scene paints is
 * `PX_PER_M × real metres`; `verify/*_check.ts` re-derives each prop from
 * the table below and fails outside ±10 %.
 */
export const PX_PER_M = 24.5

/** Metres → design px at the one scene scale. */
export const m2px = (metres: number): number => metres * PX_PER_M

/**
 * A 3.5 m lane, measured the same way in BOTH axes — the road keeps its true
 * depth now that the bands are 83 px: 2 × 86 px + 44 + 20 px sidewalks =
 * 236 px = 9.6 m of street at 1:1. (The old ×0.56 depth squeeze is gone.)
 */
export const LANE_W = Math.round(m2px(3.5)) // 86
export const LANE_DEPTH = LANE_W

/** Facade rectangle — the city must never intersect it (gate d). */
export const BLD = {
  x0: 177,
  x1: 657,
  cx: 417,
  roofOverhangX: 169,
  roofTop: 46,
  roofH: 24,
  baseY: 337,
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

/**
 * Top → bottom. Each band is `BLD_BAND_H` = 83 px = round(m2px(3.4)) — a 3.4 m
 * floor-to-floor storey — separated by `BLD_SLAB_H` = 9 px spandrels
 * (round(m2px(0.35))). The floor lip is 6 px, so feet stand at y1 − 6.
 */
export const BLD_BANDS: Record<FloorId, BuildingBand> = {
  3: { floor: 3, y0: 70, y1: 153, floorY: 147 },
  2: { floor: 2, y0: 162, y1: 245, floorY: 239 },
  1: { floor: 1, y0: 254, y1: 337, floorY: 331 },
}
export const BLD_BAND_ORDER: FloorId[] = [3, 2, 1]
export const BLD_BAND_H = 83
export const BLD_SLAB_H = 9

/**
 * Street bands under the building base, sized from `PX_PER_M` at true depth:
 *
 *   337–381  near sidewalk  44 px (1.8 m) — walkers stand at feet 381
 *   381–553  road           172 px = 2 lanes × 86 px (2 × 3.5 m, no squeeze)
 *   553–573  far sidewalk   20 px (0.8 m)
 *
 * 236 px total = 9.6 m kerb-to-kerb-to-kerb, the same scale on both axes.
 */
export const BLD_STREET = {
  top: 337,
  walk: 381,
  road: 553,
  far: 573,
  bottom: 573,
} as const

/**
 * Street furniture, also pure scale: a 7 m street tree is 172 px, a 6 m lamp
 * post 147 px. Both stand on the near sidewalk with their feet a few px above
 * the kerb, and both are painted BEFORE the facade so a canopy that reaches
 * into the facade bay is occluded by the tower instead of plastered on it.
 */
export const STREET_PROPS = {
  /** 7 m tree, the boss's table (150–200 px window) */
  treeH: Math.round(m2px(7)), // 172
  /** 6.2 m accent tree, the smaller one at each end */
  treeH2: Math.round(m2px(6.2)), // 152
  /** 6 m lamp post, head included */
  lampH: Math.round(m2px(6)), // 147
  /** feet of the furniture above the kerb line */
  inset: 6,
} as const

/**
 * Street furniture layout, shared by the painter and the gate. The side bays
 * are 169 px wide now (the tower is 480 px on an 833 px sheet), so four props
 * fit: a tree + a lamp on the left, a lamp + the accent tree on the right.
 * Every prop keeps its PAINTED span (`propSpan`, canopy reach included) on the
 * sheet, inside its side bay and clear of its neighbours.
 */
export const BLD_FURNITURE: ReadonlyArray<{ kind: 'tree' | 'lamp'; x: number; h: number }> = [
  // left bay: tree first (its 1.17 R canopy paints 1.62…126.38), lamp after
  // (post + head 150.5…168), both clear of the 0…169 bay edge and of each other
  { kind: 'tree', x: 64, h: STREET_PROPS.treeH },
  { kind: 'lamp', x: 152, h: STREET_PROPS.lampH },
  // right bay: the lamp head reaches right of the post, the accent tree after
  // (R 47.12 → painted 688.87…799.13, inside the 833.33 px sheet)
  { kind: 'lamp', x: 664, h: STREET_PROPS.lampH },
  { kind: 'tree', x: 744, h: STREET_PROPS.treeH2 },
]

/**
 * How far the painter's canopy really reaches: the side lobes are centred at
 * ±0.55 R with radius 0.62 R (see `drawTree`), so the canopy paints out to
 * 0.55 + 0.62 = 1.17 R — not the 1.0 R the trunk-centred circle suggests.
 */
export const CANOPY_LOBE_REACH = 1.17

/** Canopy radius + trunk + head sizes in px, from the one scale. */
export const STREET_SHAPE = {
  canopyR: (h: number) => h * 0.31,
  /** honest painted reach of the canopy: the side lobes reach 1.17 R. */
  canopyReach: (h: number) => h * 0.31 * CANOPY_LOBE_REACH,
  trunkH: (h: number) => h * 0.42,
  trunkW: (h: number) => Math.max(4, h * 0.045),
  /** widest horizontal reach of any part of a prop from its x */
  reach: (kind: 'tree' | 'lamp', h: number) => (kind === 'tree' ? h * 0.31 * CANOPY_LOBE_REACH : 16),
} as const

/**
 * Painted x-span of a prop: a tree is a canopy whose side lobes reach 1.17 R
 * (`canopyReach`), a lamp is a 3 px post with its arm + head reaching RIGHT.
 * Shared by the painter's occlusion rule and the gate's facade/prop clearance
 * proofs.
 */
export function propSpan(prop: { kind: 'tree' | 'lamp'; x: number; h: number }): readonly [number, number] {
  if (prop.kind === 'tree') {
    const r = STREET_SHAPE.canopyReach(prop.h)
    return [prop.x - r, prop.x + r]
  }
  return [prop.x - 1.5, prop.x + STREET_SHAPE.reach('lamp', prop.h)]
}

/**
 * Road paint. The zebra is 3.6 m wide along the street (88 px) with 0.45 m
 * stripes; the centre line is 3 m of paint and 6 m of gap, exactly the
 * Indonesian marka putus the boss asked for (74 px + 147 px).
 */
export const BLD_ZEBRA = { x0: 373, x1: 461, stripe: 11, gap: 11 } as const
export const BLD_DASH = {
  line: Math.round(m2px(3)), // 74
  gap: Math.round(m2px(6)), // 147
  thick: 3,
} as const

/** One shaft through all three floors, in the east bay: 1.2 m wide. */
export const BLD_LIFT = { x: 610, w: Math.round(m2px(1.2)), top: 74, bottom: 331 } as const // w = 29
/** Lift car, 2.2 m tall; its centre rides on `floorY − BLD_CAR_H/2`. */
export const BLD_CAR_H = Math.round(m2px(2.2)) // 54
/** Landing door, 2.1 m tall — the frame the painter draws at every floor. */
export const BLD_DOOR_H = Math.round(m2px(2.1)) // 51

/** The row of desks inside the facade, clear of the lift bay. */
export const BLD_DESK = { x0: 193, x1: 596, maxPitch: 56, scale: m2px(1.6) / 128 } as const // scale 0.30625
/** 1.7 m at `PX_PER_M` — the anchor of the whole scene scale. */
export const BLD_AVATAR_H = 42

// ------------------------------------------------------------- nameplates

/** Compact plates: first name + status dot, no chip, no team word. */
export const B_PLATE_H = 15
export const B_PLATE_FONT = 8.5
export const B_PLATE_PAD = 3
export const B_PLATE_DOT = 4
export const B_PLATE_DOT_GAP = 3
export const B_PLATE_GAP = 3
export const B_PLATE_STEP = 15

/**
 * The real metres behind every interior prop, in design px — the gate
 * re-derives each drawn prop against this table (±10 %). The plate is a UI
 * element, not a physical object, so its height is the plain 15 px constant.
 */
export const BLD_PROP = {
  /** desk top, 1.6 m wide (128 × desk scale) */
  deskW: m2px(1.6), // 39.2
  /** desk standing height, 0.75 m (58 × desk scale) */
  deskH: m2px(0.75), // 18.4
  /** chair backrest top, 1.05 m (84 × desk scale) */
  chairH: m2px(1.05), // 25.7
  /** seat surface, 0.45 m (36 × desk scale) */
  seatH: m2px(0.45), // 11.0
  /** monitor panel, 0.49 m wide (38 × desk scale) */
  monitorW: m2px(0.49), // 12.0
  /** monitor foot+neck+panel, 0.45 m ((3.3+8.3+23) × desk scale) */
  monitorH: m2px(0.45), // 11.0
  /** lift landing door, 2.1 m */
  doorH: m2px(2.1), // 51.45
  /** lift car, 2.2 m */
  carH: m2px(2.2), // 53.9
  /** lift shaft, 1.2 m */
  shaftW: m2px(1.2), // 29.4
  /** nameplate height (UI, not metres) */
  namePlateH: B_PLATE_H, // 15
} as const

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
 * Plates sit 3 px above the head. With 8 agents on a ~50 px pitch a single
 * level cannot hold five-letter names, so neighbours alternate between two
 * 15 px levels (plate height + 0) — level 1 tops out at floorY − 75, still
 * inside the band (top = floorY − 77). A connector is drawn whenever a plate
 * left its ideal slot.
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
        if (x < 1 || y < 1 || x + w > SCENE_W - 1 || y + B_PLATE_H > SCENE_H - 1) continue
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
        x: Math.max(1, Math.min(idealX, SCENE_W - 1 - w)),
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
  /** desk drawing scale (0.30625) */
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
 * the whole facade; L3's eight desks use the full 403 px row.
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

/** Buildings stand on the same street line as ours (y = BLD.baseY, 337). */
export function buildingCityRects(): CityRect[] {
  const rand = rng(0x51ed_270b)
  const rects: CityRect[] = []
  const sides: Array<[number, number]> = [
    [0, CITY_LEFT_X1],
    [CITY_RIGHT_X0, SCENE_W],
  ]
  for (const [bayX0, bayX1] of sides) {
    // one anchor tower per side, taller than our roof, so the skyline really
    // straddles the building instead of all sitting below it
    let tallPlaced = false
    for (let layer = 0; layer < 3; layer++) {
      const minH = 60 + layer * 38
      const maxH = 190 + layer * 62
      let x = bayX0 - 24 - layer * 14
      while (x < bayX1 + 20) {
        const w = 32 + rand() * 46
        let h = minH + rand() * (maxH - minH)
        if (layer === 2 && !tallPlaced) {
          h = 300 + rand() * 30 // top 7…37, above the roof at 46
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

/** Car centre y at a floor (the car bottom sits exactly on the floor line). */
export function buildingLiftY(floor: FloorId): number {
  return BLD_BANDS[floor].floorY - BLD_CAR_H / 2
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
    scene: { w: SCENE_W, h: SCENE_H, zoom: SCENE_ZOOM },
    building,
    /** |building centre − design sheet centre| in px (gate b allows ≤ 2 %) */
    centreOffset: Math.abs(building.x + building.w / 2 - SCENE_W / 2),
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
