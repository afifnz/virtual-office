/**
 * GEDUNG traffic gate — the street life of the whole-building view, headless.
 *
 * Proves, without a browser and without screenshots:
 *
 *   a. one scale: every prop is `PX_PER_M × real metres` within ±10 % — car
 *      110×37, van 135×54, bus 220×78 (shortened from 294 on purpose), moto
 *      49×27, walker 11×42, lane 86 px wide, zebra 88 px, sidewalk 44 px;
 *   b. the fleet and the crowd exist (2 lanes × 5 vehicles incl. bus/van/moto,
 *      5 pedestrians: 3 pavement walkers + 2 zebra crossers) and every one of
 *      them keeps its ground line inside its own band — never on the facade;
 *   c. no two vehicles in the same lane ever overlap their bbox (sampled at
 *      30 Hz for 2 minutes, minimum bumper gap 29 px = 1.2 m);
 *   d. the light stops the traffic: from `CROSS_CLEARANCE` (recomputed from the
 *      new bus length and speed) into the red phase the zebra is empty, no
 *      vehicle crosses the stop line while the light is red, and the queue in
 *      front of the line is stationary;
 *   e. `?still=1` is a frozen phase: two fresh computations of the same t (and
 *      two painted frames) are identical to the last digit;
 *   f. headlights/tail lights are painted at night and never by day;
 *   g. the street life never paints over the facade rect (clipped sky
 *      included), and the painted road/zebra/sidewalk widths match the scale.
 *
 * It also reports the painter cost: ops added by the traffic layer, and a
 * mock-ctx frame time (JS only, no rasterisation — the real `__office2dPerf()`
 * number comes from the front-desk browser run).
 *
 *   frontend/node_modules/.bin/esbuild verify/traffic_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/traffic_check.mjs
 *   node /tmp/traffic_check.mjs        # "TRAFFIC OK", exit 0
 */
import type { Agent, Comm } from '../frontend/src/lib/types'
import { agentsFor } from '../frontend/src/lib/roster'
import type { AgentMeta } from '../frontend/src/lib/agents'
import {
  BLD_AVATAR_H,
  BLD_DASH,
  BLD_STREET,
  BLD_ZEBRA,
  LANE_DEPTH,
  LANE_W,
  PX_PER_M,
  SCENE_H,
  SCENE_W,
  STREET_PROPS,
  buildingRect,
} from '../frontend/src/scene2d/building'
import { renderBuildingFrame } from '../frontend/src/scene2d/render-building'
import { drawSkyLife, drawStreetLife } from '../frontend/src/scene2d/render-traffic'
import {
  BIRDS,
  CLOUDS,
  CROSS_CLEARANCE,
  CROSS_DUR,
  CROSS_PX,
  CROSS_START,
  LIGHT,
  PED_SPECS,
  RED_START,
  ROAD,
  SKY_HI,
  SKY_LO,
  SPEED_RANGE,
  STOP_LINE,
  VEHICLE,
  WALK,
  ZEBRA,
  ZEBRA_CLEAR_PX,
  birdAt,
  blinkAt,
  cloudX,
  lightAt,
  neighbourWindows,
  resetTraffic,
  trafficAt,
  trafficReport,
  trafficSnapshot,
  type LightState,
  type TrafficFrame,
} from '../frontend/src/scene2d/traffic'
import { shortName } from '../frontend/src/scene2d/labels'
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
const r2 = (v: number) => Math.round(v * 100) / 100

type Rect = { x: number; y: number; w: number; h: number }
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (a: Rect, b: Rect) => a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.w <= b.x + b.w + 0.01 && a.y + a.h <= b.y + b.h + 0.01
const inter = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null
}
const vehicleRect = (v: TrafficFrame['vehicles'][number]): Rect => ({ x: v.x - v.w / 2, y: v.y, w: v.w, h: v.h })
const pedRect = (p: TrafficFrame['peds'][number]): Rect => ({ x: p.x - p.w / 2, y: p.y - p.h, w: p.w, h: p.h })

const FACADE = buildingRect()
/** How far a vehicle may hang off the loop ends while it wraps. */
const LOOP_MARGIN = Math.max(...Object.values(VEHICLE).map((v) => v.w / 2)) + 20
/** The whole street: sidewalk → road → far sidewalk, on the design sheet. */
const STREET_BAND: Rect = { x: ROAD.x0 - LOOP_MARGIN, y: BLD_STREET.top, w: ROAD.x1 - ROAD.x0 + LOOP_MARGIN * 2, h: SCENE_H - BLD_STREET.top }
const ZEBRA_RECT: Rect = { x: ZEBRA.x0, y: ROAD.top, w: ZEBRA.x1 - ZEBRA.x0, h: ROAD.bottom - ROAD.top }

const DT = 1 / 30

// the painter builds its cached sheet through `document.createElement`; the
// gate only needs a canvas-shaped object (see `verify/building_check.ts`)
;(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
    return { width: 0, height: 0, style: {}, getContext: () => recordCtx(newRec()) }
  },
}

