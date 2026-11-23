/**
 * LIFT gate — "buat lift hidup", headless and without a browser.
 *
 * The service is `frontend/src/scene2d/lift.ts`: one pure clock, one frame, and
 * both painters (GEDUNG shaft + floor core) read it. This gate proves, from the
 * real modules:
 *
 *   a. 180 s at 30 Hz: the doors are open ONLY while the car stands at a floor
 *      (0 violations), in the idle service AND while a real rider is aboard;
 *   b. the landing indicator (`liftIndicatorLabel`, the exact string both
 *      painters draw) always names the car's own floor — 0 mismatches;
 *   c. a rider wins: the car follows the journey's own `liftPhase` and the idle
 *      clock is frozen; when the rider gets out the service resumes from that
 *      floor without a jump;
 *   d. `?still=1` is a frozen phase: two fresh runtimes produce the same
 *      position and door state, frame for frame;
 *   e. the car never leaves the shaft, in either view's geometry;
 *   f. the building is really alive: > 0 and ≤ 25 floor changes in 180 s, and
 *      the parameter table stays inside the asked-for windows (dwell 3–6 s,
 *      hold 1.2–1.8 s, open/close 0.6 s, cycle 30–45 s), with eased motion
 *      (zero velocity at both ends) and a counterweight that runs opposite.
 *
 *   frontend/node_modules/.bin/esbuild verify/lift_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/lift_check.mjs
 *   node /tmp/lift_check.mjs        # "LIFT OK", exit 0
 */
import { agentsFor } from '../frontend/src/lib/roster'
import type { FloorId } from '../frontend/src/lib/rooms'
import {
  BLD_CAR_H,
  BLD_LIFT,
  buildingGeometry,
  buildingLift,
  buildingLiftY,
  buildingLiftYAt,
} from '../frontend/src/scene2d/building'
import { SIDE_LIFT, sideLiftYAt } from '../frontend/src/scene2d/side'
import {
  LIFT_CYCLE_S,
  LIFT_DING_S,
  LIFT_DOOR_S,
  LIFT_LEGS_PER_CYCLE,
  LIFT_LEG_S,
  LIFT_OPEN_CLOCK,
  LIFT_PATTERN,
  LIFT_STILL_CLOCK,
  LIFT_STOPS,
  createLiftRuntime,
  emptyLiftFrame,
  pickRider,
  liftArrowGlyph,
  liftAt,
  liftCall,
  liftEase,
  liftFloorAt,
  liftFrame,
  liftIndicatorLabel,
  liftParams,
  liftResumeClock,
  liftStep,
  liftStillFrame,
  type LiftFrame,
  type LiftRider,
} from '../frontend/src/scene2d/lift'
import { journeyAt, journeyClock, journeyFor } from '../frontend/src/scene2d/journey'
import { clearBuildingCache, renderBuildingFrame } from '../frontend/src/scene2d/render-building'
import { clearStaticCache, renderFrame } from '../frontend/src/scene2d/render'
import { SIDE_W, sideTransform } from '../frontend/src/scene2d/side'
import { SCENE_ZOOM } from '../frontend/src/scene2d/building'
import { agentsFor as allAgents } from '../frontend/src/lib/roster'

let fails = 0
let checks = 0
const fail = (msg: string) => {
  fails++
  console.log('FAIL', msg)
}
const ok = (msg: string) => {
  checks++
  console.log('ok  ', msg)
}
const r2 = (v: number) => Math.round(v * 100) / 100
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps

const DT = 1 / 30
const SECONDS = 180
const STEPS = Math.round(SECONDS / DT)
const FLOORS: FloorId[] = [1, 2, 3]
const FLOOR_IDS: FloorId[] = [1, 2, 3]

