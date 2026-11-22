/**
 * Animation & viewport checker: proves the pure behaviour of the 2D scene
 * without a browser — the pose mapping from /api/status, the world↔pixel
 * transform, integer zoom clamping and determinism.
 *
 *   frontend/node_modules/.bin/esbuild verify/anim_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/anim_check.mjs
 *   node /tmp/anim_check.mjs
 */
import type { Agent, Comm } from '../frontend/src/lib/types'
import {
  blockedChipText,
  poseFor,
  type PoseKind,
} from '../frontend/src/scene2d/anim'
import {
  TILE,
  blitScale,
  clampCenter,
  clampZoom,
  fitZoom,
  nearestAt,
  pixelToWorld,
  screenToWorld,
  worldToPixel,
  worldToScreen,
  worldSize,
} from '../frontend/src/scene2d/viewport'
import { FLOORS, type FloorId } from '../frontend/src/lib/rooms'
import { glyphFor, textWidth } from '../frontend/src/scene2d/pixelfont'
import { PALETTE, STATUS, TEAM } from '../frontend/src/scene2d/palette'

let fails = 0
const fail = (msg: string) => {
  fails++
  console.log('FAIL', msg)
}
const ok = (msg: string) => console.log('ok  ', msg)

const near = (a: number, b: number, eps = 0.001) => Math.abs(a - b) < eps

// ------------------------------------------------------------- test fixtures

const agent = (o: Partial<Agent> & { id: string; status: Agent['status'] }): Agent => ({
  id: o.id,
  status: o.status,
  last_active: 0,
  current: null,
  today: { sessions: 0, messages: 0, tool_calls: 0, tokens: 0, hourly: [] },
  total: { sessions: 0, messages: 0 },
  task: null,
  source: null,
  blocked: null,
  ...o,
})

const comm = (o: Partial<Comm> & { from: string; to: string }): Comm => ({
  ts: 0,
  kind: 'delegate',
  task: 't-1',
  ...o,
})

const NOW = 1_700_000_000

// ---------------------------------------------------- 1. the pose mapping table

const offline = poseFor(agent({ id: 'a', status: 'offline' }), NOW, [])
if (offline.kind !== 'offline') fail(`offline → ${offline.kind}, want offline`)
else ok('offline → empty chair, dimmed')

const blocked = poseFor(
  agent({ id: 'a', status: 'blocked', blocked: { reason: 'menunggu izin bos', since: NOW - 60, tools: 2 } }),
  NOW,
  [],
)
if (blocked.kind !== 'blocked') fail(`blocked → ${blocked.kind}, want blocked`)
else ok('blocked → yellow chip + pulse')
const chip = blockedChipText(
  agent({ id: 'a', status: 'blocked', blocked: { reason: 'menunggu izin bos', since: NOW - 60, tools: 2 } }),
)
if (!chip || chip.includes('menunggu izin bos') || chip.toLowerCase().includes('izin bos')) {
  fail(`blocked chip leaks the raw reason: "${chip}"`)
} else ok(`blocked chip is generic: "${chip}"`)

const typing = poseFor(
  agent({ id: 'a', status: 'working', current: { kind: 'tool', tools: ['terminal'] } }),
  NOW,
  [],
)
if (typing.kind !== 'typing' || !typing.typing || typing.tool !== 'terminal') {
  fail(`working+terminal → ${JSON.stringify(typing)}, want typing/typing/terminal`)
} else ok('working + terminal → typing, tool=terminal')

const reading = poseFor(
  agent({ id: 'a', status: 'working', current: { kind: 'tool', tools: ['read_file'] } }),
  NOW,
  [],
)
if (reading.kind !== 'reading' || !reading.reading) fail(`working+read_file → ${JSON.stringify(reading)}`)
else ok('working + read_file → reading')

const reviewingType = poseFor(
  agent({ id: 'a', status: 'reviewing', current: { kind: 'tool', tools: ['patch'] } }),
  NOW,
  [],
)
if (reviewingType.kind !== 'typing') fail(`reviewing+patch → ${reviewingType.kind}, want typing`)
else ok('reviewing + typing tool → typing (hands win over the diff)')

