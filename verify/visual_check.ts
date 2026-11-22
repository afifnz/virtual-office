/**
 * Visual-geometry checker: proves — without a browser — the six things the T1.9
 * review found broken on the production screenshot.
 *
 *   1. all 13 desks are on screen at the default view (nothing cropped)
 *   2. no nameplate/chip/bubble rect overlaps another plate or a zone plaque
 *   3. no plate leaves the canvas (the "labels spill off the mobile screen" bug)
 *   4. every nameplate is narrower than its desk slot (the garbled "OM BT" bug:
 *      plates wider than the desk pitch shred each other's glyphs)
 *   5. offline and idle are distinguishable without colour (empty seat + Zzz +
 *      a status word, not just a grey dot)
 *   6. the label text never exceeds the plate that carries it
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
  PLATE_H,
  WORLD_LABELS,
  ZONE_LABELS,
  buildStacks,
  deskSlot,
  placeStacks,
  plateMode,
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
  WORLD_H,
  WORLD_W,
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
  // 1280×800 desktop: 280 px sidebar + 52 px HUD + 56 px toolbar
  { name: 'desktop 1280×800', canvasW: 1280 - 280, canvasH: 800 - 52 - 56 },
  // 390×844 phone: 52 px HUD + 52 px toolbar, full-bleed width
  { name: 'mobile 390×844', canvasW: 390, canvasH: 844 - 52 - 52 },
]

/** Every agent's label descriptor at one viewport, exactly as render.ts builds it. */
function labelsFor(vp: Viewport, canvasW: number, canvasH: number, statuses: Map<string, string>): LabelAgent[] {
  const mode = plateMode(vp.zoom)
  return rosterAgents().map((meta) => {
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

// ------------------------------------------------- 2. the default view fits
// The default preset is "tampak": zoom-fit the whole floor. If a desk seat is
// outside the canvas the reviewer sees "only 5 of 13 desks" again.

for (const scr of SCREENS) {
  const zoom = fitZoom(scr.canvasW, scr.canvasH)
  const vp: Viewport = { x: 0, z: 0, zoom }
  // At 50 % (the phone minimum) the 448 px floor is wider than a 390 px screen:
  // panning is expected there, as long as every desk is still on screen.
  const fits = WORLD_W * zoom <= scr.canvasW && WORLD_H * zoom <= scr.canvasH
  if (!fits && zoom > 1) {
    fail(`${scr.name}: floor ${WORLD_W * zoom}×${WORLD_H * zoom} px does not fit the ${scr.canvasW}×${scr.canvasH} canvas at zoom ${zoom}`)
  } else if (fits) {
    ok(`${scr.name}: zoom-fit = ${zoom * 50}% → floor ${WORLD_W * zoom}×${WORLD_H * zoom} px inside ${scr.canvasW}×${scr.canvasH}`)
  } else {
    ok(`${scr.name}: zoom-fit = ${zoom * 50}% (minimum) → floor pans, every desk still on screen`)
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

  // -------------------------------------------------- 3. plates stay on screen
  const statuses = new Map<string, string>(metas.map((m) => [m.id, m.id === 'edu-designer' ? 'offline' : 'working']))
  const agents = labelsFor(vp, scr.canvasW, scr.canvasH, statuses)
  const reserved = zoneRects(vp, scr.canvasW, scr.canvasH)
  const stacks = buildStacks(agents, plateMode(zoom))
  const placed = placeStacks(stacks, { w: scr.canvasW, h: scr.canvasH }, reserved)

  let outside = 0
  for (const p of placed) {
    if (p.x < 0 || p.y < 0 || p.x + p.w > scr.canvasW || p.y + p.h > scr.canvasH) {
      outside++
      fail(`${scr.name}: plate ${p.id}/${p.key} leaves the canvas (${p.x},${p.y} ${p.w}×${p.h})`)
    }
  }
  if (outside === 0) ok(`${scr.name}: all ${placed.length} plates inside ${scr.canvasW}×${scr.canvasH}`)

  // ------------------------------------------------------- 4. no plate overlap
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

  // ------------------------------- 5. every nameplate fits its desk slot
  const slot = deskSlot(zoom)
  let tooWide = 0
  for (const a of agents) {
    const text = shortName(a.name, plateMode(zoom))
    const w = plateWidth(text, { dot: Boolean(a.dot) })
    if (w > slot) {
      tooWide++
      fail(`${scr.name}: nameplate "${text}" is ${w} px wide, desk slot is ${slot.toFixed(1)} px`)
    }
    // the glyphs must fit the plate they are drawn into
    const glyphs = textWidth(text, 1)
    if (glyphs > w) {
      tooWide++
      fail(`${scr.name}: text "${text}" is ${glyphs} px, plate is ${w} px`)
    }
  }
  if (tooWide === 0) ok(`${scr.name}: 13 nameplates fit a ${slot.toFixed(1)} px desk slot (no shredded glyphs)`)

  // every agent owns exactly one nameplate
  const names = placed.filter((p) => p.key === 'name')
  if (names.length !== metas.length) fail(`${scr.name}: ${names.length} nameplates drawn, want ${metas.length}`)
  else ok(`${scr.name}: one nameplate per desk (${names.length})`)

  const perId = new Set(names.map((p) => p.id))
  if (perId.size !== metas.length) fail(`${scr.name}: ${perId.size} desks have a nameplate, want ${metas.length}`)
}

// ------------------------------------- 6. offline vs idle is not colour-only

const desktop = SCREENS[0]!
const vpDesktop: Viewport = { x: 0, z: 0, zoom: fitZoom(desktop.canvasW, desktop.canvasH) }
const statuses = new Map<string, string>()
for (const m of metas) statuses.set(m.id, m.id === 'edu-designer' ? 'offline' : m.id === 'coder' ? 'idle' : 'working')
const agents = labelsFor(vpDesktop, desktop.canvasW, desktop.canvasH, statuses)
const stacks = buildStacks(agents, plateMode(vpDesktop.zoom))

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

// the compact mode (50 %) still names every desk
const compactStacks = buildStacks(agents, 'compact')
const compactNames = compactStacks.filter((s) => s.plates.some((p) => p.key === 'name'))
if (compactNames.length !== metas.length) fail(`compact mode names ${compactNames.length} desks, want ${metas.length}`)
else ok('compact (50 %) mode still labels all 13 desks')
if (compactStacks.some((s) => s.plates.some((p) => p.key === 'chip'))) {
  fail('compact mode must not draw chips: they do not fit a 26 px slot')
} else ok('compact mode draws nameplates only')

// ------------------------------------------------------- 7. zone plaques exist

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

// ------------------------------------------- 8. layout constants stay honest

if (PLATE_H !== 11) fail(`PLATE_H = ${PLATE_H}, want 11`)
if (NAME_GAP < 1) fail('nameplates must float above the head, not sit on it')
else ok(`plate geometry: ${PLATE_H} px tall, ${NAME_GAP} px above the head`)

console.log(fails === 0 ? '\nVISUAL OK' : `\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
