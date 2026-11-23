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
import { rosterAgents, tzLabel } from '../lib/roster'
import { poseFor, type Pose } from './anim'
import { journeyAt, journeyClock, journeyFor, liftChip } from './journey'
import { liftFrame, type LiftFrame, type LiftRider } from './lift'
import { THEME_STATUS, THEME_TOKENS, type ThemeName } from './palette'
import { drawAvatar, drawAvatarHands, avatarKey, type AvatarPose } from './avatar'
import { drawCity } from './city'
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
  COMPACT_MAX_W,
  PHONE_BOARD_MARGIN,
  SIDE_BOARD_TOP,
  SIDE_BOARDS,
  SIDE_FLOOR_BACK,
  SIDE_FLOOR_FRONT,
  SIDE_GLASS_TOP,
  SIDE_H,
  SIDE_W,
  boardsFor,
  fitZoomFor,
  sideLiftYAt,
  sideScale,
  sideTransform,
  sideSeats,
  visibleDesignRect,
  worldXToDesign,
  type SideSeat,
  type SideViewport,
  type SideBoard,
} from './side'

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

// ------------------------------------------------------------------ sprites

const avatarCache = new Map<string, HTMLCanvasElement>()
const AVATAR_BUCKET = 2
const AVATAR_LRU = 64

export function avatarSprite(look: AgentMeta['look'], pose: AvatarPose, frame: number, h: number): HTMLCanvasElement {
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
const CACHE_SCALE = 1.25
const CACHE_MAX = 6

export function clearStaticCache(): void {
  staticCache.clear()
}

export function createStaticLayer(
  floor: FloorId,
  theme: ThemeName,
  tzName = 'WIB',
  compact = false,
  boards: readonly SideBoard[] = SIDE_BOARDS,
): HTMLCanvasElement {
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
  // the city lives INSIDE the window band, not in a band above the ceiling.
  // Painted straight into the static sheet (no extra city canvas per cache).
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, SIDE_GLASS_TOP, SIDE_W, 485)
  ctx.clip()
  ctx.translate(0, SIDE_GLASS_TOP)
  drawCity(ctx, theme, floor, SIDE_W, 485)
  ctx.restore()
  drawCurtainWall(ctx, theme)
  drawSpandrel(ctx, theme)
  drawFloorPlane(ctx, theme)

  // boards hang in front of the glass on one rail
  drawBoards(ctx, theme, floor, tzName, compact, boards)
  // the lift core is part of the east wall
  drawLiftShaft(ctx, theme, floor)

  // floor props, standing on their row line (contact shadows included)
  drawBookshelf(ctx, theme, 58, SIDE_FLOOR_BACK, 0.92)
  if (floor === 3) drawServerRack(ctx, theme, 44, SIDE_FLOOR_FRONT, 0.92)
  else drawPlant(ctx, theme, 44, SIDE_FLOOR_FRONT, 0.95)
  drawPlant(ctx, theme, 90, SIDE_FLOOR_FRONT, 0.75)

  return canvas
}

