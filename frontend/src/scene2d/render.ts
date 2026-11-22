/**
 * The 2D office painter: a prerendered static layer (floor zones, walls,
 * decorative furniture) plus a per-frame dynamic layer (desks whose monitor
 * reflects live activity, chairs, agents, nameplates, status chips and speech
 * bubbles).
 *
 * Two coordinate spaces, on purpose:
 *  - the world is drawn at zoom-1 pixels and blitted with an integer factor, so
 *    every sprite stays nearest-neighbour crisp on any DPR;
 *  - labels are laid out in CSS pixels (`labels.ts`) so a nameplate keeps the
 *    same readable size at every zoom and never grows wider than its desk slot.
 *
 * No text goes through `fillText`: plates are cached offscreen and invalidated
 * only when their contents change.
 */
import type { AgentMeta } from '../lib/agents'
import type { Agent, Comm } from '../lib/types'
import { deskObstacle } from '../lib/layout'
import { FLOORS, LIFT, obstaclesOf, wallsOf, type FloorId } from '../lib/rooms'
import { rosterAgents } from '../lib/roster'
import { seatPoint } from '../lib/routes'
import type { Pt } from '../lib/nav'
import { poseFor, blockedChipText, type Pose } from './anim'
import { dwellFloors, journeyAt, journeyClock, journeyFor, liftChip, liftDoorRect } from './journey'
import {
  DOT,
  PLATE_H,
  PLATE_PAD,
  buildStacks,
  labelsOf,
  placeStacks,
  plateMode,
  plateScale,
  plateWidth,
  plaqueRect,
  shortName,
  type LabelAgent,
  type Rect,
  type Stack,
} from './labels'
import { EXTRAS, FLOOR_MOTIF, PALETTE, SCREEN, STATUS, TEAM } from './palette'
import { drawText } from './pixelfont'
import { getSprite, type Sprite } from './sprites'
import {
  CHIBI_W,
  CHIBI_H,
  agentSprite,
  drawChair,
  drawDesk,
  drawEnvelope,
  drawFurniture,
} from './sprites'
import { TILE, blitScale, worldSize, worldToPixel, type Viewport } from './viewport'

export type MonitorMode = 'terminal' | 'doc' | 'browser' | 'diff' | 'idle' | 'off'

// ------------------------------------------------------------------- layers

const WALL_PX = 6 // thick cutaway wall band at 16 px/tile (design: 12 px @ 32)
const CHAIR_PX = 10

/**
 * Per-floor floor motifs (design §3.1) in the modern palette:
 *  - L1 lobby: polished concrete slab, terrazzo flecks (deterministic per
 *    tile, no Math.random), a dark entry mat inside the MASUK door
 *  - L2 Tim Edu: light concrete slab, a soft zone rug under the 2×2 edu block,
 *    a glass wall band along the north wall
 *  - L3 Tim Dev: dark polished concrete, a steel cable tray and warm
 *    ceiling-light strips across the slab
 */