const reviewingPlain = poseFor(
  agent({ id: 'a', status: 'reviewing', current: { kind: 'tool', tools: [] } }),
  NOW,
  [],
)
if (reviewingPlain.kind !== 'reading' || !reviewingPlain.magnifier) {
  fail(`reviewing no tool → ${JSON.stringify(reviewingPlain)}, want reading+magnifier`)
} else ok('reviewing without a matching tool → reading + magnifier')

const workingGeneric = poseFor(
  agent({ id: 'a', status: 'working', current: { kind: 'tool', tools: ['some_other'] } }),
  NOW,
  [],
)
if (workingGeneric.kind !== 'working') fail(`working+other → ${workingGeneric.kind}, want working`)
else ok('working with an unknown tool → generic working pose')

const workingEmpty = poseFor(agent({ id: 'a', status: 'working', current: null }), NOW, [])
if (workingEmpty.kind !== 'working') fail(`working no current → ${workingEmpty.kind}, want working`)
else ok('working without a current tool → generic working pose')

// ----------------------------------------------------------- 2. delegation walk

const delegateTool = poseFor(
  agent({ id: 'dev', status: 'working', current: { kind: 'tool', tools: ['delegate_task'] } }),
  NOW,
  [comm({ from: 'dev', to: 'coder', ts: NOW - 5 })],
)
if (delegateTool.kind !== 'walk' || delegateTool.walkTo?.kind !== 'desk' || delegateTool.walkTo.id !== 'coder') {
  fail(`delegate_task → ${JSON.stringify(delegateTool)}, want walk to desk coder`)
} else ok('delegate_task + comm → walk to the target desk')

const delegateCommOnly = poseFor(
  agent({ id: 'dev', status: 'idle', current: null }),
  NOW,
  [comm({ from: 'dev', to: 'coder', ts: NOW - 5 })],
)
if (delegateCommOnly.kind !== 'walk') fail(`comm delegate (idle) → ${delegateCommOnly.kind}, want walk`)
else ok('a recent delegate comm alone → walk, even when idle')

const delegateUnknown = poseFor(
  agent({ id: 'dev', status: 'working', current: { kind: 'tool', tools: ['delegate_task'] } }),
  NOW,
  [comm({ from: 'dev', to: 'ghost-unknown', ts: NOW - 5 })],
)
if (delegateUnknown.walkTo?.kind !== 'poi' || delegateUnknown.walkTo.id !== 'standup') {
  fail(`unknown target → ${JSON.stringify(delegateUnknown.walkTo)}, want poi standup (dev walks on L3)`)
} else ok("unknown walk target → the meeting POI on the walker's own floor (standup on L3)")

const staleComm = poseFor(
  agent({ id: 'dev', status: 'idle', current: null }),
  NOW,
  [comm({ from: 'dev', to: 'coder', ts: NOW - 60 })],
)
if (staleComm.kind !== 'idle') fail(`stale comm → ${staleComm.kind}, want idle (not walk)`)
else ok('a delegate comm older than 30 s → no walk')

// -------------------------------------------------------------- 3. idle/reply

const reply = poseFor(
  agent({ id: 'a', status: 'idle', current: { kind: 'reply', tools: [] } }),
  NOW,
  [],
)
if (reply.kind !== 'relax') fail(`reply+idle → ${reply.kind}, want relax`)
else ok('reply + idle → relaxed bob/coffee pose')

const idle = poseFor(agent({ id: 'a', status: 'idle', current: null }), NOW, [])
if (idle.kind !== 'idle') fail(`idle no current → ${idle.kind}, want idle`)
else ok('idle without a current tool → idle bob')

// -------------------------------------------------------------- 4. determinism

const p1 = JSON.stringify(poseFor(agent({ id: 'dev', status: 'working', current: { kind: 'tool', tools: ['terminal'] } }), NOW, []))
const p2 = JSON.stringify(poseFor(agent({ id: 'dev', status: 'working', current: { kind: 'tool', tools: ['terminal'] } }), NOW, []))
if (p1 !== p2) fail('poseFor is not deterministic')
else ok('poseFor is deterministic for the same input')

// ------------------------------------------------------- 5. world ↔ pixel math
// per floor: L1 28×20 → 448×320, L2 20×16 → 320×256, L3 24×18 → 384×288

