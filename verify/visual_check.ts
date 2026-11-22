/**
 * Visual-geometry checker: proves — without a browser — the things the T1.9
 * review and the legibility pass found broken on a real screenshot.
 *
 *   1. all 13 desks are on screen at the default view (nothing cropped)
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
 *      fractional "50 %" view)
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
import {
  NAME_GAP,
  NAME_MAX,
  PLATE_H,
  WORLD_LABELS,
  ZONE_LABELS,
  buildStacks,
  deskSlot,
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
  FLOOR_D,
  FLOOR_W,
  MAX_ZOOM,
  MIN_ZOOM,
  WORLD_H,
  WORLD_W,
  clampZoom,
  fitZoom,
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
  // 1280×800 desktop: 280 px right rail + 56 px HUD + 56 px toolbar
  { name: 'desktop 1280×800', canvasW: 1280 - 280, canvasH: 800 - 56 - 56 },
  // 390×844 phone: 96 px HUD (brand + rooms) + 56 px bottom bar, full-bleed
  { name: 'mobile 390×844', canvasW: 390, canvasH: 844 - 96 - 56 },
]

/** Every agent's label descriptor at one viewport, exactly as render.ts builds it. */
function labelsFor(vp: Viewport, canvasW: number, canvasH: number, statuses: Map<string, string>): LabelAgent[] {
  const mode = plateMode(vp.zoom)
  return rosterAgents()
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

/** Zone plaques, placed like render.ts does (clamped into the canvas). */
function zoneRects(vp: Viewport, canvasW: number, canvasH: number): Rect[] {
  return WORLD_LABELS.map((zl) => {
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
const spots = new Set(metas.map((m) => `${m.desk.x},${m.desk.z}`))
if (spots.size !== metas.length) fail(`two desks share a position (${spots.size} unique of ${metas.length})`)
else ok('every desk has its own position')

// ------------------------------- 2. zoom is an integer 1..4, phone default 1

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
const phoneZoom = fitZoom(phone.canvasW, phone.canvasH)
if (phoneZoom !== 1) fail(`${phone.name}: default zoom is ${phoneZoom}, want 1 (integer, pan horizontal)`)
else if (!Number.isInteger(phoneZoom)) fail(`${phone.name}: default zoom ${phoneZoom} is not an integer`)
else ok(`${phone.name}: default zoom = ${phoneZoom} (integer, 448 px floor pans inside 390 px)`)

const desktopFit = fitZoom(SCREENS[0]!.canvasW, SCREENS[0]!.canvasH)
if (!Number.isInteger(desktopFit) || desktopFit < MIN_ZOOM || desktopFit > MAX_ZOOM) {
  fail(`desktop default zoom ${desktopFit} is outside the integer set 1..4`)
} else ok(`desktop 1280×800: default zoom = ${desktopFit} (integer)`)

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
const zoom1Agents = labelsFor({ x: 0, z: 0, zoom: 1 }, phone.canvasW, phone.canvasH, zoom1Statuses)
const zoom1Stacks = buildStacks(zoom1Agents, plateMode(1), plateScale(1))
const zoom1NameWidths = zoom1Stacks.map((s) => s.plates.find((p) => p.key === 'name')!.w)
const zoom1WantWidths = expectedNames.map((text) => plateWidth(text, { scale: plateScale(1) }))
const wantById = new Map(metas.map((m, i) => [m.id, zoom1WantWidths[i]!]))
const narrow = zoom1Stacks.filter((s, i) => zoom1NameWidths[i] !== wantById.get(s.id))
if (narrow.length) fail(`${narrow.length} zoom-1 nameplates are narrower than the full first name (stubbed)`)
else ok(`zoom 1 buildStacks reserves the full-name width for all ${metas.length} desks (no 3-letter stub)`)

// ------------------------------------- 4. the default view fits / pans sanely

for (const scr of SCREENS) {
  const zoom = fitZoom(scr.canvasW, scr.canvasH)
  const vp: Viewport = { x: 0, z: 0, zoom }
  const scale = plateScale(zoom)
  const mode = plateMode(zoom)
  // At zoom 1 the 448 px floor is wider than a 390 px screen: panning is
  // expected there, as long as every desk is still on screen.
  const fits = WORLD_W * zoom <= scr.canvasW && WORLD_H * zoom <= scr.canvasH
  if (!fits && zoom > MIN_ZOOM) {
    fail(`${scr.name}: floor ${WORLD_W * zoom}×${WORLD_H * zoom} px does not fit the ${scr.canvasW}×${scr.canvasH} canvas at zoom ${zoom}`)
  } else if (fits) {
    ok(`${scr.name}: zoom ${zoom} → floor ${WORLD_W * zoom}×${WORLD_H * zoom} px inside ${scr.canvasW}×${scr.canvasH}`)
  } else {
    ok(`${scr.name}: zoom ${zoom} (minimum) → floor pans, every desk still on screen`)
  }

  let offscreen = 0
  for (const meta of metas) {
    const seat = seatPoint(meta)
    const p = worldToScreen(vp, scr.canvasW, scr.canvasH, seat[0], seat[1])
    // the seat must be inside, and so must the head (16 world px above it)
    const headTop = p.y - CHIBI_H * zoom
    if (p.x < 0 || p.x > scr.canvasW || p.y < 0 || p.y > scr.canvasH || headTop < 0) {
      offscreen++
      fail(`${scr.name}: desk ${meta.id} is off-canvas at (${p.x.toFixed(0)},${p.y.toFixed(0)})`)
    }
  }
  if (offscreen === 0) ok(`${scr.name}: all ${metas.length} desks and their heads are on screen`)

  // ----------------------------------------- 5. plates stay on screen
  const statuses = new Map<string, string>(metas.map((m) => [m.id, m.id === 'edu-designer' ? 'offline' : 'working']))
  const agents = labelsFor(vp, scr.canvasW, scr.canvasH, statuses)
  const reserved = zoneRects(vp, scr.canvasW, scr.canvasH)
  const stacks = buildStacks(agents, mode, scale)
  const placed = placeStacks(stacks, { w: scr.canvasW, h: scr.canvasH }, reserved, scale)

  let outside = 0
  for (const p of placed) {
    if (p.x < 1 || p.y < 1 || p.x + p.w > scr.canvasW - 1 || p.y + p.h > scr.canvasH - 1) {
      outside++
      fail(`${scr.name}: plate ${p.id}/${p.key} leaves the canvas (${p.x},${p.y} ${p.w}×${p.h})`)
    }
  }
  if (outside === 0) ok(`${scr.name}: all ${placed.length} plates inside ${scr.canvasW}×${scr.canvasH} (edges clamped, ≥1 px margin)`)

  // ----------------------------------------------- 6. no plate overlap
  let overlaps = 0
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!
      const b = placed[j]!
      if (rectsOverlap(a, b)) {
        overlaps++
        if (overlaps <= 5) fail(`${scr.name}: ${a.id}/${a.key} overlaps ${b.id}/${b.key}`)
      }
    }
  }
  if (overlaps === 0) ok(`${scr.name}: no two plates overlap (${placed.length} rects)`)

  let onPlaque = 0
  for (const p of placed) {
    for (const z of reserved) {
      if (rectsOverlap(p, z)) {
        onPlaque++
        fail(`${scr.name}: plate ${p.id}/${p.key} sits on a zone plaque`)
      }
    }
  }
  if (onPlaque === 0) ok(`${scr.name}: no plate covers a zone plaque`)

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
        fail(`${scr.name}: nameplate "${text}" is ${w} px wide, desk slot is ${slot.toFixed(1)} px`)
      }
      // the glyphs must fit the plate they are drawn into
      const glyphs = textWidth(text, scale)
      if (glyphs > w) {
        tooWide++
        fail(`${scr.name}: text "${text}" is ${glyphs} px, plate is ${w} px`)
      }
    }
    if (tooWide === 0) ok(`${scr.name}: 13 nameplates fit a ${slot.toFixed(1)} px desk slot (widest ${widest} px, no shredded glyphs)`)
  } else {
    // At zoom 1 the plan asks for a 2× font, so a plate is wider than the
    // 26 px desk pitch on purpose; placeStacks staggers the 13 stacks and the
    // overlap check above is what guarantees they stay apart.
    if (widest > scr.canvasW - 2) fail(`${scr.name}: widest nameplate ${widest} px is wider than the canvas`)
    else
      ok(
        `${scr.name}: zoom ${zoom} font ×${scale}, widest nameplate ${widest} px vs ${slot.toFixed(1)} px desk pitch — staggered, overlap 0`,
      )
  }

  // every agent owns exactly one nameplate
  const names = placed.filter((p) => p.key === 'name')
  if (names.length !== metas.length) fail(`${scr.name}: ${names.length} nameplates drawn, want ${metas.length}`)
  else ok(`${scr.name}: one nameplate per desk (${names.length})`)

  const perId = new Set(names.map((p) => p.id))
  if (perId.size !== metas.length) fail(`${scr.name}: ${perId.size} desks have a nameplate, want ${metas.length}`)
}

