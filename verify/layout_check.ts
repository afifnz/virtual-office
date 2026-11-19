/**
 * Layout checker: proves the nav graph, POIs and desk exits never cross furniture.
 *
 *   frontend/node_modules/.bin/esbuild verify/layout_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/layout_check.mjs
 *   node /tmp/layout_check.mjs
 */
import {
  BLOCK_GAP, CLUSTERS, DESKS, DESK_EXIT, FLOOR, LEAD_DESKS, NAV, NAV_EDGES, OBSTACLES, POIS,
  SPOTS, WALLS, blockMembers, clusterOf, nearestNode, type Obstacle,
} from '../frontend/src/lib/rooms'
import { navPath, type Pt } from '../frontend/src/lib/nav'
import { SIDESTEP, avoid, homeward, onward, retrace, seatPoint } from '../frontend/src/lib/routes'

const RADIUS = 0.35 // walker half-width
let fails = 0
const fail = (msg: string) => { fails++; console.log('FAIL', msg) }
const ok = (msg: string) => console.log('ok  ', msg)

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

/** segment vs inflated AABB (slab test) */
function hits(ax: number, az: number, bx: number, bz: number, o: Obstacle, pad = RADIUS): boolean {
  const x1 = o.x1 - pad, x2 = o.x2 + pad, z1 = o.z1 - pad, z2 = o.z2 + pad
  let t0 = 0, t1 = 1
  const dx = bx - ax, dz = bz - az
  const clip = (p: number, q: number) => {
    if (near(p, 0)) return q >= 0
    const r = q / p
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r }
    else { if (r < t0) return false; if (r < t1) t1 = r }
    return true
  }
  if (!clip(-dx, ax - x1)) return false
  if (!clip(dx, x2 - ax)) return false
  if (!clip(-dz, az - z1)) return false
  if (!clip(dz, z2 - az)) return false
  return t0 <= t1
}

const inRoom = (x: number, z: number) =>
  Math.abs(x) <= FLOOR.w / 2 - 0.6 && Math.abs(z) <= FLOOR.d / 2 - 0.6

// -------------------------------------------------------------- clusters
// Team desks are deliberately touching: the six dev desks form one 3 x 2
// island, the four edu desks a 2 x 2 block, and the devops desk stands alone by
// the server rack. Every other pair of desks keeps the 1.6-unit aisle.
const PITCH = 1.62
const ROW_PITCH = 0.78
/** shortest free distance between two footprints */
const rectGap = (a: Obstacle, b: Obstacle) => {
  const dx = Math.max(b.x1 - a.x2, a.x1 - b.x2, 0)
  const dz = Math.max(b.z1 - a.z2, a.z1 - b.z2, 0)
  return Math.hypot(dx, dz)
}
const spotOf = (id: string) => DESKS.find((d) => d.id === id)
const obstacleOf = (id: string) => OBSTACLES.find((o) => o.id === `desk-${id}`)!

for (const [name, ids] of Object.entries(CLUSTERS)) {
  const group = ids.map((id) => spotOf(id)).filter((d): d is NonNullable<typeof d> => !!d)
  if (group.length !== ids.length) {
    fail(`${name}: ${ids.length - group.length} desk tanpa posisi`)
    continue
  }
  const xs = [...new Set(group.map((d) => d.x))].sort((a, b) => a - b)
  const zs = [...new Set(group.map((d) => d.z))].sort((a, b) => a - b)
  if (xs.length * zs.length !== group.length) fail(`${name}: blok tidak persegi (${xs.length} x ${zs.length})`)
  const dxs = xs.slice(1).map((x, i) => +(x - xs[i]!).toFixed(3))
  const dzs = zs.slice(1).map((z, i) => +(z - zs[i]!).toFixed(3))
  if (!dxs.every((d) => near(d, PITCH))) fail(`${name}: jarak kolom ${dxs} != ${PITCH}`)
  if (!dzs.every((d) => near(d, ROW_PITCH))) fail(`${name}: jarak baris ${dzs} != ${ROW_PITCH}`)
  // every *adjacent* pair inside the block must actually touch
  let worst = 0
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const p = group[i]!
      const q = group[j]!
      const alongX = near(Math.abs(q.x - p.x), PITCH) && near(q.z, p.z)
      const alongZ = near(q.x, p.x) && near(Math.abs(q.z - p.z), ROW_PITCH)
      if (!alongX && !alongZ) continue
      worst = Math.max(worst, rectGap(obstacleOf(p.id), obstacleOf(q.id)))
    }
  }
  if (worst > BLOCK_GAP) fail(`${name}: blok tidak mepet, celah terbesar ${worst.toFixed(2)}`)
  else ok(`${name}: ${group.length} meja mepet satu blok (${xs.length} x ${zs.length}, celah ${worst.toFixed(2)})`)
}

