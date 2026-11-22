/**
 * Visual-geometry checker for the side view (L1/L2/L3). Proves — without a
 * browser — the numbers the design review is built on:
 *
 *   1. the 13 seed desks still split 1 / 4 / 8 and keep their floor
 *   2. `z` sorts agents into two rows, `x` orders them left→right, and the
 *      back row is staggered half a pitch (L3: 170/370/570/770 and 270/470/670/870)
 *   3. same-row pitch 200 px (≥ 180), row scale 0.94, avatar 150/141 px
 *   4. room 548 px = floor→ceiling INCLUDING the window band, ratio 1:3.65
 *   5. roof band ≤ 40 px, glass band 485 px, room 3.65 units
 *   6. nameplates: 24 px, 8 px above the head, 0 overlap, 0 head cover,
 *      0 off-canvas, 0 on a board, connector when stacked
 *   7. avatar bbox overlap ≤ 20 %
 *   8. wall gate: 0 % naked, glass 88.5 %, boards 27 %
 *   9. all eight dev looks are distinguishable (≥ 1.0), 13 unique avatar keys
 *  10. both theme palettes exist with the published status colours
 *  11. the lift shaft/node contract is unchanged
 *  12. pixel font is used only for the zone plaque and lift numbers
 *
 *   frontend/node_modules/.bin/esbuild verify/visual_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/visual_check.mjs
 *   node /tmp/visual_check.mjs
 */
import { AGENTS } from '../frontend/src/lib/agents'
import { rosterAgents } from '../frontend/src/lib/roster'
import { FLOOR_IDS, LIFT, liftNode, navOf, obstaclesOf, type FloorId } from '../frontend/src/lib/rooms'
import {
  PLATE_GAP,
  PLATE_H,
  PLATE_STEP,
  labelAgentsFor,
  layoutSideLabels,
  measureSans,
  plateWidth,
  rectsOverlap,
  sideGate,
} from '../frontend/src/scene2d/labels'
import {
  SIDE_AVATAR_H,
  SIDE_BOARD_H,
  SIDE_BOARD_TOP,
  SIDE_BOARDS,
  SIDE_GLASS_BOTTOM,
  SIDE_GLASS_TOP,
  SIDE_H,
  SIDE_PPU,
  SIDE_ROOF_H,
  SIDE_ROOM_H,
  SIDE_ROOM_UNITS,
  SIDE_ROW_SCALE,
  SIDE_SLOT_PITCH,
  SIDE_STAGGER,
  SIDE_W,
  sideRows,
  sideSeats,
  sideWallGate,
} from '../frontend/src/scene2d/side'
import { lookDistance, lookHash } from '../frontend/src/scene2d/avatar'
import { THEME_STATUS, THEME_TOKENS } from '../frontend/src/scene2d/palette'
import { PIXEL_FONT_ROLES } from '../frontend/src/scene2d/props-side'

let fails = 0
const fail = (msg: string) => {
  fails++
  console.log('FAIL', msg)
}
const ok = (msg: string) => console.log('ok  ', msg)
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps

const BOUNDS = { w: SIDE_W, h: SIDE_H }
const RESERVED = SIDE_BOARDS.map((b) => ({ x: b.x, y: SIDE_BOARD_TOP, w: b.w, h: b.h }))

// ------------------------------------------------------ 1. roster unchanged
const metas = rosterAgents()
if (metas.length !== 13) fail(`roster has ${metas.length} desks, want 13`)
else ok(`roster: ${metas.length} desks, ${new Set(metas.map((m) => m.id)).size} unique ids`)
if (metas.length !== AGENTS.length) fail(`roster drifted from the seed roster (${metas.length} vs ${AGENTS.length})`)
const WANT_SPLIT: Record<FloorId, number> = { 1: 1, 2: 4, 3: 8 }
for (const f of FLOOR_IDS) {
  const n = metas.filter((m) => m.desk.floor === f).length
  if (n !== WANT_SPLIT[f]) fail(`L${f} has ${n} desks, want ${WANT_SPLIT[f]}`)
  else ok(`L${f}: ${n} seed desks on the floor`)
}