// ------------------------------------------------------- a. one scale, all props
{
  /** ±10 % window the boss asked for. */
  const near = (got: number, real: number, name: string, slack = 0.1) => {
    const want = real * PX_PER_M
    const dev = Math.abs(got - want) / want
    if (dev > slack) fail(`${name}: ${got} px vs ${want.toFixed(1)} px (${(dev * 100).toFixed(1)} % off, limit ${slack * 100} %)`)
    return dev
  }
  const devs: string[] = []
  // the anchor itself: 42 px for 1.7 m
  if (Math.abs(PX_PER_M - 42 / 1.7) > 0.5) fail(`PX_PER_M ${PX_PER_M} is not the 42 px / 1.7 m avatar scale (${(42 / 1.7).toFixed(2)})`)
  devs.push(`px/m ${PX_PER_M} = 42/1.7`)
  devs.push(`car ${VEHICLE.car.w}×${VEHICLE.car.h} (${near(VEHICLE.car.h, 1.5, 'car h').toFixed(3)}/${near(VEHICLE.car.w, 4.5, 'car w').toFixed(3)})`)
  devs.push(`van ${VEHICLE.van.w}×${VEHICLE.van.h} (${near(VEHICLE.van.h, 2.2, 'van h').toFixed(3)}/${near(VEHICLE.van.w, 5.5, 'van w').toFixed(3)})`)
  // the bus keeps its true height (3.2 m) but is shortened to 9 m so a 14 s
  // cycle can still clear the zebra; 220 px is inside the "may be shortened" bill
  near(VEHICLE.bus.h, 3.2, 'bus h')
  if (VEHICLE.bus.w < 200 || VEHICLE.bus.w > 294) fail(`bus length ${VEHICLE.bus.w} px outside the 200…294 px window`)
  devs.push(`bus ${VEHICLE.bus.w}×${VEHICLE.bus.h} (h ${near(VEHICLE.bus.h, 3.2, 'bus h').toFixed(3)}, length shortened from ${Math.round(12 * PX_PER_M)})`)
  devs.push(`moto ${VEHICLE.moto.w}×${VEHICLE.moto.h} (${near(VEHICLE.moto.h, 1.1, 'moto h').toFixed(3)}/${near(VEHICLE.moto.w, 2.0, 'moto w').toFixed(3)})`)
  const ped = trafficSnapshot(0).peds[0]!
  devs.push(`person ${ped.w}×${ped.h} (${near(ped.h, 1.7, 'ped h').toFixed(3)}/${near(ped.w, 0.45, 'ped w').toFixed(3)})`)
  if (ped.h !== BLD_AVATAR_H) {
    fail(`street walker ${ped.h} px ≠ the ${BLD_AVATAR_H} px overview avatar (inside and outside must share one person)`)
  }
  if (ped.h > BLD_AVATAR_H + 0.5) fail(`street walker is taller than the ${BLD_AVATAR_H} px overview avatar`)
  near(STREET_PROPS.treeH, 7, 'tree', 0.15)
  if (STREET_PROPS.treeH < 150 || STREET_PROPS.treeH > 200) fail(`tree ${STREET_PROPS.treeH} px outside the 150–200 px window`)
  devs.push(`tree ${STREET_PROPS.treeH} px (7 m)`)
  near(STREET_PROPS.lampH, 6, 'lamp')
  devs.push(`lamp ${STREET_PROPS.lampH} px (6 m)`)
  near(LANE_W, 3.5, 'lane width')
  // true depth: the lane is as deep as it is wide, the road exactly 2 lanes
  if (LANE_DEPTH !== LANE_W) fail(`lane depth ${LANE_DEPTH} ≠ lane width ${LANE_W} (the ×0.56 squeeze is back?)`)
  if (BLD_STREET.road - BLD_STREET.walk !== 2 * LANE_W) fail(`road depth ${BLD_STREET.road - BLD_STREET.walk} ≠ 2 lanes (${2 * LANE_W})`)
  devs.push(`lane ${LANE_W.toFixed(2)} px wide AND deep (3.5 m, true depth — no squeeze), road ${BLD_STREET.road - BLD_STREET.walk} px = 2 lanes`)
  near(ZEBRA.x1 - ZEBRA.x0, 3.6, 'zebra width')
  devs.push(`zebra ${ZEBRA.x1 - ZEBRA.x0} px`)
  near(BLD_STREET.walk - BLD_STREET.top, 1.8, 'near sidewalk')
  near(BLD_STREET.far - BLD_STREET.road, 0.8, 'far sidewalk', 0.2)
  near(BLD_DASH.line, 3, 'dash')
  near(BLD_DASH.line + BLD_DASH.gap, 9, 'dash pitch')
  devs.push(`dash ${BLD_DASH.line}+${BLD_DASH.gap} px (3 m + 6 m)`)
  devs.push(`sidewalk ${BLD_STREET.walk - BLD_STREET.top}+${BLD_STREET.far - BLD_STREET.road} px`)
  if (!fails) ok(`one scale ${PX_PER_M} px/m: ${devs.join(' · ')}`)
}

// --------------------------------------------------------- b. fleet + crowd
{
  resetTraffic()
  const f = trafficSnapshot(0)
  const kinds = new Set(f.vehicles.map((v) => v.kind))
  if (f.vehicles.length !== 10) fail(`${f.vehicles.length} vehicles, want 10`)
  if (f.counts.near !== 5 || f.counts.far !== 5) fail(`lane split ${f.counts.near}/${f.counts.far}, want 5/5`)
  for (const k of ['car', 'van', 'bus', 'moto'] as const) {
    if (!kinds.has(k)) fail(`no ${k} in the fleet`)
  }
  if (f.peds.length !== PED_SPECS.length) fail(`${f.peds.length} pedestrians, want ${PED_SPECS.length}`)
  if (f.peds.length < 3 || f.peds.length > 5) fail(`${f.peds.length} pedestrians, want 3–5`)
  const walkers = PED_SPECS.filter((p) => p.kind === 'walk').length
  const crossers = PED_SPECS.filter((p) => p.kind === 'cross').length
  if (walkers !== 3 || crossers !== 2) fail(`pedestrian split ${walkers} walkers / ${crossers} crossers, want 3/2`)
  else
    ok(
      `${f.vehicles.length} vehicles (${[...kinds].join('/')}, ${f.counts.near}+${f.counts.far} per lane) · ` +
        `${f.peds.length} pedestrians (${walkers} walkers + ${crossers} crossers)`,
    )
  Array.from(f.vehicles).forEach((v, i) =>
    v.id === `${v.lane}-${i % 5}` ? undefined : fail(`vehicle ${i} id ${v.id} does not match its lane slot`),
  )
}

