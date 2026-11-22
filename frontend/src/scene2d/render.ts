/**
 * Side-view painter: the static stage (roof, curtain wall + city, boards,
 * floor props) is cached per (floor × theme); the dynamic pass draws desks,
 * chairs, vector avatars, live status board, clock hands, the lift car and the
 * nameplates.
 *
 * Coordinates are design px on a 1000×688 stage; the camera transform is
 * applied once. No `ctx.filter` in the loop, no per-frame text layout beyond
 * the small plates, and avatars are cached sprites blitted 1:1.
 */
import type { AgentMeta } from '../lib/agents'
import type { Agent, Comm } from '../lib/types'
import { FLOORS, type FloorId } from '../lib/rooms'
import { seatPoint } from '../lib/routes'
import { rosterAgents } from '../lib/roster'
import { poseFor, type Pose } from './anim'
import { journeyAt, journeyClock, journeyFor, liftChip } from './journey'
import { THEME_STATUS, THEME_TOKENS, type ThemeName } from './palette'
import { drawAvatar, drawAvatarHands, avatarKey, type AvatarPose } from './avatar'
import { createCityCanvas } from './city'
import {
  drawBoards,
  drawBookshelf,
  drawChair,
  drawClockHands,
  drawCurtainWall,
  drawDesk,
  drawFloorPlane,
  drawKeyboardMouse,
  drawLiftCar,
  drawLiftShaft,
  drawMonitor,
  drawPlant,
  drawRoof,
  drawServerRack,
  drawSoffit,
  drawSpandrel,
  drawStatusBoard,
} from './props-side'
import {
  PLATE_DOT,
  PLATE_DOT_GAP,
  PLATE_FONT,
  PLATE_PAD,
  labelAgentsFor,
  layoutSideLabels,
  shortName,
  type PlacedPlate,
} from './labels'
import {
  SIDE_BOARDS,
  SIDE_FLOOR_BACK,
  SIDE_FLOOR_FRONT,
  SIDE_H,
  SIDE_W,
  sideTransform,
  sideSeats,
  worldXToDesign,
  type SideSeat,
  type SideViewport,
} from './side'

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

// ------------------------------------------------------------------ sprites

const avatarCache = new Map<string, HTMLCanvasElement>()
const AVATAR_BUCKET = 2
const AVATAR_LRU = 64

function avatarSprite(look: AgentMeta['look'], pose: AvatarPose, frame: number, h: number): HTMLCanvasElement {
  const key = avatarKey(look, pose, frame, AVATAR_BUCKET) + `:${Math.round(h)}`
  const hit = avatarCache.get(key)
  if (hit) return hit
  const w = Math.ceil(h * 0.72)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * AVATAR_BUCKET)
  canvas.height = Math.ceil(h * AVATAR_BUCKET)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(AVATAR_BUCKET, AVATAR_BUCKET)
    drawAvatar(ctx, look, pose, frame, w / 2, h, h)
  }
  if (avatarCache.size >= AVATAR_LRU) {
    const first = avatarCache.keys().next().value
    if (first) avatarCache.delete(first)
  }
  avatarCache.set(key, canvas)
  return canvas
}

export function clearAvatarCache(): void {
  avatarCache.clear()
}

// -------------------------------------------------------------- static layer

const staticCache = new Map<string, HTMLCanvasElement>()
const CACHE_SCALE = 1.5
const CACHE_MAX = 6

export function clearStaticCache(): void {
  staticCache.clear()
}

export function createStaticLayer(floor: FloorId, theme: ThemeName): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(SIDE_W * CACHE_SCALE)
  canvas.height = Math.round(SIDE_H * CACHE_SCALE)
  const ctx = canvas.getContext('2d')!
  ctx.scale(CACHE_SCALE, CACHE_SCALE)
  const t = THEME_TOKENS[theme]

  // page behind the section
  ctx.fillStyle = t.page
  ctx.fillRect(0, 0, SIDE_W, SIDE_H)

  drawRoof(ctx, theme)
  drawSoffit(ctx, theme)
  // the city lives INSIDE the window band, not in a band above the ceiling
  const city = createCityCanvas(theme, floor)
  ctx.drawImage(city, 0, 58, SIDE_W, 485)
  drawCurtainWall(ctx, theme)
  drawSpandrel(ctx, theme)
  drawFloorPlane(ctx, theme)

  // boards hang in front of the glass on one rail
  drawBoards(ctx, theme, floor)
  // the lift core is part of the east wall
  drawLiftShaft(ctx, theme, floor)

  // floor props, standing on their row line (contact shadows included)
  drawBookshelf(ctx, theme, 58, SIDE_FLOOR_BACK, 0.92)
  drawPlant(ctx, theme, 30, SIDE_FLOOR_FRONT, 0.95)
  if (floor === 3) drawServerRack(ctx, theme, 866, SIDE_FLOOR_FRONT, 0.92)
  else drawPlant(ctx, theme, 866, SIDE_FLOOR_FRONT, 0.8)

  return canvas
}