// ------------------------------- 8. offline vs idle is not colour-only

const desktop = SCREENS[0]!
const vpDesktop: Viewport = { x: 0, z: 0, zoom: fitZoom(desktop.canvasW, desktop.canvasH) }
const statuses = new Map<string, string>()
for (const m of metas) statuses.set(m.id, m.id === 'edu-designer' ? 'offline' : m.id === 'coder' ? 'idle' : 'working')
const agents = labelsFor(vpDesktop, desktop.canvasW, desktop.canvasH, statuses)
const stacks = buildStacks(agents, plateMode(vpDesktop.zoom), plateScale(vpDesktop.zoom))

const offlineStack = stacks.find((s) => s.id === 'edu-designer')
const idleStack = stacks.find((s) => s.id === 'coder')
if (!offlineStack || !idleStack) fail('offline/idle stacks missing')
else {
  const offKeys = offlineStack.plates.map((p) => p.key)
  const idleKeys = idleStack.plates.map((p) => p.key)
  if (!offKeys.includes('zzz')) fail(`offline stack has no Zzz plate: ${offKeys.join(',')}`)
  else ok('offline desk carries a "Z Z Z" plate (no colour needed)')
  if (offKeys.includes('bubble')) fail('offline desk should not carry a speech bubble')
  if (idleKeys.includes('zzz')) fail('idle desk must not show Zzz')
  else ok('idle desk has no Zzz — the two states differ by shape, not just hue')

  const offlineChip = agents.find((a) => a.id === 'edu-designer')!.chip
  const idleChip = agents.find((a) => a.id === 'coder')!.chip
  if (offlineChip === idleChip) fail(`offline and idle share the chip text "${offlineChip}"`)
  else ok(`status words differ: offline "${offlineChip}" vs idle "${idleChip}"`)
}