// ------------------------------------------------------- 1. the parameters
{
  const p = liftParams()
  if (p.cycleS < 30 || p.cycleS > 45) fail(`cycle ${r2(p.cycleS)} s outside the 30–45 s window`)
  else ok(`cycle ${r2(p.cycleS)} s (${p.legsPerCycle} floor changes, one every ${r2(p.cycleS / p.legsPerCycle)} s)`)
  if (p.pattern.join('→') !== '1→2→3→2') fail(`pattern ${p.pattern.join('→')}, want 1→2→3→2`)
  else ok(`pattern ${p.pattern.join(' → ')} → ${p.pattern[0]} (fixed, no Math.random anywhere)`)
  if (LIFT_LEG_S <= 0) fail('a travel leg has no duration')
  // dwell 3–6 s, hold 1.2–1.8 s, open/close 0.6 s, per stop
  let bad = 0
  for (const s of LIFT_PATTERN) {
    const dwell = s.pre + s.open + s.hold + s.close + s.post
    if (dwell < 3 || dwell > 6) {
      bad++
      fail(`L${s.floor}: dwell ${r2(dwell)} s outside 3–6 s`)
    }
    if (s.hold < 1.2 || s.hold > 1.8) {
      bad++
      fail(`L${s.floor}: door hold ${r2(s.hold)} s outside 1.2–1.8 s`)
    }
    if (s.open !== LIFT_DOOR_S || s.close !== LIFT_DOOR_S) {
      bad++
      fail(`L${s.floor}: open/close ${s.open}/${s.close} s, want ${LIFT_DOOR_S}/${LIFT_DOOR_S}`)
    }
  }
  if (!bad) {
    ok(
      `stops ${LIFT_PATTERN.map((s) => `L${s.floor}:${r2(s.pre + s.open + s.hold + s.close + s.post)}`).join(' ')} ` +
        `— dwell 3–6 s, open ${LIFT_DOOR_S} s / hold 1.2–1.8 s / close ${LIFT_DOOR_S} s`,
    )
  }
  // eased, not linear: the ease is flat at both ends and fastest in the middle
  const q0 = liftEase(0)
  const q1 = liftEase(1)
  const qMid = liftEase(0.5)
  const slope0 = (liftEase(0.02) - liftEase(0)) / 0.02
  const slopeMid = (liftEase(0.52) - liftEase(0.48)) / 0.04
  if (q0 !== 0 || q1 !== 1) fail('ease does not start at 0 and end at 1')
  else if (slope0 > 0.2) fail(`ease starts at ${r2(slope0)} — a hard start`)
  else if (!(qMid > 0.49 && qMid < 0.51 && slopeMid > 1)) fail('ease is not an S-curve (no accel/decel)')
  else ok(`ease: slope ${r2(slope0)} at the floor, ${r2(slopeMid)} mid-ride, 0 → 1 (no rigid linear move)`)
}

// ------------------------------------- 2. 180 s of idle service @ 30 Hz (a)
const idle: LiftFrame[] = []
{
  const rt = createLiftRuntime(0)
  for (let i = 0; i < STEPS; i++) {
    const f = liftStep(rt, DT, null)
    // copy: `liftStep` writes into the runtime's one frame (gate q proves that)
    idle.push({ ...f })
  }
  let violations = 0
  let worst = 0
  for (const f of idle) {
    const atFloor = Math.abs(f.level - Math.round(f.level)) < 1e-6
    if (f.door > 1e-6 && (!atFloor || f.moving)) {
      violations++
      worst = Math.max(worst, f.door)
    }
  }
  if (violations) fail(`doors open while moving/off-floor in ${violations}/${STEPS} idle frames (worst ${r2(worst)})`)
  else ok(`idle ${SECONDS} s @ 30 Hz: doors open in ${idle.filter((f) => f.door > 0).length} frames, 0 while moving`)
}

// the door cycle really is 0.6 / hold / 0.6, measured from the simulation
{
  const spans: number[] = []
  let open = false
  let t0 = 0
  idle.forEach((f, i) => {
    if (f.door > 0 && !open) {
      open = true
      t0 = i
    } else if (f.door === 0 && open) {
      open = false
      spans.push((i - t0) * DT)
    }
  })
  const want = LIFT_PATTERN.map((s) => s.open + s.hold + s.close)
  const within = spans.every((d) => want.some((w) => Math.abs(d - w) <= DT * 1.5))
  if (!spans.length) fail('no door cycle observed in 180 s')
  else if (!within) fail(`door-open spans ${spans.map(r2).join(',')} s do not match the table ${want.map(r2).join(',')}`)
  else ok(`${spans.length} door-open spans, each ${spans.map(r2).join(' / ')} s = open+hold+close`)
}

// ------------------------------------------- 3. indicator == car floor (b)
{
  const bad = idle.filter((f) => {
    const label = liftIndicatorLabel(f)
    const m = /^([▲▼·])L([123])$/.exec(label)
    return !m || Number(m[2]) !== f.floor || f.floor !== liftFloorAt(f.level)
  })
  if (bad.length) fail(`${bad.length} frames where the indicator disagrees with the car (first "${liftIndicatorLabel(bad[0]!)}" at level ${r2(bad[0]!.level)})`)
  else ok(`indicator "${liftIndicatorLabel(idle[7]!)}" … "${liftIndicatorLabel(idle[STEPS - 1]!)}": 0 mismatches in ${STEPS} frames`)
}

