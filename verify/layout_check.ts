/**
 * Layout checker: proves the nav graph, POIs and desk exits never cross furniture.
 *
 *   frontend/node_modules/.bin/esbuild verify/layout_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/layout_check.mjs
 *   node /tmp/layout_check.mjs
 */
import {
  DESKS, DESK_EXIT, FLOOR, NAV, NAV_EDGES, OBSTACLES, POIS, SPOTS, WALLS, nearestNode,
  type Obstacle,
} from '../frontend/src/lib/rooms'
import { navPath } from '../frontend/src/lib/nav'

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

// ---------------------------------------------------------------- pods
// Team rooms are facing pods: a front row (rot 0) and a back row (rot PI) on the
// same columns, 4.5 apart, desk tops meeting 0.8 apart in z.
const POD_DZ = 0.8
/** the desk across the pod, if any */
const partnerOf = (d: { id: string; x: number; z: number; rot: number }) =>
  DESKS.find((o) => o.id !== d.id && near(o.x, d.x) && near(Math.abs(o.z - d.z), POD_DZ) && !near(o.rot, d.rot))
const dev = DESKS.filter((d) => d.x < 0 && d.z < 2)
const edu = DESKS.filter((d) => d.x > 0 && d.z < 2)
for (const [name, group] of [['dev', dev], ['edu', edu]] as const) {
  const xs = [...new Set(group.map((d) => d.x))].sort((a, b) => a - b)
  const dxs = xs.slice(1).map((x, i) => +(x - xs[i]!).toFixed(3))
  if (dxs.every((d) => near(d, 4.5))) ok(`${name}: ${xs.length} kolom, jarak ${dxs.join('/')}`)
  else fail(`${name}: jarak kolom tidak konsisten ${dxs}`)
  for (const d of group) {
    const p = partnerOf(d)
    if (!p) { fail(`${name}/${d.id}: tidak punya pasangan di seberang pod`); continue }
    const front = d.z > p.z ? d : p
    if (!near(front.rot, 0)) fail(`${name}/${front.id}: baris depan harus rot 0 (menghadap -z)`)
  }
  ok(`${name}: ${group.length} meja dalam pod berhadapan`)
}

// ------------------------------------------------------------ circulation
/** shortest free distance between two footprints */
const rectGap = (a: Obstacle, b: Obstacle) => {
  const dx = Math.max(b.x1 - a.x2, a.x1 - b.x2, 0)
  const dz = Math.max(b.z1 - a.z2, a.z1 - b.z2, 0)
  return Math.hypot(dx, dz)
}

const deskObs = OBSTACLES.filter((o) => o.id.startsWith('desk-'))
let minClear = 99
for (const d of deskObs) {
  let clear = Math.min(
    FLOOR.w / 2 - 0.11 - d.x2,
    d.x1 + FLOOR.w / 2 - 0.11,
    FLOOR.d / 2 - 0.11 - d.z2,
    d.z1 + FLOOR.d / 2 - 0.11,
  )
  // the desk across the pod is meant to touch; every other neighbour keeps the aisle
  const self = DESKS.find((k) => `desk-${k.id}` === d.id)
  const partner = self ? partnerOf(self) : undefined
  for (const o of OBSTACLES) {
    if (o === d || (partner && o.id === `desk-${partner.id}`)) continue
    clear = Math.min(clear, rectGap(d, o))
  }
  minClear = Math.min(minClear, clear)
  if (clear < 1.6) fail(`${d.id}: sirkulasi ${clear.toFixed(2)} < 1.6`)
}
ok(`sirkulasi meja: minimum ${minClear.toFixed(2)} unit ke tetangga / dinding`)

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
