/**
 * Roster checker: proves /api/config drives the office and that a new agent is
 * placed on the 4.5 x 4.0 lattice with a clear aisle — without moving a single
 * existing desk. Hand-placed team desks are facing pods (see layout_check.ts).
 *
 *   frontend/node_modules/.bin/esbuild verify/roster_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/roster_check.mjs
 *   node /tmp/roster_check.mjs
 */
import { AGENTS } from '../frontend/src/lib/agents'
import { applyConfig, agentsFor, lookFor, officeTZ, resolveAgentId, rosterAgents } from '../frontend/src/lib/roster'
import { DEFAULT_GRID, clearance, deskObstacle, segRectDist, type Obstacle } from '../frontend/src/lib/layout'
import { BLOCK_GAP, CLUSTERS, FLOOR, NAV, NAV_EDGES, OBSTACLES, WALL_OBSTACLES, WALL_T, clusterOf } from '../frontend/src/lib/rooms'

let fails = 0
const fail = (msg: string) => {
  fails++
  console.log('FAIL', msg)
}
const ok = (msg: string) => console.log('ok  ', msg)

const near = (a: number, b: number, eps = 0.002) => Math.abs(a - b) < eps

// ------------------------------------------------------- 1. seed is unchanged
applyConfig(null)
const seedIds = AGENTS.map((a) => a.id).join(',')
const liveIds = rosterAgents().map((a) => a.id).join(',')
if (seedIds !== liveIds) fail(`seed roster changed: ${liveIds}`)
else ok(`seed roster: ${AGENTS.length} desks, order preserved`)

for (const a of AGENTS) {
  const got = rosterAgents().find((x) => x.id === a.id)!
  if (!got) {
    fail(`${a.id}: missing from the seed registry`)
    continue
  }
  if (!near(got.desk.x, a.desk.x) || !near(got.desk.z, a.desk.z) || !near(got.desk.rot, a.desk.rot)) {
    fail(`${a.id}: desk moved to ${JSON.stringify(got.desk)} (was ${JSON.stringify(a.desk)})`)
  }
  if (got.look.skin !== a.look.skin || got.look.style !== a.look.style) fail(`${a.id}: look changed`)
}
ok('every hand-placed desk and look is untouched')

// ------------------------------------------- 2. /api/config drives the office
const extra = [
  { id: 'kopi-baru', name: 'Sari Baru', role: 'BARISTA', team: 'lobby' },
  { id: 'ops', name: 'Ops', role: 'OPS LEAD', team: 'dev' },
  { id: 'qa-2', name: 'Tari', role: 'QA', team: 'dev' },
  { id: 'kurikulum', name: 'Kurikulum', role: 'KURIKULUM', team: 'edu' },
]
const cfg = {
  title: 'Kantor Uji',
  tz: 'Asia/Makassar',
  source: 'local',
  profiles: [...AGENTS.map((a) => a.id), ...extra.map((e) => e.id)],
  roster: [...AGENTS.map((a) => ({ id: a.id, name: a.name, role: a.role, team: a.team })), ...extra],
  layout: { floor: { w: 28, d: 20 }, grid: { dx: 4.5, dz: 4.0 }, aisle: 1.6 },
  teams: [
    { id: 'lobby', label: 'Pendopo' },
    { id: 'dev', label: 'Tim Dev' },
    { id: 'edu', label: 'Tim Edu' },
  ],
}

applyConfig(cfg)
const after = rosterAgents()
if (after.length !== AGENTS.length + extra.length) {
  fail(`roster size ${after.length}, want ${AGENTS.length + extra.length} (a new agent was dropped)`)
} else {
  ok(`config roster: ${after.length} desks (${extra.length} new)`)
}

for (const e of extra) {
  const got = after.find((a) => a.id === e.id)
  if (!got) {
    fail(`${e.id}: no desk planned`)
    continue
  }
  if (got.name !== e.name || got.role !== e.role || got.team !== e.team) {
    fail(`${e.id}: meta ${JSON.stringify({ name: got.name, role: got.role, team: got.team })}`)
  }
}
ok('new agents take name/role/team from /api/config')

// name lookup works for a new agent, so a deep link to it is not a 404
if (resolveAgentId('Tari') !== 'qa-2') fail('resolveAgentId did not find a new agent by name')
else ok('deep link resolves a new agent by display name')

if (officeTZ() !== 'Asia/Makassar') fail(`tz = ${officeTZ()}`)
else ok('roster tz is applied to the client clock')

// ------------------------------------- 3. grid, aisle and no overlap anywhere
const all = rosterAgents()
const allObstacles: Obstacle[] = [...WALL_OBSTACLES, ...OBSTACLES.filter((o) => !o.id.startsWith('desk-')), ...all.map((a) => deskObstacle(a.desk, a.id))]

// Team desks sit in touching blocks (dev 3 x 2, edu 2 x 2): inside a block the
// 1.6 aisle does not apply, everywhere else it does. Mirrors layout_check.ts.
const teammates = (id: string) => {
  const name = clusterOf(id)
  return name ? new Set(CLUSTERS[name]!) : new Set([id])
}

let minClear = 99
for (const a of all) {
  const block = teammates(a.id)
  const clear = clearance({
    spot: a.desk,
    id: a.id,
    obstacles: allObstacles.filter((o) => !o.id.startsWith('desk-') || !block.has(o.id.slice('desk-'.length))),
    floor: FLOOR,
    wallT: WALL_T,
  })
  minClear = Math.min(minClear, clear)
  if (clear < DEFAULT_GRID.aisle) fail(`${a.id}: aisle ${clear.toFixed(2)} < ${DEFAULT_GRID.aisle}`)
}
ok(`aisle: minimum ${minClear.toFixed(2)} for all ${all.length} desks`)