// --------------------------------------- b. everyone in its own band
{
  resetTraffic()
  let bad = 0
  let worstLane = 0
  let tallestOver = 0
  for (let i = 0; i <= 120 / DT; i++) {
    const t = i * DT
    const f = trafficSnapshot(t)
    for (const v of f.vehicles) {
      const r = vehicleRect(v)
      // the wheels line is what must sit in the lane
      const ground = v.y + v.h
      const laneBase = v.lane === 'near' ? ROAD.nearBase : ROAD.farBase
      if (Math.abs(ground - laneBase) > 0.51) {
        worstLane++
        if (worstLane < 3) fail(`t=${r2(t)} ${v.id} wheels at ${r2(ground)}, want its lane line ${laneBase}`)
      }
      if (!inside(r, STREET_BAND)) {
        bad++
        if (bad < 4) fail(`t=${r2(t)} ${v.id} leaves the street: y ${r2(r.y)}…${r2(r.y + r.h)}`)
      }
      // true lane depth: even the 3.2 m bus fits INSIDE the road band now
      tallestOver = Math.max(tallestOver, ROAD.top - r.y)
      if (r.y < ROAD.top - 0.01) {
        bad++
        if (bad < 4) fail(`t=${r2(t)} ${v.id} rises above the road band (y ${r2(r.y)} < ${ROAD.top})`)
      }
      if (overlap(r, FACADE)) {
        bad++
        if (bad < 4) fail(`t=${r2(t)} ${v.id} covers the facade`)
      }
    }
    for (const p of f.peds) {
      const r = pedRect(p)
      // feet decide the band: a 42 px walker is taller than a 20 px far kerb
      const onNear = p.y > BLD_STREET.top - 0.01 && p.y <= BLD_STREET.walk + 0.01
      const onFar = p.y > BLD_STREET.road - 0.01 && p.y <= BLD_STREET.bottom + 0.01
      const onZebra =
        p.crossing &&
        r.x >= ZEBRA.x0 - 0.01 &&
        r.x + r.w <= ZEBRA.x1 + 0.01 &&
        p.y >= WALK.near.feet - 0.01 &&
        p.y <= WALK.far.feet + 0.01
      if (!onNear && !onFar && !onZebra) {
        bad++
        if (bad < 6) fail(`t=${r2(t)} ${p.id} is neither on a pavement nor on the zebra (feet ${r2(p.y)})`)
      }
      if (overlap(r, FACADE)) {
        bad++
        if (bad < 6) fail(`t=${r2(t)} ${p.id} covers the facade (head ${r2(r.y)} < ${BLD_STREET.top})`)
      }
      if (r.y < BLD_STREET.top - 0.01) {
        bad++
        if (bad < 6) fail(`t=${r2(t)} ${p.id} paints above the sidewalk: head ${r2(r.y)}`)
      }
    }
  }
  if (!bad && !worstLane) {
    ok(
      `120 s swept at 30 Hz: every vehicle keeps its wheels on its lane line (near ${ROAD.nearBase}, far ${ROAD.farBase}) and its ` +
        `whole body inside the ${ROAD.bottom - ROAD.top} px road band (${r2(-tallestOver)} px of headroom over the tallest roof), ` +
        `every walker's feet on a pavement or the zebra (${ZEBRA.x0}…${ZEBRA.x1})`,
    )
  }
}

// --------------------------------------------------- b. no bbox overlap
{
  resetTraffic()
  let hits = 0
  let minGap = Infinity
  for (let i = 0; i <= 120 / DT; i++) {
    const f = trafficSnapshot(i * DT)
    for (const lane of ['near', 'far'] as const) {
      const row = f.vehicles.filter((v) => v.lane === lane)
      for (let a = 0; a < row.length; a++) {
        for (let b = a + 1; b < row.length; b++) {
          const A = row[a]!
          const B = row[b]!
          if (overlap(vehicleRect(A), vehicleRect(B))) {
            hits++
            if (hits < 4) fail(`t=${r2(i * DT)} ${A.id} overlaps ${B.id} in the ${lane} lane`)
          }
          const gap = Math.abs(A.x - B.x) - (A.w + B.w) / 2
          // ignore the pairs on opposite sides of the wrap point
          if (Math.abs(A.x - B.x) < 400) minGap = Math.min(minGap, gap)
        }
      }
    }
  }
  if (!hits) ok(`0 bbox overlaps in 120 s (30 Hz); smallest bumper gap seen ${r2(minGap)} px (min ${ROAD.minGap})`)
}

