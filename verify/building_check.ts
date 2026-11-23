/**
 * GEDUNG gate — the whole-building view, headless.
 *
 * Proves, without a browser and without screenshots:
 *
 *   a. ONE scale: the 83 px floor band is round(m2px(3.4)) within 5 %, every
 *      band is exactly that tall, the 9 px slab sits between them, and every
 *      interior prop (desk, chair, seat, monitor, door, lift car, shaft) is
 *      m2px(real metres) within ±10 %;
 *   b. one person everywhere: the 42 px avatar is 45–60 % of the band;
 *   c. one frame holds three floor bands, 13 desks and 13 nameplates, every
 *      rect inside the 1000×688 stage AND inside a 390×692 phone canvas IN
 *      FINAL px (design rect × SCENE_ZOOM); 0 plate↔plate overlap, 0 plate
 *      over another head, no plate taller than its desk or outside its band;
 *   d. the building is centred on the design sheet: |centre − sheet centre|
 *      ≤ 2 % width; the lift car is visible BETWEEN two bands while a
 *      delegation rides; the procedural skyline never covers the facade;
 *   e. the painter itself runs for both themes, desktop and phone, online and
 *      offline — 13 desks and 13 plates every frame (the offline seed is a
 *      first-class case, not an accident);
 *   f. street scale, true depth: the 7 m tree (172 px) and the 6 m lamp
 *      (147 px) are `PX_PER_M × metres`, the road is exactly 2 × 86 px lanes
 *      (lane depth = lane width, no squeeze), every prop stands clear of the
 *      facade bay and of its neighbours, and all furniture is painted BEFORE
 *      the facade — so a canopy can only be occluded by the tower, never
 *      painted over it.
 *
 * The old per-floor gates stay as they are; this file never replaces them.
 *
 *   frontend/node_modules/.bin/esbuild verify/building_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/building_check.mjs
 *   node /tmp/building_check.mjs        # "BUILDING OK", exit 0
 */
import type { Agent, Comm } from '../frontend/src/lib/types'
import { agentsFor } from '../frontend/src/lib/roster'
import { FLOOR_IDS, type FloorId } from '../frontend/src/lib/rooms'
import {
  BLD,
  BLD_BAND_ORDER,
  BLD_BAND_H,
  BLD_BANDS,
  BLD_CAR_H,
  BLD_DESK,
  BLD_DOOR_H,
  BLD_FURNITURE,
  BLD_LIFT,
  BLD_PROP,
  BLD_SLAB_H,
  BLD_STREET,
  BLD_ZEBRA,
  BUILDING_H,
  BUILDING_W,
  BLD_AVATAR_H,
  BLD_DASH,
  LANE_DEPTH,
  LANE_W,
  PX_PER_M,
  SCENE_H,
  SCENE_W,
  SCENE_ZOOM,
  STREET_PROPS,
  buildingCityRects,
  buildingDeskRect,
  buildingGeometry,
  buildingLift,
  buildingLiftY,
  buildingRect,
  buildingSeats,
  buildingSeatsFor,
  cityOverlapsBuilding,
  layoutBuildingPlates,
  m2px,
  propSpan,
} from '../frontend/src/scene2d/building'
import {
  BUILDING_PHASES,
  CACHE_SCALE,
  buildingHit,
  clearBuildingCache,
  createBuildingLayer,
  renderBuildingFrame,
  type BuildingPhase,
} from '../frontend/src/scene2d/render-building'
import { PHONE_CTRL_BAND, fitScale, sideTransform } from '../frontend/src/scene2d/side'
import { fitZoom } from '../frontend/src/scene2d/viewport'
import { shortName, measureSans } from '../frontend/src/scene2d/labels'
import { defaultViewMode } from '../frontend/src/lib/view'
import type { AgentMeta } from '../frontend/src/lib/agents'
import type { ThemeName } from '../frontend/src/scene2d/palette'

let fails = 0
let checks = 0
const fail = (msg: string) => {
  fails++
  console.log('FAIL', msg)
}
const ok = (msg: string) => {
  checks++
  console.log('ok  ', msg)
}
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps
const r2 = (v: number) => Math.round(v * 100) / 100

type Rect = { x: number; y: number; w: number; h: number }
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h

const metas = agentsFor([])
const seats = buildingSeats(metas)
const bands = BLD_BAND_ORDER.map((f) => BLD_BANDS[f])

// --------------------------------------------------------- 1. the roster
if (metas.length !== 13) fail(`roster has ${metas.length} desks, want 13`)
else ok(`roster: ${metas.length} desks (${new Set(metas.map((m) => m.id)).size} unique ids)`)
const split = FLOOR_IDS.map((f) => buildingSeatsFor(seats, f).length)
if (split.join(',') !== '1,4,8') fail(`floor split ${split.join('/')}, want 1/4/8`)
else ok(`floor split L1/L2/L3 = ${split.join('/')}`)
if (seats.length !== 13) fail(`${seats.length} building seats, want 13`)