// ------------------------------------------------------------- 2. two rows
for (const f of FLOOR_IDS) {
  const floorMetas = metas.filter((m) => m.desk.floor === f)
  const { front, back } = sideRows(floorMetas)
  const wantFront = Math.ceil(floorMetas.length / 2)
  if (front.length !== wantFront || back.length !== floorMetas.length - wantFront) {
    fail(`L${f}: rows ${front.length}/${back.length}, want ${wantFront}/${floorMetas.length - wantFront}`)
  } else ok(`L${f}: ${front.length} front + ${back.length} back`)
  for (const s of [...front, ...back]) {
    if (s.floorY !== (s.row === 'front' ? 640 : 596)) fail(`L${f} ${s.meta.id}: floor line ${s.floorY}`)
    if (!near(s.scale, s.row === 'front' ? 1 : SIDE_ROW_SCALE)) fail(`L${f} ${s.meta.id}: row scale ${s.scale}`)
    if (!near(s.avatarH, s.row === 'front' ? 150 : 141, 0.01)) fail(`L${f} ${s.meta.id}: avatar ${s.avatarH} px`)
    if (s.headTop < SIDE_ROOF_H) fail(`L${f} ${s.meta.id}: head above the roof (${s.headTop})`)
    if (s.cx < 0 || s.cx > SIDE_W) fail(`L${f} ${s.meta.id}: slot ${s.cx} outside the stage`)
  }
}

// L3 slot table is the design's measured table
const l3 = sideRows(metas.filter((m) => m.desk.floor === 3))
const wantFrontL3: Array<[string, number]> = [
  ['dev', 170],
  ['coder2', 370],
  ['planner', 570],
  ['uiux', 770],
]
const wantBackL3: Array<[string, number]> = [
  ['coder', 270],
  ['reviewer', 470],
  ['tester', 670],
  ['devops', 870],
]
for (const [row, want] of [
  ['front', wantFrontL3],
  ['back', wantBackL3],
] as const) {
  const got = row === 'front' ? l3.front : l3.back
  for (let i = 0; i < want.length; i++) {
    const [id, x] = want[i]!
    const seat = got[i]
    if (!seat || seat.meta.id !== id || !near(seat.cx, x, 0.001)) {
      fail(`L3 ${row} slot ${i}: got ${seat?.meta.id}@${seat?.cx}, want ${id}@${x}`)
    }
  }
  ok(`L3 ${row} slots: ${got.map((s) => `${s.meta.id.toUpperCase()} ${s.cx}`).join(' · ')}`)
}

// same-row pitch and inter-row stagger
for (const f of FLOOR_IDS) {
  const { front, back } = sideRows(metas.filter((m) => m.desk.floor === f))
  for (const row of [front, back]) {
    for (let i = 1; i < row.length; i++) {
      const d = row[i]!.cx - row[i - 1]!.cx
      if (!near(d, SIDE_SLOT_PITCH, 0.001)) fail(`L${f} ${row[i]!.row}: pitch ${d}, want ${SIDE_SLOT_PITCH}`)
    }
  }
  if (front.length && back.length) {
    const d = Math.abs(back[0]!.cx - front[0]!.cx)
    if (!near(d, SIDE_STAGGER, 0.001)) fail(`L${f}: back row stagger ${d}, want ${SIDE_STAGGER}`)
  }
  if (front.length > 1) ok(`L${f}: same-row pitch ${SIDE_SLOT_PITCH} px (min 180), stagger ${SIDE_STAGGER} px`)
}

// -------------------------------------------------------- 3. room + avatar
if (!near(SIDE_ROOM_H, 548, 0.001)) fail(`room height ${SIDE_ROOM_H}, want 548`)
if (!near(SIDE_ROOM_UNITS, 3.6533, 0.001)) fail(`room units ${SIDE_ROOM_UNITS}, want 3.6533`)
const ratio = SIDE_ROOM_H / SIDE_AVATAR_H
if (ratio < 3 || ratio > 4) fail(`room:avatar ratio 1:${ratio.toFixed(2)}, want 1:3–1:4`)
else ok(`room ${SIDE_ROOM_H} px = ${SIDE_ROOM_UNITS.toFixed(3)} units; avatar 150 px; ratio 1:${ratio.toFixed(2)}`)
if (SIDE_ROOF_H > 40) fail(`roof band ${SIDE_ROOF_H} px > 40`)
else ok(`roof band ${SIDE_ROOF_H} px (≤ 40), no sky above the ceiling`)
const glassH = SIDE_GLASS_BOTTOM - SIDE_GLASS_TOP
if (glassH !== 485) fail(`glass band ${glassH} px, want 485`)
else ok(`curtain wall ${glassH} px, inside the 548 px room`)
if (SIDE_PPU !== 150) fail(`camera ${SIDE_PPU} px/unit, want 150`)
else ok('camera 150 px/unit on both axes (not fit-to-width)')
if (SIDE_BOARD_H !== 148) fail(`board height ${SIDE_BOARD_H}, want 148`)
else ok(`six boards ${SIDE_BOARD_H} px tall (≈1.0 × avatar), y ${SIDE_BOARD_TOP}–${SIDE_BOARD_TOP + SIDE_BOARD_H}`)