// arrows follow the real direction
{
  let bad = 0
  for (const f of idle) {
    if (liftArrowGlyph(f.dir) !== (f.dir > 0 ? '▲' : f.dir < 0 ? '▼' : '·')) bad++
    // moving → an arrow; standing with the doors open → `·` (going nowhere yet)
    if (f.moving && f.dir === 0) bad++
    if (f.door > 0 && f.dir !== 0) bad++
  }
  if (bad) fail(`${bad} frames with a wrong/absent arrow (moving without one, or one while the doors are open)`)
  else ok(`arrow matches travel: ▲ up (${idle.filter((f) => f.dir === 1).length} frames), ▼ down (${idle.filter((f) => f.dir === -1).length}), · standing (${idle.filter((f) => f.dir === 0).length})`)
}

// ------------------------------------------------ 4. shaft bounds, both views (e)
{
  let bad = 0
  for (const f of idle) {
    const yB = buildingLiftYAt(f.level)
    if (yB - BLD_CAR_H / 2 < BLD_LIFT.top - 1e-9 || yB + BLD_CAR_H / 2 > BLD_LIFT.bottom + 1e-9) bad++
    const yS = sideLiftYAt(f.level)
    if (yS - 38 < SIDE_LIFT.top || yS + 38 > SIDE_LIFT.bottom) bad++
  }
  if (bad) fail(`car leaves the shaft in ${bad} frames`)
  else {
    ok(
      `car inside the shaft always: GEDUNG y ${r2(buildingLiftYAt(3))}…${r2(buildingLiftYAt(1))} ±${BLD_CAR_H / 2} ` +
        `in ${BLD_LIFT.top}…${BLD_LIFT.bottom}; floor core ${r2(sideLiftYAt(3))}…${r2(sideLiftYAt(1))} in ${SIDE_LIFT.top}…${SIDE_LIFT.bottom}`,
    )
  }
  // level → y is the same shape in both views: exact on every floor, monotonic
  let bad2 = 0
  for (const fl of FLOORS) {
    if (!near(buildingLiftYAt(fl), buildingLiftY(fl), 1e-9)) bad2++
    if (!near(sideLiftYAt(fl), 540 - (fl - 1) * 100, 1e-9)) bad2++
  }
  if (bad2) fail('a floor level does not map onto its landing in one of the two views')
  else ok('one level → two views: GEDUNG y(1..3) = 304/212/120, floor core 540/440/340, exact on every floor')
}

// --------------------------------------- 5. the car really moves (f)
{
  let changes = 0
  let prevMoving = false
  for (const f of idle) {
    if (f.moving && !prevMoving) changes++
    prevMoving = f.moving
  }
  if (changes === 0) fail('the car never moved in 180 s')
  else if (changes > 25) fail(`${changes} floor changes in 180 s, above the sane ceiling of 25`)
  else ok(`${changes} floor changes in ${SECONDS} s (≈1 per ${r2(SECONDS / changes)} s) — alive, not frantic`)

  // it visits every floor, and the ladder is exactly the pattern
  const visited = new Set(idle.filter((f) => !f.moving).map((f) => f.floor))
  if (visited.size !== 3) fail(`the car only served ${[...visited].join(',')}`)
  else ok('the idle service visits L1, L2 and L3 (and passes L2 twice per cycle)')
  if (LIFT_STOPS.length !== LIFT_LEGS_PER_CYCLE) fail(`${LIFT_STOPS.length} stops but ${LIFT_LEGS_PER_CYCLE} legs`)
  else ok(`${LIFT_STOPS.length} stops / ${LIFT_LEGS_PER_CYCLE} travels per cycle`)
}