if (TILE !== 16) fail(`TILE = ${TILE}, want 16`)
const FLOOR_PX: Array<[FloorId, number, number]> = [
  [1, 448, 320],
  [2, 320, 256],
  [3, 384, 288],
]
for (const [f, w, h] of FLOOR_PX) {
  const size = worldSize(f)
  if (size.w !== w || size.h !== h) fail(`L${f} worldSize = ${size.w}×${size.h}, want ${w}×${h}`)
  const c = worldToPixel(0, 0, f)
  if (c.x !== w / 2 || c.y !== h / 2) fail(`L${f} worldToPixel(0,0) = ${c.x},${c.y}, want ${w / 2},${h / 2}`)
  const nw = worldToPixel(-FLOORS[f].w / 2, -FLOORS[f].d / 2, f)
  if (nw.x !== 0 || nw.y !== 0) fail(`L${f} NW corner = ${nw.x},${nw.y}, want 0,0`)
  const se = worldToPixel(FLOORS[f].w / 2, FLOORS[f].d / 2, f)
  if (se.x !== w || se.y !== h) fail(`L${f} SE corner = ${se.x},${se.y}, want ${w},${h}`)
}
ok('world→pixel: TILE 16; L1 448×320, L2 320×256, L3 384×288; corners exact')

let roundtripOk = true
for (const [f, , ] of FLOOR_PX) {
  const halfW = FLOORS[f].w / 2
  const halfD = FLOORS[f].d / 2
  for (const [x, z] of [[0, 0], [-3.7, 6.2], [halfW - 1.1, -halfD + 1.6], [-halfW, -halfD], [halfW, halfD]] as Array<[number, number]>) {
    const p = worldToPixel(x, z, f)
    const back = pixelToWorld(p.x, p.y, f)
    if (!near(back.x, x) || !near(back.z, z)) {
      roundtripOk = false
      fail(`L${f} roundtrip (${x},${z}) → (${back.x.toFixed(2)},${back.z.toFixed(2)})`)
    }
  }
}
if (roundtripOk) ok('world→pixel→world roundtrips on sampled points of every floor')

const vp = { x: -1.2, z: 3.4, zoom: 2, floor: 1 as FloorId }
const w = 800
const h = 600
let screenOk = true
for (const [sx, sy] of [[400, 300], [12, 580], [790, 7]] as Array<[number, number]>) {
  const world = screenToWorld(vp, w, h, sx, sy)
  const back = worldToScreen(vp, w, h, world.x, world.z)
  if (!near(back.x, sx) || !near(back.y, sy)) {
    screenOk = false
    fail(`screen roundtrip (${sx},${sy}) → (${back.x.toFixed(2)},${back.y.toFixed(2)})`)
  }
}
if (screenOk) ok('screen→world→screen roundtrips through the viewport')

// -------------------------------------------------------------- 6. zoom clamp

const zooms: Array<[number, number]> = [[0, 1], [1, 1], [1.4, 1], [1.6, 2], [2.4, 2], [3, 3], [4, 4], [9, 4], [-2, 1]]
let clampOk = true
for (const [input, want] of zooms) {
  const got = clampZoom(input)
  if (got !== want) {
    clampOk = false
    fail(`clampZoom(${input}) = ${got}, want ${want}`)
  }
}
if (clampOk) ok('zoom clamps to the integer range 1..4')

if (blitScale(2, 1.5) !== 3) fail(`blitScale(2,1.5) = ${blitScale(2, 1.5)}, want 3`)
if (blitScale(1, 0.5) !== 1) fail(`blitScale(1,0.5) = ${blitScale(1, 0.5)}, want 1`)
else ok('DPR blit factor is an integer ≥ 1')

// ------------------------------------------------------------- 6b. default zoom
// The default view fits the whole floor: desktop 1000×688 → zoom 2 on every
// floor; mobile 390×692 → zoom 1 (pan, never a fractional "50 %").

let fitOk = true
for (const [f] of FLOOR_PX) {
  const desk = fitZoom(f, 1000, 688)
  const phone = fitZoom(f, 390, 692)
  if (desk !== 2) {
    fitOk = false
    fail(`L${f} fitZoom(1000×688) = ${desk}, want 2`)
  }
  if (phone !== 1) {
    fitOk = false
    fail(`L${f} fitZoom(390×692) = ${phone}, want 1`)
  }
}
if (fitOk) ok('default zoom: 1000×688 desktop → 2, 390×692 mobile → 1, on all three floors')

