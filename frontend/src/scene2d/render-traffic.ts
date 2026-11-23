/**
 * Painter for the street life of the GEDUNG view: traffic, pedestrians, the
 * signal head, and the slow sky (clouds, birds, blinking neighbour windows).
 *
 * Everything here is cheap: `fillRect`, one or two short paths per entity, no
 * gradients in the loop, no images, no per-frame allocation (the geometry comes
 * from `traffic.ts`, which reuses its buffers).
 *
 * Occlusion rules (gate g):
 *   - vehicles keep their wheels on their lane line; a 3.2 m bus legitimately
 *     rises above the foreshortened lane depth, never above `BLD.baseY`;
 *   - pedestrians stand on a pavement (feet in the band) or walk the zebra;
 *   - clouds and birds are clipped to the sky above the roof and to the two
 *     side bays, so nothing ever covers the facade — the smoke just disappears
 *     behind the tower, which is what it should do;
 *   - the signal head stands on the near pavement, clear of `BLD.baseY`;
 *   - every part is painted from the bbox (`PX_PER_M × metres`), never from a
 *     hardcoded pixel size.
 */
import { BLD, BLD_STREET, SCENE_W } from './building'
import { THEME_TOKENS, type ThemeName } from './palette'
import {
  BIRDS,
  CLOUDS,
  ROAD,
  SIGNAL,
  birdAt,
  blinkAt,
  cloudX,
  neighbourWindows,
  type LightState,
  type PedView,
  type TrafficFrame,
  type VehicleView,
} from './traffic'

type Ctx = CanvasRenderingContext2D
const TAU = Math.PI * 2

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + k, y)
  ctx.lineTo(x + w - k, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + k)
  ctx.lineTo(x + w, y + h - k)
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h)
  ctx.lineTo(x + k, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - k)
  ctx.lineTo(x, y + k)
  ctx.quadraticCurveTo(x, y, x + k, y)
  ctx.closePath()
}

/** Deterministic 0…n-1 from an id (no Math.random in the painter). */
function hash(id: string, n: number): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % n
}

const BODY = {
  day: ['#C9463F', '#3C6FA8', '#D9A33C', '#4E8F73', '#DDE3EC', '#7E5C9E'],
  night: ['#9A423B', '#2E5480', '#A87C2C', '#3A6A58', '#7D8797', '#5E4076'],
} as const

const GLASS = { day: '#BFDCF0', night: '#16233A' } as const
const WHEEL = { day: '#1D2634', night: '#080D16' } as const
const PED_COAT = {
  day: ['#3C6FA8', '#B0553F', '#4E8F73', '#7B5EA7'],
  night: ['#2E5480', '#7C3B2E', '#3A6A58', '#54406F'],
} as const
const PED_LEG = { day: '#2F3A4A', night: '#131B28' } as const
const SKIN = { day: '#E8C39B', night: '#AF9273' } as const

// ------------------------------------------------------------------- sky

/** Nothing in the sky may paint over the facade bay (see the file header). */
const SKY_CLIP: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, SCENE_W, BLD.roofTop], // above the roof
  [0, 0, BLD.x0 - 8, BLD_STREET.top], // left bay
  [BLD.x1 + 8, 0, SCENE_W - (BLD.x1 + 8), BLD_STREET.top], // right bay
]

function clipSky(ctx: Ctx): void {
  ctx.beginPath()
  for (const [x, y, w, h] of SKY_CLIP) ctx.rect(x, y, w, h)
  ctx.clip()
}