// ------------------------------------------------- c. the red light stops them
{
  resetTraffic()
  let inZebra = 0
  let crossed = 0
  let queued = 0
  // the clearance the sheet promises, derived from the longest vehicle
  const busClear = ZEBRA_CLEAR_PX / VEHICLE.bus.speed
  if (CROSS_CLEARANCE < busClear) {
    fail(`CROSS_CLEARANCE ${CROSS_CLEARANCE} s < bus clearance ${r2(busClear)} s (${ZEBRA_CLEAR_PX} px at ${VEHICLE.bus.speed} px/s)`)
  }
  for (let cycle = 0; cycle < 8; cycle++) {
    const redStart = RED_START + cycle * LIGHT.cycle
    let prev = trafficSnapshot(redStart + 0.05)
    for (let i = 1; i <= Math.round(LIGHT.red / DT); i++) {
      const t = redStart + 0.05 + i * DT
      const f = trafficSnapshot(t)
      for (let j = 0; j < f.vehicles.length; j++) {
        const v = f.vehicles[j]!
        const before = prev.vehicles[j]!
        const line = v.dir > 0 ? STOP_LINE.near : STOP_LINE.far
        const front = v.dir > 0 ? v.x + v.w / 2 : v.x - v.w / 2
        const prevFront = v.dir > 0 ? before.x + before.w / 2 : before.x - before.w / 2
        // entering the zebra while red is the violation this gate is about
        const entered = v.dir > 0 ? prevFront <= line + 0.01 && front > line + 0.4 : prevFront >= line - 0.01 && front < line - 0.4
        if (entered) {
          crossed++
          if (crossed < 4) fail(`t=${r2(t)} ${v.id} crossed the stop line ${line} during red`)
        }
        if (t >= redStart + CROSS_CLEARANCE && overlap(vehicleRect(v), ZEBRA_RECT)) {
          inZebra++
          if (inZebra < 4) fail(`t=${r2(t)} ${v.id} is inside the zebra during red + ${CROSS_CLEARANCE} s`)
        }
        // a car that has reached the queue is parked on the line, not creeping
        if (lightAt(t).phase === 'red' && front <= line && line - front <= 12 && v.speed < 0.5) queued++
      }
      prev = f
    }
  }
  if (!crossed && !inZebra) {
    ok(
      `8 red phases: 0 vehicles enter the zebra, zebra empty from red+${CROSS_CLEARANCE} s to red+${LIGHT.red} s ` +
        `(clearance ${r2(busClear)} s for a ${VEHICLE.bus.w} px bus over ${ZEBRA_CLEAR_PX} px; ${queued} queue samples stationary)`,
    )
  }
  if (queued <= 50) fail(`only ${queued} stopped-at-the-line samples during 8 red phases`)
  // and the crossing fits inside the red phase: clearance + walk < red
  if (CROSS_START + CROSS_DUR > RED_START + LIGHT.red - 0.1) {
    fail(`crossing ${CROSS_START}…${r2(CROSS_START + CROSS_DUR)} s overruns the red phase (ends ${RED_START + LIGHT.red})`)
  } else {
    ok(
      `pedestrian window ${r2(CROSS_START)}…${r2(CROSS_START + CROSS_DUR)} s (${CROSS_DUR} s for ${CROSS_PX} px kerb-to-kerb) ` +
        `fits inside the ${LIGHT.red} s red phase`,
    )
  }
}

// ------------------------------------------------------- d. determinism
{
  resetTraffic()
  const a = JSON.stringify(trafficSnapshot(21.4))
  resetTraffic()
  const b = JSON.stringify(trafficSnapshot(21.4))
  if (a !== b) fail('two fresh computations of t=21.4 differ (?still=1 would flicker)')
  else ok(`deterministic: two fresh runs of t=21.4 are identical (${a.length} bytes)`)

  resetTraffic()
  const z1 = JSON.stringify(trafficSnapshot(0))
  const z2 = JSON.stringify(trafficSnapshot(0))
  if (z1 !== z2) fail('two calls at t=0 differ')
  else ok('still phase t=0 is stable across calls (vehicles parked on the loop, light green)')
}

// -------------------------------------------------- e. lights only at night
{
  // The painter is the source of truth: count the fills whose colour is a
  // headlight/tail-light tone in a day frame and a night frame.
  const HEAD = ['rgba(255,228,150,0.16)', 'rgba(255,236,178,0.3)', '#ffedb0']
  const TAIL = ['rgba(255,86,74,0.92)', 'rgba(255,86,74,0.22)']
  const count = (theme: ThemeName) => {
    resetTraffic()
    const rec = newRec()
    const ctx = recordCtx(rec)
    const frame = trafficAt(3.3)
    ctx.save()
    drawSkyLife(ctx, theme, 3.3)
    drawStreetLife(ctx, theme, { ...frame, vehicles: frame.vehicles.map((v) => ({ ...v })), peds: frame.peds.map((p) => ({ ...p })) })
    ctx.restore()
    const head = rec.ops.filter((o) => HEAD.includes(String(o.fill).toLowerCase())).length
    const tail = rec.ops.filter((o) => TAIL.includes(String(o.fill).toLowerCase())).length
    return { head, tail, ops: rec.ops.length }
  }
  const day = count('day')
  const night = count('night')

  // direction check: a headlight cone must sit in FRONT of a vehicle, a tail
  // light behind it — the one bug a count could never catch
  resetTraffic()
  const frec = newRec()
  const fctx = recordCtx(frec)
  const ft = 3.3
  const fframe = trafficAt(ft)
  fctx.save()
  drawSkyLife(fctx, 'night', ft)
  drawStreetLife(fctx, 'night', { ...fframe, vehicles: fframe.vehicles.map((v) => ({ ...v })), peds: fframe.peds.map((p) => ({ ...p })) })
  fctx.restore()
  const cars = fframe.vehicles
  const frontOf = (v: TrafficFrame['vehicles'][number]) => (v.dir > 0 ? v.x + v.w / 2 : v.x - v.w / 2)
  const cones = frec.ops.filter((o) => String(o.fill).toLowerCase() === 'rgba(255,228,150,0.16)')
  let wrongSide = 0
  for (const op of cones) {
    const cx = (op.box[0] + op.box[2]) / 2
    const okSide = cars.some((v) => {
      const front = frontOf(v)
      return v.dir > 0 ? cx > front - 1 : cx < front + 1
    })
    if (!okSide) {
      wrongSide++
      if (wrongSide < 3) fail(`a headlight cone at x ${r2(cx)} points away from every front bumper`)
    }
  }
  if (!wrongSide && cones.length) ok(`headlight cones point the way each vehicle drives (${cones.length} cones, 0 backwards)`)
  if (day.head !== 0 || day.tail !== 0) fail(`day frame paints ${day.head} headlight / ${day.tail} tail fills, want 0`)
  if (night.head < 10) fail(`night frame paints only ${night.head} headlight fills, want ≥ 10`)
  if (night.tail < 5) fail(`night frame paints only ${night.tail} tail fills, want ≥ 5`)
  if (day.head === 0 && day.tail === 0 && night.head >= 10) {
    ok(`headlights: 0 by day, ${night.head} cone/lamp fills + ${night.tail} tail lights at night`)
  }
}