// ---------------------------------------------------------------- 7. hit test

const pts = [
  { id: 'a', x: 0, z: 0 },
  { id: 'b', x: 3, z: 0 },
  { id: 'c', x: 0, z: 3 },
]
if (nearestAt(pts, 0.2, 0.1, 0.9) !== 'a') fail('nearestAt should pick a (0.2,0.1)')
if (nearestAt(pts, 2.9, 0.1, 0.9) !== 'b') fail('nearestAt should pick b (2.9,0.1)')
if (nearestAt(pts, 5, 5, 0.9) !== null) fail('nearestAt should miss far from everyone')
else ok('hit-test picks the nearest agent within 0.9 units')

// ---------------------------------------------------------------- 8. pan clamp

const big = { x: 999, z: -999, zoom: 2, floor: 1 as FloorId }
const clamped = clampCenter(big, 800, 600)
const visW = 800 / 2 / TILE // visible world extent
const visH = 600 / 2 / TILE
const halfW = FLOORS[1].w / 2
const halfD = FLOORS[1].d / 2
if (clamped.zoom !== 2) fail(`clampCenter changed zoom: ${clamped.zoom}`)
if (clamped.floor !== 1) fail(`clampCenter changed floor: ${clamped.floor}`)
if (clamped.x > halfW - visW / 2 + 0.001 || clamped.x < -(halfW - visW / 2) - 0.001) {
  fail(`clampCenter x out of range: ${clamped.x.toFixed(2)} (want ±${(halfW - visW / 2).toFixed(2)})`)
}
if (clamped.z > halfD - visH / 2 + 0.001 || clamped.z < -(halfD - visH / 2) - 0.001) {
  fail(`clampCenter z out of range: ${clamped.z.toFixed(2)} (want ±${(halfD - visH / 2).toFixed(2)})`)
}
// when the whole floor fits, the centre is pinned to the origin (L2 20 wide
// at zoom 1 inside a 400 px view: 400/16 = 25 ≥ 20)
const fit2 = clampCenter({ x: 5, z: 5, zoom: 1, floor: 2 }, 400, 400)
if (fit2.x !== 0 || fit2.z !== 0) fail(`clampCenter should pin centre to origin when the floor fits: ${fit2.x},${fit2.z}`)
else ok('pan is clamped so the floor never leaves the view; centre pinned when it fits')

// --------------------------------------------------------------- 9. pixel font

if (textWidth('TEST') !== (4 * 6 - 1)) fail(`textWidth(TEST) = ${textWidth('TEST')}, want 23`)
if (textWidth('TEST', 2) !== 46) fail(`textWidth(TEST,2) = ${textWidth('TEST', 2)}, want 46`)
if (textWidth('') !== 0) fail('textWidth("") should be 0')
if (textWidth('AB') !== (2 * 6 - 1)) fail(`textWidth(AB) = ${textWidth('AB')}, want 11`)
if (glyphFor('a').rows.join() !== glyphFor('A').rows.join()) fail('glyphFor is not case-insensitive')
if ((glyphFor('A').rows[0] ?? 0) === 0) fail('glyph A has an empty first row')
else ok(`pixel font: 5×7 glyphs, textWidth("TEST")=${textWidth('TEST')}, deterministic`)

// --------------------------------------------------------------- 10. palette

if (TEAM.lobby !== '#D4805C' || TEAM.dev !== '#82AAC8' || TEAM.edu !== '#DEB860') {
  fail('team accents drifted from design §2.7')
}
if (STATUS.blocked !== '#FFC93B') fail('blocked chip colour drifted from design §2.2')
if (PALETTE.concrete900 !== '#121924' || PALETTE.concrete500 !== '#3B4A5E') fail('core concrete ramp drifted from design §2.1')
if (PALETTE.glass500 !== '#456E8F' || PALETTE.steel500 !== '#525F6D') fail('glass/steel tones drifted from design §2.1')
if (PALETTE.lamp !== '#F2E7C4' || PALETTE.amber !== '#E8A33D') fail('lamp/amber accents drifted from design §2.1')
else ok('palette matches the design tokens (concrete ramp, glass, steel, lamp, amber)')

