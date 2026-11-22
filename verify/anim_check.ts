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
  WORLD_H,
  WORLD_W,
  blitScale,
  clampCenter,
  clampZoom,
  nearestAt,
  pixelToWorld,
  screenToWorld,
  worldToPixel,
  worldToScreen,
} from '../frontend/src/scene2d/viewport'

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
if (delegateUnknown.walkTo?.kind !== 'poi' || delegateUnknown.walkTo.id !== 'rapat') {
  fail(`unknown target → ${JSON.stringify(delegateUnknown.walkTo)}, want poi rapat`)
} else ok('unknown walk target → the meeting POI')

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

if (TILE !== 16) fail(`TILE = ${TILE}, want 16`)
const c = worldToPixel(0, 0)
if (c.x !== 224 || c.y !== 160) fail(`worldToPixel(0,0) = ${c.x},${c.y}, want 224,160`)
const nw = worldToPixel(-14, -10)
if (nw.x !== 0 || nw.y !== 0) fail(`worldToPixel(-14,-10) = ${nw.x},${nw.y}, want 0,0`)
const se = worldToPixel(14, 10)
if (se.x !== WORLD_W || se.y !== WORLD_H) fail(`worldToPixel(14,10) = ${se.x},${se.y}, want ${WORLD_W},${WORLD_H}`)
ok('world→pixel: TILE 16, floor 28×20 → 448×320, corners exact')

let roundtripOk = true
for (const [x, z] of [[0, 0], [-3.7, 6.2], [12.9, -8.4], [-14, -10], [14, 10]] as Array<[number, number]>) {
  const p = worldToPixel(x, z)
  const back = pixelToWorld(p.x, p.y)
  if (!near(back.x, x) || !near(back.z, z)) {
    roundtripOk = false
    fail(`roundtrip (${x},${z}) → (${back.x.toFixed(2)},${back.z.toFixed(2)})`)
  }
}
if (roundtripOk) ok('world→pixel→world roundtrips for sampled points')

const vp = { x: -1.2, z: 3.4, zoom: 2 }
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

// --------------------------------------------------------------- 7. hit test

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

const big = { x: 999, z: -999, zoom: 2 }
const clamped = clampCenter(big, 800, 600)
const visW = 800 / 2
const visH = 600 / 2
if (clamped.x > 14 - visW / 2 || clamped.x < -(14 - visW / 2)) fail(`clampCenter x out of range: ${clamped.x}`)
if (clamped.z > 10 - visH / 2 || clamped.z < -(10 - visH / 2)) fail(`clampCenter z out of range: ${clamped.z}`)
else ok('pan is clamped so the floor never leaves the view at minimum zoom')

// --------------------------------------------------------------- final verdict

console.log(fails === 0 ? '\nANIM OK' : `\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