function drawFloor(ctx: CanvasRenderingContext2D, floor: FloorId): void {
  const f = FLOORS[floor]
  const toPx = (v: number) => Math.round((v + f.w / 2) * TILE)
  const toPy = (v: number) => Math.round((v + f.d / 2) * TILE)
  if (floor === 1) {
    const m = FLOOR_MOTIF.lobby
    ctx.fillStyle = m.slab
    ctx.fillRect(0, 0, f.w * TILE, f.d * TILE)
    // terrazzo flecks: a tiny integer hash per tile, 1–2 px chips
    for (let tz = 0; tz < f.d; tz++) {
      for (let tx = 0; tx < f.w; tx++) {
        const hsh = (tx * 73856093) ^ (tz * 19349663)
        const n = ((hsh % 5) + 5) % 5
        if (n < 2) continue
        ctx.fillStyle = n === 2 || n === 4 ? m.fleck : m.fleckLight
        ctx.fillRect(tx * TILE + ((hsh >> 3) % 12), tz * TILE + ((hsh >> 7) % 12), n === 3 ? 2 : 1, 1)
      }
    }
    // entry mat inside the MASUK door (x -2.2..2.2 at the south wall)
    ctx.fillStyle = m.mat
    ctx.fillRect(toPx(-1.9), toPy(9.1), Math.round(3.8 * TILE), Math.round(0.7 * TILE))
    ctx.fillStyle = m.matEdge
    ctx.fillRect(toPx(-1.9), toPy(9.1), Math.round(3.8 * TILE), 1)
  } else if (floor === 2) {
    const m = FLOOR_MOTIF.edu
    ctx.fillStyle = m.slab
    ctx.fillRect(0, 0, f.w * TILE, f.d * TILE)
    // slab seams every 4 tiles
    ctx.fillStyle = m.seam
    for (let tz = 4; tz < f.d; tz += 4) ctx.fillRect(0, tz * TILE, f.w * TILE, 1)
    for (let tx = 4; tx < f.w; tx += 4) ctx.fillRect(tx * TILE, 0, 1, f.d * TILE)
    // glass wall band along the north wall
    ctx.fillStyle = m.band
    ctx.fillRect(0, 0, f.w * TILE, 3)
    ctx.fillStyle = PALETTE.glass300
    ctx.fillRect(0, 0, f.w * TILE, 1)
    // soft zone rug under the 2×2 edu block (x ±1.7, z -1.6..2.9)
    ctx.fillStyle = m.rug
    ctx.fillRect(toPx(-1.7), toPy(-1.6), Math.round(3.4 * TILE), Math.round(4.5 * TILE))
    ctx.fillStyle = m.rugEdge
    ctx.fillRect(toPx(-1.7), toPy(-1.6), Math.round(3.4 * TILE), 1)
    ctx.fillRect(toPx(-1.7), toPy(2.9) - 1, Math.round(3.4 * TILE), 1)
  } else {
    const m = FLOOR_MOTIF.dev
    ctx.fillStyle = m.slab
    ctx.fillRect(0, 0, f.w * TILE, f.d * TILE)
    // slab seams every 3 tiles
    ctx.fillStyle = m.seam
    for (let tz = 3; tz < f.d; tz += 3) ctx.fillRect(0, tz * TILE, f.w * TILE, 1)
    // steel cable tray along the north wall
    ctx.fillStyle = m.tray
    ctx.fillRect(0, 3, f.w * TILE, 4)
    ctx.fillStyle = PALETTE.steel500
    for (let tx = 2; tx < f.w; tx += 4) ctx.fillRect(tx * TILE, 3, 1, 4)
    // ceiling-light strips across the slab (the pools sit under them)
    for (const z of [-4.5, 0.5, 5.5]) {
      const y = toPy(z)
      ctx.fillStyle = m.lamp
      ctx.fillRect(toPx(-9), y, Math.round(18 * TILE), 2)
      ctx.fillStyle = m.tray
      ctx.fillRect(toPx(-9), y - 1, Math.round(18 * TILE), 1)
      ctx.fillRect(toPx(-9), y + 2, Math.round(18 * TILE), 1)
    }
  }
}

/**
 * Ceiling-light pools and fixtures (design §3.1): warm-white lamps floating
 * on the slab. Pools are pre-blended solid tones (no alpha); fixtures are
 * small lamp bars with steel ends. Drawn before walls and furniture.
 */
function drawCeilingLights(ctx: CanvasRenderingContext2D, floor: FloorId): void {
  const f = FLOORS[floor]
  const m = floor === 1 ? FLOOR_MOTIF.lobby : floor === 2 ? FLOOR_MOTIF.edu : FLOOR_MOTIF.dev
  const lamp = PALETTE.lamp
  const pools: Array<[number, number]> =
    floor === 1 ? [[-5.5, 0.5], [6.5, 5.5]] : floor === 2 ? [[0, 0.6], [-6.5, -5.2], [6.5, 5.2]] : [[-6, -4.5], [0, 0.5], [6, 5.5]]
  for (const [px, pz] of pools) {
    const x = Math.round((px - 3 + f.w / 2) * TILE)
    const y = Math.round((pz - 1.6 + f.d / 2) * TILE)
    const w = Math.round(6 * TILE)
    const h = Math.round(3.2 * TILE)
    // the pool: a lighter patch of slab
    ctx.fillStyle = m.pool
    ctx.fillRect(x, y, w, h)
    // the fixture: a short warm-white bar with steel end caps
    const fw = Math.round(2.4 * TILE)
    const fx = x + Math.round((w - fw) / 2)
    const fy = y + Math.round(h / 2) - 1
    ctx.fillStyle = PALETTE.steel500
    ctx.fillRect(fx - 2, fy, 2, 2)
    ctx.fillRect(fx + fw, fy, 2, 2)
    ctx.fillStyle = lamp
    ctx.fillRect(fx, fy, fw, 2)
  }
}

