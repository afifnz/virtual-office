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
import { clampCam, clampZoom, fitZoom, nearestAt } from '../frontend/src/scene2d/viewport'
import { glyphFor, textWidth } from '../frontend/src/scene2d/pixelfont'
import { TEAM, THEME_STATUS, THEME_TOKENS } from '../frontend/src/scene2d/palette'
import { avatarKey } from '../frontend/src/scene2d/avatar'
import { sideRows, sideTransform, designToScreen, screenToDesign, PHONE_CTRL_BAND, sideScale } from '../frontend/src/scene2d/side'
import { rosterAgents } from '../frontend/src/lib/roster'

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

// --------------------------------------------------- 2b. waiting / stale truth

// The parent of a running subagent sits back and waits: no delegate walk, no
// tool chip — even though current.tools is still ['delegate_task'].
const waiting = poseFor(
  agent({
    id: 'dev',
    status: 'waiting',
    current: { kind: 'tool', tools: ['delegate_task'] },
    children: { total: 2, running: 1 },
  }),
  NOW,
  [comm({ from: 'dev', to: 'planner', ts: NOW - 5 })],
)
if (waiting.kind !== 'relax' || waiting.tool !== '' || waiting.comming) {
  fail(`waiting → ${JSON.stringify(waiting)}, want a relaxed seat with no tool chip`)
} else ok('waiting on children → seated relax pose (no walk, no tool chip)')

// A stale verdict must not animate as typing: the desk is quiet, not busy.
const staleWorking = poseFor(
  agent({
    id: 'dev',
    status: 'working',
    current: { kind: 'tool', tools: ['terminal'] },
    stale: true,
  }),
  NOW,
  [comm({ from: 'dev', to: 'coder', ts: NOW - 5 })],
)
if (staleWorking.kind !== 'idle' || staleWorking.typing) {
  fail(`stale working → ${JSON.stringify(staleWorking)}, want idle`)
} else ok('stale working verdict → idle pose (never typing, never a delegate walk)')

// The real backend row is already demoted to idle + stale:true — same pose.
const staleReal = poseFor(
  agent({ id: 'dev', status: 'idle', stale: true, last_kind: 'tool_result', current: { kind: 'tool_result', tools: ['terminal'] } }),
  NOW,
  [],
)
if (staleReal.kind !== 'idle') fail(`real stale row → ${staleReal.kind}, want idle`)
else ok('real stale row (idle + stale) → idle pose')

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

// ------------------------------------------------------- 5. side camera
// The stage is 1000×688 design px; zoom 2 is 150 px/unit on both axes.
const tr = sideTransform(1000, 688, { camX: 500, zoom: 2, floor: 3 })
if (!near(tr.s, 1) || !near(tr.ppu, 150) || !near(tr.top, 0)) {
  fail(`sideTransform(1000×688, zoom 2) = s ${tr.s}, ppu ${tr.ppu}, top ${tr.top}; want 1 / 150 / 0`)
} else ok('side camera: 1000×688 at zoom 2 → s=1, 150 px/unit, top=0')
const p170 = designToScreen(tr, 170, 640)
if (!near(p170.x, 170) || !near(p170.y, 640)) fail(`designToScreen(170,640) = ${p170.x},${p170.y}`)
else ok('design→screen is identity at the reference camera (slot 170, floor line 640)')
const back = screenToDesign(tr, p170.x, p170.y)
if (!near(back.x, 170) || !near(back.y, 640)) fail(`screenToDesign roundtrip = ${back.x},${back.y}`)
else ok('screen→design roundtrips through the side transform')

// zoom 1 is half scale and still fits the 688 px stage
const tr1 = sideTransform(1000, 688, { camX: 500, zoom: 1, floor: 1 })
if (!near(tr1.s, 0.5) || !near(tr1.ppu, 75)) fail(`zoom 1: s ${tr1.s}, ppu ${tr1.ppu}`)
else ok('zoom 1: 75 px/unit (half scale), stage still 344 px tall')