function drawClouds(ctx: Ctx, t: number): void {
  for (const c of CLOUDS) {
    const x = cloudX(c, t)
    if (x > SCENE_W + 10 || x + c.w < -10) continue
    const y = c.y
    ctx.fillStyle = '#FFFFFF'
    ctx.globalAlpha = c.alpha * 0.9
    ctx.beginPath()
    ctx.ellipse(x + c.w * 0.28, y + 8, c.w * 0.24, 7, 0, 0, TAU)
    ctx.ellipse(x + c.w * 0.55, y + 4, c.w * 0.3, 9, 0, 0, TAU)
    ctx.ellipse(x + c.w * 0.8, y + 8, c.w * 0.2, 6.5, 0, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = c.alpha * 0.4
    ctx.fillStyle = '#DCEBF7'
    ctx.beginPath()
    ctx.ellipse(x + c.w * 0.55, y + 11, c.w * 0.28, 4, 0, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawBirds(ctx: Ctx, t: number): void {
  ctx.strokeStyle = '#33465C'
  ctx.lineWidth = 1.1
  for (const b of BIRDS) {
    const s = birdAt(b, t)
    if (!s.visible) continue
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.moveTo(s.x - b.size, s.y + s.flap)
    ctx.lineTo(s.x, s.y + b.size * 0.35)
    ctx.lineTo(s.x + b.size, s.y + s.flap)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/** Night: a deterministic subset of the skyline windows breathes. */
function drawWindowBlink(ctx: Ctx, theme: ThemeName, t: number): void {
  if (theme !== 'night') return
  const warm = THEME_TOKENS.night.city.windowWarm
  ctx.fillStyle = warm
  for (const w of neighbourWindows()) {
    const a = blinkAt(w, t)
    if (a < 0.1) continue
    ctx.globalAlpha = a * 0.8
    ctx.fillRect(w.x, w.y, 2, 2.6)
  }
  ctx.globalAlpha = 1
}

export function drawSkyLife(ctx: Ctx, theme: ThemeName, t: number): void {
  ctx.save()
  clipSky(ctx)
  if (theme === 'night') drawWindowBlink(ctx, theme, t)
  else {
    drawClouds(ctx, t)
    drawBirds(ctx, t)
  }
  ctx.restore()
}

// ---------------------------------------------------------------- vehicles

function headlight(ctx: Ctx, v: VehicleView): void {
  const front = v.dir > 0 ? v.x + v.w / 2 : v.x - v.w / 2
  const base = v.y + v.h
  const cy = base - v.h * 0.38
  const cone = v.w * 0.2
  // two alpha layers only: a soft cone and the lamp itself
  ctx.fillStyle = 'rgba(255,228,150,0.16)'
  ctx.beginPath()
  ctx.moveTo(front, cy - v.h * 0.07)
  ctx.lineTo(front + v.dir * cone, cy - v.h * 0.18)
  ctx.lineTo(front + v.dir * cone, cy + v.h * 0.1)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255,236,178,0.3)'
  ctx.beginPath()
  ctx.moveTo(front, cy - v.h * 0.04)
  ctx.lineTo(front + v.dir * cone * 0.55, cy - v.h * 0.1)
  ctx.lineTo(front + v.dir * cone * 0.55, cy + v.h * 0.06)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#FFEDB0'
  ctx.fillRect(v.dir > 0 ? front - v.w * 0.025 : front - v.w * 0.005, cy - v.h * 0.05, v.w * 0.03, v.h * 0.1)
}

function tailLight(ctx: Ctx, v: VehicleView): void {
  const rear = v.dir > 0 ? v.x - v.w / 2 : v.x + v.w / 2
  const base = v.y + v.h
  ctx.fillStyle = 'rgba(255,86,74,0.92)'
  ctx.fillRect(v.dir > 0 ? rear + v.w * 0.01 : rear - v.w * 0.035, base - v.h * 0.34, v.w * 0.025, v.h * 0.1)
}

/**
 * One side-view vehicle, every part derived from the bbox — never from a
 * hardcoded pixel size. The bbox is `PX_PER_M × real metres` (110×37 car,
 * 220×78 bus), so the same routine paints a correct car and a correct bus.
 */
function drawVehicle(ctx: Ctx, theme: ThemeName, v: VehicleView): void {
  const night = theme === 'night'
  const x0 = v.x - v.w / 2
  const base = v.y + v.h
  const body = BODY[theme][hash(v.id, BODY[theme].length)]!
  const glass = GLASS[theme]
  const wheelH = Math.round(v.h * 0.34)
  const wheelW = Math.round(wheelH * 0.95)
  const bodyBottom = base - Math.round(wheelH * 0.5)

  // contact shadow
  ctx.fillStyle = night ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.15)'
  ctx.fillRect(x0 + v.w * 0.02, base - Math.max(2, v.h * 0.05), v.w * 0.96, Math.max(2, v.h * 0.07))

  if (night) {
    headlight(ctx, v)
  }

  if (v.kind === 'moto') {
    const cx = v.x
    const wr = v.h * 0.22
    const headR = v.h * 0.16
    ctx.fillStyle = WHEEL[theme]
    ctx.beginPath()
    ctx.arc(cx - v.w * 0.32, base - wr, wr, 0, TAU)
    ctx.arc(cx + v.w * 0.32, base - wr, wr, 0, TAU)
    ctx.fill()
    // frame + rider (head tops out exactly at v.y)
    ctx.fillStyle = body
    ctx.fillRect(cx - v.w * 0.28, base - v.h * 0.42, v.w * 0.56, v.h * 0.16)
    ctx.fillStyle = night ? '#0B111B' : '#26303E'
    ctx.fillRect(cx - v.w * 0.11, base - v.h * 0.68, v.w * 0.22, v.h * 0.28)
    ctx.fillStyle = SKIN[theme]
    ctx.beginPath()
    ctx.arc(cx + v.dir * v.w * 0.03, v.y + headR, headR, 0, TAU)
    ctx.fill()
    ctx.fillStyle = glass
    ctx.fillRect(cx + v.dir * v.w * 0.03 - v.w * 0.1, v.y + v.h * 0.06, v.w * 0.2, v.h * 0.14)
    if (night) {
      ctx.fillStyle = 'rgba(255,86,74,0.9)'
      ctx.fillRect(cx - v.dir * v.w * 0.46, base - v.h * 0.46, v.w * 0.035, v.h * 0.14)
    }
    return
  }

  const slabTop = base - Math.round(v.h * 0.5)
  if (v.kind === 'bus' || v.kind === 'van') {
    // one tall box from the roof line down to the skirt
    const bodyTop = v.y + 1
    const bodyH = bodyBottom - bodyTop
    ctx.fillStyle = body
    rr(ctx, x0, bodyTop, v.w, bodyH, Math.max(2, v.h * 0.08))
    ctx.fill()
    ctx.fillStyle = night ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.45)'
    ctx.fillRect(x0 + v.w * 0.012, bodyTop + Math.max(1, v.h * 0.02), v.w * 0.976, Math.max(1, v.h * 0.025))
    if (v.kind === 'bus') {
      // continuous window band: five bays
      const pad = v.w * 0.035
      const bays = 5
      const bay = (v.w - pad * 2) / bays
      ctx.fillStyle = glass
      for (let i = 0; i < bays; i++) {
        ctx.fillRect(x0 + pad + i * bay + bay * 0.08, bodyTop + bodyH * 0.16, bay * 0.84, bodyH * 0.34)
      }
      // headlights strip + door pillar
      ctx.fillStyle = night ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'
      ctx.fillRect(x0 + v.w * 0.94, bodyTop, Math.max(1, v.w * 0.01), bodyH)
    } else {
      // windshield at the leading end, cargo panel behind
      const winW = v.w * 0.16
      const winX = v.dir > 0 ? x0 + v.w * 0.08 : x0 + v.w * 0.92 - winW
      ctx.fillStyle = glass
      rr(ctx, winX, bodyTop + bodyH * 0.12, winW, bodyH * 0.34, Math.max(1, v.h * 0.03))
      ctx.fill()
      const panelX = v.dir > 0 ? winX + winW + v.w * 0.04 : x0 + v.w * 0.08
      ctx.fillStyle = night ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.1)'
      ctx.fillRect(panelX, bodyTop + bodyH * 0.16, v.w * 0.34, bodyH * 0.4)
    }
  } else {
    // car: a body slab plus a greenhouse whose roof touches the bbox top
    const bodyH = bodyBottom - slabTop
    ctx.fillStyle = body
    rr(ctx, x0, slabTop, v.w, bodyH, Math.max(2, v.h * 0.08))
    ctx.fill()
    ctx.fillStyle = night ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.45)'
    ctx.fillRect(x0 + v.w * 0.012, slabTop + Math.max(1, v.h * 0.02), v.w * 0.976, Math.max(1, v.h * 0.025))
    const cabH = slabTop - v.y + 2
    const cabW = v.w * 0.42
    const inset = v.w * 0.14
    const cabX = v.dir > 0 ? x0 + inset : x0 + v.w - inset - cabW
    ctx.fillStyle = glass
    rr(ctx, cabX, v.y, cabW, cabH, Math.max(1, v.h * 0.05))
    ctx.fill()
    ctx.fillStyle = night ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.55)'
    ctx.fillRect(cabX + cabW * 0.06, v.y + Math.max(1, v.h * 0.03), cabW * 0.88, Math.max(1, v.h * 0.03))
  }

  // wheels
  ctx.fillStyle = WHEEL[theme]
  ctx.fillRect(x0 + v.w * 0.16, base - wheelH, wheelW, wheelH)
  ctx.fillRect(x0 + v.w * 0.8 - wheelW, base - wheelH, wheelW, wheelH)

  if (night) tailLight(ctx, v)
}