function drawWalls(ctx: CanvasRenderingContext2D, floor: FloorId): void {
  const f = FLOORS[floor]
  for (const seg of wallsOf(floor)) {
    const half = WALL_PX / 2
    let x: number
    let y: number
    let w: number
    let h: number
    if (seg.axis === 'x') {
      x = (Math.min(seg.from, seg.to) + f.w / 2) * TILE
      y = (seg.at + f.d / 2) * TILE - half
      w = Math.abs(seg.to - seg.from) * TILE
      h = WALL_PX
    } else {
      x = (seg.at + f.w / 2) * TILE - half
      y = (Math.min(seg.from, seg.to) + f.d / 2) * TILE
      w = WALL_PX
      h = Math.abs(seg.to - seg.from) * TILE
    }
    if (seg.kind === 'glass') {
      // a glass pane: blue solid tones inside a steel frame (no alpha)
      ctx.fillStyle = PALETTE.steel700
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = PALETTE.glass500
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2)
      ctx.fillStyle = PALETTE.glass300
      ctx.fillRect(x + 1, y + 1, w - 2, 1)
      if (seg.axis === 'x') {
        ctx.fillRect(x + 1, y + 1, 1, h - 2)
        // steel mullions every 2 world units
        ctx.fillStyle = PALETTE.steel700
        for (let mx = x + 2 * TILE; mx < x + w - 2; mx += 2 * TILE) ctx.fillRect(Math.round(mx), y, 2, h)
      } else {
        ctx.fillRect(x + 1, y + 1, 1, h - 2)
        ctx.fillStyle = PALETTE.steel700
        for (let my = y + 2 * TILE; my < y + h - 2; my += 2 * TILE) ctx.fillRect(x, Math.round(my), w, 2)
      }
      continue
    }
    // solid concrete wall band
    ctx.fillStyle = PALETTE.concrete900
    ctx.fillRect(x, y, w, h)
    // trim: light line on the two inner edges of the band
    ctx.fillStyle = PALETTE.concrete600
    if (seg.axis === 'x') {
      ctx.fillRect(x, y, w, 1)
      ctx.fillRect(x, y + h - 1, w, 1)
    } else {
      ctx.fillRect(x, y, 1, h)
      ctx.fillRect(x + w - 1, y, 1, h)
    }
  }
}

function drawFurnitureLayer(ctx: CanvasRenderingContext2D, floor: FloorId): void {
  const f = FLOORS[floor]
  for (const o of obstaclesOf(floor)) {
    if (o.id.startsWith('desk-')) continue // desks are drawn dynamically
    if (o.id.startsWith('lift-')) continue // the lift shaft gets its own painter
    const x = (o.x1 + f.w / 2) * TILE
    const y = (o.z1 + f.d / 2) * TILE
    const w = Math.max(1, Math.round((o.x2 - o.x1) * TILE))
    const h = Math.max(1, Math.round((o.z2 - o.z1) * TILE))
    ctx.save()
    ctx.translate(Math.round(x), Math.round(y))
    drawFurniture(ctx, o.id, w, h)
    ctx.restore()
  }
}

/**
 * The lift: a steel shaft with two door panels on its west face, a floor
 * indicator plate above the doors, and — while an agent dwells — the panels
 * slide apart (the dynamic overlay in drawLiftDoorsOpen).
 */
function drawLift(ctx: CanvasRenderingContext2D, floor: FloorId): void {
  const f = FLOORS[floor]
  const { shaft } = LIFT[floor]
  const x = (shaft.x1 + f.w / 2) * TILE
  const y = (shaft.z1 + f.d / 2) * TILE
  const w = Math.round((shaft.x2 - shaft.x1) * TILE)
  const h = Math.round((shaft.z2 - shaft.z1) * TILE)
  // steel shaft body with a lighter face plate
  ctx.fillStyle = PALETTE.steel700
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = PALETTE.steel500
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4)
  // door frame on the west face, centred on the walk node (z = 0.6)
  const dz = Math.round((0.6 + f.d / 2) * TILE)
  ctx.fillStyle = PALETTE.concrete800
  ctx.fillRect(x - 2, dz - 14, 4, 28)
  // closed steel door panels; the dynamic layer slides them apart while an
  // agent dwells on this floor (renderFrame → drawLiftDoorsOpen)
  ctx.fillStyle = PALETTE.steel300
  ctx.fillRect(x, dz - 12, 7, 24)
  ctx.fillRect(x + 7, dz - 12, 7, 24)
  ctx.fillStyle = PALETTE.concrete800
  ctx.fillRect(x + 6, dz - 12, 1, 24)
  ctx.fillRect(x + 7, dz - 12, 1, 24)
  // floor indicator above the doors: dark plate, amber number
  const label = `L${floor}`
  const iw = 14
  const ix = x - 1
  const iy = dz - 24
  ctx.fillStyle = PALETTE.concrete900
  ctx.fillRect(ix, iy, iw, 9)
  ctx.fillStyle = PALETTE.steel500
  ctx.fillRect(ix, iy, iw, 1)
  ctx.fillRect(ix, iy + 8, iw, 1)
  ctx.fillRect(ix, iy, 1, 9)
  ctx.fillRect(ix + iw - 1, iy, 1, 9)
  drawText(ctx, label, ix + 3, iy + 1, 1, PALETTE.amber)
}