// the zoom-1 (phone) mode still names every desk, with the full first name
const phoneAgents = labelsFor({ x: 0, z: 0, zoom: phoneZoom }, phone.canvasW, phone.canvasH, statuses)
const phoneStacks = buildStacks(phoneAgents, plateMode(phoneZoom), plateScale(phoneZoom))
const phoneNames = phoneStacks.filter((s) => s.plates.some((p) => p.key === 'name'))
if (phoneNames.length !== metas.length) fail(`zoom 1 names ${phoneNames.length} desks, want ${metas.length}`)
else ok('zoom 1 (phone default) labels all 13 desks')
if (phoneStacks.some((s) => s.plates.some((p) => p.key === 'chip'))) {
  fail('zoom 1 must not draw chips: the 2× plates already fill the screen')
} else ok('zoom 1 draws nameplates only')

// ------------------------------------------------------- 9. zone plaques exist

if (ZONE_LABELS.length !== 3) fail(`${ZONE_LABELS.length} zone plaques, want 3`)
else ok(`zone plaques: ${ZONE_LABELS.map((z) => z.text).join(', ')}`)
if (!WORLD_LABELS.some((z) => z.text === 'MASUK')) fail('the entrance plaque (MASUK) is gone')
const lobbyPlaque = ZONE_LABELS.find((z) => z.text === 'PENDOPO')
if (!lobbyPlaque) fail('the Pendopo zone has no plaque')
else ok('Pendopo has a plaque (it was the missing one)')
for (const zl of ZONE_LABELS) {
  if (zl.x < -FLOOR_W / 2 || zl.x > FLOOR_W / 2 || zl.z < -FLOOR_D / 2 || zl.z > FLOOR_D / 2) {
    fail(`zone plaque ${zl.text} sits outside the floor`)
  }
}

// ------------------------------------------- 10. layout constants stay honest

if (PLATE_H !== 11) fail(`PLATE_H = ${PLATE_H}, want 11`)
if (NAME_GAP < 1) fail('nameplates must float above the head, not sit on it')
else ok(`plate geometry: ${PLATE_H} px tall at 1×, ${NAME_GAP} px above the head`)

console.log(fails === 0 ? '\nVISUAL OK' : `\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