export function staticLayerFor(floor: FloorId, theme: ThemeName): HTMLCanvasElement {
  const key = `${floor}:${theme}`
  let canvas = staticCache.get(key)
  if (!canvas) {
    canvas = createStaticLayer(floor, theme)
    if (staticCache.size >= CACHE_MAX) {
      const first = staticCache.keys().next().value
      if (first) staticCache.delete(first)
    }
    staticCache.set(key, canvas)
  }
  return canvas
}

// ---------------------------------------------------------------- placement

export interface PlacedAgent {
  meta: AgentMeta
  agent: Agent | undefined
  pose: Pose
  floor: FloorId
  x: number
  z: number
  walking: boolean
  inLift: boolean
  liftTo: FloorId | null
  seat: SideSeat | null
  /** design-space draw position (feet) */
  designX: number
  designY: number
  avatarH: number
}

/** Resolve every agent to one floor + one draw position for a frame. */
export function placeAgents(
  metas: AgentMeta[],
  byId: Map<string, Agent>,
  now: number,
  comms: Comm[],
  t: number,
): PlacedAgent[] {
  const seats = new Map<FloorId, SideSeat[]>()
  for (const f of [1, 2, 3] as FloorId[]) {
    seats.set(f, sideSeats(metas.filter((m) => m.desk.floor === f)))
  }
  return metas.map((meta) => {
    const agent = byId.get(meta.id)
    const pose = agent ? poseFor(agent, now, comms) : OFFLINE_POSE
    const homeSeat = seats.get(meta.desk.floor)?.find((s) => s.meta.id === meta.id) ?? null
    if (pose.kind !== 'walk' || !pose.walkTo || pose.offline) {
      return {
        meta,
        agent,
        pose,
        floor: meta.desk.floor,
        x: seatPoint(meta)[0],
        z: seatPoint(meta)[1],
        walking: false,
        inLift: false,
        liftTo: null,
        seat: homeSeat,
        designX: homeSeat?.cx ?? SIDE_W / 2,
        designY: homeSeat?.floorY ?? SIDE_FLOOR_FRONT,
        avatarH: homeSeat?.avatarH ?? 150,
      }
    }
    const journey = journeyFor(meta, pose.walkTo)
    const j = journeyAt(journey, journeyClock(meta, journey, t))
    const h = j.inLift ? 148 : 150
    return {
      meta,
      agent,
      pose,
      floor: j.floor,
      x: j.x,
      z: j.z,
      walking: j.walking,
      inLift: j.inLift,
      liftTo: j.liftTo,
      seat: null,
      designX: worldXToDesign(j.x, FLOORS[j.floor].w),
      designY: SIDE_FLOOR_FRONT - 8,
      avatarH: h,
    }
  })
}

const OFFLINE_POSE: Pose = {
  kind: 'offline',
  tool: '',
  typing: false,
  reading: false,
  blocked: false,
  offline: true,
  magnifier: false,
  comming: false,
}

export function pickTargets(placed: PlacedAgent[]): Array<{
  id: string
  floor: FloorId
  x: number
  z: number
  designX: number
  designY: number
  h: number
  w: number
}> {
  return placed.map((p) => ({
    id: p.meta.id,
    floor: p.floor,
    x: p.x,
    z: p.z,
    designX: p.designX,
    designY: p.designY,
    h: p.avatarH,
    w: p.avatarH * 0.5,
  }))
}

// ---------------------------------------------------------------- the frame

export interface RenderInput {
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
  /** WIB hour/minute for the wall clock (from the server `now`) */
  hour: number
  minute: number
}