/**
 * Dynamic overlay: while an agent dwells in the lift on the active floor, the
 * steel doors part and the dark car interior shows. Drawn in CSS px on top of
 * the cached static layer.
 */
function drawLiftDoorsOpen(
  ctx: CanvasRenderingContext2D,
  floor: FloorId,
  toCss: (x: number, z: number) => { x: number; y: number },
  k: number,
  dpr: number,
): void {
  const door = liftDoorRect(floor)
  const c = toCss(door.x, door.z)
  const w = Math.round(14 * k)
  const h = Math.round(24 * k)
  const x = Math.round(c.x * dpr)
  const y = Math.round((c.y - h / 2) * dpr)
  // dark car interior
  ctx.fillStyle = PALETTE.concrete900
  ctx.fillRect(x, y, w, h)
  // the warm ceiling light of the car
  ctx.fillStyle = PALETTE.lamp
  ctx.fillRect(x + 2 * dpr, y + Math.max(1, dpr), w - 4 * dpr, Math.max(1, dpr))
  // the two panels, slid to the sides of the opening
  const pw = Math.max(2, Math.round(6 * k))
  ctx.fillStyle = PALETTE.steel300
  ctx.fillRect(x - pw, y, pw, h)
  ctx.fillRect(x + w, y, pw, h)
  ctx.fillStyle = PALETTE.steel500
  ctx.fillRect(x - 1, y, Math.max(1, dpr), h)
  ctx.fillRect(x + w, y, Math.max(1, dpr), h)
}

/** Build the static world surface of one floor; the caller caches it. */
export function createStaticLayer(floor: FloorId): HTMLCanvasElement {
  const { w, h } = worldSize(floor)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  drawFloor(ctx, floor)
  drawCeilingLights(ctx, floor)
  drawWalls(ctx, floor)
  drawFurnitureLayer(ctx, floor)
  drawLift(ctx, floor)
  return canvas
}

/** The static layer cache: one prerendered canvas per floor. */
const staticCache = new Map<FloorId, HTMLCanvasElement>()

/** The prerendered static surface of one floor (built once, then cached). */
export function staticLayerFor(floor: FloorId): HTMLCanvasElement {
  let canvas = staticCache.get(floor)
  if (!canvas) {
    canvas = createStaticLayer(floor)
    staticCache.set(floor, canvas)
  }
  return canvas
}

// ------------------------------------------------------------------- plates

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

function monitorMode(pose: Pose): MonitorMode {
  if (pose.offline || pose.blocked) return 'off'
  if (pose.magnifier) return 'diff'
  if (pose.kind === 'typing') return 'terminal'
  if (pose.kind === 'reading') return pose.tool === 'web_extract' || pose.tool === 'web_search' ? 'browser' : 'doc'
  return 'idle'
}

function statusColor(agent: Agent | undefined, pose: Pose): string {
  const status = agent?.status ?? 'offline'
  if (pose.blocked) return STATUS.blocked
  if (pose.offline) return STATUS.offline
  return (STATUS as Record<string, string>)[status] ?? STATUS.idle
}

interface PlateOpts {
  bg: string
  border: string
  ink: string
  /** filled status dot on the left edge */
  dot?: string
  /** idle: the dot is a ring, not a disc — a shape cue, not only a colour */
  hollowDot?: boolean
  /** offline: 1 px border, no fill — a hollow plate reads as "empty desk" */
  hollow?: boolean
}