// ------------------------------------------------------------ lead desks
// A lead desk is not part of the block grid: it stands on the block's short
// side, flush against it and turned a quarter turn, so the lead faces the team
// instead of the wall behind him.
const DESK_DEPTH = 1.03
for (const [name, lead] of Object.entries(LEAD_DESKS)) {
  const desk = spotOf(lead.id)
  const group = (CLUSTERS[lead.cluster] ?? []).map((id) => spotOf(id)).filter((d): d is NonNullable<typeof d> => !!d)
  if (!desk) { fail(`${name}: meja lead ${lead.id} tanpa posisi`); continue }
  if (!group.length) { fail(`${name}: blok ${lead.cluster} kosong`); continue }
  const own = obstacleOf(lead.id)
  const w = own.x2 - own.x1
  const d = own.z2 - own.z1
  if (!(near(Math.min(w, d), DESK_DEPTH, 0.01) && near(Math.max(w, d), PITCH, 0.01))) {
    fail(`${name}: meja lead tidak vertikal (${w.toFixed(2)} x ${d.toFixed(2)}, mau ${DESK_DEPTH} x ${PITCH})`)
    continue
  }
  const boxes = group.map((g) => obstacleOf(g.id))
  const bX1 = Math.min(...boxes.map((b) => b.x1))
  const bX2 = Math.max(...boxes.map((b) => b.x2))
  const bZ1 = Math.min(...boxes.map((b) => b.z1))
  const bZ2 = Math.max(...boxes.map((b) => b.z2))
  // flush against the face it claims, without cutting into the block
  const sideGap = lead.side === 'w' ? bX1 - own.x2 : own.x1 - bX2
  if (sideGap < -BLOCK_GAP) fail(`${name}: meja lead menabrak blok (${sideGap.toFixed(2)})`)
  else if (sideGap > BLOCK_GAP) fail(`${name}: meja lead tidak mepet sisi ${lead.side} blok (celah ${sideGap.toFixed(2)})`)
  // and it spans the block's whole depth, so no hole is left at either end
  if (own.z1 < bZ1 - BLOCK_GAP || own.z2 > bZ2 + BLOCK_GAP) {
    fail(`${name}: meja lead keluar dari kedalaman blok (z ${own.z1.toFixed(2)}..${own.z2.toFixed(2)} vs ${bZ1.toFixed(2)}..${bZ2.toFixed(2)})`)
  }
  const zc = (bZ1 + bZ2) / 2
  const ownZc = (own.z1 + own.z2) / 2
  if (Math.abs(ownZc - zc) > BLOCK_GAP) {
    fail(`${name}: meja lead tidak di tengah sisi blok (z ${ownZc.toFixed(2)} vs ${zc.toFixed(2)})`)
  }
  // facing the block, not the wall: -PI/2 faces +x, +PI/2 faces -x
  const facing = lead.side === 'w' ? -Math.PI / 2 : Math.PI / 2
  if (Math.abs(desk.rot - facing) > 1e-6) {
    fail(`${name}: meja lead rot ${desk.rot.toFixed(2)}, harus ${facing.toFixed(2)} supaya menghadap tim`)
  } else {
    ok(`${name}: meja lead ${lead.id} ${w.toFixed(2)}x${d.toFixed(2)} mepet sisi ${lead.side} blok, menghadap tim (rot ${desk.rot.toFixed(2)})`)
  }
}

