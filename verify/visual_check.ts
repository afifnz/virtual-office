/**
 * Visual-geometry checker (3 floors): proves — without a browser — the things
 * the T1.9 review and the legibility pass found broken on a real screenshot.
 *
 *   1. the 13 seed desks split 1/4/8 over L1/L2/L3, each desk on its own floor
 *   2. no nameplate/chip/bubble rect overlaps another plate or a zone plaque
 *   3. no plate leaves the canvas (the "labels spill off the mobile screen" bug)
 *   4. at 1× (zoom ≥2) every nameplate is narrower than its desk slot; at zoom
 *      1 the 2× plates are deliberately wider than the 26 px pitch and are
 *      staggered by placeStacks instead
 *   5. every nameplate carries the whole first name — never a 3-letter stub
 *   6. offline and idle are distinguishable without colour (empty seat + Zzz +
 *      a status word, not just a grey dot)
 *   7. the label text never exceeds the plate that carries it
 *   8. zoom is an integer in 1..4 and the phone default is 1 (pan, not a
 *      fractional "50 %" view); the desktop default is 2 on every floor
 *   9. every floor carries its zone plaque(s), inside the floor's own bounds
 *
 *   frontend/node_modules/.bin/esbuild verify/visual_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/visual_check.mjs
 *   node /tmp/visual_check.mjs
 *
 * Pure: it imports only label/viewport maths, so there is no canvas, no jsdom
 * and no browser in the loop.
 */
import { AGENTS } from '../frontend/src/lib/agents'
import { rosterAgents } from '../frontend/src/lib/roster'
import { seatPoint } from '../frontend/src/lib/routes'
import { FLOORS, FLOOR_IDS, LIFT, liftNode, navOf, obstaclesOf, type FloorId } from '../frontend/src/lib/rooms'
import {
  NAME_GAP,
  NAME_MAX,
  PLATE_H,
  buildStacks,
  deskSlot,
  labelsOf,
  placeStacks,
  plateHeight,
  plateMode,
  plateScale,
  plateWidth,
  plaqueRect,
  rectsOverlap,
  shortName,
  type LabelAgent,
  type Rect,
} from '../frontend/src/scene2d/labels'
import { CHIBI_H } from '../frontend/src/scene2d/sprites'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitZoom,
  worldSize,
  worldToScreen,
  type Viewport,
} from '../frontend/src/scene2d/viewport'
import { textWidth } from '../frontend/src/scene2d/pixelfont'

let fails = 0
const fail = (msg: string) => {
  fails++
  console.log('FAIL', msg)
}
const ok = (msg: string) => console.log('ok  ', msg)

/** Canvas CSS size for a screen of `w`×`h` with the app chrome subtracted. */
interface Screen {
  name: string
  canvasW: number
  canvasH: number
}

const SCREENS: Screen[] = [
  // desktop canvas used by the verify screenshots (1000×688)
  { name: 'desktop 1000×688', canvasW: 1000, canvasH: 688 },
  // 390×692 phone canvas: HUD + bottom bar subtracted, full-bleed
  { name: 'mobile 390×692', canvasW: 390, canvasH: 692 },
]

/** Every agent's label descriptor at one viewport, exactly as render.ts builds it. */
function labelsFor(vp: Viewport, canvasW: number, canvasH: number, statuses: Map<string, string>): LabelAgent[] {
  const mode = plateMode(vp.zoom)
  return rosterAgents()
    .filter((meta) => meta.desk.floor === vp.floor)
    .map((meta) => {
      const seat = seatPoint(meta)
      const head = worldToScreen(vp, canvasW, canvasH, seat[0], seat[1])
      const status = statuses.get(meta.id) ?? 'offline'
      const offline = status === 'offline'
      return {
        id: meta.id,
        name: meta.name,
        cx: head.x,
        topY: head.y - CHIBI_H * vp.zoom,
        offline,
        chip: mode === 'compact' ? '' : offline ? 'offline' : status === 'idle' ? 'idle' : status === 'blocked' ? 'butuh izin' : status === 'reviewing' ? 'review' : 'terminal',
        bubble: mode !== 'compact' && !offline && (status === 'working' || status === 'reviewing' || status === 'blocked') ? (status === 'blocked' ? '!' : '...') : '',
        counters: mode === 'detail' && !offline ? '12M 34T #a1b2c3' : '',
        dot: mode === 'compact' ? undefined : offline ? '#8B93A5' : '#F2B434',
      }
    })
    // render.ts draws labels in painter order (back rows first); placeStacks is
    // greedy, so the gate must replay the same order to be faithful.
    .sort((a, b) => a.topY - b.topY)
}