// ------------------------------------------------------- 2. band geometry
{
  if (bands.length !== 3) fail(`${bands.length} floor bands, want 3`)
  const order = bands.map((b) => b.floor).join(',')
  if (order !== '3,2,1') fail(`bands top→bottom = ${order}, want 3,2,1`)
  else ok(`3 stacked bands (top→bottom): ${bands.map((b) => `L${b.floor} ${b.y0}–${b.y1}`).join(' · ')}`)
  // (a) the band IS the scale: 83 px = round(m2px(3.4)) within 5 %
  const wantBand = m2px(3.4)
  const bandErr = Math.abs(BLD_BAND_H - wantBand) / wantBand
  if (bandErr > 0.05) fail(`BLD_BAND_H ${BLD_BAND_H} vs m2px(3.4) ${r2(wantBand)} (${r2(bandErr * 100)} % off, limit 5 %)`)
  // (a) and the slab exactly — not just the self-referential gap === BLD_SLAB_H:
  // 9 px, and exactly round(m2px(0.35)), the 0.35 m spandrel it claims to be
  if (BLD_SLAB_H !== 9) fail(`BLD_SLAB_H is ${BLD_SLAB_H}, want exactly 9`)
  if (BLD_SLAB_H !== Math.round(m2px(0.35))) {
    fail(`BLD_SLAB_H is ${BLD_SLAB_H}, want exactly round(m2px(0.35)) = ${Math.round(m2px(0.35))}`)
  }
  for (const b of bands) {
    if (!(b.y1 > b.y0)) fail(`L${b.floor}: band height ${b.y1 - b.y0}`)
    if (b.y1 - b.y0 !== BLD_BAND_H) fail(`L${b.floor}: band ${b.y1 - b.y0} px, want ${BLD_BAND_H}`)
    if (b.y1 - b.floorY !== 6) fail(`L${b.floor}: floor lip ${b.y1 - b.floorY} px, want 6`)
    if (!(b.floorY > b.y0 && b.floorY < b.y1)) fail(`L${b.floor}: floor line ${b.floorY} outside its band`)
    if (b.y0 < 0 || b.y1 > SCENE_H) fail(`L${b.floor}: band leaves the design sheet`)
  }
  // the 9 px spandrel between bands = round(m2px(0.35))
  for (let i = 0; i < bands.length - 1; i++) {
    const gap = bands[i + 1]!.y0 - bands[i]!.y1
    if (gap !== BLD_SLAB_H) fail(`slab between L${bands[i]!.floor}/L${bands[i + 1]!.floor} is ${gap} px, want ${BLD_SLAB_H}`)
  }
  const bandBottom = Math.max(...bands.map((b) => b.y1))
  if (bandBottom !== BLD_STREET.top) fail(`the lowest band ends at ${bandBottom}, the street starts at ${BLD_STREET.top}`)
  else
    ok(
      `bands ${bands[0]!.y0}–${bandBottom} = 3 × ${BLD_BAND_H} px + 2 × ${BLD_SLAB_H} px slab, ` +
        `${BLD_BAND_H} px = round(m2px(3.4)) — a 3.4 m floor-to-floor storey (3.0 m clear + 0.4 m slab/services)`,
    )
}

// ------------------------------------------------------ 3. desks + plates
/** design px → final stage px: what the painter actually blits. */
const fin = (r: Rect): Rect => ({ x: r.x * SCENE_ZOOM, y: r.y * SCENE_ZOOM, w: r.w * SCENE_ZOOM, h: r.h * SCENE_ZOOM })
const platesBySeat = new Map(layoutBuildingPlates(seats).plates.map((p) => [p.id, p]))
const { plates, violations } = layoutBuildingPlates(seats)
if (plates.length !== 13) fail(`${plates.length} plates, want 13`)
if (violations.length) fail(`plate layout: ${violations.join('; ')}`)
let plateOverlap = 0
let plateOnHead = 0
let offStage = 0
for (const s of seats) {
  const desk = buildingDeskRect(s)
  if (!inside(fin(desk), BUILDING_W, BUILDING_H)) {
    offStage++
    fail(`${s.meta.id}: desk ${JSON.stringify(fin(desk))} leaves the ${BUILDING_W}×${BUILDING_H} stage in final px`)
  }
  const p = platesBySeat.get(s.meta.id)
  if (!p) {
    fail(`${s.meta.id}: no nameplate`)
    continue
  }
  if (!inside(fin({ x: p.x, y: p.y, w: p.w, h: p.h }), BUILDING_W, BUILDING_H)) offStage++
  // the plate is a UI chip: never taller than the desk it labels, never
  // outside the floor band of the agent it names
  if (p.h > 58 * BLD_DESK.scale + 0.01) fail(`${p.id}: plate ${p.h} px is taller than the ${r2(58 * BLD_DESK.scale)} px desk`)
  const band = BLD_BANDS[s.floor]
  if (p.y < band.y0 || p.y + p.h > band.y1) {
    fail(`${p.id}: plate ${p.y}…${p.y + p.h} leaves its band ${band.y0}…${band.y1}`)
  }
  for (const q of plates) {
    if (q.id === p.id) continue
    if (overlap(p, q)) {
      plateOverlap++
      fail(`${p.id} plate overlaps ${q.id}`)
    }
  }
  for (const o of seats) {
    if (o.meta.id === s.meta.id) continue
    if (overlap(p, { x: o.cx - o.headW / 2, y: o.headTop, w: o.headW, h: o.headH })) {
      plateOnHead++
      fail(`${p.id} plate covers ${o.meta.id}'s head`)
    }
  }
  if (p.y + p.h > s.headTop) fail(`${p.id}: plate reaches below its own head top`)
}
for (let i = 0; i < plates.length; i++) {
  for (let j = i + 1; j < plates.length; j++) {
    if (overlap(plates[i]!, plates[j]!)) plateOverlap++
  }
}
if (offStage === 0) ok(`13 desks + 13 nameplates inside the ${BUILDING_W}×${BUILDING_H} stage in final px (design × ${SCENE_ZOOM})`)
if (plateOverlap === 0 && plateOnHead === 0) {
  ok(`plates: 0 overlap, 0 over another head, none taller than its desk or outside its band (${plates.length} plates, max width ${Math.max(...plates.map((p) => p.w))} px)`)
}
// (b) one person everywhere: the avatar is 42 px = 45–60 % of the 83 px band
{
  const ratio = BLD_AVATAR_H / BLD_BAND_H
  if (BLD_AVATAR_H !== 42) fail(`avatar ${BLD_AVATAR_H} px, want exactly 42 (the 1.7 m scale anchor)`)
  else if (!(ratio >= 0.45 && ratio <= 0.6)) fail(`avatar is ${r2(ratio * 100)} % of the band, want 45–60 %`)
  else
    ok(
      `one person everywhere: avatar ${BLD_AVATAR_H} px = ${r2(ratio * 100)} % of the ${BLD_BAND_H} px band ` +
        `(final ${r2(42 * SCENE_ZOOM)} px); desk ${r2(128 * BLD_DESK.scale)} design / ${r2(128 * BLD_DESK.scale * SCENE_ZOOM)} final px`,
    )
}
if (measureSans(shortName('Dimas'), 8.5, 700) <= 0) fail('plate measurement returned 0')