// -------------------------------------------------------------- 6. zoom clamp
const zooms: Array<[number, number]> = [[0, 1], [1, 1], [1.4, 1], [1.6, 2], [2, 2], [9, 2], [-2, 1]]
let clampOk = true
for (const [input, want] of zooms) {
  const got = clampZoom(input)
  if (got !== want) {
    clampOk = false
    fail(`clampZoom(${input}) = ${got}, want ${want}`)
  }
}
if (clampOk) ok('zoom clamps to the integer range 1..2 (the camera is a fixed section)')

// ------------------------------------------------------------- 6b. default zoom
if (fitZoom(3, 1000, 688) !== 2) fail(`fitZoom(1000×688) = ${fitZoom(3, 1000, 688)}, want 2`)
else if (fitZoom(3, 720, 688) !== 2) fail(`fitZoom(720×688, no band) = ${fitZoom(3, 720, 688)}, want 2`)
else if (fitZoom(3, 390, 692) !== 1) fail(`fitZoom(390×692, no band) = ${fitZoom(3, 390, 692)}, want 1`)
else ok('default zoom (non-phone): 1000×688 desktop → 2, a narrow window without the phone band → 1')

// the phone default is the WHOLE FLOOR: 0.39 CSS px per design px at 390×692,
// i.e. zoom 0.78, an avatar 58.5 CSS px (the R&D mockup's 55–60)
const phoneFit = fitZoom(3, 390, 692, PHONE_CTRL_BAND)
if (!near(phoneFit, 0.78)) fail(`phone fitZoom(390×692, band) = ${phoneFit}, want 0.78`)
else if (!near(sideScale(390, 692, phoneFit, PHONE_CTRL_BAND), 0.39, 0.001)) {
  fail(`phone fit scale = ${sideScale(390, 692, phoneFit, PHONE_CTRL_BAND)}, want 0.39`)
} else ok(`phone default zoom: 390×692 with the control band → ${phoneFit} (fit-to-floor, avatar ${150 * 0.39} px)`)

// a phone zoom is fractional: the fit is the floor, zoom 2 the reference camera
if (clampZoom(0.5, 0.78) !== 0.78) fail(`phone clampZoom(0.5) = ${clampZoom(0.5, 0.78)}, want 0.78 (the fit)`)
else if (!near(clampZoom(1.337, 0.78), 1.34)) fail(`phone clampZoom(1.337) = ${clampZoom(1.337, 0.78)}, want 1.34`)
else if (clampZoom(9, 0.78) !== 2) fail(`phone clampZoom(9) = ${clampZoom(9, 0.78)}, want 2`)
else ok('phone zoom clamps between the fit (0.78) and 2, keeping fractions')

// ---------------------------------------------------------------- 7. hit test
const pts = [
  { id: 'a', x: 0, z: 0 },
  { id: 'b', x: 3, z: 0 },
  { id: 'c', x: 0, z: 3 },
]
if (nearestAt(pts, 0.2, 0.1, 0.9) !== 'a') fail('nearestAt should pick a (0.2,0.1)')
if (nearestAt(pts, 2.9, 0.1, 0.9) !== 'b') fail('nearestAt should pick b (2.9,0.1)')
if (nearestAt(pts, 5, 5, 0.9) !== null) fail('nearestAt should miss far from everyone')
else ok('hit-test picks the nearest agent within 0.9 world units')

// ---------------------------------------------------------------- 8. pan clamp
if (!near(clampCam(999, 1000, 688, 2), 500)) fail(`clampCam(999, 1000 wide, zoom 2) = ${clampCam(999, 1000, 688, 2)}, want 500`)
else ok('pan is pinned at the stage centre when the stage exactly fills the canvas')
const lo = clampCam(-999, 390, 692, 1)
const hi = clampCam(999, 390, 692, 1)
if (!near(lo, 390) || !near(hi, 610)) fail(`clampCam at zoom 1 / 390 wide = ${lo}..${hi}, want 390..610`)
else ok(`pan clamp at 390 px / zoom 1: camX ${lo}..${hi} (stage 500 px, never leaves the view)`)