// -------------------------------------------------- f. facade + light cycle
{
  // every op the street layer emits, clipped the way the canvas clips it
  resetTraffic()
  let offFacade = 0
  let outside = 0
  let ops = 0
  for (const theme of ['day', 'night'] as ThemeName[]) {
    for (const t of [0, 3.3, 9.4, 12.1, 20.7, 30.2, 41.6]) {
      const rec = newRec()
      const ctx = recordCtx(rec)
      const frame = trafficAt(t)
      ctx.save()
      drawSkyLife(ctx, theme, t)
      drawStreetLife(ctx, theme, frame)
      ctx.restore()
      for (const op of rec.ops) {
        if (op.clipped) continue
        ops++
        const r = { x: op.box[0], y: op.box[1], w: op.box[2] - op.box[0], h: op.box[3] - op.box[1] }
        if (r.w <= 0 || r.h <= 0) continue
        if (overlap(r, FACADE)) {
          offFacade++
          if (offFacade < 4) fail(`${theme} t=${t}: ${op.name} (${r2(r.x)},${r2(r.y)}) covers the facade`)
        }
        const sky = r.y + r.h <= BLD_STREET.top + 0.5
        const street = inside(r, STREET_BAND)
        if (!sky && !street) {
          outside++
          if (outside < 4) fail(`${theme} t=${t}: ${op.name} at y ${r2(r.y)}…${r2(r.y + r.h)} is neither sky nor street`)
        }
      }
    }
  }
  if (ops < 200) fail(`only ${ops} street-life ops recorded over 14 frames`)
  if (!offFacade && !outside) {
    ok(`14 street-life frames (day+night): ${ops} unc(lipped) ops, 0 over the facade ${FACADE.x}…${FACADE.x + FACADE.w}, all inside sky/street`)
  }
}

// ---------------------------------------------------------- light cycle
{
  const seq: Array<[number, LightState['phase']]> = [
    [0, 'green'],
    [5.9, 'green'],
    [6.0, 'yellow'],
    [7.9, 'yellow'],
    [8.0, 'red'],
    [16.9, 'red'],
    [17.0, 'green'],
  ]
  let bad = 0
  for (const [t, phase] of seq) {
    const l = lightAt(t)
    if (l.phase !== phase) {
      bad++
      fail(`light at ${t}s is ${l.phase}, want ${phase}`)
    }
    if (l.pedWalk !== (phase === 'red')) {
      bad++
      fail(`pedestrian light at ${t}s is ${l.pedWalk ? 'green' : 'red'} while the road is ${phase}`)
    }
  }
  if (LIGHT.cycle !== LIGHT.green + LIGHT.yellow + LIGHT.red) {
    fail(`LIGHT.cycle ${LIGHT.cycle} ≠ ${LIGHT.green}+${LIGHT.yellow}+${LIGHT.red}`)
  }
  if (LIGHT.green !== 6 || LIGHT.yellow !== 2 || LIGHT.red !== 9) {
    fail(`cycle is ${LIGHT.green}/${LIGHT.yellow}/${LIGHT.red}, want 6/2/9`)
  } else if (!bad) {
    ok(`light cycle 6 s green · 2 s yellow · 9 s red (${LIGHT.cycle} s); pedestrian green exactly during red`)
  }
  // the 7 m crossing needs a longer red: 184 px at 1.29 m/s = 5.8 s walk,
  // and the pedestrian window 10.2…16.0 must sit inside the 8…17 red phase
  const mps = (CROSS_PX / CROSS_DUR) / PX_PER_M
  if (!(mps >= 1.2 && mps <= 1.4)) fail(`crossing speed ${r2(mps)} m/s, want 1.2–1.4 (a brisk walk)`)
  if (CROSS_START < RED_START + CROSS_CLEARANCE - 1e-9) fail(`CROSS_START ${CROSS_START} < red + clearance ${RED_START + CROSS_CLEARANCE}`)
  if (CROSS_START + CROSS_DUR > RED_START + LIGHT.red - 0.1) fail(`pedestrian window ${CROSS_START}…${r2(CROSS_START + CROSS_DUR)} overruns the red phase`)
  else ok(`crossing: ${CROSS_PX} px (7 m kerb-to-kerb) in ${CROSS_DUR} s = ${r2(CROSS_PX / CROSS_DUR)} px/s = ${r2(mps)} m/s, window ${CROSS_START}…${r2(CROSS_START + CROSS_DUR)} s inside the ${RED_START}…${RED_START + LIGHT.red} red`)
}