// --------------------------------------- 4. the two canvases (desktop/phone)
{
  const desktop = sideTransform(1000, 688, { camX: 500, camY: 344, zoom: 2, floor: 1 })
  if (!near(desktop.s, 1) || !near(desktop.left, 0) || !near(desktop.top, 0)) {
    fail(`desktop transform at 1000×688 zoom 2 = s ${desktop.s}, left ${desktop.left}, top ${desktop.top}`)
  } else ok('desktop: 1000×688 canvas draws the sheet 1:1 (s=1, left=0, top=0)')

  const PH = 692
  const PW = 390
  const fit = fitScale(PW, PH, PHONE_CTRL_BAND)
  const fitZ = fitZoom(1, PW, PH, PHONE_CTRL_BAND)
  const phone = sideTransform(PW, PH, { camX: 500, camY: 344, zoom: fitZ, floor: 1 }, PHONE_CTRL_BAND)
  if (!near(fitZ, 0.78)) fail(`phone fit zoom ${fitZ}, want 0.78`)
  if (!near(phone.s, 0.39, 0.001)) fail(`phone scale ${phone.s}, want 0.39`)
  let cut = 0
  for (const s of seats) {
    for (const [name, r] of [
      ['desk', buildingDeskRect(s)],
      ['plate', platesBySeat.get(s.meta.id)!],
    ] as const) {
      const f = fin(r)
      const sx = phone.left + f.x * phone.s
      const sy = phone.top + f.y * phone.s
      const sw = f.w * phone.s
      const sh = f.h * phone.s
      if (sx < 0 || sy < 0 || sx + sw > PW || sy + sh > PH) {
        cut++
        fail(`390×692: ${s.meta.id} ${name} spans ${sx.toFixed(1)}…${(sx + sw).toFixed(1)} × ${sy.toFixed(1)}…${(sy + sh).toFixed(1)}`)
      }
    }
  }
  for (const b of bands) {
    const sy = phone.top + b.y0 * SCENE_ZOOM * phone.s
    const sh = (b.y1 - b.y0) * SCENE_ZOOM * phone.s
    if (sy < 0 || sy + sh > PH) {
      cut++
      fail(`390×692: L${b.floor} band spans y ${sy.toFixed(1)}…${(sy + sh).toFixed(1)}`)
    }
  }
  if (!cut) {
    ok(`390×692 phone: 3 bands + 13 desks + 13 plates all inside (stage ${r2(1000 * phone.s)}×${r2(688 * phone.s)} CSS px at y ${r2(phone.top)})`)
  }
  if (fit <= 0) fail('phone fit scale is 0')
}

// --------------------------------- 4b. everything on the stage, in FINAL px
{
  const foot = BLD_STREET.walk - STREET_PROPS.inset
  const furnitureRect = (p: { kind: 'tree' | 'lamp'; x: number; h: number }): Rect => {
    const [x0, x1] = propSpan(p)
    return { x: x0, y: foot - p.h, w: x1 - x0, h: p.h }
  }
  const rects: Array<[string, Rect]> = [
    ['building', buildingRect()],
    ['street', { x: 0, y: BLD_STREET.top, w: SCENE_W, h: BLD_STREET.bottom - BLD_STREET.top }],
    ['lift shaft', { x: BLD_LIFT.x, y: BLD_LIFT.top, w: BLD_LIFT.w, h: BLD_LIFT.bottom - BLD_LIFT.top }],
    ...bands.map((b) => [`L${b.floor} band`, { x: BLD.x0, y: b.y0, w: BLD.x1 - BLD.x0, h: b.y1 - b.y0 }] as [string, Rect]),
    ...seats.map((s) => [`${s.meta.id} desk`, buildingDeskRect(s)] as [string, Rect]),
    ...plates.map((p) => [`${p.id} plate`, { x: p.x, y: p.y, w: p.w, h: p.h }] as [string, Rect]),
    ...BLD_FURNITURE.map((p) => [`${p.kind}@${p.x}`, furnitureRect(p)] as [string, Rect]),
    ...buildingCityRects().map((r, i) => [`city ${i}`, { x: r.x, y: r.y, w: r.w, h: r.h }] as [string, Rect]),
  ]
  let out = 0
  for (const [name, r] of rects) {
    if (!inside(fin(r), BUILDING_W, BUILDING_H)) {
      out++
      fail(`final px: ${name} ${JSON.stringify(fin(r))} leaves the ${BUILDING_W}×${BUILDING_H} stage`)
    }
  }
  // the same rects on the 390×692 phone at its fit (s 0.39)
  const phone = sideTransform(390, 692, { camX: 500, camY: 344, zoom: 0.78, floor: 1 }, PHONE_CTRL_BAND)
  for (const [name, r] of rects) {
    const f = fin(r)
    const sx = phone.left + f.x * phone.s
    const sy = phone.top + f.y * phone.s
    if (sx < 0 || sy < 0 || sx + f.w * phone.s > 390 || sy + f.h * phone.s > 692) {
      out++
      fail(`390×692: ${name} spans ${r2(sx)}…${r2(sx + f.w * phone.s)} × ${r2(sy)}…${r2(sy + f.h * phone.s)}`)
    }
  }
  if (!out) ok(`${rects.length} design rects (building, bands, desks, plates, furniture, lift, street, city) × ${SCENE_ZOOM} all inside the stage AND the 390×692 phone fit`)
}

// -------------------------------------------------------- 5. it is centred
{
  const b = buildingRect()
  const dx = Math.abs(b.x + b.w / 2 - SCENE_W / 2)
  const limit = SCENE_W * 0.02
  if (dx > limit) fail(`building centre is ${dx} px off the design-sheet centre (limit ${r2(limit)})`)
  else ok(`building centred on the design sheet: |${b.x + b.w / 2} − ${r2(SCENE_W / 2)}| = ${r2(dx)} px ≤ ${r2(limit)} (2 %)`)
  // and the rendered centring: at the fit the stage is centred in the canvas
  const phone = sideTransform(390, 692, { camX: 500, camY: 344, zoom: 0.78, floor: 1 }, PHONE_CTRL_BAND)
  const cx = phone.left + (b.x + b.w / 2) * SCENE_ZOOM * phone.s
  const off = Math.abs(cx - 390 / 2)
  if (off > 390 * 0.02) fail(`rendered building centre is ${r2(off)} px off the canvas centre on 390 px`)
  else ok(`rendered centre on 390×692: ${r2(cx)} vs canvas 195 (${r2(off)} px)`)
}