// --------------------------------------------------------- 11. lift journeys
// Cross-floor delegation is a lift journey (plan §Lift): walk to the lift on
// the home floor, dwell exactly LIFT_DWELL with the doors open and a floor-only
// chip, walk on the target floor, stand, walk back, dwell, walk home. Same-floor
// delegation keeps the old out/stand/back loop with no lift step at all.

import { LIFT_DWELL, journeyAt, journeyFor, liftChip } from '../frontend/src/scene2d/journey'
import { DESK_EXIT, LIFT } from '../frontend/src/lib/rooms'
import { agentMeta, hashId } from '../frontend/src/lib/roster'

const pathLenOf = (path: Array<[number, number]>) => {
  let L = 0
  for (let i = 0; i < path.length - 1; i++) L += Math.hypot(path[i + 1]![0] - path[i]![0], path[i + 1]![1] - path[i]![1])
  return L
}

const devMeta = agentMeta('dev') // Bima, desk on L3

// --- cross-floor: dev (L3) delegates to default (Ndoro, desk on L1)

const xj = journeyFor(devMeta, { kind: 'desk', id: 'default' })
const xkinds = xj.steps.map((s) => s.kind).join(',')
if (xkinds !== 'walk,lift,walk,walk,lift,walk') {
  fail(`cross-floor journey = ${xkinds}, want walk,lift,walk,walk,lift,walk (A..G)`)
} else ok('cross-floor journey: segments A walk, B lift, C walk, D stand, E walk, F lift, G walk')

if (LIFT_DWELL !== 2.6) fail(`LIFT_DWELL = ${LIFT_DWELL}, want 2.6`)
else ok('LIFT_DWELL = 2.6')

const dwells = xj.steps.filter((s) => s.kind === 'lift')
if (dwells.length !== 2) fail(`cross-floor journey has ${dwells.length} lift steps, want 2`)
else {
  const [b, fseg] = dwells as Array<{ kind: 'lift'; floor: 1 | 2 | 3; to: 1 | 2 | 3; x: number; z: number; dur: number }>
  if (b!.dur !== 2.6 || fseg!.dur !== 2.6) fail(`lift dwells are ${b!.dur}/${fseg!.dur}, want 2.6/2.6`)
  else ok('both lift dwells are exactly 2.6 s')
  if (b!.floor !== 3 || b!.to !== 1) fail(`seg B = floor ${b!.floor}→${b!.to}, want 3→1`)
  if (fseg!.floor !== 1 || fseg!.to !== 3) fail(`seg F = floor ${fseg!.floor}→${fseg!.to}, want 1→3`)
  else ok('seg B dwells on L3 bound for L1; seg F dwells on L1 bound for L3')
  const node = LIFT[3]!.node
  if (b!.x !== node.x || b!.z !== node.z) fail(`seg B dwell position ${b!.x},${b!.z} != lift node ${node.x},${node.z}`)
  else ok('seg B dwells at the L3 lift node')
}

// segment D keeps the existing stand duration 5 + seed*4
const seed = (hashId('dev') % 1000) / 1000
const standWant = 5 + seed * 4
const segC = xj.steps[2]!
if (segC.kind !== 'walk' || segC.stand !== standWant) {
  fail(`seg C stand = ${segC.kind === 'walk' ? segC.stand : '?'}, want ${standWant}`)
} else ok(`seg D stand = 5+seed·4 = ${standWant.toFixed(2)} s`)

// the total covers the whole round trip: 2(tA+tC) + 2·2.6 + stand + rest
const tA = pathLenOf((xj.steps[0] as { kind: 'walk'; path: Array<[number, number]> }).path) / 1.8
const tC = pathLenOf((xj.steps[2] as { kind: 'walk'; path: Array<[number, number]> }).path) / 1.8
const tE = pathLenOf((xj.steps[3] as { kind: 'walk'; path: Array<[number, number]> }).path) / 1.8
const tG = pathLenOf((xj.steps[5] as { kind: 'walk'; path: Array<[number, number]> }).path) / 1.8
if (!(xj.total >= 2 * (tA + tC) + 2 * 2.6 + standWant - 1e-9)) {
  fail(`cross-floor total ${xj.total.toFixed(2)} < 2(tA+tC)+5.2+stand — the return leg is cut`)
} else ok(`cross-floor total ${xj.total.toFixed(2)} s covers out + dwell + stand + back + dwell + home`)
if (!(tE >= tC - 1e-9)) fail(`seg E (${tE.toFixed(2)}) should retrace seg C (${tC.toFixed(2)})`)