function avatarPose(pose: Pose): AvatarPose {
  switch (pose.kind) {
    case 'typing':
      return 'typing'
    case 'reading':
      return 'reading'
    case 'working':
      return 'working'
    case 'walk':
      return 'walk'
    case 'relax':
      return 'relax'
    case 'blocked':
      return 'blocked'
    case 'idle':
      return 'idle'
    default:
      return 'seated'
  }
}

function poseFrame(pose: Pose, t: number, still: boolean): number {
  if (still) return 0
  switch (pose.kind) {
    case 'typing':
      return Math.floor(t * 4) % 2
    case 'walk':
      return Math.floor(t * 6) % 2
    case 'idle':
    case 'relax':
      return Math.floor(t * 1.5) % 2
    default:
      return 0
  }
}

function statusOf(agent: Agent | undefined, pose: Pose): keyof typeof THEME_STATUS.day {
  if (pose.offline || !agent) return 'offline'
  if (pose.blocked) return 'blocked'
  return (agent.status as keyof typeof THEME_STATUS.day) ?? 'idle'
}

function screenOf(pose: Pose): 'terminal' | 'doc' | 'diff' | 'off' {
  if (pose.offline || pose.blocked) return 'off'
  if (pose.magnifier) return 'diff'
  if (pose.kind === 'typing') return 'terminal'
  if (pose.kind === 'reading') return 'doc'
  return 'terminal'
}