/** Zone plaques of this floor, placed like render.ts does (clamped into the canvas). */
function zoneRects(vp: Viewport, canvasW: number, canvasH: number): Rect[] {
  return labelsOf(vp.floor).map((zl) => {
    const c = worldToScreen(vp, canvasW, canvasH, zl.x, zl.z)
    const r = plaqueRect(zl.text, c.x, c.y)
    const x = Math.min(Math.max(r.x, 1), Math.max(1, canvasW - r.w - 1))
    return { x, y: r.y, w: r.w, h: r.h }
  })
}

// ------------------------------------------------------- 1. the roster is 13

const metas = rosterAgents()
if (metas.length !== 13) fail(`roster has ${metas.length} desks, want 13`)
else ok(`roster: ${metas.length} desks, ${new Set(metas.map((m) => m.id)).size} unique ids`)
if (metas.length !== AGENTS.length) fail(`roster drifted from the seed roster (${metas.length} vs ${AGENTS.length})`)
const spots = new Set(metas.map((m) => `${m.desk.floor}:${m.desk.x},${m.desk.z}`))
if (spots.size !== metas.length) fail(`two desks share a position (${spots.size} unique of ${metas.length})`)
else ok('every desk has its own position (floor + coords)')

const WANT_SPLIT: Record<FloorId, number> = { 1: 1, 2: 4, 3: 8 }
for (const f of FLOOR_IDS) {
  const n = metas.filter((m) => m.desk.floor === f).length
  if (n !== WANT_SPLIT[f]) fail(`L${f} has ${n} desks, want ${WANT_SPLIT[f]}`)
  else ok(`L${f}: ${n} seed desks on the floor`)
}

// ------------------------------- 2. zoom is an integer 1..4, defaults per floor

if (MIN_ZOOM !== 1 || MAX_ZOOM !== 4) fail(`zoom range is ${MIN_ZOOM}..${MAX_ZOOM}, want 1..4`)
else ok(`zoom range is the integer set {${MIN_ZOOM},2,3,4}`)

const clampCases: Array<[number, number]> = [
  [0, 1],
  [0.5, 1],
  [1, 1],
  [2, 2],
  [2.4, 2],
  [3, 3],
  [4, 4],
  [9, 4],
  [-3, 1],
]
let clampBad = 0
for (const [input, want] of clampCases) {
  const got = clampZoom(input)
  if (got !== want || !Number.isInteger(got)) {
    clampBad++
    fail(`clampZoom(${input}) = ${got}, want integer ${want}`)
  }
}
if (clampBad === 0) ok(`clampZoom keeps ${clampCases.length} inputs in {1,2,3,4} (0.5 → 1, 9 → 4)`)

const phone = SCREENS[1]!
const desktop = SCREENS[0]!
let defaultOk = true
for (const f of FLOOR_IDS) {
  const pz = fitZoom(f, phone.canvasW, phone.canvasH)
  const dz = fitZoom(f, desktop.canvasW, desktop.canvasH)
  if (pz !== 1) {
    defaultOk = false
    fail(`L${f} ${phone.name}: default zoom is ${pz}, want 1 (integer, pan)`)
  }
  if (dz !== 2) {
    defaultOk = false
    fail(`L${f} ${desktop.name}: default zoom is ${dz}, want 2 (integer)`)
  }
}
if (defaultOk) {
  ok(`${phone.name}: default zoom = 1 on every floor (integer, the floor pans inside the screen)`)
  ok(`${desktop.name}: default zoom = 2 on every floor (integer)`)
}

if (plateScale(1) !== 2) fail(`plateScale(1) = ${plateScale(1)}, want 2 (plan §viewport)`)
else ok('zoom 1 draws the pixel font at scale 2 (integer)')
if (plateScale(2) !== 1) fail(`plateScale(2) = ${plateScale(2)}, want 1`)
else ok('zoom 2 draws the pixel font at scale 1 (integer)')
if (plateHeight('name', 2) !== 2 * PLATE_H) fail(`scale-2 nameplate is ${plateHeight('name', 2)} px tall, want ${2 * PLATE_H}`)
else ok(`zoom-1 nameplate is ${2 * PLATE_H} px tall (glyph 14 px), zoom-2 is ${PLATE_H} px`)