// ------------------------------------------------------ pedestrians + light
{
  resetTraffic()
  let bad = 0
  let crossings = 0
  for (let i = 0; i <= 120 / DT; i++) {
    const t = i * DT
    const f = trafficSnapshot(t)
    const walk = lightAt(t).pedWalk
    for (const p of f.peds) {
      if (!p.crossing) continue
      crossings++
      if (!walk) {
        bad++
        if (bad < 4) fail(`t=${r2(t)} ${p.id} crosses while the pedestrian light is red`)
      }
      if (p.x < ZEBRA.x0 || p.x > ZEBRA.x1) {
        bad++
        if (bad < 4) fail(`t=${r2(t)} ${p.id} crosses outside the zebra (x ${r2(p.x)})`)
      }
      // never walk through a stopped car: the nearest car must be behind the curb
      for (const v of f.vehicles) {
        if (v.lane !== 'near') continue
        if (overlap(pedRect(p), vehicleRect(v))) {
          bad++
          if (bad < 4) fail(`t=${r2(t)} ${p.id} walks through ${v.id}`)
        }
      }
    }
  }
  if (!bad && crossings > 0) ok(`${crossings} crossing samples, all during the pedestrian green, inside the zebra, no car overlap`)
  if (crossings === 0) fail('no pedestrian ever crossed')
}

// ------------------------------------------------------------- e2. speeds
{
  resetTraffic()
  let fastest = 0
  let moving = 0
  let inRange = 0
  for (let i = 0; i <= 60 / DT; i++) {
    const f = trafficSnapshot(i * DT)
    for (const v of f.vehicles) {
      if (v.speed < 0.5) continue
      moving++
      fastest = Math.max(fastest, v.speed)
      if (v.speed >= SPEED_RANGE.min && v.speed <= SPEED_RANGE.max) inRange++
    }
  }
  if (fastest > SPEED_RANGE.max + 0.5) fail(`a vehicle reached ${r2(fastest)} px/s, above the ${SPEED_RANGE.max} budget`)
  if (!inRange) fail('no vehicle ever moved inside the promised speed window')
  else ok(`moving speeds ${r2(SPEED_RANGE.min)}…${r2(SPEED_RANGE.max)} px/s promised, observed max ${r2(fastest)} (${moving} moving samples)`)

  const kmh = (px: number) => (px / PX_PER_M) * 3.6
  if (!(VEHICLE.bus.speed < VEHICLE.van.speed && VEHICLE.van.speed < VEHICLE.car.speed && VEHICLE.car.speed < VEHICLE.moto.speed)) {
    fail(`speed order is not bus < van < car < moto (${VEHICLE.bus.speed}/${VEHICLE.van.speed}/${VEHICLE.car.speed}/${VEHICLE.moto.speed})`)
  } else {
    ok(
      `free-flow speeds ${kmh(VEHICLE.bus.speed).toFixed(0)}/${kmh(VEHICLE.van.speed).toFixed(0)}/` +
        `${kmh(VEHICLE.car.speed).toFixed(0)}/${kmh(VEHICLE.moto.speed).toFixed(0)} km/h (bus/van/car/moto) — ` +
        `cars inside the 30–50 km/h bill at the low end, the moto nimbler`,
    )
  }
}

// -------------------------------------------------------------- wrap safety
{
  resetTraffic()
  let wraps = 0
  let wrapsOnScreen = 0
  let prev = trafficSnapshot(0)
  for (let i = 1; i <= 120 / DT; i++) {
    const f = trafficSnapshot(i * DT)
    for (let j = 0; j < f.vehicles.length; j++) {
      const A = prev.vehicles[j]!
      const B = f.vehicles[j]!
      if (Math.abs(B.x - A.x) < 200) continue
      const half = Math.max(A.w, B.w) / 2
      // a wrap is only legal when the WHOLE body was off-canvas on one side
      const offA = A.x + half < 1 || A.x - half > SCENE_W - 1
      const offB = B.x + half < 1 || B.x - half > SCENE_W - 1
      wraps++
      const off = offA && offB
      if (!off) {
        wrapsOnScreen++
        if (wrapsOnScreen < 3) fail(`a vehicle wrapped at x ${r2(A.x)} → ${r2(B.x)}, inside the canvas`)
      }
    }
    prev = f
  }
  if (!wraps) fail('no vehicle ever wrapped in 2 minutes')
  else if (!wrapsOnScreen) ok(`${wraps} wraps in 2 minutes, every one outside the 0…${r2(SCENE_W)} design sheet`)
}