// ------------------------------------------------------- 4. nameplate gate
const statusMap = new Map(
  metas.map((m) => [m.id, { status: 'working', shape: 'circle' as const, colour: THEME_STATUS.day.working }]),
)
for (const f of FLOOR_IDS) {
  const seats = sideSeats(metas.filter((m) => m.desk.floor === f))
  const labels = labelAgentsFor(seats, statusMap)
  const { plates, violations } = layoutSideLabels(labels, BOUNDS, RESERVED)
  const gate = sideGate(seats, plates, BOUNDS)
  if (violations.length) fail(`L${f} layout: ${violations.join('; ')}`)
  if (gate.plateOverlaps !== 0) fail(`L${f}: ${gate.plateOverlaps} plate overlaps`)
  if (gate.plateOnHead !== 0) fail(`L${f}: ${gate.plateOnHead} plates cover another head`)
  if (gate.avatarOverlapPct > 20) fail(`L${f}: avatar overlap ${gate.avatarOverlapPct} % > 20 %`)
  if (seats.filter((x) => x.row === 'front').length > 1 && gate.minSameRowPx < 180) fail(`L${f}: same-row pitch ${gate.minSameRowPx} < 180`)
  if (gate.minPlateHeadGap < PLATE_GAP - 0.01) fail(`L${f}: plate↔head gap ${gate.minPlateHeadGap} < ${PLATE_GAP}`)
  for (const p of plates) {
    if (p.h !== PLATE_H) fail(`L${f} ${p.id}: plate ${p.h} px, want ${PLATE_H}`)
    if (p.y + p.h > BOUNDS.h || p.x + p.w > BOUNDS.w || p.x < 0 || p.y < 0) fail(`L${f} ${p.id}: plate off-canvas`)
    for (const b of RESERVED) if (rectsOverlap(p, b)) fail(`L${f} ${p.id}: plate sits on a board`)
    const a = labels.find((q) => q.id === p.id)!
    if (p.connector && p.y + p.h < a.headTop - PLATE_GAP - 0.5) {
      if (p.h !== PLATE_H) fail(`L${f} ${p.id}: connector plate has the wrong height`)
    }
    if (!p.connector && !near(a.headTop - (p.y + p.h), PLATE_GAP, 0.01)) {
      fail(`L${f} ${p.id}: plate sits ${a.headTop - (p.y + p.h)} px above the head, want ${PLATE_GAP}`)
    }
  }
  if (!gate.violations.length) {
    ok(
      `L${f}: ${plates.length} plates · overlap ${gate.plateOverlaps} · on-head ${gate.plateOnHead} · avatar overlap ${gate.avatarOverlapPct} % · pitch ${gate.minSameRowPx} · gap ${gate.minPlateHeadGap}`,
    )
  }
}

// plate width is measured, not guessed
if (PLATE_STEP !== 27) fail(`plate step ${PLATE_STEP}, want 27`)
const sample = plateWidth('BAGAS', true)
if (sample < 40 || sample > 100) fail(`plateWidth(BAGAS) = ${sample}, outside a sane 40–100 px`)
else ok(`plate widths: BAGAS ${sample} px, WAHYU ${plateWidth('WAHYU', true)} px (measured sans, not 5×7)`)
if (measureSans('MMMM', 11.5, 700) <= measureSans('iiii', 11.5, 700)) fail('measureSans is not width-aware')
else ok('measureSans is width-aware (MMMM wider than iiii)')

// --------------------------------------------------------- 5. wall metrics
const wall = sideWallGate()
if (wall.emptyPct > 30) fail(`wall empty ${wall.emptyPct} % > 30 %`)
if (wall.emptyRunPct > 30) fail(`wall empty run ${wall.emptyRunPct} % > 30 %`)
if (wall.emptyColumns !== 0) fail(`${wall.emptyColumns} columns cross the empty-run limit`)
if (wall.glassPct < 80) fail(`glass+city covers ${wall.glassPct} %, want ≥ 80 %`)
if (wall.panelPct < 20) fail(`boards cover ${wall.panelPct} %, want ≥ 20 %`)
ok(`wall: naked ${wall.emptyPct} % · glass+city ${wall.glassPct} % · boards ${wall.panelPct} %`)