// ------------------------------------------------- reception desk (furniture)
// The lobby has no desk mesh: Ndoro Kakung sits behind the reception counter,
// whose footprint already stands in for his desk. Assert the placement instead
// of measuring a second box on top of it.
const counter = OBSTACLES.find((o) => o.id === 'resepsionis')
const lobbyDesk = spotOf('default')
if (!counter || !lobbyDesk) fail('meja resepsionis atau desk default tidak ada')
else {
  if (OBSTACLES.some((o) => o.id === 'desk-default')) fail('desk-default dobel dengan meja resepsionis')
  const seatX = lobbyDesk.x + Math.sin(lobbyDesk.rot) * 0.42
  const seatZ = lobbyDesk.z + Math.cos(lobbyDesk.rot) * 0.42
  const cz = (counter.z1 + counter.z2) / 2
  if (!near(lobbyDesk.rot, -Math.PI / 2)) fail(`default: rot ${lobbyDesk.rot.toFixed(2)}, harus -PI/2 (menghadap +x)`)
  else if (seatX > counter.x1 - 0.2) fail(`default: kursi x ${seatX.toFixed(2)} menabrak meja resepsionis (${counter.x1})`)
  else if (Math.abs(seatZ - cz) > 0.3) fail(`default: kursi z ${seatZ.toFixed(2)} tidak di tengah meja (${cz.toFixed(2)})`)
  else ok(`default: Ndoro duduk di belakang meja resepsionis (kursi ${seatX.toFixed(2)},${seatZ.toFixed(2)}, rot ${lobbyDesk.rot.toFixed(2)})`)
}

// ------------------------------------------------------------ circulation
const deskObs = OBSTACLES.filter((o) => o.id.startsWith('desk-'))
let minClear = 99
for (const d of deskObs) {
  const id = d.id.slice('desk-'.length)
  let clear = Math.min(
    FLOOR.w / 2 - 0.11 - d.x2,
    d.x1 + FLOOR.w / 2 - 0.11,
    FLOOR.d / 2 - 0.11 - d.z2,
    d.z1 + FLOOR.d / 2 - 0.11,
  )
  // desks inside one block are meant to touch; everything else keeps the aisle
  const own = clusterOf(id)
  for (const o of OBSTACLES) {
    if (o === d) continue
    const other = o.id.startsWith('desk-') ? o.id.slice('desk-'.length) : null
    if (other && own && clusterOf(other) === own) continue
    clear = Math.min(clear, rectGap(d, o))
  }
  minClear = Math.min(minClear, clear)
  if (clear < 1.6) fail(`${d.id}: sirkulasi ${clear.toFixed(2)} < 1.6`)
}
ok(`sirkulasi meja: minimum ${minClear.toFixed(2)} unit ke tetangga / dinding`)

// the devops desk must actually stand by the server rack
const opsDesk = obstacleOf('devops')
const rack = OBSTACLES.find((o) => o.id === 'server')
if (!rack) fail('rak server tidak ada di OBSTACLES')
else {
  const gap = rectGap(opsDesk, rack)
  if (gap > 3) fail(`meja devops ${gap.toFixed(2)} dari rak server (harus <= 3)`)
  else ok(`devops: meja ${gap.toFixed(2)} unit dari rak server`)
}

// ------------------------------------------------------------- nav edges
let edgeMin = 99
for (const [a, b] of NAV_EDGES) {
  const na = NAV.find((n) => n.id === a)
  const nb = NAV.find((n) => n.id === b)
  if (!na || !nb) { fail(`edge ${a}-${b}: node tidak ada`); continue }
  for (const o of OBSTACLES) {
    if (hits(na.x, na.z, nb.x, nb.z, o)) fail(`edge ${a}->${b} menembus ${o.id}`)
  }
  edgeMin = Math.min(edgeMin, Math.hypot(na.x - nb.x, na.z - nb.z))
}
ok(`nav: ${NAV.length} node, ${NAV_EDGES.length} edge, edge terpendek ${edgeMin.toFixed(2)}`)

// --------------------------------------------------- poi + desk exit legs
for (const p of POIS) {
  const n = nearestNode(p.pos[0], p.pos[1])
  if (!inRoom(p.pos[0], p.pos[1])) fail(`poi ${p.id}: di luar ruangan`)
  for (const o of OBSTACLES) {
    if (hits(n.x, n.z, p.pos[0], p.pos[1], o)) fail(`poi ${p.id}: kaki ${n.id}->poi menembus ${o.id}`)
  }
}
for (const d of DESKS) {
  const e = DESK_EXIT[d.id]!
  const n = nearestNode(e[0], e[1])
  for (const o of OBSTACLES) {
    if (o.id === `desk-${d.id}`) continue
    if (hits(e[0], e[1], n.x, n.z, o)) fail(`exit ${d.id} (${e[0]},${e[1]})->${n.id} menembus ${o.id}`)
  }
  const seat: [number, number] = [d.x + Math.sin(d.rot) * 0.42, d.z + Math.cos(d.rot) * 0.42]
  if (Math.hypot(seat[0] - e[0], seat[1] - e[1]) < 1.2) fail(`exit ${d.id} terlalu dekat kursi`)
}
ok('poi + desk exit: semua kaki lurus bebas furniture')

