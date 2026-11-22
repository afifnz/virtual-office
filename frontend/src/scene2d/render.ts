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
import { DESK_EXIT, FLOOR, OBSTACLES, POIS, WALLS } from '../lib/rooms'
import { hashId, rosterAgents } from '../lib/roster'
import { onward, seatPoint } from '../lib/routes'
import type { Pt } from '../lib/nav'
import { poseFor, blockedChipText, type Pose } from './anim'
import {
  PLATE_H,
  PLATE_PAD,
  WORLD_LABELS,
  buildStacks,
  placeStacks,
  plateMode,
  plateWidth,
  plaqueRect,
  shortName,
  type LabelAgent,
  type PlateMode,
  type Rect,
  type Stack,
} from './labels'
import { EXTRAS, PALETTE, SCREEN, STATUS } from './palette'
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
import { TILE, WORLD_H, WORLD_W, blitScale, worldToPixel, type Viewport } from './viewport'

export type MonitorMode = 'terminal' | 'doc' | 'browser' | 'diff' | 'idle' | 'off'

// ------------------------------------------------------------------- layers

const WALL_PX = 6 // thick cutaway wall band at 16 px/tile (design: 12 px @ 32)
const CHAIR_PX = 10

/** Which zone a floor tile belongs to: lobby z>=2, dev x<0, edu x>=0. */
function zoneAt(tx: number, tz: number): 'lobby' | 'dev' | 'edu' {
  if (tz >= 12) return 'lobby' // world z >= 2
  return tx < 14 ? 'dev' : 'edu' // world x < 0
}

function drawFloor(ctx: CanvasRenderingContext2D): void {
  for (let tz = 0; tz < FLOOR.d; tz++) {
    for (let tx = 0; tx < FLOOR.w; tx++) {
      const zone = zoneAt(tx, tz)
      let c: string
      if (zone === 'lobby') c = (tx + tz) % 2 === 0 ? '#C4602C' : '#E07B3E'
      else if (zone === 'edu') c = '#D9B36B'
      else c = '#1F2A42'
      ctx.fillStyle = c
      ctx.fillRect(tx * TILE, tz * TILE, TILE, TILE)
      if (zone === 'lobby' && tz === 12) {
        // sand strip marking the Pendopo edge along the partition
        ctx.fillStyle = PALETTE.sand300
        ctx.fillRect(tx * TILE, tz * TILE, TILE, TILE)
      }
      // dev plank seam every tile row + amber duct along the north wall
      if (zone === 'dev') {
        ctx.fillStyle = '#16203A'
        ctx.fillRect(tx * TILE, (tz + 1) * TILE - 1, TILE, 1)
        if (tz === 0) {
          ctx.fillStyle = '#C99A3C'
          ctx.fillRect(tx * TILE, 1, TILE, 2)
        }
      } else if (zone === 'edu') {
        // woven bamboo: diagonal 2px lines, alternating direction per tile
        ctx.fillStyle = '#C49A4E'
        const flip = (tx + tz) % 2 === 0
        for (let k = 0; k < TILE; k += 4) {
          if (flip) {
            ctx.fillRect(tx * TILE + k, tz * TILE + TILE - k - 2, 2, 2)
          } else {
            ctx.fillRect(tx * TILE + k, tz * TILE + k, 2, 2)
          }
        }
      }
    }
  }
}

function drawWalls(ctx: CanvasRenderingContext2D): void {
  for (const seg of WALLS) {
    const half = WALL_PX / 2
    let x: number
    let y: number
    let w: number
    let h: number
    if (seg.axis === 'x') {
      x = (Math.min(seg.from, seg.to) + FLOOR.w / 2) * TILE
      y = (seg.at + FLOOR.d / 2) * TILE - half
      w = Math.abs(seg.to - seg.from) * TILE
      h = WALL_PX
    } else {
      x = (seg.at + FLOOR.w / 2) * TILE - half
      y = (Math.min(seg.from, seg.to) + FLOOR.d / 2) * TILE
      w = WALL_PX
      h = Math.abs(seg.to - seg.from) * TILE
    }
    ctx.fillStyle = PALETTE.navy900
    ctx.fillRect(x, y, w, h)
    // trim: light line on the two inner edges of the band
    ctx.fillStyle = PALETTE.navy700
    if (seg.axis === 'x') {
      ctx.fillRect(x, y, w, 1)
      ctx.fillRect(x, y + h - 1, w, 1)
    } else {
      ctx.fillRect(x, y, 1, h)
      ctx.fillRect(x + w - 1, y, 1, h)
    }
  }
}