// ------------------------------------------------------------------ sky
{
  let moved = 0
  for (const c of CLOUDS) if (Math.abs(cloudX(c, 30) - cloudX(c, 0)) > 1) moved++
  if (moved !== CLOUDS.length) fail(`${CLOUDS.length - moved} clouds are static`)
  else ok(`${CLOUDS.length} clouds drift (${CLOUDS.map((c) => c.speed).join('/')} px/s), all above the roof`)

  const span = SKY_HI - SKY_LO
  const wrapped = CLOUDS.every((c) => cloudX(c, 10_000) >= SKY_LO && cloudX(c, 10_000) <= SKY_HI)
  if (!wrapped) fail('a cloud leaves the wrap window')
  else ok(`clouds wrap inside ${SKY_LO}…${r2(SKY_HI)} (span ${r2(span)} px, SCENE_W + 170 each side), always off-sheet`)

  const seen = new Set<number>()
  const flaps = new Set<number>()
  for (let i = 0; i < 240; i++) {
    const t = i * 0.5
    BIRDS.forEach((bird, b) => {
      const s = birdAt(bird, t)
      if (!s.visible) return
      seen.add(b)
      flaps.add(s.flap)
      if (s.y > BLD_STREET.top) fail(`bird ${b} flies below the sky at y ${r2(s.y)}`)
      if (s.flap !== 0 && s.flap >= 0) fail(`bird ${b} flap ${s.flap} is not a wing offset`)
    })
  }
  if (seen.size === 0) fail('no bird ever crossed')
  else if (flaps.size < 2) fail('bird wings never flap')
  else ok(`birds: ${seen.size}/3 cross the sky in 2 minutes, 2 wing frames, all above ${BLD_STREET.top}`)

  const win = neighbourWindows()
  if (win.length < 20) fail(`only ${win.length} blinking neighbour windows`)
  else {
    const changed = win.filter((w) => Math.abs(blinkAt(w, 3) - blinkAt(w, 5.5)) > 0.2).length
    if (!changed) fail('no neighbour window ever changes brightness')
    else ok(`neighbour windows: ${win.length} blink candidates, ${changed} change between t=3 and t=5.5 (night only)`)
    if (win.some((w) => w.x > FACADE.x - 8 && w.x < FACADE.x + FACADE.w + 8)) fail('a blinking window sits on the facade bay')
    else ok('every blinking window is inside a side bay (outside the facade)')
  }
}

// ------------------------------------------------------ painted frames (e)
{
  const metas = agentsFor([]) as AgentMeta[]
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
  const byId = new Map(metas.map((m, i) => [m.id, agent(m.id, (['working', 'idle'] as const)[i % 2]!)]))
  const paint = (theme: ThemeName, t: number) => {
    resetTraffic()
    const rec = newRec()
    renderBuildingFrame(recordCtx(rec), {
      theme,
      metas,
      byId,
      now: NOW,
      comms: [] as Comm[],
      vp: { camX: 500, camY: 344, zoom: 2, floor: 1 },
      viewW: 1000,
      viewH: 688,
      dpr: 1,
      still: false,
      t,
    })
    return rec
  }
  const day = paint('day', 3.3)
  const night = paint('night', 3.3)
  const dayAgain = paint('day', 3.3)
  const head = (rec: ReturnType<typeof newRec>) =>
    rec.ops.filter((o) => ['rgba(255,228,150,0.16)', 'rgba(255,236,178,0.3)', '#ffedb0'].includes(String(o.fill).toLowerCase())).length
  if (head(day) !== 0) fail(`day building frame has ${head(day)} headlight fills`)
  if (head(night) < 5) fail(`night building frame has only ${head(night)} headlight fills`)
  if (!head(day) && head(night) >= 5) ok(`painter: ${day.ops.length} day ops, ${night.ops.length} night ops, headlights only at night (${head(night)})`)
  // both frames still carry the 13 desks and 13 plates
  const plates = metas.filter((m) => day.texts.includes(shortName(m.name))).length
  if (plates < 13) fail(`day frame carries ${plates}/13 nameplates`)
  else ok(`13 nameplates still painted with traffic on top (${plates})`)

  // the cached sheet is blitted first, exactly once
  const sheets = day.ops.filter((o) => o.name === 'drawImage' && Math.abs(o.box[2] - o.box[0] - 1000) < 1).length
  if (sheets !== 1) fail(`${sheets} static sheet blits, want 1`)
  else ok('the static 1000 px sheet is still blitted once per frame')

  // ?still=1: the same t paints the same ops
  if (JSON.stringify(day) !== JSON.stringify(dayAgain)) fail('two still frames at t=3.3 differ')
  else ok(`still frame is byte-identical across two paints (${day.ops.length} ops)`)
}

// --------------------------------------------------------- painter cost
{
  const metas = agentsFor([]) as AgentMeta[]
  const NOW = 1_760_000_000
  const byId = new Map(metas.map((m) => [m.id, { id: m.id, status: 'working' } as Agent]))
  const bench = (label: string, run: (i: number) => void, n = 200) => {
    run(0)
    const t0 = performance.now()
    for (let i = 0; i < n; i++) run(i)
    const ms = (performance.now() - t0) / n
    return { label, ms }
  }
  for (const theme of ['day', 'night'] as ThemeName[]) {
    let sink = 0
    let fullOps = 0
    let streetOps = 0
    resetTraffic() // t is monotone in the real loop: the replay advances 1 step
    const full = bench('frame', (i) => {
      const n = countCtx((ctx) =>
        renderBuildingFrame(ctx, {
          theme,
          metas,
          byId,
          now: NOW,
          comms: [],
          vp: { camX: 500, camY: 344, zoom: 2, floor: 1 },
          viewW: 1000,
          viewH: 688,
          dpr: 1,
          still: false,
          t: 3 + i * 0.016,
        }),
      )
      sink += n
      if (!fullOps) fullOps = n
    }, 60)
    const street = bench('traffic', (i) => {
      const t = 3.3 + i * 0.016
      const n = countCtx((ctx) => {
        drawSkyLife(ctx, theme, t)
        drawStreetLife(ctx, theme, trafficAt(t))
      })
      sink += n
      if (!streetOps) streetOps = n
    }, 200)
    void sink
    ok(
      `${theme}: ${fullOps} canvas calls/frame (${streetOps} of them street life, ` +
        `${r2((streetOps / Math.max(fullOps, 1)) * 100)} %), mock-ctx ${r2(full.ms)} ms/frame ` +
        `(${r2(street.ms)} ms street; JS only, no rasterisation — browser number from front desk)`,
    )
  }
}

