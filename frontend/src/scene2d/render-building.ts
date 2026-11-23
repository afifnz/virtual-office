/**
 * Painter for the whole-building view (the `GEDUNG` tab).
 *
 * The static half — sky, procedural skyline on both sides, street, facade
 * shell, slabs, roof, lift shaft — is painted once per theme into a cached
 * 1000×688 sheet. The dynamic half draws the 13 desks, their vector avatars,
 * the compact nameplates and the one lift car, all under the same camera as
 * the per-floor painter.
 *
 * Scale is deliberately small (42 px avatars, 0.38 desks): this is an
 * overview, so status colour and names beat facial detail. The camera stays
 * anti-aliased (`imageSmoothingEnabled` is never turned off).
 */
import type { AgentMeta } from '../lib/agents'
import type { Agent, Comm } from '../lib/types'
import { FLOORS, type FloorId } from '../lib/rooms'
import { placeAgents, avatarPose, avatarSprite, poseFrame, type PlacedAgent } from './render'
import { THEME_STATUS, THEME_TOKENS, type ThemeName } from './palette'
import { shortName } from './labels'
import { drawChair, drawDesk, drawKeyboardMouse, drawMonitor } from './props-side'
import { SIDE_H, SIDE_W, sideTransform, type SideViewport } from './side'
import { drawSkyLife, drawStreetLife } from './render-traffic'
import { cityWindowCells, trafficAt } from './traffic'
import {
  BLD,
  BLD_AVATAR_H,
  BLD_BAND_ORDER,
  BLD_BANDS,
  BLD_LIFT,
  BLD_STREET,
  BUILDING_H,
  BUILDING_W,
  B_PLATE_DOT,
  B_PLATE_DOT_GAP,
  B_PLATE_FONT,
  B_PLATE_PAD,
  buildingCityRects,
  buildingDeskRect,
  buildingLift,
  buildingPlateWidth,
  buildingSeats,
  buildingWorldX,
  layoutBuildingPlates,
  type BuildingSeat,
} from './building'

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

type Ctx = CanvasRenderingContext2D

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

function text(ctx: Ctx, s: string, x: number, y: number, size: number, colour: string, weight = 600): void {
  ctx.save()
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.fillStyle = colour
  ctx.textBaseline = 'top'
  ctx.fillText(s, x, y)
  ctx.restore()
}