// ------------------------------------------------------------- pedestrians

/** One 42 px walker: limbs and torso are fractions of `p.h`, never constants. */
function drawPed(ctx: Ctx, theme: ThemeName, p: PedView): void {
  const night = theme === 'night'
  const base = p.y
  const coat = PED_COAT[theme][p.coat % PED_COAT[theme].length]!
  const headR = p.h * 0.12
  const headCy = base - p.h + headR
  const torsoTop = headCy + headR * 0.8
  const legH = p.h * 0.24
  const torsoH = base - legH - torsoTop
  const torsoW = p.h * 0.2

  if (!p.crossing) {
    ctx.fillStyle = night ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.13)'
    ctx.fillRect(p.x - p.w * 0.65, base - 1, p.w * 1.3, 2)
  }

  // legs: two frames, feet apart / together
  const swing = p.frame === 0 ? p.h * 0.05 : 0
  ctx.fillStyle = PED_LEG[theme]
  ctx.fillRect(p.x - p.w * 0.22 + swing * 0.5, base - legH, Math.max(1.5, p.w * 0.16), legH)
  ctx.fillRect(p.x + p.w * 0.06 - swing * 0.5, base - legH, Math.max(1.5, p.w * 0.16), legH)
  // torso
  ctx.fillStyle = coat
  ctx.fillRect(p.x - torsoW / 2, torsoTop, torsoW, torsoH)
  // arm swing
  ctx.fillRect(p.x + p.facing * (torsoW * 0.62 + swing * 0.4), torsoTop + p.h * 0.04, Math.max(1.2, p.w * 0.11), p.h * 0.24)
  // head
  ctx.fillStyle = SKIN[theme]
  ctx.beginPath()
  ctx.arc(p.x + p.facing * p.w * 0.05, headCy, headR, 0, TAU)
  ctx.fill()
}