// ---------------------------------- 6. ding, call lamps, counterweight
{
  // one flash per arrival, LIFT_DING_S long, on a stopped car
  const flashes: number[] = []
  let on = false
  let t0 = 0
  idle.forEach((f, i) => {
    if (f.ding > 0 && !on) {
      on = true
      t0 = i
    } else if (f.ding === 0 && on) {
      on = false
      flashes.push((i - t0) * DT)
    }
  })
  if (flashes.length < 15) fail(`only ${flashes.length} arrival flashes in 180 s`)
  else if (!flashes.every((d) => d <= LIFT_DING_S + DT * 1.01)) fail(`a flash lasts ${Math.max(...flashes).toFixed(2)} s, more than ${LIFT_DING_S}`)
  else ok(`${flashes.length} arrival flashes, each ≤ ${LIFT_DING_S} s (≈${Math.round(LIFT_DING_S * 60)} frames at 60 Hz)`)
  const dinging = idle.filter((f) => f.ding > 0)
  if (dinging.some((f) => f.moving)) fail('the arrival flash fired while the car was moving')
  else ok('every flash lands on a stopped car (ding = arrival, never in motion)')

  // call lamp: lit for the floor served / the floor called, dark elsewhere
  let bad = 0
  for (const f of idle) {
    for (const fl of FLOOR_IDS) {
      const lamp = liftCall(f, fl)
      // lit = the floor being served, or the floor the car is heading to; the
      // floor it just left fades out over the first third of the leg
      const allowed = !f.moving ? fl === f.floor : fl === f.to || (fl === f.from && f.progress < 0.35)
      if (lamp > 0.5 && !allowed) bad++
      if (lamp > 0 && lamp < 0.5 && !(fl === f.from && f.moving && f.progress < 0.35)) bad++
      if (!f.moving && fl === f.floor && lamp < 1) bad++
      if (f.moving && fl === f.to && lamp < 1) bad++
    }
  }
  if (bad) fail(`${bad} call-panel lamp states disagree with the car`)
  else ok('call panel: served/called floor fully lit, the floor just left fades in the first third, the rest dark')

  // counterweight runs opposite the car
  const midB = (BLD_LIFT.top + BLD_LIFT.bottom) / 2
  const cwAt = (level: number) => Math.max(BLD_LIFT.top + 16, Math.min(BLD_LIFT.bottom - 16, 2 * midB - buildingLiftYAt(level)))
  // the car goes up (y smaller) → the counterweight goes down (y larger)
  if (!(cwAt(3) > cwAt(1))) fail('the counterweight does not run opposite the car')
  else if (!(cwAt(3) > BLD_LIFT.top && cwAt(1) < BLD_LIFT.bottom)) fail('the counterweight leaves the shaft')
  else ok(`counterweight mirrors the car: L3 car y ${r2(buildingLiftYAt(3))} → cw ${r2(cwAt(3))}, L1 car y ${r2(buildingLiftYAt(1))} → cw ${r2(cwAt(1))}`)
}