function drawFurnitureLayer(ctx: CanvasRenderingContext2D): void {
  for (const o of OBSTACLES) {
    if (o.id.startsWith('desk-')) continue // desks are drawn dynamically
    const x = (o.x1 + FLOOR.w / 2) * TILE
    const y = (o.z1 + FLOOR.d / 2) * TILE
    const w = Math.max(1, Math.round((o.x2 - o.x1) * TILE))
    const h = Math.max(1, Math.round((o.z2 - o.z1) * TILE))
    ctx.save()
    ctx.translate(Math.round(x), Math.round(y))
    drawFurniture(ctx, o.id, w, h)
    ctx.restore()
  }
}

/** Build the static world surface (448×320) once; rebuilt only on config change. */
export function createStaticLayer(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = WORLD_W
  canvas.height = WORLD_H
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  drawFloor(ctx)
  drawWalls(ctx)
  drawFurnitureLayer(ctx)
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

/** A nameplate/chip plate, drawn at pixel-font scale 1 (CSS px). */
function pillPlate(text: string, opts: PlateOpts): Sprite {
  const w = plateWidth(text, { dot: Boolean(opts.dot) })
  const h = PLATE_H
  const dotW = opts.dot ? 6 : 0
  const key = `pill:${text}:${opts.bg}:${opts.border}:${opts.ink}:${opts.dot ?? ''}:${opts.hollowDot ? 1 : 0}:${opts.hollow ? 1 : 0}`
  return getSprite(key, w, h, (ctx) => {
    if (opts.hollow) {
      ctx.fillStyle = opts.bg
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = opts.border
      ctx.fillRect(0, 0, w, 1)
      ctx.fillRect(0, h - 1, w, 1)
      ctx.fillRect(0, 0, 1, h)
      ctx.fillRect(w - 1, 0, 1, h)
    } else {
      ctx.fillStyle = opts.border
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = opts.bg
      ctx.fillRect(1, 1, w - 2, h - 2)
    }
    if (opts.dot) {
      const ds = 4
      const dy = Math.round((h - ds) / 2)
      ctx.fillStyle = opts.dot
      if (opts.hollowDot) {
        ctx.fillRect(PLATE_PAD, dy, ds, 1)
        ctx.fillRect(PLATE_PAD, dy + ds - 1, ds, 1)
        ctx.fillRect(PLATE_PAD, dy, 1, ds)
        ctx.fillRect(PLATE_PAD + ds - 1, dy, 1, ds)
      } else {
        ctx.fillRect(PLATE_PAD, dy, ds, ds)
      }
    }
    drawText(ctx, text, PLATE_PAD + dotW, PLATE_PAD, 1, opts.ink)
  })
}

function bubblePlate(text: string): Sprite {
  const w = plateWidth(text) + 2
  const h = PLATE_H + 3
  const key = `bubble:${text}`
  return getSprite(key, w, h, (ctx) => {
    ctx.fillStyle = PALETTE.sand200
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = PALETTE.navy600
    ctx.fillRect(0, 0, w, 1)
    ctx.fillRect(0, h - 1, w, 1)
    ctx.fillRect(0, 0, 1, h)
    ctx.fillRect(w - 1, 0, 1, h)
    // tail, pointing down at the head
    ctx.fillStyle = PALETTE.sand200
    ctx.fillRect(Math.floor(w / 2) - 1, h - 1, 3, 2)
    ctx.fillStyle = PALETTE.navy600
    ctx.fillRect(Math.floor(w / 2) - 1, h, 3, 1)
    drawText(ctx, text, PLATE_PAD, PLATE_PAD + 1, 1, SCREEN.bubbleInk)
  })
}

/** The zone plaque: navy plate, accent-free, always the same size on screen. */
function plaquePlate(text: string): Sprite {
  const w = plaqueRect(text, 0, 0).w
  const h = plaqueRect(text, 0, 0).h
  const key = `plaque:${text}`
  return getSprite(key, w, h, (ctx) => {
    ctx.fillStyle = PALETTE.navy800
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = PALETTE.navy600
    ctx.fillRect(0, 0, w, 1)
    ctx.fillRect(0, h - 1, w, 1)
    ctx.fillRect(0, 0, 1, h)
    ctx.fillRect(w - 1, 0, 1, h)
    drawText(ctx, text, PLATE_PAD, PLATE_PAD - 1, 1, PALETTE.muted)
  })
}

// ---------------------------------------------------------------- geometry

/** Live world position of one agent for picking & the proximity card. */
export function pickTargets(metas: AgentMeta[]): Array<{ id: string; x: number; z: number }> {
  return metas.map((m) => {
    const p = seatPoint(m)
    return { id: m.id, x: p[0], z: p[1] }
  })
}

function poiPoint(id: string): Pt {
  return (POIS.find((p) => p.id === id)?.pos as Pt | undefined) ?? [0, 5]
}

function pathLen(path: Pt[]): number {
  let L = 0
  for (let i = 0; i < path.length - 1; i++) {
    L += Math.hypot(path[i + 1]![0] - path[i]![0], path[i + 1]![1] - path[i]![1])
  }
  return L
}

function pointAt(path: Pt[], dist: number): Pt {
  if (path.length === 0) return [0, 0]
  if (path.length === 1) return path[0]!
  let rem = dist
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (rem <= seg || i === path.length - 2) {
      const k = seg > 0 ? Math.min(1, rem / seg) : 1
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
    }
    rem -= seg
  }
  return path[path.length - 1]!
}