// --------------------------- 3. every plate shows the whole first name (zoom 1)

const expectedNames = metas.map((m) => (m.name.trim().split(/\s+/)[0] ?? '').toUpperCase().slice(0, NAME_MAX))
const actualNames = metas.map((m) => shortName(m.name))
const stubs = actualNames.filter((text, i) => text !== expectedNames[i])
if (stubs.length) {
  fail(`${stubs.length} zoom-1 nameplates are stubs: ${actualNames.join(', ')} (want ${expectedNames.join(', ')})`)
} else {
  ok(`zoom 1 names: ${actualNames.join(', ')}`)
}
const lengths = actualNames.map((t) => t.length)
const fivePlus = lengths.filter((n) => n >= 5).length
const shortOnes = actualNames.filter((t) => t.length < 5)
ok(
  `zoom-1 name lengths ${Math.min(...lengths)}–${Math.max(...lengths)}; ${fivePlus}/13 are 5–6 chars, the rest are genuinely short first names (${shortOnes.join(', ')})`,
)
if (lengths.some((n) => n < 3)) fail(`a nameplate has fewer than 3 letters: ${actualNames.join(', ')}`)

// the old 3-letter stubs must never come back: at zoom 1 buildStacks must
// reserve exactly the width of the whole first name, not a 3-letter slice.
const zoom1Statuses = new Map<string, string>(metas.map((m) => [m.id, 'working']))
const zoom1Agents = labelsFor(
  { x: 0, z: 0, zoom: 1, floor: 3 },
  phone.canvasW,
  phone.canvasH,
  zoom1Statuses,
)
const zoom1Stacks = buildStacks(zoom1Agents, plateMode(1), plateScale(1))
const zoom1NameWidths = zoom1Stacks.map((s) => s.plates.find((p) => p.key === 'name')!.w)
const zoom1WantWidths = expectedNames.map((text) => plateWidth(text, { scale: plateScale(1) }))
const wantById = new Map(metas.map((m, i) => [m.id, zoom1WantWidths[i]!]))
const narrow = zoom1Stacks.filter((s, i) => zoom1NameWidths[i] !== wantById.get(s.id))
if (narrow.length) fail(`${narrow.length} zoom-1 nameplates are narrower than the full first name (stubbed)`)
else ok(`zoom 1 buildStacks reserves the full-name width for all ${metas.length} desks (no 3-letter stub)`)

// ------------------------------------- 4. the default view fits / pans sanely
// Replayed per floor, per screen: the active floor's desks must all be on
// screen, every plate must stay inside the canvas, and no two plates may
// overlap. This is the headless twin of the screenshot review.