function groundShadow(ctx: Ctx, cx: number, y: number, rx: number, alpha: number): void {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, rx))
  g.addColorStop(0, `rgba(0,0,0,${alpha})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.save()
  ctx.translate(cx, y)
  ctx.scale(1, 0.12)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, rx, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// ------------------------------------------------------------ static layer

const staticCache = new Map<ThemeName, HTMLCanvasElement>()
const CACHE_SCALE = 1.25

export function clearBuildingCache(): void {
  staticCache.clear()
}

/** Deterministic skyline window texture (no Math.random anywhere). */
function windows(ctx: Ctx, theme: ThemeName, rect: { x: number; y: number; w: number; h: number }): void {
  const t = THEME_TOKENS[theme].city
  for (const cell of cityWindowCells(rect)) {
    if (theme === 'night' && cell.v < 0.42) continue
    ctx.fillStyle = cell.v > 0.6 ? t.windowWarm : t.windowCool
    ctx.globalAlpha = theme === 'day' ? 0.16 + cell.v * 0.22 : 0.26 + cell.v * 0.3
    ctx.fillRect(cell.x, cell.y, 2, 2.6)
  }
  ctx.globalAlpha = 1
}

function drawSky(ctx: Ctx, theme: ThemeName): void {
  const c = THEME_TOKENS[theme].city
  const sky = ctx.createLinearGradient(0, 0, 0, BLD_STREET.top)
  sky.addColorStop(0, c.skyTop)
  sky.addColorStop(0.5, c.skyMid)
  sky.addColorStop(0.82, c.skyLow)
  sky.addColorStop(1, c.horizon)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, BUILDING_W, BLD_STREET.top)

  // sun (day) / moon (night), left of the tower so nothing is hidden by it
  const sx = 138
  const sy = 108
  if (theme === 'day') {
    const halo = ctx.createRadialGradient(sx, sy, 4, sx, sy, 54)
    halo.addColorStop(0, 'rgba(255,255,255,0.9)')
    halo.addColorStop(0.4, 'rgba(255,255,255,0.28)')
    halo.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(sx, sy, 54, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.arc(sx, sy, 17, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // stars: a deterministic sprinkle in the upper sky
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    for (let i = 0; i < 42; i++) {
      const x = (i * 137 + 23) % 940
      const y = 18 + ((i * 61) % 190)
      if (x > BLD.x0 && x < BLD.x1) continue
      ctx.globalAlpha = 0.25 + ((i * 37) % 60) / 100
      ctx.fillRect(x, y, 1.4, 1.4)
    }
    ctx.globalAlpha = 1
    const halo = ctx.createRadialGradient(sx, sy, 4, sx, sy, 46)
    halo.addColorStop(0, 'rgba(243,197,123,0.3)')
    halo.addColorStop(1, 'rgba(243,197,123,0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(sx, sy, 46, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#F5E7C6'
    ctx.beginPath()
    ctx.arc(sx, sy, 15, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = c.skyMid
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.arc(sx + 5, sy - 4, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

function drawSkyline(ctx: Ctx, theme: ThemeName): void {
  const c = THEME_TOKENS[theme].city
  const rects = buildingCityRects()
  // two side bays only: the facade bay stays empty, so the skyline can never
  // paint over the building (gate d)
  for (const [x0, x1] of [
    [0, BLD.x0 - 8],
    [BLD.x1 + 8, BUILDING_W],
  ] as const) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x0, 0, x1 - x0, BLD_STREET.top)
    ctx.clip()
    for (const layer of [0, 1, 2] as const) {
      for (const r of rects) {
        if (r.layer !== layer) continue
        if (r.x + r.w < x0 || r.x > x1) continue
        ctx.fillStyle = c.layers[layer]!
        ctx.fillRect(r.x, r.y, r.w, r.h)
        if (layer === 2) {
          ctx.fillStyle = theme === 'day' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'
          ctx.fillRect(r.x, r.y, r.w, 1)
        }
        windows(ctx, theme, r)
      }
    }
    // atmospheric haze: the skyline fades at its feet, never at its top
    const haze = ctx.createLinearGradient(0, BLD_STREET.top - 120, 0, BLD_STREET.top)
    haze.addColorStop(0, 'rgba(0,0,0,0)')
    haze.addColorStop(1, theme === 'day' ? 'rgba(238,243,248,0.42)' : 'rgba(12,18,34,0.55)')
    ctx.fillStyle = haze
    ctx.fillRect(x0, BLD_STREET.top - 120, x1 - x0, 120)
    ctx.restore()
  }
  // whole-sky depth veil
  ctx.fillStyle = theme === 'day' ? 'rgba(238,243,248,0.08)' : 'rgba(8,12,22,0.12)'
  ctx.fillRect(0, 0, BUILDING_W, BLD_STREET.top)
}

function drawStreet(ctx: Ctx, theme: ThemeName): void {
  // near sidewalk (the building stands on it)
  ctx.fillStyle = theme === 'day' ? '#DCE4EE' : '#1B2433'
  ctx.fillRect(0, BLD_STREET.top, BUILDING_W, BLD_STREET.walk - BLD_STREET.top)
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.1)' : 'rgba(255,255,255,0.07)'
  for (let x = 0; x < BUILDING_W; x += 34) ctx.fillRect(x, BLD_STREET.top + 3, 1, BLD_STREET.walk - BLD_STREET.top - 6)
  ctx.fillRect(0, BLD_STREET.walk - 1, BUILDING_W, 1)

  // road
  ctx.fillStyle = theme === 'day' ? '#7C8794' : '#0D1420'
  ctx.fillRect(0, BLD_STREET.walk, BUILDING_W, BLD_STREET.road - BLD_STREET.walk)
  ctx.fillStyle = theme === 'day' ? '#9AA4B0' : '#151E2C'
  ctx.fillRect(0, BLD_STREET.walk + 4, BUILDING_W, 2)
  // dashed centre line
  ctx.fillStyle = theme === 'day' ? '#F3F6FA' : '#C9BFA0'
  ctx.globalAlpha = theme === 'day' ? 0.85 : 0.5
  for (let x = 6; x < BUILDING_W; x += 54) ctx.fillRect(x, (BLD_STREET.walk + BLD_STREET.road) / 2 - 1, 28, 2)
  ctx.globalAlpha = 1
  // crosswalk under the tower entrance
  ctx.fillStyle = theme === 'day' ? 'rgba(255,255,255,0.8)' : 'rgba(220,228,240,0.35)'
  for (let x = 420; x < 580; x += 18) {
    ctx.fillRect(x, BLD_STREET.walk + 8, 10, BLD_STREET.road - BLD_STREET.walk - 16)
  }

  // far sidewalk + foreground pavement
  ctx.fillStyle = theme === 'day' ? '#CDD7E3' : '#141C2B'
  ctx.fillRect(0, BLD_STREET.road, BUILDING_W, BLD_STREET.far - BLD_STREET.road)
  ctx.fillStyle = theme === 'day' ? '#B9C5D3' : '#0C1320'
  ctx.fillRect(0, BLD_STREET.far, BUILDING_W, BLD_STREET.bottom - BLD_STREET.far)
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.08)' : 'rgba(255,255,255,0.05)'
  ctx.fillRect(0, BLD_STREET.road, BUILDING_W, 1)
  ctx.fillRect(0, BLD_STREET.far, BUILDING_W, 1)
}

function drawTree(ctx: Ctx, theme: ThemeName, cx: number, scale = 1): void {
  const t = THEME_TOKENS[theme]
  const y = BLD_STREET.top + 4
  groundShadow(ctx, cx, y, 22 * scale, theme === 'day' ? 0.18 : 0.3)
  ctx.fillStyle = theme === 'day' ? '#8A6A4A' : '#2C2118'
  ctx.fillRect(cx - 2 * scale, y - 30 * scale, 4 * scale, 30 * scale)
  for (const [dx, dy, r] of [
    [0, -44, 18],
    [-11, -36, 13],
    [11, -37, 13],
  ] as const) {
    ctx.fillStyle = t.plant
    ctx.beginPath()
    ctx.ellipse(cx + dx * scale, y + dy * scale, r * scale, r * 0.82 * scale, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = t.plantDark
    ctx.beginPath()
    ctx.ellipse(cx + (dx + 3) * scale, y + (dy + 3) * scale, r * 0.55 * scale, r * 0.45 * scale, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawLamp(ctx: Ctx, theme: ThemeName, cx: number): void {
  const y = BLD_STREET.top + 3
  groundShadow(ctx, cx, y, 9, theme === 'day' ? 0.16 : 0.3)
  ctx.fillStyle = theme === 'day' ? '#5A6675' : '#39434F'
  ctx.fillRect(cx - 1.5, y - 74, 3, 74)
  ctx.fillRect(cx - 1.5, y - 74, 13, 2.5)
  if (theme === 'night') {
    const g = ctx.createRadialGradient(cx + 11, y - 71, 1, cx + 11, y - 71, 22)
    g.addColorStop(0, 'rgba(243,197,123,0.55)')
    g.addColorStop(1, 'rgba(243,197,123,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx + 11, y - 71, 22, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = theme === 'day' ? '#E9EFF6' : THEME_TOKENS[theme].lamp
  rr(ctx, cx + 6, y - 75, 10, 4, 2)
  ctx.fill()
}

function drawFacade(ctx: Ctx, theme: ThemeName): void {
  const t = THEME_TOKENS[theme]
  const frame = theme === 'day' ? '#C3CEDC' : '#1B2434'
  const steel = theme === 'day' ? '#8B99A9' : '#3A4659'

  groundShadow(ctx, BLD.cx, BLD.baseY + 2, 270, theme === 'day' ? 0.24 : 0.36)

  // side pilasters (the cut edges of the section)
  for (const x of [BLD.x0, BLD.x1 - 12]) {
    ctx.fillStyle = frame
    ctx.fillRect(x, BLD.roofTop + 8, 12, BLD.baseY - BLD.roofTop - 8)
    ctx.fillStyle = steel
    ctx.fillRect(x + 4, BLD.roofTop + 8, 3, BLD.baseY - BLD.roofTop - 8)
  }

  // bands, top floor first
  for (const floor of BLD_BAND_ORDER) {
    const b = BLD_BANDS[floor]
    const x0 = BLD.x0 + 12
    const x1 = BLD.x1 - 12

    // back wall
    const wall = ctx.createLinearGradient(0, b.y0, 0, b.y1)
    wall.addColorStop(0, theme === 'day' ? '#EEF3F8' : '#141C2B')
    wall.addColorStop(1, theme === 'day' ? '#DCE5F0' : '#101827')
    ctx.fillStyle = wall
    ctx.fillRect(x0, b.y0, x1 - x0, b.y1 - b.y0)

    // window strip on the back wall: a hint of the city, tinted
    ctx.fillStyle = t.city.skyLow
    ctx.globalAlpha = theme === 'day' ? 0.4 : 0.24
    ctx.fillRect(x0, b.y0 + 4, x1 - x0, 26)
    ctx.globalAlpha = 1
    ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.16)' : 'rgba(255,255,255,0.1)'
    ctx.fillRect(x0, b.y0 + 30, x1 - x0, 1)

    // facade mullions, quiet so the plates stay readable
    ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.1)' : 'rgba(255,255,255,0.07)'
    for (let x = x0 + 51; x < x1 - 6; x += 51) ctx.fillRect(x, b.y0 + 4, 1, b.y1 - b.y0 - 16)

    // floor plane + front lip
    ctx.fillStyle = t.floor
    ctx.fillRect(x0, b.y1 - 12, x1 - x0, 12)
    ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.14)' : 'rgba(255,255,255,0.1)'
    ctx.fillRect(x0, b.y1 - 12, x1 - x0, 1)
    ctx.fillStyle = theme === 'day' ? '#C3CEDC' : '#0D1420'
    ctx.fillRect(x0, b.y1 - 2, x1 - x0, 2)

    // slab between floors (L3/L2); L1 sits on the plinth
    if (floor !== 1) {
      ctx.fillStyle = frame
      ctx.fillRect(x0, b.y1, x1 - x0, 8)
      ctx.fillStyle = theme === 'day' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.1)'
      ctx.fillRect(x0, b.y1, x1 - x0, 1)
    }

    // floor label in the band's top-left
    const team = floor === 1 ? 'LOBBY' : floor === 2 ? 'TIM EDU' : 'TIM DEV'
    text(ctx, `L${floor}`, x0 + 10, b.y0 + 7, 11, t.ink, 800)
    text(ctx, team, x0 + 30, b.y0 + 9, 8, t.muted, 700)
  }

  // roof: coping overhangs 8 px each side, then the fascia band
  const roofX = BLD.roofOverhangX
  const roofW = BLD.x1 - BLD.x0 + (BLD.x0 - BLD.roofOverhangX) * 2
  ctx.fillStyle = theme === 'day' ? '#E9EFF6' : '#1B2536'
  ctx.fillRect(roofX, BLD.roofTop, roofW, 8)
  ctx.fillStyle = theme === 'day' ? '#CBD6E3' : '#101827'
  ctx.fillRect(BLD.x0, 78, BLD.x1 - BLD.x0, 16)
  ctx.fillStyle = theme === 'day' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.12)'
  ctx.fillRect(roofX, BLD.roofTop, roofW, 1)
  // rooftop plant + antenna
  ctx.fillStyle = theme === 'day' ? '#B7C4D3' : '#0C1320'
  ctx.fillRect(320, 58, 46, 12)
  ctx.fillRect(600, 52, 34, 18)
  ctx.fillRect(640, 30, 3, 22)
  ctx.fillStyle = THEME_STATUS[theme].danger
  ctx.beginPath()
  ctx.arc(641.5, 28, 2.5, 0, Math.PI * 2)
  ctx.fill()
  // building name on the fascia
  text(ctx, 'AGENT OFFICE', BLD.cx - 43, 82, 10, theme === 'day' ? '#2B3A4D' : '#C6D0E0', 800)
}

function drawLiftShaftStatic(ctx: Ctx, theme: ThemeName): void {
  const t = THEME_TOKENS[theme]
  const { x, w, top, bottom } = BLD_LIFT
  ctx.fillStyle = theme === 'day' ? '#5A6675' : '#0A111C'
  ctx.fillRect(x, top, w, bottom - top)
  ctx.fillStyle = theme === 'day' ? '#DCE4EE' : '#1B2433'
  ctx.fillRect(x + 3, top + 3, w - 6, bottom - top - 6)
  ctx.fillStyle = theme === 'day' ? '#6E7C8C' : '#3A4659'
  ctx.fillRect(x + 5, top + 6, 2, bottom - top - 12)
  ctx.fillRect(x + w - 7, top + 6, 2, bottom - top - 12)
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.22)' : 'rgba(255,255,255,0.1)'
  ctx.fillRect(x + w / 2 - 0.5, top + 10, 1, bottom - top - 20)
  for (const floor of [1, 2, 3] as const) {
    const b = BLD_BANDS[floor]
    // landing door frame
    ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.2)' : 'rgba(255,255,255,0.12)'
    ctx.fillRect(x + 4, b.floorY - 42, w - 8, 44)
    ctx.fillStyle = theme === 'day' ? '#C7D2DF' : '#232E40'
    ctx.fillRect(x + 6, b.floorY - 40, w - 12, 40)
    ctx.fillStyle = theme === 'day' ? '#AEBBCB' : '#2C374A'
    ctx.fillRect(x + w / 2 - 0.5, b.floorY - 40, 1, 40)
    ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.8)' : 'rgba(0,0,0,0.6)'
    rr(ctx, x + w / 2 - 8, b.floorY - 62, 16, 10, 2)
    ctx.fill()
    text(ctx, `L${floor}`, x + w / 2 - 5.5, b.floorY - 61, 7, t.accent, 800)
  }
  text(ctx, 'LIFT', x + 10, bottom - 26, 6, theme === 'day' ? '#3B4A5E' : '#93A0B6', 700)
}

export function createBuildingLayer(theme: ThemeName): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(BUILDING_W * CACHE_SCALE)
  canvas.height = Math.round(BUILDING_H * CACHE_SCALE)
  const ctx = canvas.getContext('2d')!
  ctx.scale(CACHE_SCALE, CACHE_SCALE)

  drawSky(ctx, theme)
  drawSkyline(ctx, theme)
  drawStreet(ctx, theme)
  drawFacade(ctx, theme)
  drawLiftShaftStatic(ctx, theme)

  // street furniture in front of the skyline, outside the facade bay
  for (const x of [44, 142, 224]) drawTree(ctx, theme, x, x === 44 ? 1 : 0.86)
  for (const x of [776, 872, 958]) drawTree(ctx, theme, x, x === 958 ? 0.86 : 1)
  drawLamp(ctx, theme, 110)
  drawLamp(ctx, theme, 296)
  drawLamp(ctx, theme, 704)
  drawLamp(ctx, theme, 890)

  return canvas
}

export function buildingLayerFor(theme: ThemeName): HTMLCanvasElement {
  let sheet = staticCache.get(theme)
  if (!sheet) {
    sheet = createBuildingLayer(theme)
    staticCache.set(theme, sheet)
  }
  return sheet
}

// ---------------------------------------------------------------- dynamic

export interface BuildingRenderInput {
  theme: ThemeName
  metas: AgentMeta[]
  byId: Map<string, Agent>
  now: number
  comms: Comm[]
  vp: SideViewport
  viewW: number
  viewH: number
  dpr: number
  still: boolean
  t: number
  /** reserved bottom band for the phone pad */
  band?: number
}

function statusOf(agent: Agent | undefined, offline: boolean): keyof typeof THEME_STATUS.day {
  if (offline || !agent) return 'offline'
  // A stale verdict is painted as idle: the desk is not working.
  if (agent.stale === true) return 'idle'
  return (agent.status as keyof typeof THEME_STATUS.day) ?? 'offline'
}

function screenOf(pose: PlacedAgent['pose']): 'terminal' | 'doc' | 'diff' | 'off' {
  if (pose.offline || pose.blocked) return 'off'
  if (pose.magnifier) return 'diff'
  if (pose.kind === 'typing') return 'terminal'
  if (pose.kind === 'reading') return 'doc'
  return 'terminal'
}

/** Small status glyph inside the plate: square = offline, diamond = blocked. */
function dotShape(ctx: Ctx, shape: 'circle' | 'ring' | 'square' | 'diamond', x: number, y: number, size: number, colour: string): void {
  const r = size / 2
  ctx.save()
  ctx.fillStyle = colour
  ctx.strokeStyle = colour
  ctx.lineWidth = 1
  if (shape === 'diamond') {
    ctx.beginPath()
    ctx.moveTo(x, y - r)
    ctx.lineTo(x + r, y)
    ctx.lineTo(x, y + r)
    ctx.lineTo(x - r, y)
    ctx.closePath()
    ctx.fill()
  } else if (shape === 'square') {
    ctx.strokeRect(x - r, y - r, size, size)
  } else if (shape === 'ring') {
    ctx.beginPath()
    ctx.arc(x, y, r - 0.8, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(x, y, r - 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function shapeFor(key: keyof typeof THEME_STATUS.day): 'circle' | 'ring' | 'square' | 'diamond' {
  if (key === 'blocked') return 'diamond'
  if (key === 'offline') return 'square'
  if (key === 'waiting') return 'square'
  if (key === 'idle' || key === 'reviewing') return 'ring'
  return 'circle'
}

function drawStation(ctx: Ctx, theme: ThemeName, seat: BuildingSeat, placed: PlacedAgent | undefined, agent: Agent | undefined, r: BuildingRenderInput): void {
  // offline is the API row, never "his desk is empty right now": a delegate
  // walking to the lift still owns a lit desk, he is just not sitting at it.
  const offline = !agent || agent.status === 'offline'
  const key = statusOf(agent, offline)
  const scale = seat.scale
  groundShadow(ctx, seat.cx, seat.floorY, 18 * scale * 2.2, theme === 'day' ? 0.16 : 0.24)
  drawChair(ctx, theme, seat.cx, seat.floorY, scale, !offline)
  if (!offline && placed) {
    const pose = avatarPose(placed.pose)
    const frame = poseFrame(placed.pose, r.t, r.still)
    const sprite = avatarSprite(seat.meta.look, pose, frame, seat.avatarH)
    ctx.drawImage(sprite, seat.cx - (seat.avatarH * 0.72) / 2, seat.floorY - seat.avatarH, seat.avatarH * 0.72, seat.avatarH)
  }
  const deskTop = drawDesk(ctx, theme, seat.cx, seat.floorY, scale)
  drawKeyboardMouse(ctx, theme, seat.cx, deskTop, scale)
  drawMonitor(ctx, theme, seat.cx, seat.floorY, scale, key, placed && !offline ? screenOf(placed.pose) : 'off')
  if (offline) {
    ctx.save()
    ctx.globalAlpha = 0.7
    text(ctx, 'Z Z', seat.cx + 12, seat.headTop + 4, 6, THEME_TOKENS[theme].muted, 700)
    ctx.restore()
  }
}

function drawPlate(
  ctx: Ctx,
  theme: ThemeName,
  plate: { id: string; x: number; y: number; w: number; h: number; connector: boolean },
  seat: BuildingSeat,
  key: keyof typeof THEME_STATUS.day,
  offline: boolean,
): void {
  const t = THEME_TOKENS[theme]
  const fill = theme === 'day' ? 'rgba(255,255,255,0.95)' : 'rgba(20,27,46,0.95)'
  const border = theme === 'day' ? 'rgba(15,36,64,0.32)' : 'rgba(255,255,255,0.3)'
  if (plate.connector) {
    ctx.strokeStyle = border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(plate.x + plate.w / 2, plate.y + plate.h)
    ctx.lineTo(seat.cx, seat.headTop)
    ctx.stroke()
  }
  ctx.fillStyle = fill
  ctx.strokeStyle = border
  ctx.lineWidth = 1
  rr(ctx, plate.x, plate.y, plate.w, plate.h, 7)
  ctx.fill()
  ctx.stroke()
  const cy = plate.y + plate.h / 2
  dotShape(
    ctx,
    offline ? 'square' : shapeFor(key),
    plate.x + B_PLATE_PAD + B_PLATE_DOT / 2,
    cy,
    B_PLATE_DOT,
    offline ? THEME_STATUS[theme].offline : THEME_STATUS[theme][key],
  )
  ctx.save()
  ctx.font = `700 ${B_PLATE_FONT}px ${FONT}`
  ctx.fillStyle = offline ? t.muted : t.ink
  ctx.textBaseline = 'middle'
  ctx.fillText(
    shortName(seat.meta.name),
    plate.x + B_PLATE_PAD + B_PLATE_DOT + B_PLATE_DOT_GAP,
    cy + 0.5,
    plate.w - (B_PLATE_PAD * 2 + B_PLATE_DOT + B_PLATE_DOT_GAP),
  )
  ctx.restore()
}

function drawLiftCar(ctx: Ctx, theme: ThemeName, car: ReturnType<typeof buildingLift>): void {
  const t = THEME_TOKENS[theme]
  const x = car.x + 2
  const w = car.w - 4
  const y = car.y - car.h / 2
  ctx.fillStyle = theme === 'day' ? '#2A3446' : '#0E1522'
  rr(ctx, x, y, w, car.h, 4)
  ctx.fill()
  ctx.fillStyle = t.lamp
  ctx.globalAlpha = 0.9
  ctx.fillRect(x + 3, y + 3, w - 6, 2)
  ctx.globalAlpha = 1
  ctx.fillStyle = theme === 'day' ? '#CBD6E3' : '#2A3446'
  ctx.fillRect(x, y + 8, w, car.h - 8)
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.28)' : 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 1
  ctx.strokeRect(x, y + 8, w, car.h - 8)
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.35)' : 'rgba(0,0,0,0.5)'
  ctx.fillRect(x + w / 2 - 0.5, y + 8, 1, car.h - 8)
  // destination plate: two arrows up/down + the target floor
  const label = car.to ? `▸ L${car.to}` : '▸ L1'
  ctx.fillStyle = theme === 'day' ? 'rgba(10,16,26,0.85)' : 'rgba(0,0,0,0.55)'
  rr(ctx, x + w / 2 - 11, y + 3, 22, 9, 2)
  ctx.fill()
  text(ctx, label, x + w / 2 - 8.5, y + 4, 6, t.accent, 800)
}

/** Paint one whole-building frame into a canvas whose backing store is sized. */
export function renderBuildingFrame(ctx: CanvasRenderingContext2D, r: BuildingRenderInput): void {
  const band = r.band ?? 0
  const tr = sideTransform(r.viewW, r.viewH, r.vp, band)
  const theme = r.theme

  ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0)
  ctx.fillStyle = THEME_TOKENS[theme].page
  ctx.fillRect(0, 0, r.viewW, r.viewH)
  // cheap antialiasing guard: the sheet is scaled down on a phone
  ctx.imageSmoothingEnabled = true

  ctx.drawImage(buildingLayerFor(theme), tr.left, tr.top, SIDE_W * tr.s, SIDE_H * tr.s)

  ctx.save()
  ctx.translate(tr.left, tr.top)
  ctx.scale(tr.s, tr.s)

  // street life sits between the cached sheet and the desks: clouds/birds in
  // the sky (clipped to the bays), then the two lanes, the signal and walkers.
  drawSkyLife(ctx, theme, r.t)
  drawStreetLife(ctx, theme, trafficAt(r.t))

  const metas = r.metas
  const placed = placeAgents(metas, r.byId, r.now, r.comms, r.t)
  const bySeat = new Map(placed.map((p) => [p.meta.id, p]))
  const seats = buildingSeats(metas)

  for (const floor of BLD_BAND_ORDER) {
    const row = seats.filter((s) => s.floor === floor)
    for (const seat of row) {
      const p = bySeat.get(seat.meta.id)
      const agent = r.byId.get(seat.meta.id)
      // a walker or a rider has left the desk: the chair stays, empty
      const atDesk = p && p.floor === floor && !p.walking && !p.inLift
      drawStation(ctx, theme, seat, atDesk ? p : undefined, agent, r)
    }
    // walkers on this floor (no desk of their own in the row)
    for (const p of placed) {
      if (p.floor !== floor || !p.walking) continue
      const scale = 0.9
      const bx = buildingWorldX(floor, p.x)
      groundShadow(ctx, bx, BLD_BANDS[floor].floorY, 16, theme === 'day' ? 0.16 : 0.24)
      const h = BLD_AVATAR_H * scale
      const sprite = avatarSprite(p.meta.look, 'walk', poseFrame(p.pose, r.t, r.still), h)
      ctx.drawImage(sprite, bx - (h * 0.72) / 2, BLD_BANDS[floor].floorY - h, h * 0.72, h)
    }
  }

  // one car, vertical between the bands while somebody rides
  const car = buildingLift(
    placed.map((p) => ({ id: p.meta.id, floor: p.floor, inLift: p.inLift, liftTo: p.liftTo })),
    r.t,
  )
  drawLiftCar(ctx, theme, car)

  // compact plates, laid out by the same pure function the gate replays
  const { plates } = layoutBuildingPlates(seats)
  const seatOf = new Map(seats.map((s) => [s.meta.id, s]))
  for (const plate of plates) {
    const seat = seatOf.get(plate.id)
    if (!seat) continue
    const agent = r.byId.get(plate.id)
    const offline = !agent || agent.status === 'offline'
    drawPlate(ctx, theme, plate, seat, statusOf(agent, offline), offline)
  }

  ctx.restore()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

/** Hit test in design px: an agent seat first, then the band it stands in. */
export function buildingHit(
  seats: readonly BuildingSeat[],
  x: number,
  y: number,
): { id: string } | { floor: FloorId } | null {
  let best: BuildingSeat | null = null
  let bestD = Infinity
  for (const s of seats) {
    const inside = Math.abs(x - s.cx) <= (s.avatarH * 0.72) / 2 + 4 && y >= s.headTop - 4 && y <= s.floorY + 6
    const d = Math.hypot(x - s.cx, y - (s.floorY - s.avatarH / 2))
    if (inside && d < bestD) {
      bestD = d
      best = s
    }
  }
  if (best) return { id: best.meta.id }
  for (const floor of BLD_BAND_ORDER) {
    const b = BLD_BANDS[floor]
    if (x >= BLD.x0 && x <= BLD.x1 && y >= b.y0 && y <= b.y1) return { floor }
  }
  return null
}

/** The whole-building layout + gates, exposed for the browser probe. */
export function buildingReport(
  metas: AgentMeta[],
  riders: ReadonlyArray<{ id: string; floor: FloorId; inLift: boolean; liftTo: FloorId | null }> = [],
  t = 0,
) {
  const seats = buildingSeats(metas)
  const { plates, violations } = layoutBuildingPlates(seats)
  return {
    mode: 'building' as const,
    stage: { w: BUILDING_W, h: BUILDING_H },
    bands: BLD_BAND_ORDER.map((floor) => ({ ...BLD_BANDS[floor], name: FLOORS[floor].name })),
    building: { x: BLD.x0, y: BLD.roofTop, w: BLD.x1 - BLD.x0, h: BLD.baseY - BLD.roofTop },
    desks: seats.map((s) => ({ id: s.meta.id, floor: s.floor, ...buildingDeskRect(s) })),
    plates,
    plateViolations: violations,
    plateWidthMax: Math.max(...seats.map((s) => buildingPlateWidth(s.meta.name))),
    lift: buildingLift(riders, t),
    city: buildingCityRects().length,
  }
}