// journeyAt: dwell state, single floor, target-floor chip, determinism
const dwellAt = journeyAt(xj, tA + 1.0)
if (!dwellAt.inLift || dwellAt.liftTo !== 1 || dwellAt.floor !== 3 || dwellAt.walking) {
  fail(`mid-dwell state = ${JSON.stringify(dwellAt)}, want floor 3, inLift, liftTo 1, standing`)
} else ok('mid-dwell: standing in the lift on L3, liftTo = 1')

const liftChipText = liftChip(dwellAt.liftTo ?? 1)
if (!/^di lift · L[123]$/.test(liftChipText)) fail(`lift chip "${liftChipText}" must be only "di lift · L<floornum>"`)
else ok(`lift chip is generic: "${liftChipText}"`)

const midC = journeyAt(xj, tA + 2.6 + tC / 2)
if (midC.floor !== 1 || !midC.walking || midC.inLift) {
  fail(`mid-seg-C state = ${JSON.stringify(midC)}, want walking on L1`)
} else ok('seg C walks the target floor (L1)')

const midStand = journeyAt(xj, tA + 2.6 + tC + standWant / 2)
const exit1 = DESK_EXIT['default']!
if (midStand.floor !== 1 || midStand.walking || !near(midStand.x, exit1[0]) || !near(midStand.z, exit1[1])) {
  fail(`mid-stand state = ${JSON.stringify(midStand)}, want standing at the L1 target desk exit`)
} else ok('seg D stands at the target desk exit')

let floorsSeen = new Set<number>()
let singleFloorOk = true
let finiteOk = true
for (let i = 0; i < 600; i++) {
  const ph = (xj.total * i) / 600
  const st = journeyAt(xj, ph)
  floorsSeen.add(st.floor)
  if (!Number.isFinite(st.x) || !Number.isFinite(st.z)) finiteOk = false
}
if (!finiteOk) fail('journeyAt produced a non-finite position')
if (floorsSeen.size !== 2 || !floorsSeen.has(3) || !floorsSeen.has(1)) {
  fail(`cross-floor journey visits floors {${[...floorsSeen].join(',')}}, want exactly {1,3} — never two floors at once`)
} else ok('a cross-floor agent is drawn on exactly one floor at a time ({1,3} across the period)')

const j1 = JSON.stringify(journeyAt(xj, 3.21))
const j2 = JSON.stringify(journeyAt(xj, 3.21))
const f1 = JSON.stringify(journeyFor(devMeta, { kind: 'desk', id: 'default' }))
const f2 = JSON.stringify(journeyFor(devMeta, { kind: 'desk', id: 'default' }))
if (j1 !== j2 || f1 !== f2) fail('journey is not deterministic for the same agent + clock')
else ok('journey is deterministic from hashId(agent) + t (frozen under ?still=1)')

// --- same-floor: dev (L3) delegates to coder (Dimas, desk on L3)

const sj = journeyFor(devMeta, { kind: 'desk', id: 'coder' })
if (sj.steps.some((s) => s.kind === 'lift')) fail('same-floor journey must not contain a lift step')
else if (sj.steps.map((s) => s.kind).join(',') !== 'walk,walk') {
  fail(`same-floor journey = ${sj.steps.map((s) => s.kind).join(',')}, want walk,walk (out, back)`)
} else ok('same-floor journey keeps the out/stand/back loop — no lift step')
if (!sj.steps.every((s) => s.kind !== 'walk' || s.floor === 3)) fail('same-floor journey left L3')
let sfloors = new Set<number>()
for (let i = 0; i < 300; i++) sfloors.add(journeyAt(sj, (sj.total * i) / 300).floor)
if (sfloors.size !== 1) fail(`same-floor journey visited floors {${[...sfloors].join(',')}}, want only {3}`)

// --------------------------------------------------------------- final verdict

console.log(fails === 0 ? '\nANIM OK' : `\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