for (const f of FLOOR_IDS) {
  const floorMetas = metas.filter((m) => m.desk.floor === f)
  const size = worldSize(f)
  for (const scr of SCREENS) {
    const zoom = fitZoom(f, scr.canvasW, scr.canvasH)
    const vp: Viewport = { x: 0, z: 0, zoom, floor: f }
    const scale = plateScale(zoom)
    const mode = plateMode(zoom)
    const fits = size.w * zoom <= scr.canvasW && size.h * zoom <= scr.canvasH
    if (!fits && zoom > MIN_ZOOM) {
      fail(`${scr.name} L${f}: floor ${size.w * zoom}×${size.h * zoom} px does not fit the ${scr.canvasW}×${scr.canvasH} canvas at zoom ${zoom}`)
    } else if (fits) {
      ok(`${scr.name} L${f}: zoom ${zoom} → floor ${size.w * zoom}×${size.h * zoom} px inside ${scr.canvasW}×${scr.canvasH}`)
    } else {
      ok(`${scr.name} L${f}: zoom ${zoom} (minimum) → floor pans, every desk still on screen`)
    }

    let offscreen = 0
    for (const meta of floorMetas) {
      const seat = seatPoint(meta)
      const p = worldToScreen(vp, scr.canvasW, scr.canvasH, seat[0], seat[1])
      // the seat must be inside, and so must the head (16 world px above it)
      const headTop = p.y - CHIBI_H * zoom
      if (p.x < 0 || p.x > scr.canvasW || p.y < 0 || p.y > scr.canvasH || headTop < 0) {
        offscreen++
        fail(`${scr.name} L${f}: desk ${meta.id} is off-canvas at (${p.x.toFixed(0)},${p.y.toFixed(0)})`)
      }
    }
    if (offscreen === 0) ok(`${scr.name} L${f}: all ${floorMetas.length} desks and their heads are on screen`)

    // ----------------------------------------- 5. plates stay on screen
    const statuses = new Map<string, string>(
      floorMetas.map((m) => [m.id, m.id === 'edu-designer' ? 'offline' : 'working']),
    )
    const agents = labelsFor(vp, scr.canvasW, scr.canvasH, statuses)
    const reserved = zoneRects(vp, scr.canvasW, scr.canvasH)
    const stacks = buildStacks(agents, mode, scale)
    const placed = placeStacks(stacks, { w: scr.canvasW, h: scr.canvasH }, reserved, scale)

    let outside = 0
    for (const p of placed) {
      if (p.x < 1 || p.y < 1 || p.x + p.w > scr.canvasW - 1 || p.y + p.h > scr.canvasH - 1) {
        outside++
        fail(`${scr.name} L${f}: plate ${p.id}/${p.key} leaves the canvas (${p.x},${p.y} ${p.w}×${p.h})`)
      }
    }
    if (outside === 0) ok(`${scr.name} L${f}: all ${placed.length} plates inside ${scr.canvasW}×${scr.canvasH} (edges clamped, ≥1 px margin)`)

    // ----------------------------------------------- 6. no plate overlap
    let overlaps = 0
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!
        const b = placed[j]!
        if (rectsOverlap(a, b)) {
          overlaps++
          if (overlaps <= 5) fail(`${scr.name} L${f}: ${a.id}/${a.key} overlaps ${b.id}/${b.key}`)
        }
      }
    }
    if (overlaps === 0) ok(`${scr.name} L${f}: no two plates overlap (${placed.length} rects)`)

    let onPlaque = 0
    for (const p of placed) {
      for (const z of reserved) {
        if (rectsOverlap(p, z)) {
          onPlaque++
          fail(`${scr.name} L${f}: plate ${p.id}/${p.key} sits on a zone plaque`)
        }
      }
    }
    if (onPlaque === 0) ok(`${scr.name} L${f}: no plate covers a zone plaque`)

    // --------------------------- 7. nameplates fit their slot at 1×, read at 2×
    const slot = deskSlot(zoom)
    const widths = agents.map((a) => plateWidth(shortName(a.name), { dot: Boolean(a.dot), scale }))
    const widest = Math.max(...widths)
    if (scale === 1) {
      let tooWide = 0
      for (const a of agents) {
        const text = shortName(a.name)
        const w = plateWidth(text, { dot: Boolean(a.dot), scale })
        if (w > slot) {
          tooWide++
          fail(`${scr.name} L${f}: nameplate "${text}" is ${w} px wide, desk slot is ${slot.toFixed(1)} px`)
        }
        // the glyphs must fit the plate they are drawn into
        const glyphs = textWidth(text, scale)
        if (glyphs > w) {
          tooWide++
          fail(`${scr.name} L${f}: text "${text}" is ${glyphs} px, plate is ${w} px`)
        }
      }
      if (tooWide === 0) ok(`${scr.name} L${f}: ${agents.length} nameplates fit a ${slot.toFixed(1)} px desk slot (widest ${widest} px, no shredded glyphs)`)
    } else {
      // At zoom 1 the plan asks for a 2× font, so a plate is wider than the
      // 26 px desk pitch on purpose; placeStacks staggers the stacks and the
      // overlap check above is what guarantees they stay apart.
      if (widest > scr.canvasW - 2) fail(`${scr.name} L${f}: widest nameplate ${widest} px is wider than the canvas`)
      else
        ok(
          `${scr.name} L${f}: zoom ${zoom} font ×${scale}, widest nameplate ${widest} px vs ${slot.toFixed(1)} px desk pitch — staggered, overlap 0`,
        )
    }

    // every agent owns exactly one nameplate
    const names = placed.filter((p) => p.key === 'name')
    if (names.length !== agents.length) fail(`${scr.name} L${f}: ${names.length} nameplates drawn, want ${agents.length}`)
    else ok(`${scr.name} L${f}: one nameplate per desk (${names.length})`)

    const perId = new Set(names.map((p) => p.id))
    if (perId.size !== agents.length) fail(`${scr.name} L${f}: ${perId.size} desks have a nameplate, want ${agents.length}`)
  }
}

