/**
 * Painter for the street life of the GEDUNG view: traffic, pedestrians, the
 * signal head, and the slow sky (clouds, birds, blinking neighbour windows).
 *
 * Everything here is cheap: `fillRect`, one or two short paths per entity, no
 * gradients in the loop, no images, no per-frame allocation (the geometry comes
 * from `traffic.ts`, which reuses its buffers).
 *
 * Occlusion rules (gate f):
 *   - vehicles only ever paint inside the road band;
 *   - pedestrians only on the two pavements or on the zebra;
 *   - clouds and birds are clipped to the sky above the roof and to the two
 *     side bays, so nothing ever covers the facade — the smoke just disappears
 *     behind the tower, which is what it should do;
 *   - the signal head stands on the near pavement, clear of `BLD.baseY`.
 */
import { BLD, BLD_STREET, BUILDING_W } from './building'
import { THEME_TOKENS, type ThemeName } from './palette'
import {
  BIRDS,
  CLOUDS,
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
  [0, 0, BUILDING_W, 66], // above the roof
  [0, 0, BLD.x0 - 8, BLD_STREET.top], // left bay
  [BLD.x1 + 8, 0, BUILDING_W - (BLD.x1 + 8), BLD_STREET.top], // right bay
]

function clipSky(ctx: Ctx): void {
  ctx.beginPath()
  for (const [x, y, w, h] of SKY_CLIP) ctx.rect(x, y, w, h)
  ctx.clip()
}

function drawClouds(ctx: Ctx, t: number): void {
  for (const c of CLOUDS) {
    const x = cloudX(c, t)
    if (x > BUILDING_W + 10 || x + c.w < -10) continue
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
  const cy = base - v.h * 0.36
  // two alpha layers only: a soft cone and the lamp itself
  ctx.fillStyle = 'rgba(255,228,150,0.16)'
  ctx.beginPath()
  ctx.moveTo(front, cy - 2.4)
  ctx.lineTo(front + v.dir * 22, cy - 6.5)
  ctx.lineTo(front + v.dir * 22, cy + 3.6)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255,236,178,0.3)'
  ctx.beginPath()
  ctx.moveTo(front, cy - 1.6)
  ctx.lineTo(front + v.dir * 12, cy - 3.6)
  ctx.lineTo(front + v.dir * 12, cy + 2.2)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#FFEDB0'
  ctx.fillRect(v.dir > 0 ? front - 2.2 : front - 0.6, cy - 1.8, 2.8, 3)
}

function tailLight(ctx: Ctx, v: VehicleView): void {
  const rear = v.dir > 0 ? v.x - v.w / 2 : v.x + v.w / 2
  const base = v.y + v.h
  ctx.fillStyle = 'rgba(255,86,74,0.92)'
  ctx.fillRect(v.dir > 0 ? rear + 1 : rear - 3.6, base - 8, 2.6, 3.2)
}

function drawVehicle(ctx: Ctx, theme: ThemeName, v: VehicleView): void {
  const night = theme === 'night'
  const x0 = v.x - v.w / 2
  const base = v.y + v.h
  const body = BODY[theme][hash(v.id, BODY[theme].length)]!
  const glass = GLASS[theme]

  // contact shadow
  ctx.fillStyle = night ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.15)'
  ctx.fillRect(x0 + 2, base - 1.4, v.w - 4, 2.4)

  if (night) {
    headlight(ctx, v)
  }

  if (v.kind === 'moto') {
    const cx = v.x
    ctx.fillStyle = WHEEL[theme]
    ctx.fillRect(cx - 8, base - 4, 4, 4)
    ctx.fillRect(cx + 4, base - 4, 4, 4)
    ctx.fillStyle = body
    ctx.fillRect(cx - 5, base - 9, 10, 4)
    ctx.fillStyle = SKIN[theme]
    ctx.beginPath()
    ctx.arc(cx + v.dir * 1.5, base - 12, 2.6, 0, TAU)
    ctx.fill()
    ctx.fillStyle = glass
    ctx.fillRect(cx + v.dir * 1.5 - 2.4, base - 13.4, 4.8, 3)
    ctx.fillStyle = night ? '#0B111B' : '#26303E'
    ctx.fillRect(cx - 2, base - 10.4, 4, 2.2) // rider torso
    if (night) {
      ctx.fillStyle = 'rgba(255,86,74,0.9)'
      ctx.fillRect(cx - v.dir * 5.5, base - 9, 2, 2.6)
    }
    return
  }

  const bodyTop = v.kind === 'bus' ? base - 17 : v.kind === 'van' ? base - 13 : base - 12
  const bodyH = base - 3.5 - bodyTop
  ctx.fillStyle = body
  rr(ctx, x0, bodyTop, v.w, bodyH, v.kind === 'bus' ? 2.5 : 3)
  ctx.fill()
  // one highlight along the shoulder gives the slab some volume
  ctx.fillStyle = night ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.45)'
  ctx.fillRect(x0 + 1.5, bodyTop + 0.8, v.w - 3, 1)

  // cabin / roof, mirrored by direction (it sinks 1.6 px into the body)
  if (v.kind === 'bus') {
    ctx.fillStyle = glass
    const winW = (v.w - 14) / 4
    for (let i = 0; i < 4; i++) ctx.fillRect(x0 + 6 + i * (winW + 2), bodyTop + 3, winW - 2, 5)
  } else {
    const cabH = v.kind === 'van' ? 6.5 : 5.5
    const cabW = v.kind === 'van' ? v.w - 14 : v.w - 20
    const inset = v.kind === 'van' ? 6 : 9
    const cabX = v.dir > 0 ? x0 + inset : x0 + v.w - inset - cabW
    const cabY = bodyTop - cabH + 1.6
    ctx.fillStyle = glass
    rr(ctx, cabX, cabY, cabW, cabH, 1.2)
    ctx.fill()
    ctx.fillStyle = night ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.55)'
    ctx.fillRect(cabX + 1, cabY + 1, cabW - 2, 1)
  }

  // wheels
  ctx.fillStyle = WHEEL[theme]
  const wy = base - 4.6
  ctx.fillRect(x0 + 4, wy, 7, 4.6)
  ctx.fillRect(x0 + v.w - 11, wy, 7, 4.6)

  if (night) tailLight(ctx, v)
}