// ------------------------------------------- 7. rider wins (c), real journey
const metas = agentsFor([])
{
  const coder = metas.find((m) => m.id === 'coder')!
  const journey = journeyFor(coder, { kind: 'desk', id: 'default' })
  const rt = createLiftRuntime(0)
  const frames: Array<{ f: LiftFrame; rider: boolean; phase: number; target: FloorId }> = []
  let prevRider = false
  const riderFloors = { lift: 0, endpointErr: 0, backward: 0, maxDoorWhileMoving: 0, clockMoved: 0 }
  let heldClock = -1
  let prevLevel = NaN
  for (let i = 0; i < Math.round(60 / DT); i++) {
    const t = i * DT
    const j = journeyAt(journey, journeyClock(coder, journey, t))
    const rider: LiftRider | null = j.inLift
      ? { id: coder.id, floor: j.floor, inLift: true, liftTo: j.liftTo, phase: j.liftPhase }
      : null
    const f = liftStep(rt, DT, rider, t)
    frames.push({ f: { ...f }, rider: Boolean(rider), phase: j.liftPhase, target: (rider?.liftTo ?? j.floor) as FloorId })
    const ridingPrev = prevRider
    prevRider = Boolean(rider)
    if (rider) {
      riderFloors.lift++
      // the idle clock may not advance between two consecutive rider frames
      if (ridingPrev) {
        if (heldClock >= 0 && rt.clock !== heldClock) riderFloors.clockMoved++
        heldClock = rt.clock
      } else heldClock = rt.clock
      // the car stands at the source while the doors work, and has arrived by
      // the time the journey lets the agent out (86 % of the leg onward)
      const atSource = rider.phase! <= 0.14
      const arrived = rider.phase! >= 0.86
      if (atSource && !near(f.level, rider.floor, 1e-9)) riderFloors.endpointErr++
      if (arrived && !near(f.level, rider.liftTo!, 1e-9)) riderFloors.endpointErr++
      // and it never travels the wrong way
      if (!atSource && !Number.isNaN(prevLevel)) {
        const step = f.level - prevLevel
        if (rider.liftTo! > rider.floor ? step < -1e-9 : step > 1e-9) riderFloors.backward++
      }
      if (f.door > 1e-6 && (f.moving || Math.abs(f.level - Math.round(f.level)) > 1e-6)) {
        riderFloors.maxDoorWhileMoving = Math.max(riderFloors.maxDoorWhileMoving, f.door)
      }
      if (f.rider !== coder.id) fail('a rider frame without the rider on the car')
    } else {
      heldClock = -1
    }
    prevLevel = f.level
  }
  if (!riderFloors.lift) fail('the journey never put an agent in the lift')
  else ok(`rider aboard for ${riderFloors.lift} frames (${r2(riderFloors.lift * DT)} s over 60 s)`)

  if (riderFloors.endpointErr) fail(`${riderFloors.endpointErr} rider frames where the car was not at the journey floor`)
  else ok('car sits at the source while the doors work and is at the destination from 86 % of the leg (follows the journey)')
  if (riderFloors.backward) fail(`the car travelled the wrong way in ${riderFloors.backward} rider frames`)
  else ok('rider travel is monotone in the journey direction (never backwards)')

  if (riderFloors.clockMoved) fail(`the idle clock advanced ${riderFloors.clockMoved} frames while a rider held the service`)
  else ok('idle clock frozen for the whole ride (the service waits, it does not fight)')

  if (riderFloors.maxDoorWhileMoving > 1e-6) fail(`doors at ${r2(riderFloors.maxDoorWhileMoving)} while the rider's car moved`)
  else ok('rider doors: shut for the whole travel, 0 frames open in motion')

  // on release the car stands exactly at the destination and the service picks
  // up that floor's stop — no jump in position, no jump in door phase
  let resumes = 0
  let maxJump = 0
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!
    const b = frames[i]!
    if (!a.rider || b.rider) continue
    resumes++
    maxJump = Math.max(maxJump, Math.abs(b.f.level - a.f.level))
    if (b.f.door > 1e-6 && a.f.level === a.f.level) {
      // doors close again from the released state: allowed only to 0
      maxJump = Math.max(maxJump, b.f.door)
    }
    if (Math.abs(a.f.level - Math.round(a.f.level)) > 1e-6) fail(`rider released at level ${r2(a.f.level)}, not at a floor`)
    if (b.f.rider !== null) fail('the car is still ridden after the agent got out')
  }
  if (!resumes) fail('the rider never got out in 60 s')
  else if (maxJump > 0.05) fail(`the car jumped ${r2(maxJump)} at a hand-over (want continuity)`)
  else ok(`${resumes} rider hand-over(s): car stays at the floor it was left on, doors restart from shut (max step ${maxJump.toFixed(3)})`)

  // and the destination really is the journey's target
  const lastRider = [...frames].reverse().find((x) => x.rider)
  if (!lastRider) fail('no rider frame captured')
  else {
    const dest = lastRider.target
    if (!near(lastRider.f.level, dest, 0.02)) {
      fail(`the ride ends at level ${r2(lastRider.f.level)}, expected L${dest}`)
    } else {
      ok(
        `ride ends at L${dest} (level ${r2(lastRider.f.level)}); the service restarts at liftResumeClock(L${dest}) = ${r2(liftResumeClock(dest))} s`,
      )
    }
  }
}

// the two riders case: the lowest id wins, never a flicker between them
{
  const a: LiftRider = { id: 'coder', floor: 3, inLift: true, liftTo: 1, phase: 0.5 }
  const b: LiftRider = { id: 'dev', floor: 1, inLift: true, liftTo: 3, phase: 0.5 }
  const idleRider: LiftRider = { id: 'planner', floor: 2, inLift: false, liftTo: null }
  if (pickRider([b, a])?.id !== 'coder' || pickRider([a, b])?.id !== 'coder') {
    fail('two simultaneous riders do not pick the lowest id')
  } else if (pickRider([idleRider]) !== null) fail('an agent that is not in the lift was picked as rider')
  else ok('two simultaneous riders: the lowest id always drives the car (no flicker); a non-rider never does')
}

// ------------------------------------------------ 8. frozen phases (d)
{
  const a = createLiftRuntime(LIFT_STILL_CLOCK)
  const b = createLiftRuntime(LIFT_STILL_CLOCK)
  let same = true
  for (let i = 0; i < 5; i++) {
    const fa = { ...liftStep(a, 0, null) }
    const fb = { ...liftStep(b, 0, null) }
    if (JSON.stringify(fa) !== JSON.stringify(fb)) same = false
  }
  if (!same) fail('two frozen runtimes drift apart')
  else ok(`?still=1: two runtimes, same clock ${LIFT_STILL_CLOCK} s → identical level/door/ding for 5 calls`)

  const still = liftStillFrame()
  if (still.floor !== 1 || still.moving || still.door !== 0) {
    fail(`still frame is L${still.floor} moving=${still.moving} door=${r2(still.door)}, want L1 stopped, doors shut`)
  } else ok(`?still=1 parks the car at L1 (level ${still.level}), doors shut, no flash (${liftIndicatorLabel(still)})`)

  const open = liftStillFrame(LIFT_OPEN_CLOCK)
  if (open.floor !== 1 || open.door !== 1 || open.moving) fail(`?lift=open: L${open.floor} door ${r2(open.door)}`)
  else ok(`?lift=open freezes L1 with the doors fully open (door ${open.door}) — screenshot phase`)

  // dt = 0 advances nothing: the frame the loop paints for reduced motion
  // (Office2D passes no rider and dt 0) is the same lobby frame, forever
  const rm = createLiftRuntime(LIFT_STILL_CLOCK)
  let held = true
  for (let i = 0; i < 200; i++) {
    const f = liftStep(rm, 0, null)
    if (f.level !== 1 || f.door !== 0 || f.moving) held = false
  }
  if (!held) fail('a frozen runtime drifted')
  else ok('dt = 0 × 200 calls: the car stays at L1 with the doors shut (reduced-motion frame)')
}