/** A nameplate/chip plate, drawn at the zoom's pixel-font scale (CSS px). */
function pillPlate(text: string, opts: PlateOpts, scale = 1): Sprite {
  const w = plateWidth(text, { dot: Boolean(opts.dot), scale })
  const h = PLATE_H * scale
  const dotW = opts.dot ? (DOT + 2) * scale : 0
  const key = `pill:${text}:${opts.bg}:${opts.border}:${opts.ink}:${opts.dot ?? ''}:${opts.hollowDot ? 1 : 0}:${opts.hollow ? 1 : 0}:${scale}`
  return getSprite(key, w, h, (ctx) => {
    if (opts.hollow) {
      ctx.fillStyle = opts.bg
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = opts.border
      ctx.fillRect(0, 0, w, scale)
      ctx.fillRect(0, h - scale, w, scale)
      ctx.fillRect(0, 0, scale, h)
      ctx.fillRect(w - scale, 0, scale, h)
    } else {
      ctx.fillStyle = opts.border
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = opts.bg
      ctx.fillRect(scale, scale, w - 2 * scale, h - 2 * scale)
    }
    if (opts.dot) {
      const ds = DOT * scale
      const dy = Math.round((h - ds) / 2)
      ctx.fillStyle = opts.dot
      if (opts.hollowDot) {
        ctx.fillRect(PLATE_PAD * scale, dy, ds, scale)
        ctx.fillRect(PLATE_PAD * scale, dy + ds - scale, ds, scale)
        ctx.fillRect(PLATE_PAD * scale, dy, scale, ds)
        ctx.fillRect(PLATE_PAD * scale + ds - scale, dy, scale, ds)
      } else {
        ctx.fillRect(PLATE_PAD * scale, dy, ds, ds)
      }
    }
    drawText(ctx, text, PLATE_PAD * scale + dotW, PLATE_PAD * scale, scale, opts.ink)
  })
}

function bubblePlate(text: string, scale = 1): Sprite {
  const w = plateWidth(text, { scale }) + 2 * scale
  const h = (PLATE_H + 3) * scale
  const key = `bubble:${text}:${scale}`
  return getSprite(key, w, h, (ctx) => {
    ctx.fillStyle = PALETTE.concrete100
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = PALETTE.concrete600
    ctx.fillRect(0, 0, w, scale)
    ctx.fillRect(0, h - scale, w, scale)
    ctx.fillRect(0, 0, scale, h)
    ctx.fillRect(w - scale, 0, scale, h)
    // tail, pointing down at the head
    ctx.fillStyle = PALETTE.concrete100
    ctx.fillRect(Math.floor(w / 2) - scale, h - scale, 3 * scale, 2 * scale)
    ctx.fillStyle = PALETTE.concrete600
    ctx.fillRect(Math.floor(w / 2) - scale, h, 3 * scale, scale)
    drawText(ctx, text, PLATE_PAD * scale, (PLATE_PAD + 1) * scale, scale, SCREEN.bubbleInk)
  })
}

/** The zone plaque: concrete plate with an amber floor number, accent-free body. */
function plaquePlate(text: string): Sprite {
  const w = plaqueRect(text, 0, 0).w
  const h = plaqueRect(text, 0, 0).h
  const key = `plaque:${text}`
  return getSprite(key, w, h, (ctx) => {
    ctx.fillStyle = PALETTE.concrete800
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = PALETTE.concrete500
    ctx.fillRect(0, 0, w, 1)
    ctx.fillRect(0, h - 1, w, 1)
    ctx.fillRect(0, 0, 1, h)
    ctx.fillRect(w - 1, 0, 1, h)
    drawText(ctx, text, PLATE_PAD, PLATE_PAD - 1, 1, PALETTE.muted)
  })
}

// ---------------------------------------------------------------- geometry

/**
 * One agent resolved to its current floor + position for a single frame. The
 * `floor` is the journey's current floor while walking — an agent in transit
 * belongs to exactly one floor at a time, never two.
 */
export interface PlacedAgent {
  meta: AgentMeta
  agent: Agent | undefined
  pose: Pose
  /** the floor the agent is on right now (journey floor, else its desk floor) */
  floor: FloorId
  x: number
  z: number
  walking: boolean
  /** dwelling in the lift on `floor`, riding towards `liftTo` */
  inLift: boolean
  liftTo: FloorId | null
}

/**
 * Resolve every agent's position for one frame. A delegate gets a
 * deterministic journey (scene2d/journey.ts) that may cross floors through
 * the lift; everyone else sits at their desk. Offline agents stay parked.
 */