// ------------------------------------------------------- errand replay
// Every desk to every POI of its team and back, exactly as AgentActor builds
// the routes — including the walk home from the POI and a mid-route recall.
// The first leg (seat -> desk exit) runs through the agent's own chair.
const legsClear = (who: string, route: Pt[], skipOwnFirst: boolean, label: string): boolean => {
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1]!, route[i]!]
    for (const o of OBSTACLES) {
      const own = o.id === `desk-${who}`
      if (own && ((skipOwnFirst && i === 1) || i === route.length - 1)) continue
      if (hits(a[0], a[1], b[0], b[1], o)) {
        fail(`${label}: kaki ${i} (${a.map((v) => v.toFixed(1))})->(${b.map((v) => v.toFixed(1))}) menembus ${o.id}`)
        return false
      }
    }
  }
  return true
}
let trips = 0
for (const d of DESKS) {
  const meta = { desk: d }
  const team = d.z > 3 ? 'lobby' : d.x < 0 ? 'dev' : 'edu'
  for (const p of POIS.filter((q) => q.team === team)) {
    const out = [seatPoint(meta), ...onward(meta, p.pos)]
    const home = [p.pos, ...homeward(meta, p.pos)]
    legsClear(d.id, out, true, `${d.id}->${p.id}`)
    legsClear(d.id, home, false, `${p.id}->${d.id}`)
    // recalled half-way: from the middle of each outbound leg
    const route = onward(meta, p.pos)
    for (let k = 1; k < route.length; k++) {
      const a = route[k - 1]!, b = route[k]!
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      legsClear(d.id, [mid, ...retrace(meta, route, k)], false, `${d.id}->${p.id} dipanggil di kaki ${k}`)
    }
    trips++
  }
}
ok(`errand: ${trips} perjalanan meja->poi->meja (+ dipanggil di tengah jalan) bebas furniture`)

// Passing room: walkers keep right by SIDESTEP (lib/routes.ts) when they meet, so
// every nav edge needs body half-width + sidestep of clearance.
const PASS = 0.25 + SIDESTEP
let tight = 0
for (const [a, b] of NAV_EDGES) {
  const na = NAV.find((n) => n.id === a)!, nb = NAV.find((n) => n.id === b)!
  for (const o of OBSTACLES) if (hits(na.x, na.z, nb.x, nb.z, o, PASS)) { tight++; fail(`edge ${a}->${b}: ruang papasan < ${PASS} ke ${o.id}`) }
}
if (!tight) ok(`ruang papasan: semua edge punya >= ${PASS} m ke furniture`)

// ------------------------------------------------------ walker meeting
// Same stepping as AgentActor (route follow + avoid() + eased sidestep), run
// headless: two walkers must pass without their bodies overlapping, and a
// colleague standing on the route must not stall anyone.
interface Sim { id: string; path: Pt[]; idx: number; x: number; z: number; ox: number; oz: number; yielded: number; still?: boolean }
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt))
function simulate(walkers: Sim[], seconds: number): { minD: number; done: boolean } {
  const dt = 1 / 30
  let minD = 99
  const pos = new Map<string, { x: number; z: number }>()
  for (const w of walkers) pos.set(w.id, { x: w.x, z: w.z })
  for (let t = 0; t < seconds; t += dt) {
    for (const w of walkers) {
      if (w.still || w.idx >= w.path.length) continue
      const tg = w.path[w.idx]!
      const d0 = Math.hypot(tg[0] - w.x, tg[1] - w.z)
      const dx = d0 > 1e-4 ? (tg[0] - w.x) / d0 : 0
      const dz = d0 > 1e-4 ? (tg[1] - w.z) / d0 : 0
      const av = avoid(w.id, w, dx, dz, pos)
      w.ox = damp(w.ox, -dz * av.side, 4, dt)
      w.oz = damp(w.oz, dx * av.side, 4, dt)
      w.yielded = av.hold ? w.yielded + dt : Math.max(0, w.yielded - dt * 0.5)
      let budget = 1.0 * dt * av.speed
      while (budget > 0 && w.idx < w.path.length) {
        const p = w.path[w.idx]!
        const ex = p[0] - w.x, ez = p[1] - w.z
        const d = Math.hypot(ex, ez)
        if (d < 1e-4) { w.idx++; continue }
        const m = Math.min(budget, d)
        w.x += (ex / d) * m; w.z += (ez / d) * m; budget -= m
        if (m >= d - 1e-3) w.idx++
      }
      pos.set(w.id, { x: w.x + w.ox, z: w.z + w.oz })
    }
    const ps = [...pos.values()]
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      minD = Math.min(minD, Math.hypot(ps[i]!.x - ps[j]!.x, ps[i]!.z - ps[j]!.z))
    }
    if (walkers.every((w) => w.still || w.idx >= w.path.length)) return { minD, done: true }
  }
  return { minD, done: false }
}
const walker = (id: string, path: Pt[], still = false): Sim =>
  ({ id, path: path.slice(1), idx: 0, x: path[0]![0], z: path[0]![1], ox: 0, oz: 0, yielded: 0, still })