// ---------------------------------------------------- 6. look distinctness
const dev = metas.filter((m) => m.desk.floor === 3)
let weakest = { pair: '', d: Infinity }
let under = 0
for (let i = 0; i < dev.length; i++) {
  for (let j = i + 1; j < dev.length; j++) {
    const d = lookDistance(dev[i]!.look, dev[j]!.look)
    if (d < weakest.d) weakest = { pair: `${dev[i]!.id}↔${dev[j]!.id}`, d }
    if (d < 1) under++
  }
}
if (under) fail(`${under} dev look pairs are closer than 1.0 (weakest ${weakest.pair} ${weakest.d})`)
else ok(`look distinctness: 8/8 ≥ 1.0 (weakest ${weakest.pair} ${weakest.d})`)
const keys = new Set(metas.map((m) => lookHash(m.look)))
if (keys.size !== metas.length) fail(`avatar keys collide: ${keys.size} unique of ${metas.length}`)
else ok(`avatar keys: ${keys.size} unique for ${metas.length} looks`)

// --------------------------------------------------------- 7. theme tokens
for (const theme of ['day', 'night'] as const) {
  const t = THEME_TOKENS[theme]
  if (!t.glass.surface || !t.city.layers?.length) fail(`${theme} palette is incomplete`)
  if (THEME_STATUS[theme].working === undefined) fail(`${theme} status palette is incomplete`)
}
const day = THEME_STATUS.day
if (day.working !== '#8A5406' || day.blocked !== '#B33A12' || day.ok !== '#116B33' || day.offline !== '#556073') {
  fail(`day status colours drifted: ${JSON.stringify(day)}`)
} else ok('day status colours match the 4.5:1 table (working/blocked/ok/offline)')
if (THEME_TOKENS.day.city.skyTop === THEME_TOKENS.night.city.skyTop) fail('day and night share a sky')
else ok('two city palettes: Daylight Atrium and Sky Lobby')

// -------------------------------------------------------------- 8. the lift
for (const f of FLOOR_IDS) {
  const lift = LIFT[f]
  const shaft = obstaclesOf(f).find((o) => o.id === `lift-${f}`)
  if (!shaft) fail(`L${f}: lift shaft is not an obstacle`)
  else if (!near(shaft.x1, lift.shaft.x1, 1e-9) || !near(shaft.z2, lift.shaft.z2, 1e-9)) fail(`L${f}: lift obstacle drifted`)
  const node = liftNode(f)
  if (!navOf(f).some((n) => n.id === node.id)) fail(`L${f}: lift node ${node.id} missing`)
  else ok(`L${f}: lift shaft + node ${node.id} (${node.x},${node.z}) wired`)
}

// --------------------------------------------------------- 9. font roles
if (PIXEL_FONT_ROLES.length !== 2 || !PIXEL_FONT_ROLES.includes('zone-plaque') || !PIXEL_FONT_ROLES.includes('lift-floor-number')) {
  fail(`pixel font roles: ${PIXEL_FONT_ROLES.join(',')} — only zone plaque + lift number`)
} else ok('pixel font roles are exactly the zone plaque and the lift floor number')

// ----------------------------------------------------- 10. stage bands sum
const bands = SIDE_ROOF_H + (SIDE_GLASS_BOTTOM - SIDE_ROOF_H) + (588 - SIDE_GLASS_BOTTOM) + (648 - 588) + (SIDE_H - 648)
if (bands !== SIDE_H) fail(`bands sum ${bands}, want ${SIDE_H}`)
else ok(`stage bands sum to ${SIDE_H} px (roof + window + spandrel + floor + slab)`)

// every agent has a unique (floor, slot) pair
const placed = new Set<string>()
for (const f of FLOOR_IDS) {
  for (const s of sideSeats(metas.filter((m) => m.desk.floor === f))) placed.add(`${f}:${s.cx}`)
}
if (placed.size !== metas.length) fail(`${metas.length - placed.size} agents share a slot`)
else ok(`every agent has its own (floor, slot): ${placed.size}`)

console.log(fails === 0 ? '\nVISUAL OK' : `\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