export function placeAgents(
  metas: AgentMeta[],
  byId: Map<string, Agent>,
  now: number,
  comms: Comm[],
  t: number,
): PlacedAgent[] {
  return metas.map((meta) => {
    const agent = byId.get(meta.id)
    const pose = agent ? poseFor(agent, now, comms) : OFFLINE_POSE
    const seat = seatPoint(meta)
    if (pose.kind !== 'walk' || !pose.walkTo || pose.offline) {
      return {
        meta,
        agent,
        pose,
        floor: meta.desk.floor,
        x: seat[0],
        z: seat[1],
        walking: false,
        inLift: false,
        liftTo: null,
      }
    }
    const journey = journeyFor(meta, pose.walkTo)
    const j = journeyAt(journey, journeyClock(meta, journey, t))
    return { meta, agent, pose, floor: j.floor, x: j.x, z: j.z, walking: j.walking, inLift: j.inLift, liftTo: j.liftTo }
  })
}

/** Live world position of one agent (current floor) for picking & the proximity card. */
export function pickTargets(placed: PlacedAgent[]): Array<{ id: string; floor: FloorId; x: number; z: number }> {
  return placed.map((p) => ({ id: p.meta.id, floor: p.floor, x: p.x, z: p.z }))
}

// ---------------------------------------------------------------- the frame

export interface RenderInput {
  static: HTMLCanvasElement
  metas: AgentMeta[]
  byId: Map<string, Agent>
  now: number
  comms: Comm[]
  vp: Viewport
  /** CSS size of the canvas element */
  viewW: number
  viewH: number
  dpr: number
  stale: boolean
  still: boolean
  /** monotonic seconds (0 while still) */
  t: number
}