// ------------------------------------------------------ 6. city vs facade
{
  const rects = buildingCityRects()
  const b = buildingRect()
  const hits = cityOverlapsBuilding(rects)
  if (rects.length < 20) fail(`skyline generated only ${rects.length} buildings`)
  if (hits.length) fail(`${hits.length} city rect(s) cover the facade, first ${JSON.stringify(hits[0])}`)
  else ok(`skyline: ${rects.length} procedural buildings, 0 intersect the facade (${b.x}…${b.x + b.w})`)
  const lane = rects.filter((r) => r.x + r.w > b.x && r.x < b.x + b.w)
  if (lane.length) fail(`${lane.length} city rect(s) reach into the facade bay`)
  else ok('both side bays stay clear of the facade bay (8 px gap each side)')
  if (rects.some((r) => r.y + r.h !== BLD_STREET.top)) fail('a city building does not stand on the street line')
  else ok(`every city building stands on the shared street line y=${BLD_STREET.top}`)
  const tallest = Math.min(...rects.map((r) => r.y))
  const shortest = Math.max(...rects.map((r) => r.y))
  if (!(tallest < BLD.roofTop && shortest > BLD.roofTop + 100)) {
    fail(`skyline height spread ${tallest}..${shortest} does not straddle the roof (${BLD.roofTop})`)
  } else ok(`skyline heights straddle the tower: tops ${tallest} (taller) … ${shortest} (shorter) vs roof ${BLD.roofTop}`)
}

// --------------------------------------------------------------- 7. the lift
{
  const parked = buildingLift([], 0)
  if (parked.moving || parked.y !== buildingLiftY(1)) fail(`parked car at ${parked.y}, want L1 (${buildingLiftY(1)})`)
  else ok(`no rider → car parked at L1 (y ${parked.y})`)

  const rider = { id: 'coder', floor: 3 as FloorId, inLift: true, liftTo: 1 as FloorId }
  const mid = buildingLift([rider], 0.8)
  if (!mid.moving || mid.progress <= 0 || mid.progress >= 1) fail(`mid-ride car is not moving (${JSON.stringify(mid)})`)
  const lo = Math.min(buildingLiftY(3), buildingLiftY(1))
  const hi = Math.max(buildingLiftY(3), buildingLiftY(1))
  if (!(mid.y > lo + 10 && mid.y < hi - 10)) {
    fail(`car centre ${r2(mid.y)} is not between the bands (${lo}..${hi})`)
  } else ok(`lift car between bands: y ${r2(mid.y)} inside ${lo}..${hi} (progress ${r2(mid.progress)})`)
  const floorYs = FLOOR_IDS.map((f) => buildingLiftY(f))
  if (floorYs.some((y) => Math.abs(y - mid.y) < 10)) fail(`car centre ${r2(mid.y)} sits on a floor`)
  else ok(`car is clear of every floor line (L1 ${floorYs[0]}, L2 ${floorYs[1]}, L3 ${floorYs[2]})`)
  const car = { x: mid.x, y: mid.y - mid.h / 2, w: mid.w, h: mid.h }
  if (car.x < BLD_LIFT.x || car.x + car.w > BLD_LIFT.x + BLD_LIFT.w) fail('car leaves the shaft horizontally')
  if (car.y < BLD_LIFT.top || car.y + car.h > BLD_LIFT.bottom) fail('car leaves the shaft vertically')
  if (!fails) ok(`car ${r2(car.w)}×${car.h} stays inside the shaft (x ${BLD_LIFT.x}–${BLD_LIFT.x + BLD_LIFT.w})`)
}

// ------------------------------------------------------------ 8. hit tests
{
  const first = seats[0]!
  const hit = buildingHit(seats, first.cx, first.floorY - first.avatarH / 2)
  if (!hit || !('id' in hit) || hit.id !== first.meta.id) fail(`click on ${first.meta.id} → ${JSON.stringify(hit)}`)
  else ok(`click on a desk → ${hit.id} (opens that floor + desk)`)
  const bandOnly = buildingHit(seats, 620, BLD_BANDS[2]!.y0 + 8)
  if (!bandOnly || !('floor' in bandOnly) || bandOnly.floor !== 2) fail(`click on the empty L2 band → ${JSON.stringify(bandOnly)}`)
  else ok('click on an empty band → its floor')
  const outside = buildingHit(seats, 80, 200)
  if (outside !== null) fail(`click on the skyline → ${JSON.stringify(outside)}`)
  else ok('click outside the building → nothing')
}

// -------------------------------------------- 10. deep-link mode precedence
{
  const cases: Array<[string, Parameters<typeof defaultViewMode>[0], string]> = [
    ['fresh load', {}, 'building'],
    ['?view=building', { view: 'building' }, 'building'],
    ['?view=building&face=dev', { view: 'building', agentLink: true }, 'building'],
    ['?view=floor', { view: 'floor' }, 'floor'],
    ['?floor=2', { floor: 2 }, 'floor'],
    ['?floor=3&view=building', { floor: 3, view: 'building' }, 'floor'],
    ['?spot=lobby (legacy)', { spot: 'lobby' }, 'floor'],
    ['?face=dev', { agentLink: true }, 'floor'],
  ]
  let bad = 0
  for (const [name, input, want] of cases) {
    const got = defaultViewMode(input)
    if (got !== want) {
      bad++
      fail(`${name} → ${got}, want ${want}`)
    }
  }
  if (!bad) ok(`deep-link precedence: ${cases.length} cases ok (GEDUNG default, ?floor wins, ?view=building honoured)`)
}

// ------------------------------------------------- 11. the painter, both themes
interface Op {
  name: string
  box: [number, number, number, number]
}
const newRec = () => ({ ops: [] as Op[], texts: [] as string[] })
/**
 * A canvas 2D recorder. With `track` it follows the painter's translate/scale
 * transforms (never rotation — these painters do not rotate), so a `fill` under
 * `translate(cx, y); scale(1, 0.12)` records its TRUE painted box instead of the
 * local one; the frame pass (track = false) keeps the raw design coords the
 * desk-matching gate expects.
 */