// ---------------------------------- 9. determinism + no per-frame allocation
{
  const same = JSON.stringify(liftFrame(12.34)) === JSON.stringify(liftFrame(12.34))
  const sameRider = JSON.stringify(liftFrame(12.34, { id: 'coder', floor: 3, inLift: true, liftTo: 1, phase: 0.4 })) ===
    JSON.stringify(liftFrame(12.34, { id: 'coder', floor: 3, inLift: true, liftTo: 1, phase: 0.4 }))
  if (!same || !sameRider) fail('the same clock produced two different frames')
  else ok('pure function of the clock: same t → same frame (idle and rider)')

  const scratch = emptyLiftFrame()
  const returns: boolean[] = []
  for (let i = 0; i < 1000; i++) returns.push(liftAt(scratch, i * DT) === scratch)
  if (returns.some((v) => !v)) fail('liftAt allocated instead of writing into the frame')
  else ok('liftAt writes into the caller’s frame: 1000 calls, 0 allocations')

  // the whole cycle is covered: 0…cycle maps monotonically through the ladder
  const cyc = Math.round(LIFT_CYCLE_S / DT)
  const levels: number[] = []
  for (let i = 0; i <= cyc; i++) levels.push(liftFrame(i * DT).level)
  if (Math.min(...levels) < 1 || Math.max(...levels) > 3) fail('a cycle leaves the 1…3 level range')
  else ok(`one cycle (${cyc} samples) stays inside level 1…3, endpoints ${r2(levels[0]!)} → ${r2(levels[cyc]!)}`)
}

// ------------------------------------------ 10. the wiring both views share
{
  const g = buildingGeometry(metas)
  const l = g.lift
  for (const key of ['level', 'floor', 'door', 'dir', 'ding', 'call1', 'call2', 'call3', 'rider', 'moving', 'progress'] as const) {
    if (!(key in l)) {
      fail(`buildingGeometry().lift is missing "${key}" — the GEDUNG painter would have to guess`)
      break
    }
  }
  if (typeof g.lift.clock !== 'number') fail('buildingGeometry().lift has no clock')
  else ok('GEDUNG geometry ships the shared frame (level, floor, door, dir, ding, call lamps, clock)')

  const b = buildingLift([], LIFT_STILL_CLOCK)
  if (!near(b.y, buildingLiftY(1), 1e-9) || b.x !== BLD_LIFT.x || b.h !== BLD_CAR_H) {
    fail(`buildingLift() rect ${b.x},${r2(b.y)} ${b.w}×${b.h} does not sit at L1`)
  } else ok(`buildingLift() at the frozen clock: rect x ${b.x} y ${r2(b.y)} ${b.w}×${b.h} — L1, car bottom on the floor line`)

  // riders are honoured through the same entry point
  const riding = buildingLift([{ id: 'coder', floor: 3, inLift: true, liftTo: 1, phase: 0.5 }], 0)
  if (riding.riderId !== 'coder' || !riding.moving || riding.progress <= 0 || riding.progress >= 1) {
    fail(`buildingLift() ignored its rider (${JSON.stringify({ rider: riding.riderId, p: riding.progress })})`)
  } else ok(`buildingLift() follows a rider: L3 → L1 at progress ${r2(riding.progress)}, y ${r2(riding.y)} between bands`)
}

// ------------------------------- 11. the painters really paint the frame
/**
 * A canvas 2D recorder good enough for both painters: it follows translate /
 * scale / setTransform and keeps every rect, so "the car moved" is measured
 * from the paint calls, not from the module that produced them. Any method it
 * does not know is a no-op, so a painter change can never crash the gate.
 */