// ------------------------------- 8. offline vs idle is not colour-only

const vpL3: Viewport = { x: 0, z: 0, zoom: fitZoom(3, desktop.canvasW, desktop.canvasH), floor: 3 }
const vpL2: Viewport = { x: 0, z: 0, zoom: fitZoom(2, desktop.canvasW, desktop.canvasH), floor: 2 }
const statuses = new Map<string, string>()
for (const m of metas) statuses.set(m.id, m.id === 'edu-designer' ? 'offline' : m.id === 'coder' ? 'idle' : 'working')
const agentsL3 = labelsFor(vpL3, desktop.canvasW, desktop.canvasH, statuses)
const stacksL3 = buildStacks(agentsL3, plateMode(vpL3.zoom), plateScale(vpL3.zoom))

const idleStack = stacksL3.find((s) => s.id === 'coder')
if (!idleStack) fail('idle stack missing on L3 (coder must sit on L3)')
else {
  const idleKeys = idleStack.plates.map((p) => p.key)
  if (idleKeys.includes('zzz')) fail('idle desk must not show Zzz')
  else ok('idle desk has no Zzz — a shape cue, not just hue')
  const idleChip = agentsL3.find((a) => a.id === 'coder')!.chip
  if (idleChip !== 'idle') fail(`idle chip is "${idleChip}", want "idle"`)
  else ok(`idle desk carries the status word "idle"`)
}
const agentsL2 = labelsFor(vpL2, desktop.canvasW, desktop.canvasH, statuses)
const stacksL2 = buildStacks(agentsL2, plateMode(vpL2.zoom), plateScale(vpL2.zoom))
const offlineStack = stacksL2.find((s) => s.id === 'edu-designer')
if (!offlineStack) fail('offline stack missing on L2 (edu-designer must sit on L2)')
else {
  const offKeys = offlineStack.plates.map((p) => p.key)
  if (!offKeys.includes('zzz')) fail(`offline stack has no Zzz plate: ${offKeys.join(',')}`)
  else ok('offline desk carries a "Z Z Z" plate (no colour needed)')
  if (offKeys.includes('bubble')) fail('offline desk should not carry a speech bubble')
  const offlineChip = agentsL2.find((a) => a.id === 'edu-designer')!.chip
  if (offlineChip !== 'offline') fail(`offline chip is "${offlineChip}", want "offline"`)
  else ok(`status words differ: offline "offline" vs idle "idle"`)
}

// the zoom-1 (phone) mode still names every desk, with the full first name
const phoneStatuses = new Map<string, string>(metas.map((m) => [m.id, m.id === 'edu-designer' ? 'offline' : 'working']))
let phoneNamesOk = true
for (const f of FLOOR_IDS) {
  const pz = fitZoom(f, phone.canvasW, phone.canvasH)
  const agents = labelsFor({ x: 0, z: 0, zoom: pz, floor: f }, phone.canvasW, phone.canvasH, phoneStatuses)
  const stacks = buildStacks(agents, plateMode(pz), plateScale(pz))
  const named = stacks.filter((s) => s.plates.some((p) => p.key === 'name'))
  const want = metas.filter((m) => m.desk.floor === f).length
  if (named.length !== want) {
    phoneNamesOk = false
    fail(`L${f} zoom 1 names ${named.length} desks, want ${want}`)
  }
  if (stacks.some((s) => s.plates.some((p) => p.key === 'chip'))) {
    phoneNamesOk = false
    fail(`L${f} zoom 1 must not draw chips: the 2× plates already fill the screen`)
  }
}
if (phoneNamesOk) ok('zoom 1 (phone default) labels every desk on every floor, nameplates only')

// ------------------------------------------------------- 9. zone plaques exist
// One plaque per zone per floor, hung on the wall band, inside the floor.