/** Paint one full frame into a canvas whose backing store is already sized. */
export function renderFrame(ctx: CanvasRenderingContext2D, r: RenderInput): void {
  const s = blitScale(r.vp.zoom, r.dpr) // backing px per world px
  const k = s / r.dpr // CSS px per world px
  const dpr = r.dpr
  const cssW = ctx.canvas.width / dpr
  const cssH = ctx.canvas.height / dpr

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = EXTRAS.bg
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const centre = worldToPixel(r.vp.x, r.vp.z, r.vp.floor)
  const ox = cssW / 2 - centre.x * k
  const oy = cssH / 2 - centre.y * k
  /** world → CSS px */
  const toCss = (x: number, z: number) => {
    const p = worldToPixel(x, z, r.vp.floor)
    return { x: ox + p.x * k, y: oy + p.y * k }
  }
  /** blit a zoom-1 world sprite at a CSS position */
  const blitWorld = (spr: Sprite, cx: number, cy: number) => {
    ctx.drawImage(
      spr.canvas,
      Math.round(cx * dpr),
      Math.round(cy * dpr),
      Math.round(spr.w * s),
      Math.round(spr.h * s),
    )
  }
  /** blit a 1× CSS sprite (a label plate) at a CSS position */
  const blitLabel = (spr: Sprite, cx: number, cy: number) => {
    ctx.drawImage(
      spr.canvas,
      Math.round(cx * dpr),
      Math.round(cy * dpr),
      Math.round(spr.w * dpr),
      Math.round(spr.h * dpr),
    )
  }

  // concrete plinth framing the active floor — a quiet exterior hint
  const { w: worldWpx, h: worldHpx } = worldSize(r.vp.floor)
  const tl = toCss(-FLOORS[r.vp.floor].w / 2, -FLOORS[r.vp.floor].d / 2)
  ctx.fillStyle = PALETTE.concrete800
  ctx.fillRect(Math.round(tl.x - 4 * k) * dpr, Math.round(tl.y - 4 * k) * dpr, Math.round((worldWpx + 8) * k) * dpr, Math.round((worldHpx + 8) * k) * dpr)
  ctx.fillStyle = PALETTE.concrete600
  ctx.fillRect(Math.round(tl.x - 2 * k) * dpr, Math.round(tl.y - 2 * k) * dpr, Math.round((worldWpx + 4) * k) * dpr, Math.round((worldHpx + 4) * k) * dpr)

  blitWorld({ canvas: r.static, w: worldWpx, h: worldHpx }, tl.x, tl.y)

  const mode = plateMode(r.vp.zoom)
  const scale = plateScale(r.vp.zoom)

  // Every agent resolved to its current floor + position: a delegate's journey
  // may cross floors, so an in-transit agent belongs to exactly one floor —
  // the journey's current floor — and is drawn only while that floor is active.
  const resolved = placeAgents(r.metas, r.byId, r.now, r.comms, r.t)

  // lift doors stand open on any floor where an agent dwells
  if (dwellFloors(resolved).has(r.vp.floor)) drawLiftDoorsOpen(ctx, r.vp.floor, toCss, k, dpr)

  // The dynamic layer shows the active floor only: desks, chairs, agents,
  // nameplates and comm envelopes all belong to the floor on screen.
  const floorMetas = r.metas.filter((m) => m.desk.floor === r.vp.floor)

  // desks + chairs, z-sorted (south last) so back rows sit behind front rows
  const deskOrder = [...floorMetas].sort((a, b) => a.desk.z - b.desk.z)
  for (const meta of deskOrder) {
    const agent = r.byId.get(meta.id)
    const pose = agent ? poseFor(agent, r.now, r.comms) : OFFLINE_POSE
    const foot = deskObstacle(meta.desk, meta.id)
    const dx = toCss(foot.x1, foot.z1)
    const dw = Math.max(1, Math.round((foot.x2 - foot.x1) * TILE))
    const dh = Math.max(1, Math.round((foot.z2 - foot.z1) * TILE))
    const mon = monitorMode(pose)
    const desk = getSprite(`desk:${dw}x${dh}:${mon}`, dw, dh, (c) => drawDesk(c, dw, dh, mon))
    blitWorld(desk, dx.x, dx.y)
    const seat = seatPoint(meta)
    const sd = toCss(seat[0], seat[1])
    const chair = getSprite(`chair:${CHAIR_PX}:${pose.offline ? 'empty' : 'taken'}`, CHAIR_PX, CHAIR_PX, (c) =>
      drawChair(c, CHAIR_PX, !pose.offline),
    )
    blitWorld(chair, sd.x - (CHAIR_PX / 2) * k, sd.y - (CHAIR_PX / 2) * k)
    if (pose.offline) {
      // dim the abandoned station — the second, colour-free cue is the empty chair
      ctx.fillStyle = 'rgba(10, 15, 22, 0.4)'
      ctx.fillRect(
        Math.round(dx.x * dpr),
        Math.round(dx.y * dpr),
        Math.round(dw * s),
        Math.round(dh * s),
      )
    }
  }

  // agents on the active floor, painter's-algorithm sorted by current z
  // (south drawn last); a cross-floor delegate appears only on the floor
  // their journey is currently on
  const order = resolved
    .filter((p) => p.floor === r.vp.floor)
    .map((p) => ({ ...p }))
    .sort((a, b) => a.z - b.z)

  for (const item of order) {
    const { meta, pose, walking } = item
    if (pose.offline) continue // the empty chair already tells the story
    const head = toCss(item.x, item.z)
    const frame =
      walking
        ? Math.floor(r.t * 6) % 4
        : pose.kind === 'idle' || pose.kind === 'relax'
          ? Math.floor(r.t * 1.5) % 2
          : pose.kind === 'typing'
            ? Math.floor(r.t * 4) % 2
            : 0
    const spr = agentSprite(meta.look, pose.kind, frame)
    blitWorld(spr, head.x - (CHIBI_W / 2) * k, head.y - CHIBI_H * k)
  }

  // ------------------------------------------------------------- labels
  // Laid out in CSS px (never scaled by the zoom) so 13 nameplates stay
  // readable and inside their desk slot at every zoom level.
  const reserved: Rect[] = []
  for (const zl of labelsOf(r.vp.floor)) {
    const c = toCss(zl.x, zl.z)
    const spr = plaquePlate(zl.text)
    const rect = plaqueRect(zl.text, c.x, c.y)
    const x = Math.min(Math.max(rect.x, 1), Math.max(1, cssW - rect.w - 1))
    blitLabel(spr, x, rect.y)
    reserved.push({ x, y: rect.y, w: rect.w, h: rect.h })
  }

  const stacks: Stack[] = []
  const labelAgents: LabelAgent[] = []
  const sprites = new Map<string, Sprite>()

  for (const item of order) {
    const { meta, agent, pose } = item
    const head = toCss(item.x, item.z)
    const offline = pose.offline
    const dot = mode === 'compact' ? undefined : statusColor(agent, pose)
    const bubble =
      mode !== 'compact' && !offline && (pose.blocked || pose.kind === 'typing' || pose.kind === 'reading' || pose.kind === 'working')
        ? pose.blocked
          ? '!'
          : dotsFrame(r.t)
        : ''
    const chip =
      mode === 'compact'
        ? ''
        : item.inLift
          ? liftChip(item.liftTo ?? r.vp.floor)
          : statusChip(agent, pose)
    const counters = mode === 'detail' && !offline ? countersLine(agent) : ''

    // nameplate: team accent border, status dot, full first name
    sprites.set(
      `${meta.id}|name`,
      pillPlate(
        shortName(meta.name),
        {
          bg: offline ? PALETTE.concrete800 : PALETTE.concrete900,
          border: offline ? PALETTE.concrete500 : teamAccent(meta.team),
          ink: offline ? PALETTE.muted : PALETTE.ink,
          dot,
          hollowDot: agent?.status === 'idle' && !offline,
          hollow: offline,
        },
        scale,
      ),
    )
    if (chip) {
      sprites.set(
        `${meta.id}|chip`,
        pillPlate(
          chip,
          {
            bg: pose.blocked ? STATUS.blocked : PALETTE.concrete800,
            border: pose.blocked ? PALETTE.concrete900 : pose.magnifier ? STATUS.reviewing : PALETTE.concrete500,
            ink: pose.blocked ? EXTRAS.inkOnAmber : pose.magnifier ? STATUS.reviewing : PALETTE.inkDim,
          },
          scale,
        ),
      )
    }
    if (counters) {
      sprites.set(
        `${meta.id}|counters`,
        pillPlate(counters, { bg: PALETTE.concrete900, border: PALETTE.concrete700, ink: PALETTE.inkDim }, scale),
      )
    }
    if (offline && mode !== 'compact') {
      sprites.set(
        `${meta.id}|zzz`,
        pillPlate('Z Z Z', { bg: PALETTE.concrete800, border: PALETTE.muted, ink: PALETTE.muted }, scale),
      )
    }
    if (bubble) sprites.set(`${meta.id}|bubble`, bubblePlate(bubble, scale))

    labelAgents.push({
      id: meta.id,
      name: meta.name,
      cx: head.x,
      topY: head.y - CHIBI_H * k,
      offline,
      chip,
      bubble,
      counters,
      dot,
    })
  }

  stacks.push(...buildStacks(labelAgents, mode, scale))

  const placed = placeStacks(stacks, { w: cssW, h: cssH }, reserved, scale)
  for (const p of placed) {
    const spr = sprites.get(`${p.id}|${p.key}`)
    if (spr) blitLabel(spr, p.x, p.y)
  }

  // comms envelopes: a quick paper-plane hop from sender to recipient, only
  // when both ends are on the same active floor (cross-floor comms ride the lift)
  for (const c of r.comms) {
    const age = r.now - c.ts
    if (age < 0 || age > 1.5) continue
    const from = resolved.find((p) => p.meta.id === c.from)
    const to = resolved.find((p) => p.meta.id === c.to)
    if (!from || !to) continue
    if (from.floor !== r.vp.floor || to.floor !== r.vp.floor) continue
    const fp: Pt = [from.x, from.z]
    const tp: Pt = [to.x, to.z]
    const kk = age / 1.5
    const x = fp[0] + (tp[0] - fp[0]) * kk
    const z = fp[1] + (tp[1] - fp[1]) * kk - Math.sin(kk * Math.PI) * 0.6
    const p = toCss(x, z)
    const env = getSprite('envelope', 10, 8, (c2) => drawEnvelope(c2))
    blitWorld(env, p.x - (env.w / 2) * k, p.y - (env.h / 2) * k)
  }
}