// ----------------------------------------------------------------- signal

/**
 * Two small housings on one post: the vehicle head (red / amber / green) and,
 * 2 px to its right, the pedestrian head (green = walk, red = wait). Two
 * separate boxes, so a red walk lamp can never read as a red vehicle lamp.
 * The housing is 20 px (0.8 m) tall and stands between the facade base and the
 * kerb, so it never paints over the tower.
 */
function drawSignal(ctx: Ctx, theme: ThemeName, light: LightState): void {
  const night = theme === 'night'
  const { x, y, h } = SIGNAL
  const post = night ? '#111927' : '#5B6675'
  const housing = night ? '#090F18' : '#2B3543'
  const headW = 16
  const pedX = x + headW + 2
  const lampR = h * 0.1

  // post down to the pavement, under both heads
  ctx.fillStyle = post
  ctx.fillRect(pedX + 2, y + h, 2, BLD_STREET.walk - (y + h))
  ctx.fillRect(x + 2, y + h, 2, BLD_STREET.walk - (y + h))

  ctx.fillStyle = housing
  rr(ctx, x, y, headW, h, 2)
  ctx.fill()
  rr(ctx, pedX, y + 1, 8, h - 2, 1.5)
  ctx.fill()

  const lamps: Array<[LightState['phase'], number, string]> = [
    ['red', y + h * 0.2, '#E4574A'],
    ['yellow', y + h * 0.5, '#E8B23C'],
    ['green', y + h * 0.8, '#4FBF7B'],
  ]
  for (const [phase, ly, colour] of lamps) {
    const on = light.phase === phase
    ctx.fillStyle = colour
    ctx.globalAlpha = on ? 1 : 0.16
    ctx.beginPath()
    ctx.arc(x + headW / 2, ly, lampR, 0, TAU)
    ctx.fill()
    if (on) {
      ctx.globalAlpha = 0.28
      ctx.beginPath()
      ctx.arc(x + headW / 2, ly, lampR * 1.8, 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // pedestrian head: a walking figure when the road is red, a bar when not
  const walk = light.pedWalk
  ctx.fillStyle = walk ? '#4FBF7B' : '#E4574A'
  ctx.globalAlpha = walk ? 0.95 : 0.8
  if (walk) {
    ctx.fillRect(pedX + 3.6, y + 5, 1.6, 1.6) // head
    ctx.fillRect(pedX + 2.6, y + 7.5, 3.6, 1.4) // stride
    ctx.fillRect(pedX + 3.1, y + 9, 1.4, 4.2) // body
  } else {
    ctx.fillRect(pedX + 3.8, y + 6.2, 1.8, 1.8)
    ctx.fillRect(pedX + 3.2, y + 8.6, 3, 4.4)
  }
  ctx.globalAlpha = 1
}

// ------------------------------------------------------------------ layer

function laneVehicles(ctx: Ctx, theme: ThemeName, frame: TrafficFrame, lane: 'near' | 'far'): void {
  for (let i = 0; i < frame.vehicles.length; i++) {
    const v = frame.vehicles[i]!
    if (v.lane !== lane) continue
    drawVehicle(ctx, theme, v)
  }
}

/**
 * Paint order is depth order — back to front:
 *   1. walkers on the pavement the tower stands on (they are BEHIND the road),
 *   2. the far lane, the signal head on that kerb,
 *   3. the near lane,
 *   4. walkers on the foreground kerb at the bottom of the sheet (they are
 *      closer to the camera than any car and 42 px tall, so they overlap the
 *      road exactly like the real thing),
 *   5. the crossers last.
 * Getting 1 and 4 the wrong way round makes a foreground walker vanish behind
 * a bus, which is the bug this split exists to prevent.
 */
export function drawStreetLife(ctx: Ctx, theme: ThemeName, frame: TrafficFrame): void {
  for (const p of frame.peds) {
    if (p.crossing || p.y > ROAD.centre) continue
    drawPed(ctx, theme, p)
  }
  laneVehicles(ctx, theme, frame, 'far')
  drawSignal(ctx, theme, frame.light)
  laneVehicles(ctx, theme, frame, 'near')

  for (const p of frame.peds) {
    if (p.crossing || p.y <= ROAD.centre) continue
    drawPed(ctx, theme, p)
  }
  // crossers last: they walk in front of the stopped near lane
  for (const p of frame.peds) {
    if (!p.crossing) continue
    drawPed(ctx, theme, p)
  }
}