function recordCtx(rec: { ops: Op[]; texts: string[] }, track = false): CanvasRenderingContext2D {
  const styles: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textBaseline: 'top',
    textAlign: 'start',
    imageSmoothingEnabled: true,
  }
  let path: [number, number, number, number] | null = null
  // CTM: x' = a·x + e, y' = d·y + f (translate + scale only)
  let a = 1
  let d = 1
  let e = 0
  let f = 0
  const ctm: Array<[number, number, number, number]> = []
  const grow = (x: number, y: number) => {
    const X = a * x + e
    const Y = d * y + f
    if (!path) path = [X, Y, X, Y]
    else {
      path[0] = Math.min(path[0], X)
      path[1] = Math.min(path[1], Y)
      path[2] = Math.max(path[2], X)
      path[3] = Math.max(path[3], Y)
    }
  }
  const push = (name: string, box: [number, number, number, number]) => rec.ops.push({ name, box })
  const fontPx = () => {
    const m = /(\d+(?:\.\d+)?)px/.exec(String(styles.font))
    return m ? Number(m[1]) : 8
  }
  const textW = (s: string) => String(s).length * fontPx() * 0.62
  const gradient = { addColorStop() {} }
  const methods: Record<string, (...a: never[]) => unknown> = {
    fillRect: ((x: number, y: number, w: number, h: number) =>
      push('fillRect', [a * x + e, d * y + f, a * (x + w) + e, d * (y + h) + f])) as never,
    strokeRect: (() => undefined) as never,
    fillText: ((t: string, x: number, y: number) => {
      rec.texts.push(String(t))
      push(
        `fillText:${t}`,
        [a * x + e, d * y + f, a * (x + textW(String(t))) + e, d * (y + fontPx()) + f],
      )
    }) as never,
    drawImage: ((_img: unknown, x: number, y: number, w = 0, h = 0) =>
      push('drawImage', [a * x + e, d * y + f, a * (x + w) + e, d * (y + h) + f])) as never,
    beginPath: (() => {
      path = null
    }) as never,
    closePath: (() => undefined) as never,
    moveTo: ((x: number, y: number) => grow(x, y)) as never,
    lineTo: ((x: number, y: number) => grow(x, y)) as never,
    quadraticCurveTo: ((cx: number, cy: number, x: number, y: number) => {
      grow(cx, cy)
      grow(x, y)
    }) as never,
    rect: ((x: number, y: number, w: number, h: number) => {
      grow(x, y)
      grow(x + w, y + h)
    }) as never,
    arc: ((x: number, y: number, r: number) => {
      grow(x - r, y - r)
      grow(x + r, y + r)
    }) as never,
    ellipse: ((x: number, y: number, rx: number, ry: number) => {
      grow(x - rx, y - ry)
      grow(x + rx, y + ry)
    }) as never,
    fill: (() => {
      if (path) push('fill', [...path] as [number, number, number, number])
    }) as never,
    stroke: (() => undefined) as never,
    clip: (() => undefined) as never,
    save: (() => {
      if (track) ctm.push([a, d, e, f])
    }) as never,
    restore: (() => {
      if (track && ctm.length) {
        const m = ctm.pop()!
        a = m[0]!
        d = m[1]!
        e = m[2]!
        f = m[3]!
      }
    }) as never,
    translate: ((x: number, y: number) => {
      if (track) {
        e += a * x
        f += d * y
      }
      push('translate', [x, y, 0, 0])
    }) as never,
    scale: ((x: number, y: number) => {
      if (track) {
        a *= x
        d *= y
      }
      push('scale', [x, y, 0, 0])
    }) as never,
    rotate: (() => undefined) as never,
    setTransform: ((a2: number, _b: number, _c: number, d2: number, e2: number, f2: number) => {
      if (track) {
        a = a2
        d = d2
        e = e2
        f = f2
      }
    }) as never,
    measureText: ((s: string) => ({ width: textW(String(s)) })) as never,
    createLinearGradient: (() => gradient) as never,
    createRadialGradient: (() => gradient) as never,
  }
  return new Proxy(styles, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop === 'canvas') return undefined
      if (prop in methods) return methods[prop]
      return target[prop]
    },
    set(target, prop, value) {
      if (typeof prop === 'string') target[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

const created: HTMLCanvasElement[] = []
;(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
    const rec = newRec()
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      rec,
      getContext: () => recordCtx(rec),
    }
    created.push(canvas as unknown as HTMLCanvasElement)
    return canvas as unknown as HTMLCanvasElement
  },
}

const NOW = 1_760_000_000
const agent = (id: string, status: Agent['status']): Agent => ({
  id,
  status,
  last_active: NOW,
  current: null,
  today: { sessions: 1, messages: 2, tool_calls: 3, tokens: 0, hourly: [] },
  total: { sessions: 1, messages: 2 },
  task: null,
  source: null,
  blocked: null,
})

const THEMES: ThemeName[] = ['day', 'night']
const STATUSES: Agent['status'][] = ['working', 'reviewing', 'idle', 'blocked']
const ONLINE = new Map(agentsFor([]).map((m, i) => [m.id, agent(m.id, STATUSES[i % STATUSES.length]!)]))
const OFFLINE = new Map(agentsFor([]).map((m) => [m.id, agent(m.id, 'offline')]))

interface FrameCase {
  name: string
  byId: Map<string, Agent>
  viewW: number
  viewH: number
  band: number
  zoom: number
}
const cases: FrameCase[] = [
  { name: 'desktop 1000×688', byId: ONLINE, viewW: 1000, viewH: 688, band: 0, zoom: 2 },
  { name: 'phone 390×692', byId: ONLINE, viewW: 390, viewH: 692, band: PHONE_CTRL_BAND, zoom: 0.78 },
  { name: 'offline desktop', byId: OFFLINE, viewW: 1000, viewH: 688, band: 0, zoom: 2 },
  { name: 'offline phone', byId: OFFLINE, viewW: 390, viewH: 692, band: PHONE_CTRL_BAND, zoom: 0.78 },
]