const WANT_PLAQUES: Record<FloorId, string[]> = { 1: ['LOBBY', 'MASUK'], 2: ['TIM EDU'], 3: ['TIM DEV'] }
for (const f of FLOOR_IDS) {
  const labels = labelsOf(f)
  const texts = labels.map((l) => l.text)
  for (const want of WANT_PLAQUES[f]) {
    if (!texts.includes(want)) fail(`L${f} has no "${want}" plaque`)
  }
  for (const zl of labels) {
    if (zl.floor !== f) fail(`plaque ${zl.text} claims floor ${zl.floor} but labelsOf(${f}) returned it`)
    if (zl.x < -FLOORS[f].w / 2 || zl.x > FLOORS[f].w / 2 || zl.z < -FLOORS[f].d / 2 || zl.z > FLOORS[f].d / 2) {
      fail(`L${f} plaque ${zl.text} sits outside the floor`)
    }
  }
  ok(`L${f} plaques: ${texts.join(', ')} — all inside ${FLOORS[f].w}×${FLOORS[f].d}`)

  // at the desktop fit view every plaque is on screen and plates avoid it
  const dz = fitZoom(f, desktop.canvasW, desktop.canvasH)
  const vp: Viewport = { x: 0, z: 0, zoom: dz, floor: f }
  const reserved = zoneRects(vp, desktop.canvasW, desktop.canvasH)
  let plaqueOff = 0
  for (const r of reserved) {
    if (r.x < 1 || r.y < 1 || r.x + r.w > desktop.canvasW - 1 || r.y + r.h > desktop.canvasH - 1) plaqueOff++
  }
  if (plaqueOff) fail(`L${f}: ${plaqueOff} plaque(s) off-canvas at the desktop fit view`)
}

// ------------------------------------------- 10. layout constants stay honest

if (PLATE_H !== 11) fail(`PLATE_H = ${PLATE_H}, want 11`)
if (NAME_GAP < 1) fail('nameplates must float above the head, not sit on it')
else ok(`plate geometry: ${PLATE_H} px tall at 1×, ${NAME_GAP} px above the head`)

// ------------------------------------------------- 11. the lift on every floor
// The lift core follows the identical rule on all three floors: a shaft that
// is a real obstacle, a walkable nav node wired into that floor's graph, 1.0
// unit west of the door, inside the floor bounds (plan §Denah/Lift).

for (const f of FLOOR_IDS) {
  const lift = LIFT[f]
  if (!lift) fail(`L${f}: LIFT[${f}] missing`)
  else {
    const shaft = obstaclesOf(f).find((o) => o.id === `lift-${f}`)
    if (!shaft) fail(`L${f}: lift shaft is not an obstacle on this floor`)
    else if (Math.abs(shaft.x1 - lift.shaft.x1) > 1e-9 || Math.abs(shaft.z2 - lift.shaft.z2) > 1e-9) {
      fail(`L${f}: OBSTACLES lift-${f} != LIFT[${f}].shaft`)
    }
    const node = liftNode(f)
    const nav = navOf(f)
    const wired = nav.find((n) => n.id === node.id)
    if (!wired) fail(`L${f}: nav node ${node.id} missing`)
    else {
      if (wired.floor !== f) fail(`L${f}: lift nav node claims floor ${wired.floor}`)
      if (wired.x !== node.x || wired.z !== node.z) fail(`L${f}: lift nav node drifted from LIFT[${f}].node`)
      if (Math.abs(wired.x - (lift.doorX - 1)) > 1e-9) fail(`L${f}: lift node must stand 1.0 west of the door`)
      if (wired.z < -FLOORS[f].d / 2 || wired.z > FLOORS[f].d / 2) fail(`L${f}: lift node outside the floor`)
    }
    const shaftPxW = (lift.shaft.x2 - lift.shaft.x1) * 16
    const shaftPxH = (lift.shaft.z2 - lift.shaft.z1) * 16
    if (Math.abs(shaftPxW - 2.6 * 16) > 1e-9 || Math.abs(shaftPxH - 3.2 * 16) > 1e-9) {
      fail(`L${f}: shaft is ${shaftPxW}×${shaftPxH}px, want 2.6×3.2 world units`)
    }
  }
  ok(`L${f}: shaft lift = obstacle, node ${liftNode(f).id} (${liftNode(f).x},${liftNode(f).z}) walkable & wired`)
}

console.log(fails === 0 ? '\nVISUAL OK' : `\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