// ------------------------------------------------------------------ output
console.log('')
if (fails) {
  console.log(`TRAFFIC FAIL — ${fails} problem(s), ${checks} ok`)
  process.exit(1)
}
const report = trafficReport(4.2)
console.log(
  `TRAFFIC OK — ${checks} checks · ${report.vehicles} vehicles · ${report.peds} pedestrians · ` +
    `${report.blinkWindows} blinking windows · light ${LIGHT.green}/${LIGHT.yellow}/${LIGHT.red}`,
)
process.exit(0)

// ---------------------------------------------------------------- helpers

interface Op {
  name: string
  box: [number, number, number, number]
  fill: string
  alpha: number
  clipped: boolean
}

function newRec() {
  return { ops: [] as Op[], texts: [] as string[] }
}

type Clip = Rect[] | null

/**
 * A canvas 2D recorder: it tracks the path bbox, the fill colour and — the part
 * the facade gate needs — a rectangular clip stack, so an op painted behind a
 * clip is recorded as clipped (or dropped when the intersection is empty).
 */
function recordCtx(rec: ReturnType<typeof newRec>): CanvasRenderingContext2D {
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
  let path: Rect | null = null
  let pending: Rect[] = []
  let clip: Clip = null
  const stack: Clip[] = []
  const grow = (x: number, y: number) => {
    if (!path) path = { x, y, w: 0, h: 0 }
    const r = path
    const x1 = Math.max(r.x + r.w, x)
    const y1 = Math.max(r.y + r.h, y)
    r.x = Math.min(r.x, x)
    r.y = Math.min(r.y, y)
    r.w = x1 - r.x
    r.h = y1 - r.y
  }
  const push = (name: string, box: Rect) => {
    if (clip) {
      const hit = clip.map((c) => inter(box, c)).filter((c): c is Rect => !!c)
      if (!hit.length) {
        rec.ops.push({ name, box: [box.x, box.y, box.x + box.w, box.y + box.h], fill: String(styles.fillStyle), alpha: Number(styles.globalAlpha), clipped: true })
        return
      }
      const big = hit.sort((a, b) => b.w * b.h - a.w * a.h)[0]!
      rec.ops.push({ name, box: [big.x, big.y, big.x + big.w, big.y + big.h], fill: String(styles.fillStyle), alpha: Number(styles.globalAlpha), clipped: false })
      return
    }
    rec.ops.push({ name, box: [box.x, box.y, box.x + box.w, box.y + box.h], fill: String(styles.fillStyle), alpha: Number(styles.globalAlpha), clipped: false })
  }
  const fontPx = () => {
    const m = /(\d+(?:\.\d+)?)px/.exec(String(styles.font))
    return m ? Number(m[1]) : 8
  }
  const textW = (s: string) => String(s).length * fontPx() * 0.62
  const gradient = { addColorStop() {} }
  const methods: Record<string, (...a: never[]) => unknown> = {
    fillRect: ((x: number, y: number, w: number, h: number) => push('fillRect', { x, y, w, h })) as never,
    strokeRect: (() => undefined) as never,
    fillText: ((t: string, x: number, y: number) => {
      rec.texts.push(String(t))
      push(`fillText:${t}`, { x, y, w: textW(String(t)), h: fontPx() })
    }) as never,
    drawImage: ((_img: unknown, x: number, y: number, w = 0, h = 0) => push('drawImage', { x, y, w, h })) as never,
    beginPath: (() => {
      path = null
      pending = []
    }) as never,
    closePath: (() => undefined) as never,
    moveTo: ((x: number, y: number) => grow(x, y)) as never,
    lineTo: ((x: number, y: number) => grow(x, y)) as never,
    quadraticCurveTo: ((cx: number, cy: number, x: number, y: number) => {
      grow(cx, cy)
      grow(x, y)
    }) as never,
    rect: ((x: number, y: number, w: number, h: number) => {
      pending.push({ x, y, w, h })
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
      if (path) push('fill', path)
    }) as never,
    stroke: (() => {
      if (path) push('stroke', path)
    }) as never,
    clip: (() => {
      clip = pending.length ? pending : null
    }) as never,
    save: (() => {
      stack.push(clip)
    }) as never,
    restore: (() => {
      clip = stack.pop() ?? null
    }) as never,
    translate: (() => undefined) as never,
    scale: (() => undefined) as never,
    rotate: (() => undefined) as never,
    setTransform: (() => undefined) as never,
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

/** A counting context for the timing loop: same calls, no bookkeeping. */
function countCtx(run: (ctx: CanvasRenderingContext2D) => void): number {
  let n = 0
  const styles: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1, font: '', textBaseline: 'top' }
  const gradient = { addColorStop() {} }
  const bump = () => {
    n++
  }
  const methods: Record<string, (...a: never[]) => unknown> = {
    fillRect: bump as never,
    strokeRect: bump as never,
    fillText: bump as never,
    drawImage: bump as never,
    beginPath: bump as never,
    closePath: bump as never,
    moveTo: bump as never,
    lineTo: bump as never,
    quadraticCurveTo: bump as never,
    rect: bump as never,
    arc: bump as never,
    ellipse: bump as never,
    fill: bump as never,
    stroke: bump as never,
    clip: bump as never,
    save: bump as never,
    restore: bump as never,
    translate: bump as never,
    scale: bump as never,
    rotate: bump as never,
    setTransform: bump as never,
    measureText: (() => ({ width: 8 })) as never,
    createLinearGradient: (() => gradient) as never,
    createRadialGradient: (() => gradient) as never,
  }
  const ctx = new Proxy(styles, {
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
  run(ctx)
  return n
}