let frames = 0
for (const theme of THEMES) {
  for (const c of cases) {
    clearBuildingCache()
    const rec = newRec()
    const ctx = recordCtx(rec)
    try {
      renderBuildingFrame(ctx, {
        theme,
        metas: metas as AgentMeta[],
        byId: c.byId,
        now: NOW,
        comms: [] as Comm[],
        vp: { camX: 500, camY: 344, zoom: c.zoom, floor: 1 },
        viewW: c.viewW,
        viewH: c.viewH,
        band: c.band,
        dpr: 1,
        still: true,
        t: 0,
      })
    } catch (err) {
      fail(`${theme}/${c.name} threw: ${(err as Error).message}`)
      continue
    }
    frames++
    const trS = sideTransform(c.viewW, c.viewH, { camX: 500, camY: 344, zoom: c.zoom, floor: 1 }, c.band).s
    const sheetW = BUILDING_W * trS
    const stage = rec.ops.find((o) => o.name === 'drawImage' && Math.abs(o.box[2] - o.box[0] - sheetW) < 1)
    if (!stage) {
      fail(`${theme}/${c.name}: the cached sheet is not blitted at ${r2(sheetW)} px wide`)
      continue
    }
    // all 13 plates, by first name
    const missing = metas.filter((m) => !rec.texts.includes(shortName(m.name)))
    if (missing.length) fail(`${theme}/${c.name}: ${missing.length} plates missing (${missing.map((m) => m.id).join(',')})`)
    // all 13 desk slabs, at the geometry's own rects
    let desksFound = 0
    for (const s of seats) {
      const d = buildingDeskRect(s)
      const found = rec.ops.some(
        (o) =>
          o.name === 'fill' &&
          Math.abs(o.box[0] - d.x) < 0.75 &&
          Math.abs(o.box[1] - d.y) < 0.75 &&
          Math.abs(o.box[2] - (d.x + d.w)) < 0.75,
      )
      if (found) desksFound++
      else fail(`${theme}/${c.name}: ${s.meta.id}'s desk slab is not painted`)
    }
    const avatars = rec.ops.filter((o) => o.name === 'drawImage').length - 1
    const offline = c.byId === OFFLINE
    if (offline && avatars !== 0) fail(`${theme}/${c.name}: ${avatars} avatars painted on an all-offline roster`)
    if (!offline && avatars < 13) fail(`${theme}/${c.name}: only ${avatars} avatars painted, want 13`)
    if (!missing.length && desksFound === 13) {
      ok(
        `${theme}/${c.name}: ${desksFound} desks · 13 plates · ${avatars} avatars · ${rec.ops.length} paint ops` +
          (offline ? ' · all OFFLINE (chairs empty, banner is DOM)' : ''),
      )
    }
  }
}
if (frames !== THEMES.length * cases.length) fail(`${frames} frames painted, want ${THEMES.length * cases.length}`)
else ok(`${frames} building frames (${THEMES.length} themes × desktop/phone × online/offline)`)

// the geometry object the probe reads answers the same numbers
{
  const g = buildingGeometry(metas)
  if (g.seats.length !== 13 || g.plates.length !== 13) fail(`buildingGeometry has ${g.seats.length} seats / ${g.plates.length} plates`)
  else if (g.bands.length !== 3) fail(`buildingGeometry has ${g.bands.length} bands`)
  else if (g.centreOffset > BUILDING_W * 0.02) fail(`buildingGeometry centreOffset ${g.centreOffset}`)
  else if (g.city.overlaps !== 0) fail(`buildingGeometry city overlaps ${g.city.overlaps}`)
  else ok(`building report: 3 bands, 13 seats, 13 plates, centreOffset ${g.centreOffset}, city overlaps 0`)
}