// the hand-placed desks keep their blocks: dev 3 x 2, edu 2 x 2, tops touching
const PITCH = 1.62
const ROW_PITCH = 0.78
for (const [name, ids] of Object.entries(CLUSTERS)) {
  const group = all.filter((a) => ids.includes(a.id))
  if (group.length !== ids.length) {
    fail(`${name}: ${ids.length - group.length} block desk missing`)
    continue
  }
  const xs = [...new Set(group.map((a) => a.desk.x))].sort((x, y) => x - y)
  const zs = [...new Set(group.map((a) => a.desk.z))].sort((x, y) => x - y)
  const dxs = xs.slice(1).map((x, i) => +(x - xs[i]!).toFixed(3))
  const dzs = zs.slice(1).map((z, i) => +(z - zs[i]!).toFixed(3))
  if (!dxs.every((d) => near(d, PITCH))) fail(`${name}: columns ${dxs} != ${PITCH}`)
  if (!dzs.every((d) => near(d, ROW_PITCH))) fail(`${name}: rows ${dzs} != ${ROW_PITCH}`)
  const front = group.filter((a) => near(a.desk.rot, 0))
  const back = group.filter((a) => near(a.desk.rot, Math.PI))
  if (front.length !== group.length / 2) fail(`${name}: ${front.length} front / ${back.length} back rows`)
  let worst = 0
  const obs = (id: string) => deskObstacle(all.find((a) => a.id === id)!.desk, id)
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const p = group[i]!.desk
      const q = group[j]!.desk
      const alongX = near(Math.abs(q.x - p.x), PITCH) && near(q.z, p.z)
      const alongZ = near(q.x, p.x) && near(Math.abs(q.z - p.z), ROW_PITCH)
      if (!alongX && !alongZ) continue
      const a = obs(group[i]!.id)
      const b = obs(group[j]!.id)
      const ddx = Math.max(b.x1 - a.x2, a.x1 - b.x2, 0)
      const ddz = Math.max(b.z1 - a.z2, a.z1 - b.z2, 0)
      worst = Math.max(worst, Math.hypot(ddx, ddz))
    }
  }
  if (worst > BLOCK_GAP) fail(`${name}: block is not touching (gap ${worst.toFixed(2)})`)
  else ok(`${name}: ${group.length} hand-placed desks in one touching ${xs.length} x ${zs.length} block`)
}

// the devops desk stands alone, beside the server rack (tested in layout_check.ts)

// the auto-placed desks of one team share one lattice block
for (const team of ['lobby', 'dev', 'edu']) {
  const group = extra.map((e) => all.find((a) => a.id === e.id)!).filter((a) => a.team === team)
  if (group.length < 2) continue
  const x0 = group[0]!.desk.x
  const z0 = group[0]!.desk.z
  for (const a of group) {
    const kx = (a.desk.x - x0) / DEFAULT_GRID.dx
    const kz = (a.desk.z - z0) / DEFAULT_GRID.dz
    if (Math.abs(kx - Math.round(kx)) > 0.002) fail(`${team}/${a.id}: x ${a.desk.x} off the auto-layout lattice`)
    if (Math.abs(kz - Math.round(kz)) > 0.002) fail(`${team}/${a.id}: z ${a.desk.z} off the auto-layout lattice`)
  }
  ok(`${team}: ${group.length} auto-placed desks on one ${DEFAULT_GRID.dx} x ${DEFAULT_GRID.dz} block`)
}

// a desk must not stand on a walkway: the same 0.35 walker half-width the nav
// graph uses, tested against every edge of the graph
const WALKER = 0.35
let tightest = 99
for (const a of all) {
  const own = deskObstacle(a.desk, a.id)
  for (const [x, y] of NAV_EDGES) {
    const na = NAV.find((n) => n.id === x)!
    const nb = NAV.find((n) => n.id === y)!
    const d = segRectDist([na.x, na.z], [nb.x, nb.z], own)
    tightest = Math.min(tightest, d)
    if (d < WALKER) fail(`${a.id}: desk blocks the walkway ${x}-${y} (${d.toFixed(2)} < ${WALKER})`)
  }
}
ok(`no desk sits on a walkway (closest ${tightest.toFixed(2)} to an edge)`)

// ------------------------------------------------ 4. deterministic placement
const first = JSON.stringify(rosterAgents().map((a) => [a.id, a.desk]))
applyConfig(cfg)
const second = JSON.stringify(rosterAgents().map((a) => [a.id, a.desk]))
if (first !== second) fail('the same /api/config produced a different office')
else ok('placement is deterministic across reloads')

// ------------------------------------------------------ 5. stable look per id
const lookA = JSON.stringify(lookFor('agent-baru'))
const lookB = JSON.stringify(lookFor('agent-baru'))
if (lookA !== lookB) fail('lookFor is not deterministic')
else ok(`lookFor(agent-baru) stable: ${lookA}`)

// a status-only agent (not in /api/config) still gets a desk
applyConfig(cfg)
const withStatus = agentsFor(['ops', 'ghost-agent'])
const ghost = withStatus.find((a) => a.id === 'ghost-agent')
if (!ghost) fail('status-only agent got no desk')
else ok(`status-only agent placed at ${ghost.desk.x},${ghost.desk.z}`)

console.log(fails === 0 ? '\nROSTER OK' : `\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