// the phone fit is exactly as wide as the canvas: no pan until the user zooms
const fitCam = clampCam(999, 390, 692, phoneFit, PHONE_CTRL_BAND)
if (!near(fitCam, 500)) fail(`phone clampCam at the fit = ${fitCam}, want 500 (nothing to pan)`)
else ok('pan is locked at the phone fit (stage 390 px = canvas 390 px)')
const z2lo = clampCam(0, 390, 692, 2, PHONE_CTRL_BAND)
const z2hi = clampCam(999, 390, 692, 2, PHONE_CTRL_BAND)
if (!(z2lo < 500 && z2hi > 500)) {
  fail(`phone pan at zoom 2 is clamped to ${z2lo}..${z2hi} — wants room either side of the centre`)
} else {
  ok(`phone pan at zoom 2: camX ${z2lo}..${z2hi} (stage ${(1000 * sideScale(390, 692, 2, PHONE_CTRL_BAND)).toFixed(0)} px wide, pan both ways)`)
}

// --------------------------------------------------------------- 9. pixel font
if (textWidth('TEST') !== (4 * 6 - 1)) fail(`textWidth(TEST) = ${textWidth('TEST')}, want 23`)
if (textWidth('TEST', 2) !== 46) fail(`textWidth(TEST,2) = ${textWidth('TEST', 2)}, want 46`)
if (textWidth('') !== 0) fail('textWidth("") should be 0')
if (glyphFor('a').rows.join() !== glyphFor('A').rows.join()) fail('glyphFor is not case-insensitive')
else ok('pixel font: 5×7 glyphs, deterministic, used only for plaque + lift numbers')

// --------------------------------------------------------------- 10. palette
if (TEAM.lobby !== '#D4805C' || TEAM.dev !== '#82AAC8' || TEAM.edu !== '#DEB860') fail('team accents drifted')
if (THEME_STATUS.day.working !== '#8A5406' || THEME_STATUS.night.working !== '#F2B434') fail('status palette drifted')
if (THEME_STATUS.day.waiting !== '#9A3412' || THEME_STATUS.night.waiting !== '#FFA94D') fail('waiting palette drifted')
if (THEME_TOKENS.day.glass.alpha !== 0.66 || THEME_TOKENS.night.glass.alpha !== 0.62) fail('glass alpha drifted')
if (THEME_TOKENS.day.city.layers.length !== 4 || THEME_TOKENS.night.city.layers.length !== 4) fail('city layers drifted')
else ok('palette: two themes, published status colours, 4 city layers')

// ------------------------------------------------------- 10b. avatar keys
const lookKeys = new Set(rosterAgents().map((m) => avatarKey(m.look, 'seated', 0, 2)))
if (lookKeys.size !== 13) fail(`avatarKey unique ${lookKeys.size}/13`)
else ok('avatarKey is unique for all 13 looks (cache never mixes two agents)')

// ------------------------------------------------------- 10c. row resolver
const l3metas = rosterAgents().filter((m) => m.desk.floor === 3)
const rowsA = sideRows(l3metas)
const rowsB = sideRows([...l3metas].reverse())
if (rowsA.front.map((s) => s.meta.id).join(',') !== rowsB.front.map((s) => s.meta.id).join(',')) {
  fail('sideRows depends on input order (not deterministic)')
} else ok(`sideRows deterministic: front ${rowsA.front.map((s) => s.meta.id).join('/')} · back ${rowsA.back.map((s) => s.meta.id).join('/')}`)
if (rowsA.front.map((s) => s.cx).join(',') !== '170,370,570,770') fail(`L3 front slots ${rowsA.front.map((s) => s.cx).join(',')}`)
if (rowsA.back.map((s) => s.cx).join(',') !== '270,470,670,870') fail(`L3 back slots ${rowsA.back.map((s) => s.cx).join(',')}`)
else ok('L3 slots: front 170/370/570/770, back 270/470/670/870')

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
if (!/^DI LIFT · L[123]$/.test(liftChipText)) fail(`lift chip "${liftChipText}" must be only "DI LIFT · L<floornum>"`)
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