// ------------------------------- 12. street scale + z-order (furniture vs facade)
{
  /** ±10 % window over `PX_PER_M × real metres`. */
  const scaleNear = (got: number, real: number, name: string, slack = 0.1) => {
    const want = real * PX_PER_M
    const dev = Math.abs(got - want) / want
    if (dev > slack) fail(`${name}: ${got} px vs ${want.toFixed(1)} px (${(dev * 100).toFixed(1)} % off, limit ${slack * 100} %)`)
  }
  if (Math.abs(PX_PER_M - 42 / 1.7) > 0.5) fail(`PX_PER_M ${PX_PER_M} is not 42 px / 1.7 m (${(42 / 1.7).toFixed(2)})`)
  else ok(`scale anchor: ${PX_PER_M} px/m = the 42 px overview avatar / 1.7 m`)
  scaleNear(STREET_PROPS.treeH, 7, 'tree height', 0.15)
  scaleNear(STREET_PROPS.lampH, 6, 'lamp height')
  scaleNear(LANE_W, 3.5, 'lane width')
  scaleNear(BLD_ZEBRA.x1 - BLD_ZEBRA.x0, 3.6, 'zebra width')
  scaleNear(BLD_DASH.line, 3, 'dash paint')
  scaleNear(BLD_DASH.line + BLD_DASH.gap, 9, 'dash pitch')
  scaleNear(BLD_STREET.walk - BLD_STREET.top, 1.8, 'near sidewalk')
  scaleNear(BLD_STREET.far - BLD_STREET.road, 0.8, 'far sidewalk', 0.25)
  scaleNear(BLD_STREET.bottom - BLD_STREET.top, 9.6, 'whole street (true depth)')
  if (STREET_PROPS.treeH < 150 || STREET_PROPS.treeH > 200) fail(`tree ${STREET_PROPS.treeH} px outside the 150–200 px window`)
  // the depth axis is no longer squeezed: a lane is as deep as it is wide
  if (LANE_DEPTH !== LANE_W) fail(`lane depth ${LANE_DEPTH} ≠ lane width ${LANE_W} (the ×0.56 squeeze is back?)`)
  if (BLD_STREET.road - BLD_STREET.walk !== 2 * LANE_W) {
    fail(`road depth ${BLD_STREET.road - BLD_STREET.walk} ≠ 2 lanes (${2 * LANE_W})`)
  }
  if (!fails) {
    ok(
      `street scale ${PX_PER_M} px/m at TRUE depth: road ${BLD_STREET.road - BLD_STREET.walk} px = 2 × ${LANE_W} px lanes ` +
        `(lane depth = lane width), sidewalks ${BLD_STREET.walk - BLD_STREET.top}+${BLD_STREET.far - BLD_STREET.road} px, ` +
        `${BLD_STREET.bottom - BLD_STREET.top} px = 9.6 m kerb to kerb to kerb`,
    )
  }

  // ---------------- interior props, all derived from m2px (gate c) ----------
  {
    const s = BLD_DESK.scale
    const propNear = (got: number, want: number, name: string) => {
      const dev = Math.abs(got - want) / want
      if (dev > 0.1) fail(`${name}: ${r2(got)} px vs ${r2(want)} px (${r2(dev * 100)} % off, limit 10 %)`)
    }
    propNear(128 * s, BLD_PROP.deskW, 'desk width (128 × scale vs m2px(1.6))')
    propNear(58 * s, BLD_PROP.deskH, 'desk height (58 × scale vs m2px(0.75))')
    propNear(84 * s, BLD_PROP.chairH, 'chair back (84 × scale vs m2px(1.05))')
    propNear(36 * s, BLD_PROP.seatH, 'seat (36 × scale vs m2px(0.45))')
    propNear(38 * s, BLD_PROP.monitorW, 'monitor width (38 × scale vs m2px(0.49))')
    propNear((3.3 + 8.3 + 23) * s, BLD_PROP.monitorH, 'monitor height ((3.3+8.3+23) × scale vs m2px(0.45))')
    propNear(BLD_DOOR_H, BLD_PROP.doorH, 'lift door (BLD_DOOR_H vs m2px(2.1))')
    propNear(BLD_CAR_H, BLD_PROP.carH, 'lift car (BLD_CAR_H vs m2px(2.2))')
    propNear(BLD_LIFT.w, BLD_PROP.shaftW, 'lift shaft (BLD_LIFT.w vs m2px(1.2))')
    // and the table itself is honest: every entry IS m2px(real metres)
    const metres: Array<[keyof typeof BLD_PROP, number]> = [
      ['deskW', 1.6],
      ['deskH', 0.75],
      ['chairH', 1.05],
      ['seatH', 0.45],
      ['monitorW', 0.49],
      ['monitorH', 0.45],
      ['doorH', 2.1],
      ['carH', 2.2],
      ['shaftW', 1.2],
    ]
    for (const [key, m] of metres) {
      if (Math.abs(BLD_PROP[key] - m2px(m)) > 1e-9) fail(`BLD_PROP.${key} ${BLD_PROP[key]} is not m2px(${m})`)
    }
    if (BLD_PROP.namePlateH !== 15) fail(`BLD_PROP.namePlateH ${BLD_PROP.namePlateH}, want the 15 px UI chip`)
    if (!fails) {
      ok(
        `interior props from one scale: desk ${r2(128 * s)}×${r2(58 * s)} (1.6×0.75 m), chair ${r2(84 * s)} seat ${r2(36 * s)}, ` +
          `monitor ${r2(38 * s)}×${r2((3.3 + 8.3 + 23) * s)}, door ${BLD_DOOR_H}, car ${BLD_CAR_H}, shaft ${BLD_LIFT.w} — all ±10 % of metres`,
      )
    }
  }

  // each prop stands on the kerb, whole painted span clear of the facade bay
  const foot = BLD_STREET.walk - STREET_PROPS.inset
  let offStreet = 0
  let inFacadeBay = 0
  for (const prop of BLD_FURNITURE) {
    const top = foot - prop.h
    if (top < 0 || foot > SCENE_H) {
      offStreet++
      fail(`${prop.kind} at x ${prop.x} spans y ${r2(top)}…${foot}, outside the sheet`)
    }
    const [x0, x1] = propSpan(prop)
    if (x1 > BLD.x0 && x0 < BLD.x1) {
      inFacadeBay++
      fail(`${prop.kind} at x ${prop.x} paints over the facade bay (${r2(Math.max(x0, BLD.x0))}…${r2(Math.min(x1, BLD.x1))})`)
    }
  }
  // a lamp head must never grow out of a canopy: keep the x-intervals apart
  let propHits = 0
  for (let i = 0; i < BLD_FURNITURE.length; i++) {
    for (let j = i + 1; j < BLD_FURNITURE.length; j++) {
      const a = propSpan(BLD_FURNITURE[i]!)
      const b = propSpan(BLD_FURNITURE[j]!)
      if (a[1] > b[0] && b[1] > a[0]) {
        propHits++
        fail(`${BLD_FURNITURE[i]!.kind}@${BLD_FURNITURE[i]!.x} overlaps ${BLD_FURNITURE[j]!.kind}@${BLD_FURNITURE[j]!.x} (${r2(a[0])}…${r2(a[1])} vs ${r2(b[0])}…${r2(b[1])})`)
      }
    }
  }
  if (!propHits) ok(`${BLD_FURNITURE.length} props keep clear of each other (no lamp head inside a canopy)`)
  const trees = BLD_FURNITURE.filter((p) => p.kind === 'tree')
  const lamps = BLD_FURNITURE.filter((p) => p.kind === 'lamp')
  if (!offStreet && !inFacadeBay) {
    ok(
      `${BLD_FURNITURE.length} props on the near kerb (${trees.length} trees ${STREET_PROPS.treeH}/${STREET_PROPS.treeH2} px, ` +
        `${lamps.length} lamps ${STREET_PROPS.lampH} px), all inside the ${r2(SCENE_W)}×${r2(SCENE_H)} sheet and clear of the facade bay`,
    )
  }

  // z-order: every furniture op is painted BEFORE the facade starts
  /** running min/max painted x of furniture-phase ops, both themes, design px */
  let furnMinX = Infinity
  let furnMaxX = -Infinity
  for (const theme of THEMES) {
    clearBuildingCache()
    const rec = newRec()
    const marks: Partial<Record<BuildingPhase, number>> = {}
    // the sheet paints through `document.createElement`; point it at OUR
    // recorder, transform-aware so a fill under translate/scale records its
    // true painted box
    const doc = (globalThis as unknown as { document: unknown }).document
    ;(globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
        return { width: 0, height: 0, style: {}, getContext: () => recordCtx(rec, true) }
      },
    }
    try {
      createBuildingLayer(theme, (phase) => {
        marks[phase] = rec.ops.length
      })
    } catch (err) {
      fail(`${theme}: createBuildingLayer threw: ${(err as Error).message}`)
      continue
    } finally {
      ;(globalThis as unknown as { document: unknown }).document = doc
    }
    const order = BUILDING_PHASES.map((p) => marks[p])
    if (order.some((m) => m === undefined)) {
      fail(`${theme}: phases not all reported (${JSON.stringify(marks)})`)
      continue
    }
    let monotone = true
    for (let i = 1; i < order.length; i++) if (order[i]! < order[i - 1]!) monotone = false
    if (!monotone) fail(`${theme}: paint phases out of order (${BUILDING_PHASES.join(' → ')})`)
    const furnStart = marks.furniture!
    const facadeStart = marks.facade!
    const liftStart = marks.lift!
    if (!(furnStart < facadeStart && facadeStart < liftStart)) {
      fail(`${theme}: furniture ${furnStart} / facade ${facadeStart} / lift ${liftStart} are not in painting order`)
      continue
    }
    // the sheet records backing-store px (createBuildingLayer paints at
    // CACHE_SCALE); divide back to design px so the boxes compare against the
    // design geometry below
    const design = (op: Op): Op => ({
      name: op.name,
      box: [op.box[0] / CACHE_SCALE, op.box[1] / CACHE_SCALE, op.box[2] / CACHE_SCALE, op.box[3] / CACHE_SCALE] as [
        number,
        number,
        number,
        number,
      ],
    })
    const furnOps = rec.ops.slice(furnStart, facadeStart).map(design)
    const facadeOps = rec.ops.slice(facadeStart, liftStart).map(design)
    if (furnOps.length < BLD_FURNITURE.length) {
      fail(`${theme}: only ${furnOps.length} furniture ops for ${BLD_FURNITURE.length} props`)
    }
    // the painted-bounds gate: EVERY op the furniture phase emits — canopy
    // lobes at their honest 1.17 R reach, lamp heads, night halos, ground
    // shadows — must sit fully inside the design sheet. Recorded boxes are
    // true painted bounds (the recorder applies translate/scale), not just
    // the analytic `propSpan` the layout gate above already checks.
    let offSheet = 0
    for (const op of furnOps) {
      const [x0, y0, x1, y1] = op.box
      if (x1 <= x0 || y1 <= y0) continue // translate/scale bookkeeping, not paint
      furnMinX = Math.min(furnMinX, x0)
      furnMaxX = Math.max(furnMaxX, x1)
      if (x0 < -0.01 || y0 < -0.01 || x1 > SCENE_W + 0.01 || y1 > SCENE_H + 0.01) {
        offSheet++
        fail(
          `${theme}: furniture op ${op.name} box ${r2(x0)},${r2(y0)}…${r2(x1)},${r2(y1)} ` +
            `leaves the design sheet 0…${r2(SCENE_W)} × 0…${r2(SCENE_H)}`,
        )
      }
    }
    // nothing the furniture paints above the facade base may survive the facade
    let uncovered = 0
    for (const op of furnOps) {
      const r = { x: op.box[0], y: op.box[1], w: op.box[2] - op.box[0], h: op.box[3] - op.box[1] }
      if (r.y >= BLD.baseY - 0.5 || r.w <= 0 || r.h <= 0) continue
      if (r.x + r.w <= BLD.x0 || r.x >= BLD.x1) continue // outside the facade bay: nothing to cover
      const need = { x: Math.max(r.x, BLD.x0), y: r.y, w: 0, h: Math.min(r.y + r.h, BLD.baseY) - r.y }
      need.w = Math.min(r.x + r.w, BLD.x1) - need.x
      // several facade ops may share the job (pilaster + wall), so sample the
      // region on a small grid instead of demanding one covering rect
      let samples = 0
      let hit = 0
      for (let gx = 0; gx <= 4; gx++) {
        for (let gy = 0; gy <= 4; gy++) {
          const px = need.x + (need.w * gx) / 4
          const py = need.y + (need.h * gy) / 4
          samples++
          if (
            facadeOps.some((f) => {
              const fr = { x: f.box[0], y: f.box[1], w: f.box[2] - f.box[0], h: f.box[3] - f.box[1] }
              return px > fr.x - 0.6 && px < fr.x + fr.w + 0.6 && py > fr.y - 0.6 && py < fr.y + fr.h + 0.6
            })
          ) {
            hit++
          }
        }
      }
      const covered = hit === samples
      if (!covered) {
        uncovered++
        if (uncovered < 4) fail(`${theme}: a ${op.name} above the facade base at y ${r2(r.y)} is painted after nothing that covers it`)
      }
    }
    if (uncovered === 0 && offSheet === 0) {
      ok(
        `${theme}/sheet: phases ${BUILDING_PHASES.length} in order, ${furnOps.length} furniture ops painted BEFORE the facade ` +
          `(${facadeOps.length} facade ops after them) — occlusion only, never over the tower; every furniture box ` +
          `inside 0…${r2(SCENE_W)} × 0…${r2(SCENE_H)} (painted x so far ${r2(furnMinX)}…${r2(furnMaxX)})`,
      )
    }
  }
  if (Number.isFinite(furnMinX) && Number.isFinite(furnMaxX)) {
    if (furnMinX < 0 || furnMaxX > SCENE_W) {
      fail(`furniture painted x ${r2(furnMinX)}…${r2(furnMaxX)} leaves the design sheet`)
    } else {
      ok(`furniture painted bounds: x ${r2(furnMinX)}…${r2(furnMaxX)} inside 0…${r2(SCENE_W)} (design px, both themes)`)
    }
  }
}

console.log('')
if (fails) {
  console.log(`BUILDING FAIL — ${fails} problem(s), ${checks} ok`)
  process.exit(1)
}
console.log(`BUILDING OK — ${checks} checks, ${frames} frames, ${created.length} offscreen sheets`)
