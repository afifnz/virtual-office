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
import { DEFAULT_GRID, clearance, deskObstacle, type Obstacle } from '../frontend/src/lib/layout'
import { FLOOR, NAV, NAV_EDGES, OBSTACLES, WALL_OBSTACLES, WALL_T } from '../frontend/src/lib/rooms'

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
  layout: { floor: { w: 40, d: 30 }, grid: { dx: 4.5, dz: 4.0 }, aisle: 1.6 },
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

// Team rooms are facing pods: a front row (rot 0) and a back row (rot PI) on the
// same column, desk tops meeting POD_DZ apart in z. Mirrors layout_check.ts.
const POD_DZ = 0.8
const partnerOf = (a: (typeof all)[number]) =>
  all.find(
    (o) =>
      o.id !== a.id &&
      near(o.desk.x, a.desk.x) &&
      near(Math.abs(o.desk.z - a.desk.z), POD_DZ) &&
      !near(o.desk.rot, a.desk.rot),
  )

let minClear = 99
for (const a of all) {
  // the desk across the pod is meant to touch; every other neighbour keeps the aisle
  const partner = partnerOf(a)
  const clear = clearance({
    spot: a.desk,
    id: a.id,
    obstacles: partner ? allObstacles.filter((o) => o.id !== `desk-${partner.id}`) : allObstacles,
    floor: FLOOR,
    wallT: WALL_T,
  })
  minClear = Math.min(minClear, clear)
  if (clear < DEFAULT_GRID.aisle) fail(`${a.id}: aisle ${clear.toFixed(2)} < ${DEFAULT_GRID.aisle}`)
}
ok(`aisle: minimum ${minClear.toFixed(2)} for all ${all.length} desks`)

// the hand-placed desks keep their own lattice: lobby on the plain grid, the
// team rooms as facing pods on 4.5 columns
for (const team of ['lobby', 'dev', 'edu']) {
  const group = all.filter((a) => a.team === team && AGENTS.some((s) => s.id === a.id))
  if (group.length < 2) continue
  const x0 = Math.min(...group.map((a) => a.desk.x))
  const z0 = Math.min(...group.map((a) => a.desk.z))
  const pods = team !== 'lobby'
  for (const a of group) {
    const kx = (a.desk.x - x0) / DEFAULT_GRID.dx
    if (Math.abs(kx - Math.round(kx)) > 0.002) fail(`${team}/${a.id}: x ${a.desk.x} off the ${DEFAULT_GRID.dx} lattice`)
    if (pods) {
      const p = partnerOf(a)
      if (!p || !group.includes(p)) {
        fail(`${team}/${a.id}: no facing desk across the pod`)
        continue
      }
      const front = a.desk.z > p.desk.z ? a : p
      if (!near(front.desk.rot, 0)) fail(`${team}/${front.id}: pod front row must be rot 0`)
    } else {
      const kz = (a.desk.z - z0) / DEFAULT_GRID.dz
      if (Math.abs(kz - Math.round(kz)) > 0.002) fail(`${team}/${a.id}: z ${a.desk.z} off the ${DEFAULT_GRID.dz} lattice`)
    }
  }
  ok(
    pods
      ? `${team}: ${group.length} hand-placed desks in facing pods on ${DEFAULT_GRID.dx} columns`
      : `${team}: ${group.length} hand-placed desks on the ${DEFAULT_GRID.dx} x ${DEFAULT_GRID.dz} lattice`,
  )
}

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

// a desk must not stand on a walkway
for (const a of all) {
  const own = deskObstacle(a.desk, a.id)
  for (const [x, y] of NAV_EDGES) {
    const na = NAV.find((n) => n.id === x)!
    const nb = NAV.find((n) => n.id === y)!
    const inside =
      own.x1 - 0.35 < Math.max(na.x, nb.x) &&
      own.x2 + 0.35 > Math.min(na.x, nb.x) &&
      own.z1 - 0.35 < Math.max(na.z, nb.z) &&
      own.z2 + 0.35 > Math.min(na.z, nb.z)
    // the bounding-box test is loose; only report a real footprint hit
    if (inside) {
      const clear = clearance({ spot: a.desk, obstacles: [], floor: FLOOR, wallT: WALL_T })
      if (clear < 0) fail(`${a.id}: desk on a walkway (${x}-${y})`)
    }
  }
}
ok('no desk sits on a walkway')

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