const W: Pt = [-11.0, -6.4], E: Pt = [-1.8, -6.4]
const cases: Array<[string, Sim[], number]> = [
  ['berpapasan di lorong belakang', [walker('a', [W, E]), walker('b', [E, W])], 0.45],
  ['berpapasan, prioritas terbalik', [walker('b', [W, E]), walker('a', [E, W])], 0.45],
  ['menyusul dari belakang', [walker('a', [W, [-3.2, -6.4]]), walker('b', [[-9.6, -6.4], E])], 0.45],
  ['bersilangan di depan pintu tim', [walker('a', [[-11.0, -1.6], [-1.8, -1.6]]), walker('b', [[-7.5, 1.0], [-7.5, -1.6], [-11.0, -1.6]])], 0.45],
  ['rekan berdiri di jalur', [walker('a', [W, E]), walker('z', [[-7.6, -6.4]], true)], 0.4],
]
for (const [name, ws, need] of cases) {
  const r = simulate(ws, 60)
  if (!r.done) fail(`papasan "${name}": tidak sampai tujuan dalam 60 s (macet)`)
  else if (r.minD < need) fail(`papasan "${name}": jarak terdekat ${r.minD.toFixed(2)} < ${need}`)
  else ok(`papasan "${name}": jarak terdekat ${r.minD.toFixed(2)} m`)
}

// -------------------------------------------------------- reachability
const adj = new Map<string, string[]>()
for (const [a, b] of NAV_EDGES) {
  adj.set(a, [...(adj.get(a) ?? []), b])
  adj.set(b, [...(adj.get(b) ?? []), a])
}
const seen = new Set<string>(['gate'])
const q = ['gate']
while (q.length) {
  for (const n of adj.get(q.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n) }
}
if (seen.size !== NAV.length) fail(`graph tidak terhubung: ${NAV.length - seen.size} node yatim`)
else ok(`graph terhubung: ${seen.size}/${NAV.length} node dari pintu masuk`)

for (const p of POIS) {
  const from = DESK_EXIT[DESKS.find((d) => d.id === (p.team === 'lobby' ? 'default' : p.team))!.id]!
  const a = nearestNode(from[0], from[1])
  const b = nearestNode(p.pos[0], p.pos[1])
  if (navPath(a.id, b.id).length === 0 && a.id !== b.id) fail(`poi ${p.id}: tidak ada jalur dari ${a.id}`)
}
ok('semua poi terjangkau dari meja timnya')

// ------------------------------------------------------------- cameras
for (const s of Object.values(SPOTS)) {
  // the overview preset flies above the dollhouse; the room presets stay inside
  if (s.pos[1] < 5 && !inRoom(s.pos[0], s.pos[2])) fail(`spot ${s.id}: kamera di luar lantai`)
  if (s.pos[1] < 1.2) fail(`spot ${s.id}: kamera terlalu rendah`)
}
ok(`spot kamera: ${Object.keys(SPOTS).join(', ')}`)

// --------------------------------------------------------------- walls
for (const w of WALLS) {
  const len = Math.abs(w.to - w.from)
  const atLim = w.axis === 'x' ? FLOOR.d / 2 : FLOOR.w / 2
  const runLim = w.axis === 'x' ? FLOOR.w / 2 : FLOOR.d / 2
  if (Math.abs(w.at) > atLim || Math.abs(w.from) > runLim + 0.01 || Math.abs(w.to) > runLim + 0.01) {
    fail(`wall ${w.axis}@${w.at} ${w.from}..${w.to} keluar lantai`)
  }
  if (len < 0.5) fail(`wall ${w.axis}@${w.at}: panjang ${len}`)
}
ok(`dinding: ${WALLS.length} segmen di dalam ${FLOOR.w}x${FLOOR.d}`)

console.log(fails === 0 ? '\nLAYOUT OK' : `\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