function recorder() {
  const rects: Array<{ name: string; box: [number, number, number, number] }> = []
  const texts: string[] = []
  let a = 1
  let d = 1
  let e = 0
  let f = 0
  const stack: Array<[number, number, number, number]> = []
  const grad = { addColorStop() {} }
  const noop = () => undefined
  const api: Record<string, (...args: never[]) => unknown> = {
    fillRect: ((x: number, y: number, w: number, h: number) =>
      rects.push({ name: 'fillRect', box: [a * x + e, d * y + f, a * (x + w) + e, d * (y + h) + f] })) as never,
    strokeRect: ((x: number, y: number, w: number, h: number) =>
      rects.push({ name: 'strokeRect', box: [a * x + e, d * y + f, a * (x + w) + e, d * (y + h) + f] })) as never,
    fillText: ((s: string, x: number, y: number) => {
      texts.push(String(s))
      rects.push({ name: 'fillText', box: [a * x + e, d * y + f, a * x + e, d * y + f] })
    }) as never,
    drawImage: ((_img: unknown, x: number, y: number, w = 0, h = 0) =>
      rects.push({ name: 'drawImage', box: [a * x + e, d * y + f, a * (x + w) + e, d * (y + h) + f] })) as never,
    translate: ((x: number, y: number) => {
      e += a * x
      f += d * y
    }) as never,
    scale: ((x: number, y: number) => {
      a *= x
      d *= y
    }) as never,
    setTransform: ((a2: number, _b: number, _c: number, d2: number, e2: number, f2: number) => {
      a = a2
      d = d2
      e = e2
      f = f2
    }) as never,
    save: (() => stack.push([a, d, e, f])) as never,
    restore: (() => {
      const m = stack.pop()
      if (m) {
        a = m[0]
        d = m[1]
        e = m[2]
        f = m[3]
      }
    }) as never,
    measureText: ((s: string) => ({ width: String(s).length * 6 })) as never,
    createLinearGradient: (() => grad) as never,
    createRadialGradient: (() => grad) as never,
  }
  const styles: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    lineWidth: 1,
    font: '8px sans-serif',
    textBaseline: 'top',
    textAlign: 'start',
    imageSmoothingEnabled: true,
  }
  const ctx = new Proxy(styles, {
    get(t, p) {
      if (typeof p !== 'string') return undefined
      if (p in t) return t[p]
      if (p in api) return api[p]
      if (p === 'canvas') return undefined
      return noop
    },
    set(t, p, v) {
      if (typeof p === 'string') t[p] = v
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, texts }
}
const sheetCanvas = () => {
  const rec = recorder()
  return { width: 0, height: 0, style: {}, getContext: () => rec.ctx, rec }
}
;(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
    return sheetCanvas() as unknown as HTMLCanvasElement
  },
}
{
  const metas2 = allAgents([])
  const NOW = 1_760_000_000
  const byId = new Map<string, never>()

  // the GEDUNG painter works in design px under one camera: the blit scale is
  // sideTransform(...).s and the dynamic pass adds SCENE_ZOOM on top
  const bTr = sideTransform(1000, 688, { camX: 500, camY: 344, zoom: 2, floor: 1 }, 0)
  const k = bTr.s * SCENE_ZOOM
  /** the car's ceiling-lamp strip: a 17 px fillRect 7 px below the car roof */
  const lampTop = (rects: Array<{ name: string; box: [number, number, number, number] }>) => {
    const hit = rects.find(
      (r) =>
        r.name === 'fillRect' &&
        Math.abs(r.box[2] - r.box[0] - 17 * k) < 0.02 &&
        Math.abs(r.box[0] - (BLD_LIFT.x + 6) * k) < 0.02,
    )
    return hit ? (hit.box[1] - bTr.top) / k : NaN
  }

  const paintBuilding = (clock: number) => {
    clearBuildingCache()
    const rec = recorder()
    renderBuildingFrame(rec.ctx, {
      theme: 'day',
      metas: metas2,
      byId: byId as never,
      now: NOW,
      comms: [],
      vp: { camX: 500, camY: 344, zoom: 2, floor: 1 },
      viewW: 1000,
      viewH: 688,
      dpr: 1,
      still: true,
      t: clock,
      lift: liftFrame(clock),
    })
    return rec
  }
  const stopA = paintBuilding(LIFT_STILL_CLOCK) // parked at L1
  const midB = paintBuilding(LIFT_PATTERN[0]!.pre + LIFT_PATTERN[0]!.open + LIFT_PATTERN[0]!.hold + LIFT_PATTERN[0]!.close + LIFT_PATTERN[0]!.post + LIFT_LEG_S / 2) // mid L1 → L2
  const yA = lampTop(stopA.rects)
  const yB = lampTop(midB.rects)
  if (Number.isNaN(yA) || Number.isNaN(yB)) fail('the GEDUNG painter draws no lift car')
  else if (Math.abs(yA - yB) < 20) fail(`the car did not move between two clocks (roof ${r2(yA)} vs ${r2(yB)})`)
  else ok(`GEDUNG painter: the car is painted at y ${r2(yA)} (L1) and y ${r2(yB)} (between L1 and L2) — it really rides`)

  const frames = (clock: number) => liftFrame(clock)
  if (!stopA.texts.includes(liftIndicatorLabel(frames(LIFT_STILL_CLOCK)))) {
    fail(`the landing indicator "${liftIndicatorLabel(frames(LIFT_STILL_CLOCK))}" is not painted in the GEDUNG view`)
  } else ok(`GEDUNG painter draws the indicator "${liftIndicatorLabel(frames(LIFT_STILL_CLOCK))}" above the door`)
  const plateA = stopA.texts.filter((s) => s.startsWith('▸'))
  if (plateA.length !== 1) fail(`GEDUNG car plate painted ${plateA.length} times (${plateA.join(',')})`)
  else ok(`GEDUNG car plate "${plateA[0]}" (one per frame, never doubled)`)

  // floor view: the same frame, one landing
  const paintFloor = (clock: number) => {
    clearStaticCache()
    const rec = recorder()
    renderFrame(rec.ctx, {
      theme: 'night',
      metas: metas2,
      byId: byId as never,
      now: NOW,
      comms: [],
      vp: { camX: SIDE_W / 2, zoom: 2, floor: 1 },
      viewW: 1280,
      viewH: 800,
      dpr: 1,
      still: true,
      t: clock,
      lift: liftFrame(clock),
      hour: 14,
      minute: 5,
    })
    return rec
  }
  const open = paintFloor(LIFT_OPEN_CLOCK)
  if (!open.texts.includes(liftIndicatorLabel(frames(LIFT_OPEN_CLOCK)))) {
    fail(`floor painter: indicator "${liftIndicatorLabel(frames(LIFT_OPEN_CLOCK))}" missing`)
  } else ok(`floor painter draws the same indicator "${liftIndicatorLabel(frames(LIFT_OPEN_CLOCK))}" and "▸ L${frames(LIFT_OPEN_CLOCK).floor}" plate`)
  const plateF = open.texts.filter((s) => s.startsWith('▸'))
  if (plateF.length !== 1) fail(`floor car plate painted ${plateF.length} times`)
  else if (plateF[0] !== `▸ L${frames(LIFT_OPEN_CLOCK).to}`) fail(`floor plate "${plateF[0]}" ≠ to L${frames(LIFT_OPEN_CLOCK).to}`)
  else ok(`floor car plate "${plateF[0]}" matches the frame's destination`)
  // the landing door is drawn as two leaves that move with the frame
  const fTr = sideTransform(1280, 800, { camX: SIDE_W / 2, zoom: 2, floor: 1 }, 0)
  const leaves = (rec: { rects: Array<{ name: string; box: [number, number, number, number] }> }) =>
    rec.rects.filter(
      (r) =>
        r.name === 'fillRect' &&
        Math.abs(r.box[0] - (fTr.left + (SIDE_LIFT.x + 12) * fTr.s)) < 0.02 &&
        r.box[3] - r.box[1] > 60 * fTr.s,
    )
  const closedLeaves = leaves(paintFloor(LIFT_STILL_CLOCK))
  const openLeaves = leaves(open)
  const wClosed = closedLeaves.reduce((n, r) => n + (r.box[2] - r.box[0]), 0)
  const wOpen = openLeaves.reduce((n, r) => n + (r.box[2] - r.box[0]), 0)
  if (!closedLeaves.length || !openLeaves.length) fail('the landing door leaves are not painted')
  else if (!(wClosed > wOpen + 20)) fail(`door leaves did not open (${r2(wClosed)} px shut vs ${r2(wOpen)} px open)`)
  else ok(`landing door leaves move: ${r2(wClosed)} px of leaf shut → ${r2(wOpen)} px with the doors open`)
}

// ------------------------------------------------------------------ report
console.log()
if (fails) {
  console.log(`LIFT FAILED — ${fails} problem(s), ${checks} ok`)
  process.exit(1)
}
console.log(`LIFT OK — ${checks} checks · cycle ${r2(LIFT_CYCLE_S)} s · ${LIFT_LEGS_PER_CYCLE} travels · ${STEPS} frames @ 30 Hz`)