function teamAccent(team: string): string {
  if (team === 'dev') return TEAM.dev
  if (team === 'edu') return TEAM.edu
  return TEAM.lobby
}

function dotsFrame(t: number): string {
  const f = Math.floor(t * 2) % 3
  return f === 0 ? '.' : f === 1 ? '..' : '...'
}

function statusChip(agent: Agent | undefined, pose: Pose): string {
  if (pose.offline) return 'offline'
  if (pose.blocked) return agent ? blockedChipText(agent) : 'butuh izin'
  if (pose.magnifier) return 'review'
  if (pose.kind === 'typing' || pose.kind === 'reading' || pose.kind === 'working') return pose.tool || 'kerja'
  if (pose.kind === 'walk') return 'delegasi'
  if (pose.kind === 'idle' || pose.kind === 'relax') return 'idle'
  return ''
}

/** Counters only at zoom ≥3, where a detail plate has room for them. */
function countersLine(agent: Agent | undefined): string {
  if (!agent) return ''
  const m = agent.today?.messages ?? 0
  const t = agent.today?.tool_calls ?? 0
  const task = agent.task ? `#${agent.task.slice(0, 6)}` : ''
  const cnt = `${m}M ${t}T`
  return task ? `${cnt} ${task}` : cnt
}

// ------------------------------------------------------------------ helpers

/** The full roster (all desks), used when nothing else is available. */
export function allMetas(): AgentMeta[] {
  return rosterAgents()
}