// ------------------------------------------------------------- pedestrians

function drawPed(ctx: Ctx, theme: ThemeName, p: PedView): void {
  const night = theme === 'night'
  const base = p.y
  const top = base - p.h
  const coat = PED_COAT[theme][p.coat % PED_COAT[theme].length]!

  if (!p.crossing) {
    ctx.fillStyle = night ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.13)'
    ctx.fillRect(p.x - p.w / 2, base - 1, p.w, 2)
  }

  // legs: two frames, feet apart / together
  const swing = p.frame === 0 ? 1.5 : 0
  ctx.fillStyle = PED_LEG[theme]
  ctx.fillRect(p.x - 1.9 + swing * 0.5, base - 3.4, 1.5, 3.4)
  ctx.fillRect(p.x + 0.4 - swing * 0.5, base - 3.4, 1.5, 3.4)
  // torso
  ctx.fillStyle = coat
  ctx.fillRect(p.x - 2.1, top + 4.6, 4.2, p.h - 8.4)
  // arm swing
  ctx.fillStyle = coat
  ctx.fillRect(p.x + p.facing * (1.4 + swing * 0.4), top + 5.4, 1.2, 4)
  // head
  ctx.fillStyle = SKIN[theme]
  ctx.beginPath()
  ctx.arc(p.x + p.facing * 0.4, top + 2.6, 2.3, 0, TAU)
  ctx.fill()
}

// ----------------------------------------------------------------- signal

/**
 * Two small housings on one post: the vehicle head (red / amber / green) and,
 * 2 px to its right, the pedestrian head (green = walk, red = wait). Two
 * separate boxes, so a red walk lamp can never read as a red vehicle lamp.
 */
function drawSignal(ctx: Ctx, theme: ThemeName, light: LightState): void {
  const night = theme === 'night'
  const { x, y, h } = SIGNAL
  const post = night ? '#111927' : '#5B6675'
  const housing = night ? '#090F18' : '#2B3543'
  const headW = 14
  const pedX = x + headW + 2

  // post down to the pavement, under both heads
  ctx.fillStyle = post
  ctx.fillRect(pedX + 2, y + h, 2, 2)
  ctx.fillRect(x + 2, y + h, 2, 2)

  ctx.fillStyle = housing
  rr(ctx, x, y, headW, h, 2)
  ctx.fill()
  rr(ctx, pedX, y + 1, 8, h - 2, 1.5)
  ctx.fill()

  const lamps: Array<[LightState['phase'], number, string]> = [
    ['red', y + 3.5, '#E4574A'],
    ['yellow', y + 8, '#E8B23C'],
    ['green', y + 12.5, '#4FBF7B'],
  ]
  for (const [phase, ly, colour] of lamps) {
    const on = light.phase === phase
    ctx.fillStyle = colour
    ctx.globalAlpha = on ? 1 : 0.16
    ctx.beginPath()
    ctx.arc(x + 7, ly, 1.9, 0, TAU)
    ctx.fill()
    if (on) {
      ctx.globalAlpha = 0.28
      ctx.beginPath()
      ctx.arc(x + 7, ly, 3.4, 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // pedestrian head: a walking figure when the road is red, a bar when not
  const walk = light.pedWalk
  ctx.fillStyle = walk ? '#4FBF7B' : '#E4574A'
  ctx.globalAlpha = walk ? 0.95 : 0.8
  if (walk) {
    ctx.fillRect(pedX + 3.4, y + 4, 1.6, 1.6) // head
    ctx.fillRect(pedX + 2.4, y + 6, 3.4, 1.3) // stride
    ctx.fillRect(pedX + 2.9, y + 7.3, 1.4, 3.2) // body
  } else {
    ctx.fillRect(pedX + 3.6, y + 5, 1.8, 1.8)
    ctx.fillRect(pedX + 3, y + 7.2, 3, 3.4)
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

export function drawStreetLife(ctx: Ctx, theme: ThemeName, frame: TrafficFrame): void {
  // far lane first: the signal and the near lane read in front of it
  laneVehicles(ctx, theme, frame, 'far')
  drawSignal(ctx, theme, frame.light)
  laneVehicles(ctx, theme, frame, 'near')

  for (let i = 0; i < frame.peds.length; i++) {
    const p = frame.peds[i]!
    if (p.crossing) continue
    drawPed(ctx, theme, p)
  }
  // crossers last: they walk in front of the stopped near lane
  for (let i = 0; i < frame.peds.length; i++) {
    const p = frame.peds[i]!
    if (!p.crossing) continue
    drawPed(ctx, theme, p)
  }
}