/** Paint one full frame into a canvas whose backing store is already sized. */
export function renderFrame(ctx: CanvasRenderingContext2D, r: RenderInput): void {
  const t = sideTransform(r.viewW, r.viewH, r.vp)
  const theme = r.theme
  const pal = THEME_TOKENS[theme]
  const status = THEME_STATUS[theme]
  const dpr = r.dpr

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = pal.page
  ctx.fillRect(0, 0, r.viewW, r.viewH)

  // the cached stage, scaled by the camera
  const stage = staticLayerFor(r.vp.floor, theme)
  ctx.drawImage(stage, t.left, t.top, SIDE_W * t.s, SIDE_H * t.s)

  const resolved = placeAgents(r.metas, r.byId, r.now, r.comms, r.t)
  const onFloor = resolved.filter((p) => p.floor === r.vp.floor)
  const seats = sideSeats(r.metas.filter((m) => m.desk.floor === r.vp.floor))

  // ---- live board content + clock hands (the cached board is a blank shell)
  drawStatusBoard(
    ctx,
    theme,
    onFloor
      .filter((p) => p.seat)
      .map((p) => ({ id: p.meta.id, name: p.meta.name, status: p.agent?.status ?? 'offline' })),
  )
  drawClockHands(ctx, theme, r.hour, r.minute)

  // ---- lift car: open while someone dwells, otherwise closed at this floor
  const liftY = 530 - (r.vp.floor - 1) * 100
  const dwelling = onFloor.find((p) => p.inLift)
  if (dwelling) {
    const target = dwelling.liftTo ?? r.vp.floor
    const targetY = 530 - (target - 1) * 100
    const progress = r.still ? 0.5 : (r.t % 2.6) / 2.6
    const y = liftY + (targetY - liftY) * Math.sin(progress * Math.PI) * 0.32
    drawLiftCar(ctx, theme, r.vp.floor, y, 0.35 + 0.65 * Math.sin(progress * Math.PI), target)
  } else {
    drawLiftCar(ctx, theme, r.vp.floor, liftY, 0, r.vp.floor)
  }

  // ---- stations: back row first, then front row
  for (const seat of seats) {
    const p = onFloor.find((q) => q.meta.id === seat.meta.id && !q.walking)
    if (!p) continue
    drawStation(ctx, theme, seat, p, r)
  }

  // ---- walking agents on this floor (no desk, no plate)
  for (const p of onFloor) {
    if (!p.walking) continue
    drawWalkShadow(ctx, theme, p.designX, p.designY, p.avatarH)
    const sprite = avatarSprite(p.meta.look, 'walk', poseFrame(p.pose, r.t, r.still), p.avatarH)
    ctx.drawImage(sprite, p.designX - (p.avatarH * 0.72) / 2, p.designY - p.avatarH, p.avatarH * 0.72, p.avatarH)
  }

  // ---- nameplates (seated agents only; walkers get no floating plate)
  const statuses = new Map<string, { status: string; shape: 'circle' | 'ring' | 'diamond' | 'square' | 'triangle'; colour: string }>()
  for (const p of onFloor) {
    if (p.walking) continue
    const key = statusOf(p.agent, p.pose)
    statuses.set(p.meta.id, {
      status: p.agent?.status ?? 'offline',
      shape: shapeOf(key),
      colour: status[key],
    })
  }
  const labelAgents = labelAgentsFor(
    seats.filter((s) => !onFloor.some((p) => p.meta.id === s.meta.id && p.walking)),
    statuses,
  )
  const bounds = { w: SIDE_W, h: SIDE_H }
  const reserved = SIDE_BOARDS.map((b) => ({ x: b.x, y: 132, w: b.w, h: b.h }))
  const { plates } = layoutSideLabels(labelAgents, bounds, reserved)
  for (const plate of plates) {
    const agent = labelAgents.find((a) => a.id === plate.id)
    if (!agent) continue
    drawPlate(ctx, theme, plate, agent)
  }

  // ---- lift chip (generic: floor only, never a message)
  if (dwelling) {
    const chip = liftChip(dwelling.liftTo ?? r.vp.floor)
    drawChip(ctx, theme, 742, liftY - 58, chip, status.reviewing)
  }

  // ---- comms: a small paper plane between two agents on this floor
  for (const c of r.comms) {
    const age = r.now - c.ts
    if (age < 0 || age > 1.5) continue
    const from = onFloor.find((p) => p.meta.id === c.from)
    const to = onFloor.find((p) => p.meta.id === c.to)
    if (!from || !to) continue
    const k = age / 1.5
    const x = from.designX + (to.designX - from.designX) * k
    const y = (from.designY - from.avatarH * 0.6) + (to.designY - to.avatarH * 0.6 - (from.designY - from.avatarH * 0.6)) * k - Math.sin(k * Math.PI) * 24
    drawEnvelope(ctx, theme, x, y)
  }

  // camera frame: nothing is drawn outside the stage, but the page is already
  // filled, so the section reads as a slice of a building.
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

function drawStation(
  ctx: CanvasRenderingContext2D,
  theme: ThemeName,
  seat: SideSeat,
  p: PlacedAgent,
  r: RenderInput,
): void {
  const key = statusOf(p.agent, p.pose)
  const offline = key === 'offline'
  const scale = seat.scale

  // feet contact shadow
  drawWalkShadow(ctx, theme, seat.cx, seat.floorY, seat.avatarH)

  drawChair(ctx, theme, seat.cx, seat.floorY, scale, !offline)

  if (!offline) {
    const pose = avatarPose(p.pose)
    const frame = poseFrame(p.pose, r.t, r.still)
    const sprite = avatarSprite(p.meta.look, pose, frame, seat.avatarH)
    ctx.drawImage(sprite, seat.cx - (seat.avatarH * 0.72) / 2, seat.floorY - seat.avatarH, seat.avatarH * 0.72, seat.avatarH)
  }

  const deskTop = drawDesk(ctx, theme, seat.cx, seat.floorY, scale)
  drawKeyboardMouse(ctx, theme, seat.cx, deskTop, scale)
  if (!offline) {
    drawAvatarHands(ctx, p.meta.look, avatarPose(p.pose), poseFrame(p.pose, r.t, r.still), seat.cx, seat.floorY, seat.avatarH, deskTop)
  }
  drawMonitor(ctx, theme, seat.cx, seat.floorY, scale, key, screenOf(p.pose))

  // an empty station says so without colour
  if (offline) {
    ctx.save()
    ctx.globalAlpha = 0.75
    ctx.font = `600 9px ${FONT}`
    ctx.fillStyle = THEME_TOKENS[theme].muted
    ctx.fillText('Z Z Z', seat.cx - 14, seat.headTop - 4)
    ctx.restore()
  }
}

function drawWalkShadow(ctx: CanvasRenderingContext2D, theme: ThemeName, cx: number, floorY: number, h: number): void {
  ctx.save()
  ctx.translate(cx, floorY)
  ctx.scale(1, 0.18)
  const g = ctx.createRadialGradient(0, 0, 1, 0, 0, h * 0.22)
  g.addColorStop(0, `rgba(0,0,0,${theme === 'day' ? 0.25 : 0.35})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, h * 0.22, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function shapeOf(key: keyof typeof THEME_STATUS.day): 'circle' | 'ring' | 'diamond' | 'square' | 'triangle' {
  if (key === 'blocked') return 'diamond'
  if (key === 'idle') return 'ring'
  if (key === 'offline') return 'square'
  if (key === 'danger') return 'triangle'
  if (key === 'reviewing') return 'ring'
  return 'circle'
}

function drawPlate(
  ctx: CanvasRenderingContext2D,
  theme: ThemeName,
  plate: PlacedPlate,
  agent: { id: string; name: string; dot: string | null; shape?: string; offline: boolean; cx: number; headTop: number },
): void {
  const t = THEME_TOKENS[theme]
  const text = shortName(agent.name)
  const fill = theme === 'day' ? 'rgba(255,255,255,0.92)' : 'rgba(20,27,46,0.92)'
  const border = theme === 'day' ? 'rgba(15,36,64,0.33)' : 'rgba(255,255,255,0.33)'

  // connector first, under the plate
  if (plate.connector) {
    ctx.strokeStyle = border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(plate.x + plate.w / 2, plate.y + plate.h)
    ctx.lineTo(agent.cx, agent.headTop)
    ctx.stroke()
  }

  ctx.save()
  ctx.fillStyle = fill
  ctx.strokeStyle = border
  ctx.lineWidth = 1
  rounded(ctx, plate.x, plate.y, plate.w, plate.h, 11)
  ctx.fill()
  ctx.stroke()

  const cy = plate.y + plate.h / 2
  if (agent.dot) {
    drawShape(ctx, agent.shape ?? 'circle', plate.x + PLATE_PAD + PLATE_DOT / 2, cy, PLATE_DOT, agent.dot, theme)
  }
  const tx = plate.x + PLATE_PAD + (agent.dot ? PLATE_DOT + PLATE_DOT_GAP : 0)
  const maxW = plate.w - (tx - plate.x) - PLATE_PAD
  ctx.font = `700 ${PLATE_FONT}px ${FONT}`
  ctx.fillStyle = agent.offline ? t.muted : t.ink
  ctx.textBaseline = 'middle'
  ctx.fillText(text, tx, cy + 0.5, Math.max(1, maxW))
  ctx.restore()
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  theme: ThemeName,
  x: number,
  y: number,
  text: string,
  colour: string,
): void {
  ctx.save()
  ctx.font = `700 10px ${FONT}`
  const w = Math.ceil(ctx.measureText(text).width) + 16
  const h = 22
  ctx.fillStyle = theme === 'day' ? 'rgba(255,255,255,0.95)' : 'rgba(20,27,46,0.95)'
  ctx.strokeStyle = colour
  ctx.lineWidth = 1
  rounded(ctx, x, y, w, h, 10)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = colour
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 8, y + h / 2 + 0.5)
  ctx.restore()
}

function drawEnvelope(ctx: CanvasRenderingContext2D, theme: ThemeName, x: number, y: number): void {
  const t = THEME_TOKENS[theme]
  ctx.save()
  ctx.fillStyle = t.surfaceSolid
  ctx.strokeStyle = THEME_STATUS[theme].reviewing
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - 7, y - 5)
  ctx.lineTo(x + 7, y - 5)
  ctx.lineTo(x + 7, y + 5)
  ctx.lineTo(x - 7, y + 5)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - 7, y - 5)
  ctx.lineTo(x, y + 1)
  ctx.lineTo(x + 7, y - 5)
  ctx.stroke()
  ctx.restore()
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  theme: ThemeName,
): void {
  const r = size / 2
  ctx.save()
  ctx.fillStyle = colour
  ctx.strokeStyle = colour
  ctx.lineWidth = 1.2
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
  } else if (shape === 'triangle') {
    ctx.beginPath()
    ctx.moveTo(x, y - r)
    ctx.lineTo(x + r, y + r)
    ctx.lineTo(x - r, y + r)
    ctx.closePath()
    ctx.fill()
  } else if (shape === 'ring') {
    ctx.beginPath()
    ctx.arc(x, y, r - 1, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(x, y, r - 0.6, 0, Math.PI * 2)
    ctx.fill()
  }
  void theme
  ctx.restore()
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2)
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

/** The full roster (all desks), used when nothing else is available. */
export function allMetas(): AgentMeta[] {
  return rosterAgents()
}