/**
 * Deterministic delegate walk: out to the target's desk exit, stand, walk home.
 * Seeded from the agent id so two agents never sync, and driven by `t` (the
 * render loop's monotonic clock, frozen under `?still=1`) — never Math.random.
 */
function walkState(meta: AgentMeta, pose: Pose, t: number): { x: number; z: number; walking: boolean } {
  const walkTo = pose.walkTo!
  const target: Pt =
    walkTo.kind === 'desk'
      ? ((DESK_EXIT[walkTo.id] as Pt | undefined) ?? poiPoint('rapat'))
      : poiPoint(walkTo.id)
  const path = onward(meta, target)
  const seed = (hashId(meta.id) % 1000) / 1000
  const period = 16 + seed * 6
  const stand = 5 + seed * 4
  const L = pathLen(path)
  const speed = 1.8
  const tOut = Math.max(0.01, L / speed)
  const phase = (((t + seed * 97) % period) + period) % period

  if (phase < tOut) return { x: pointAt(path, phase * speed)[0], z: pointAt(path, phase * speed)[1], walking: true }
  if (phase < tOut + stand) {
    const p = path[path.length - 1]!
    return { x: p[0], z: p[1], walking: false }
  }
  if (phase < tOut + stand + tOut) {
    const back = phase - tOut - stand
    const p = pointAt(path, (tOut - back) * speed)
    return { x: p[0], z: p[1], walking: true }
  }
  const seat = seatPoint(meta)
  return { x: seat[0], z: seat[1], walking: false }
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

  const centre = worldToPixel(r.vp.x, r.vp.z)
  const ox = cssW / 2 - centre.x * k
  const oy = cssH / 2 - centre.y * k
  /** world → CSS px */
  const toCss = (x: number, z: number) => {
    const p = worldToPixel(x, z)
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

  // stone batur platform framing the floor — a quiet exterior hint
  const tl = toCss(-FLOOR.w / 2, -FLOOR.d / 2)
  ctx.fillStyle = '#1f3123'
  ctx.fillRect(Math.round(tl.x - 4 * k) * dpr, Math.round(tl.y - 4 * k) * dpr, Math.round((WORLD_W + 8) * k) * dpr, Math.round((WORLD_H + 8) * k) * dpr)
  ctx.fillStyle = PALETTE.terra600
  ctx.fillRect(Math.round(tl.x - 2 * k) * dpr, Math.round(tl.y - 2 * k) * dpr, Math.round((WORLD_W + 4) * k) * dpr, Math.round((WORLD_H + 4) * k) * dpr)

  blitWorld({ canvas: r.static, w: WORLD_W, h: WORLD_H }, tl.x, tl.y)

  const mode = plateMode(r.vp.zoom)

  // desks + chairs, z-sorted (south last) so back rows sit behind front rows
  const deskOrder = [...r.metas].sort((a, b) => a.desk.z - b.desk.z)
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
      ctx.fillStyle = 'rgba(16, 24, 40, 0.35)'
      ctx.fillRect(
        Math.round(dx.x * dpr),
        Math.round(dx.y * dpr),
        Math.round(dw * s),
        Math.round(dh * s),
      )
    }
  }

  // agents, painter's-algorithm sorted by their current z (south drawn last)
  const order = r.metas
    .map((meta) => {
      const agent = r.byId.get(meta.id)
      const pose = agent ? poseFor(agent, r.now, r.comms) : OFFLINE_POSE
      const seat = seatPoint(meta)
      const walk = pose.kind === 'walk' ? walkState(meta, pose, r.t) : null
      return {
        meta,
        agent,
        pose,
        x: walk ? walk.x : seat[0],
        z: walk ? walk.z : seat[1],
        walking: walk?.walking ?? false,
      }
    })
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
  for (const zl of WORLD_LABELS) {
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
    const chip = mode === 'compact' ? '' : statusChip(agent, pose)
    const counters = mode === 'detail' && !offline ? countersLine(agent) : ''

    // nameplate: team accent border, status dot, name
    sprites.set(
      `${meta.id}|name`,
      pillPlate(shortName(meta.name, mode), {
        bg: offline ? PALETTE.navy800 : PALETTE.navy900,
        border: offline ? PALETTE.navy600 : teamAccent(meta.team),
        ink: offline ? PALETTE.muted : PALETTE.ink,
        dot,
        hollowDot: agent?.status === 'idle' && !offline,
        hollow: offline,
      }),
    )
    if (chip) {
      sprites.set(
        `${meta.id}|chip`,
        pillPlate(chip, {
          bg: pose.blocked ? STATUS.blocked : PALETTE.navy800,
          border: pose.blocked ? PALETTE.navy900 : pose.magnifier ? STATUS.reviewing : PALETTE.navy600,
          ink: pose.blocked ? EXTRAS.inkOnTerra : pose.magnifier ? STATUS.reviewing : PALETTE.inkDim,
        }),
      )
    }
    if (counters) {
      sprites.set(
        `${meta.id}|counters`,
        pillPlate(counters, { bg: PALETTE.navy900, border: PALETTE.navy700, ink: PALETTE.inkDim }),
      )
    }
    if (offline && mode !== 'compact') {
      sprites.set(`${meta.id}|zzz`, pillPlate('Z Z Z', { bg: PALETTE.navy800, border: PALETTE.muted, ink: PALETTE.muted }))
    }
    if (bubble) sprites.set(`${meta.id}|bubble`, bubblePlate(bubble))

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

  stacks.push(...buildStacks(labelAgents, mode))

  const placed = placeStacks(stacks, { w: cssW, h: cssH }, reserved)
  for (const p of placed) {
    const spr = sprites.get(`${p.id}|${p.key}`)
    if (spr) blitLabel(spr, p.x, p.y)
  }

  // comms envelopes: a quick paper-plane hop from sender to recipient
  for (const c of r.comms) {
    const age = r.now - c.ts
    if (age < 0 || age > 1.5) continue
    const from = r.metas.find((m) => m.id === c.from)
    const to = r.metas.find((m) => m.id === c.to)
    if (!from || !to) continue
    const fp = seatPoint(from)
    const tp = seatPoint(to)
    const kk = age / 1.5
    const x = fp[0] + (tp[0] - fp[0]) * kk
    const z = fp[1] + (tp[1] - fp[1]) * kk - Math.sin(kk * Math.PI) * 0.6
    const p = toCss(x, z)
    const env = getSprite('envelope', 10, 8, (c2) => drawEnvelope(c2))
    blitWorld(env, p.x - (env.w / 2) * k, p.y - (env.h / 2) * k)
  }
}

function teamAccent(team: string): string {
  if (team === 'dev') return '#82AAC8'
  if (team === 'edu') return '#DEB860'
  return '#D4805C'
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

/** Re-exported for the headless checker. */
export type { PlateMode }