export function staticLayerFor(
  floor: FloorId,
  theme: ThemeName,
  tzName = 'WIB',
  compact = false,
  boards: readonly SideBoard[] = SIDE_BOARDS,
): HTMLCanvasElement {
  // the phone wall depends on the viewport width, so the key carries its
  // geometry — one cached sheet per phone width, six boards for desktop
  const key = `${floor}:${theme}:${tzName}:${compact ? boards.map((b) => `${b.id}@${Math.round(b.x)}+${Math.round(b.w)}`).join(',') : 'wide'}`
  let canvas = staticCache.get(key)
  if (!canvas) {
    canvas = createStaticLayer(floor, theme, tzName, compact, boards)
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
  /** progress through the lift leg (0…1), the car's own phase while riding */
  liftPhase: number
  seat: SideSeat | null
  /** design-space draw position (feet) */
  designX: number
  designY: number
  avatarH: number
}

/** The first in-lift agent of a frame (the car's rider), or null. */
function riderOf(placed: readonly PlacedAgent[]): LiftRider | null {
  let best: LiftRider | null = null
  for (const p of placed) {
    if (!p.inLift) continue
    if (!best || p.meta.id < best.id) {
      best = { id: p.meta.id, floor: p.floor, inLift: true, liftTo: p.liftTo, phase: p.liftPhase }
    }
  }
  return best
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
        liftPhase: 0,
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
      liftPhase: j.liftPhase,
      seat: null,
      designX: worldXToDesign(j.x, FLOORS[j.floor].w),
      designY: SIDE_FLOOR_FRONT,
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
  /**
   * The lift frame for this instant (`scene2d/lift.ts`). The app passes the one
   * the GEDUNG view uses — same service, same phase. Omitted (gates, probes)
   * it is recomputed from `t` and the riders of this frame.
   */
  lift?: LiftFrame
  /** WIB hour/minute for the wall clock (from the server `now`) */
  hour: number
  minute: number
  /**
   * Phone wall: three boards, no decorative panels. Defaults to
   * `viewW < COMPACT_MAX_W` so a narrow canvas can never paint the wide set.
   */
  compact?: boolean
  /**
   * Canvas px reserved at the bottom for the D-pad (0 on desktop). Comes from
   * the layout, not from the canvas width: a desktop window narrowed by the
   * roster rail keeps its 150 px/unit camera.
   */
  band?: number
}

export function avatarPose(pose: Pose): AvatarPose {
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

export function poseFrame(pose: Pose, t: number, still: boolean): number {
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

/**
 * The status key a station is painted with. `agent` is optional on purpose: a
 * desk always exists, but its `/api/status` row may not (a status-only agent on
 * another floor, a roster still loading, or an agent that is walking right now).
 * Never dereference it without the guard — that crash killed the whole loop.
 */
function statusOf(agent: Agent | undefined, pose: Pose): keyof typeof THEME_STATUS.day {
  if (pose.offline || !agent) return 'offline'
  if (pose.blocked) return 'blocked'
  return statusKey(agent)
}

/**
 * The colour/shape key for one row. A stale working/reviewing verdict is drawn
 * as idle (the backend already demoted it; the canvas must agree), and waiting
 * has its own amber + square so it never reads as one more working desk.
 */
export function statusKey(agent: Agent): keyof typeof THEME_STATUS.day {
  // The backend already demoted a stale verdict to idle; paint it that way even
  // if a client sends `stale` next to a working/reviewing status.
  if (agent.stale === true) return 'idle'
  return (agent.status as keyof typeof THEME_STATUS.day) ?? 'offline'
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
  const band = r.band ?? 0
  const t = sideTransform(r.viewW, r.viewH, r.vp, band)
  const theme = r.theme
  const pal = THEME_TOKENS[theme]
  const status = THEME_STATUS[theme]
  const dpr = r.dpr
  const compact = r.compact ?? r.viewW < COMPACT_MAX_W
  // the phone wall lives inside the design window this viewport really shows,
  // with 8 CSS px of clearance from the screen edge (converted to design px at
  // the fit scale, so it is 21 at 390 px). The wall is laid out from the FIT
  // window, never the current zoom: it is painted into the cached stage, so it
  // must not move or re-key the cache while the user zooms.
  const wallZoom = band > 0 ? fitZoomFor(r.viewW, r.viewH, band) : 1
  const wallScale = sideScale(r.viewW, r.viewH, wallZoom, band)
  const wallWindow = compact ? visibleDesignRect(r.viewW, r.viewH, wallZoom, SIDE_W / 2, band) : undefined
  const boardMargin = compact && wallScale > 0 ? Math.ceil(PHONE_BOARD_MARGIN / wallScale) : undefined
  const boards = boardsFor(compact, wallWindow, boardMargin)

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = pal.page
  ctx.fillRect(0, 0, r.viewW, r.viewH)

  // the cached stage, scaled by the camera
  const stage = staticLayerFor(r.vp.floor, theme, tzLabel(), compact, boards)
  ctx.drawImage(stage, t.left, t.top, SIDE_W * t.s, SIDE_H * t.s)

  // The dynamic pass is painted in design px, so the camera has to be applied
  // once here — otherwise the desks, avatars and nameplates are drawn 1:1 and
  // a 390 px phone shows only 390/150 = 2.6 floor units of them, unscaled and
  // off the stage the sheet was just fitted into (the "BAGA…" screenshot).
  ctx.save()
  ctx.translate(t.left, t.top)
  ctx.scale(t.s, t.s)

  const resolved = placeAgents(r.metas, r.byId, r.now, r.comms, r.t)
  const onFloor = resolved.filter((p) => p.floor === r.vp.floor)
  const seats = sideSeats(r.metas.filter((m) => m.desk.floor === r.vp.floor))

  // ---- live board content + clock hands (the cached board is a blank shell)
  // The board counts every agent *on this floor*, seated or walking: filtering
  // to seats made an L1 frame read "0/0" the moment its only agent stepped into
  // the lift. Presence is the floor's roster; the seat only decides the drawing.
  drawStatusBoard(
    ctx,
    theme,
    onFloor.map((p) => ({ id: p.meta.id, name: p.meta.name, status: p.agent ? statusKey(p.agent) : 'offline' })),
    compact,
    boards,
  )
  drawClockHands(ctx, theme, r.hour, r.minute, compact, boards)

  // ---- the lift: the SAME frame the GEDUNG shaft paints (scene2d/lift.ts),
  // so the idle service, the doors, the arrow and the flash are one truth
  const lift = r.lift ?? liftFrame(r.t, riderOf(resolved))
  const liftY = sideLiftYAt(r.vp.floor)
  drawLiftCar(ctx, theme, lift, r.vp.floor)
  const dwelling = onFloor.find((p) => p.inLift)

  // ---- stations: back row first, then front row. A walking agent leaves an
  // empty desk behind (the chair stays, the monitor goes dark) — the desk must
  // never vanish just because its agent is on a delegation.
  for (const seat of seats) {
    const p = onFloor.find((q) => q.meta.id === seat.meta.id && !q.walking) ?? null
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
  for (const seat of seats) {
    const agent = r.byId.get(seat.meta.id)
    const key = agent ? statusKey(agent) : 'offline'
    statuses.set(seat.meta.id, {
      status: agent?.status ?? 'offline',
      shape: shapeOf(key),
      colour: status[key] ?? status.offline,
    })
  }
  const labelAgents = labelAgentsFor(seats, statuses)
  const bounds = { w: SIDE_W, h: SIDE_H }
  const reserved = boards.map((b) => ({ x: b.x, y: SIDE_BOARD_TOP, w: b.w, h: b.h }))
  // On the phone the sheet can be wider than the screen (zoomed in): clamp
  // plates to the part of the stage the viewport really shows, with a 4 CSS px
  // safety margin, or a plate near the edge is cut by the screen ("BAGA…"). At
  // the fit zoom that window is the whole stage, so nothing moves. The window
  // follows the camera, so panning never cuts a visible agent's plate; a plate
  // whose head has left the window keeps the stage bounds and is cropped with
  // its desk.
  const labelScale = sideScale(r.viewW, r.viewH, r.vp.zoom, band)
  const labelWindow =
    band > 0 && labelScale > 0
      ? {
          ...visibleDesignRect(r.viewW, r.viewH, r.vp.zoom, r.vp.camX, band),
          margin: Math.ceil(4 / labelScale),
          visibleHeadsOnly: true,
        }
      : undefined
  const { plates } = layoutSideLabels(labelAgents, bounds, reserved, labelWindow)
  for (const plate of plates) {
    const agent = labelAgents.find((a) => a.id === plate.id)
    if (!agent) continue
    drawPlate(ctx, theme, plate, agent)
  }

  // ---- lift chip (generic: floor only, never a message)
  if (dwelling) {
    const chip = liftChip(dwelling.liftTo ?? r.vp.floor)
    drawChip(ctx, theme, 742, liftY - 26, chip, status.reviewing)
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
  ctx.restore()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

function drawStation(
  ctx: CanvasRenderingContext2D,
  theme: ThemeName,
  seat: SideSeat,
  p: PlacedAgent | null,
  r: RenderInput,
): void {
  const agentAtDesk = r.byId.get(seat.meta.id)
  const key = p ? statusOf(p.agent, p.pose) : ((agentAtDesk?.status as keyof typeof THEME_STATUS.day) ?? 'offline')
  const offline = !agentAtDesk || key === 'offline'
  const scale = seat.scale

  // feet contact shadow
  drawWalkShadow(ctx, theme, seat.cx, seat.floorY, seat.avatarH)

  drawChair(ctx, theme, seat.cx, seat.floorY, scale, !offline)

  if (!offline && p) {
    const pose = avatarPose(p.pose)
    const frame = poseFrame(p.pose, r.t, r.still)
    const sprite = avatarSprite(p.meta.look, pose, frame, seat.avatarH)
    ctx.drawImage(sprite, seat.cx - (seat.avatarH * 0.72) / 2, seat.floorY - seat.avatarH, seat.avatarH * 0.72, seat.avatarH)
  }

  const deskTop = drawDesk(ctx, theme, seat.cx, seat.floorY, scale)
  drawKeyboardMouse(ctx, theme, seat.cx, deskTop, scale)
  if (!offline && p) {
    drawAvatarHands(ctx, p.meta.look, avatarPose(p.pose), poseFrame(p.pose, r.t, r.still), seat.cx, seat.floorY, seat.avatarH, deskTop)
  }
  drawMonitor(ctx, theme, seat.cx, seat.floorY, scale, key, p ? screenOf(p.pose) : 'off')

  // an empty station says so without colour
  if (offline) {
    ctx.save()
    ctx.globalAlpha = 0.75
    ctx.font = `600 9px ${FONT}`
    ctx.fillStyle = THEME_TOKENS[theme].muted
    ctx.fillText('Z Z Z', seat.cx + seat.headW / 2 + 4, seat.headTop + 10)
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
  // waiting is a hollow square: not a working dot, not an offline square either
  // (offline rows are grey and carry no live status).
  if (key === 'waiting') return 'square'
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

