/**
 * GEDUNG gate — the whole-building view, headless.
 *
 * Proves, without a browser and without screenshots:
 *
 *   a. one frame holds three floor bands, 13 desks and 13 nameplates, every
 *      rect inside the 1000×688 sheet AND inside a 390×692 phone canvas;
 *      0 plate↔plate overlap, 0 plate over another head;
 *   b. the building is centred: |building centre − canvas centre| ≤ 2 % width;
 *   c. the lift car is visible BETWEEN two bands while a delegation rides
 *      (not parked on a floor, inside the shaft);
 *   d. the procedural skyline never covers the facade: 0 city rect ∩ building;
 *   e. the painter itself runs for both themes, desktop and phone, online and
 *      offline — 13 desks and 13 plates every frame (the offline seed is a
 *      first-class case, not an accident).
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
  BLD_BANDS,
  BLD_STREET,
  BUILDING_H,
  BUILDING_W,
  BLD_AVATAR_H,
  BLD_DESK,
  BLD_LIFT,
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
} from '../frontend/src/scene2d/building'
import { buildingHit, clearBuildingCache, renderBuildingFrame } from '../frontend/src/scene2d/render-building'
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
if (bands.length !== 3) fail(`${bands.length} floor bands, want 3`)
const order = bands.map((b) => b.floor).join(',')
if (order !== '3,2,1') fail(`bands top→bottom = ${order}, want 3,2,1`)
else ok(`3 stacked bands (top→bottom): ${bands.map((b) => `L${b.floor} ${b.y0}–${b.y1}`).join(' · ')}`)
for (const b of bands) {
  if (!(b.y1 > b.y0)) fail(`L${b.floor}: band height ${b.y1 - b.y0}`)
  if (b.y1 - b.y0 !== 150) fail(`L${b.floor}: band ${b.y1 - b.y0} px, want 150`)
  if (!(b.floorY > b.y0 && b.floorY < b.y1)) fail(`L${b.floor}: floor line ${b.floorY} outside its band`)
  if (b.y0 < 0 || b.y1 > BUILDING_H) fail(`L${b.floor}: band leaves the stage`)
}
const bandTop = Math.min(...bands.map((b) => b.y0))
const bandBottom = Math.max(...bands.map((b) => b.y1))
if (bandBottom > BLD_STREET.top) fail(`the lowest band ends at ${bandBottom}, below the street ${BLD_STREET.top}`)
else ok(`bands 94–560 above the street line ${BLD_STREET.top}, each 150 px tall`)

// ------------------------------------------------------ 3. desks + plates
const platesBySeat = new Map(layoutBuildingPlates(seats).plates.map((p) => [p.id, p]))
const { plates, violations } = layoutBuildingPlates(seats)
if (plates.length !== 13) fail(`${plates.length} plates, want 13`)
if (violations.length) fail(`plate layout: ${violations.join('; ')}`)
let plateOverlap = 0
let plateOnHead = 0
let offStage = 0
for (const s of seats) {
  const desk = buildingDeskRect(s)
  if (!inside(desk, BUILDING_W, BUILDING_H)) {
    offStage++
    fail(`${s.meta.id}: desk ${JSON.stringify(desk)} leaves the ${BUILDING_W}×${BUILDING_H} sheet`)
  }
  const p = platesBySeat.get(s.meta.id)
  if (!p) {
    fail(`${s.meta.id}: no nameplate`)
    continue
  }
  if (!inside({ x: p.x, y: p.y, w: p.w, h: p.h }, BUILDING_W, BUILDING_H)) offStage++
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
if (offStage === 0) ok(`13 desks + 13 nameplates inside the ${BUILDING_W}×${BUILDING_H} sheet`)
if (plateOverlap === 0 && plateOnHead === 0) {
  ok(`plates: 0 overlap, 0 over another head (${plates.length} plates, max width ${Math.max(...plates.map((p) => p.w))} px)`)
}
if (BLD_AVATAR_H < 30 || BLD_AVATAR_H > 45) fail(`avatar ${BLD_AVATAR_H} px, want 30–45 (overview scale)`)
else ok(`overview scale: avatar ${BLD_AVATAR_H} px, desk ${r2(128 * BLD_DESK.scale)} px wide (per-floor avatar is 150)`)
if (measureSans(shortName('Dimas'), 9, 700) <= 0) fail('plate measurement returned 0')

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
      const sx = phone.left + r.x * phone.s
      const sy = phone.top + r.y * phone.s
      const sw = r.w * phone.s
      const sh = r.h * phone.s
      if (sx < 0 || sy < 0 || sx + sw > PW || sy + sh > PH) {
        cut++
        fail(`390×692: ${s.meta.id} ${name} spans ${sx.toFixed(1)}…${(sx + sw).toFixed(1)} × ${sy.toFixed(1)}…${(sy + sh).toFixed(1)}`)
      }
    }
  }
  for (const b of bands) {
    const sy = phone.top + b.y0 * phone.s
    const sh = (b.y1 - b.y0) * phone.s
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

// -------------------------------------------------------- 5. it is centred
{
  const b = buildingRect()
  const dx = Math.abs(b.x + b.w / 2 - BUILDING_W / 2)
  const limit = BUILDING_W * 0.02
  if (dx > limit) fail(`building centre is ${dx} px off the stage centre (limit ${limit})`)
  else ok(`building centred: |${b.x + b.w / 2} − ${BUILDING_W / 2}| = ${dx} px ≤ ${limit} (2 %)`)
  // and the rendered centring: at the fit the stage is centred in the canvas
  const phone = sideTransform(390, 692, { camX: 500, camY: 344, zoom: 0.78, floor: 1 }, PHONE_CTRL_BAND)
  const cx = phone.left + (b.x + b.w / 2) * phone.s
  const off = Math.abs(cx - 390 / 2)
  if (off > 390 * 0.02) fail(`rendered building centre is ${off} px off the canvas centre on 390 px`)
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
  const bandOnly = buildingHit(seats, 660, BLD_BANDS[2].y0 + 8)
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
function recordCtx(rec: { ops: Op[]; texts: string[] }): CanvasRenderingContext2D {
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
  const grow = (x: number, y: number) => {
    if (!path) path = [x, y, x, y]
    else {
      path[0] = Math.min(path[0], x)
      path[1] = Math.min(path[1], y)
      path[2] = Math.max(path[2], x)
      path[3] = Math.max(path[3], y)
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
    fillRect: ((x: number, y: number, w: number, h: number) => push('fillRect', [x, y, x + w, y + h])) as never,
    strokeRect: (() => undefined) as never,
    fillText: ((t: string, x: number, y: number) => {
      rec.texts.push(String(t))
      push(`fillText:${t}`, [x, y, x + textW(String(t)), y + fontPx()])
    }) as never,
    drawImage: ((_img: unknown, x: number, y: number, w = 0, h = 0) => push('drawImage', [x, y, x + w, y + h])) as never,
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
    save: (() => undefined) as never,
    restore: (() => undefined) as never,
    translate: ((x: number, y: number) => push('translate', [x, y, 0, 0])) as never,
    scale: ((x: number, y: number) => push('scale', [x, y, 0, 0])) as never,
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

console.log('')
if (fails) {
  console.log(`BUILDING FAIL — ${fails} problem(s), ${checks} ok`)
  process.exit(1)
}
console.log(`BUILDING OK — ${checks} checks, ${frames} frames, ${created.length} offscreen sheets`)
