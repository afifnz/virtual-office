/**
 * The 2D office painter: a prerendered static layer (floor zones, walls, door
 * labels, decorative furniture) plus a per-frame dynamic layer (desks whose
 * monitor reflects live activity, chairs, agents, nameplates, status chips and
 * speech bubbles).
 *
 * Everything is drawn at zoom-1 pixel scale into cached offscreen canvases and
 * blitted with an integer factor, so every pixel stays nearest-neighbour crisp
 * on any DPR. No text goes through `fillText` per frame — plates are cached
 * offscreen and invalidated only when their contents change.
 */
import type { AgentMeta } from '../lib/agents'
import type { Agent, Comm } from '../lib/types'
import { deskObstacle } from '../lib/layout'
import { DESK_EXIT, DOORS, FLOOR, OBSTACLES, POIS, WALLS } from '../lib/rooms'
import { hashId, rosterAgents } from '../lib/roster'
import { onward, seatPoint } from '../lib/routes'
import type { Pt } from '../lib/nav'
import { poseFor, blockedChipText, type Pose } from './anim'
import { EXTRAS, PALETTE, SCREEN, STATUS } from './palette'
import { drawText, textWidth } from './pixelfont'
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
const CHAIR_PX = 8

/** Which zone a floor tile belongs to: lobby z>=2, dev x<0, edu x>=0. */
function zoneAt(tx: number, tz: number): 'lobby' | 'dev' | 'edu' {
  if (tz >= 12) return 'lobby' // world z >= 2
  return tx < 14 ? 'dev' : 'edu' // world x < 0
}

function floorColor(tx: number, tz: number, zone: 'lobby' | 'dev' | 'edu', edge: boolean): string {
  if (edge) return PALETTE.sand300
  if (zone === 'lobby') return (tx + tz) % 2 === 0 ? '#C4602C' : '#E07B3E'
  return '#1F2A42' // dev plank; edu bamboo overridden below
}

function drawFloor(ctx: CanvasRenderingContext2D): void {
  for (let tz = 0; tz < FLOOR.d; tz++) {
    for (let tx = 0; tx < FLOOR.w; tx++) {
      const zone = zoneAt(tx, tz)
      const edge = zone === 'lobby' && tz === 12
      let c = floorColor(tx, tz, zone, edge)
      if (zone === 'edu') c = '#D9B36B'
      if (zone === 'dev' && tz === 0) c = '#1F2A42'
      ctx.fillStyle = c
      ctx.fillRect(tx * TILE, tz * TILE, TILE, TILE)
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
      } else if (zone === 'lobby' && tz === 12) {
        ctx.fillStyle = PALETTE.sand300
        ctx.fillRect(tx * TILE, tz * TILE, TILE, TILE)
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

function drawDoorLabels(ctx: CanvasRenderingContext2D): void {
  for (const door of DOORS) {
    if (!door.label) continue
    const px = (door.x + FLOOR.w / 2) * TILE
    const py = (door.z + FLOOR.d / 2) * TILE
    // plaque just north of a horizontal doorway (rot 0)
    const labelW = textWidth(door.label, 1)
    const w = labelW + 4
    const h = 9
    const x = Math.round(px - w / 2)
    const y = Math.round(py - WALL_PX / 2 - h - 1)
    ctx.fillStyle = PALETTE.navy800
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = PALETTE.navy600
    ctx.fillRect(x, y, w, 1)
    ctx.fillRect(x, y, 1, h)
    ctx.fillRect(x + w - 1, y, 1, h)
    ctx.fillRect(x, y + h - 1, w, 1)
    drawText(ctx, door.label, x + 2, y + 1, 1, PALETTE.ink)
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
  drawDoorLabels(ctx)
  drawFurnitureLayer(ctx)
  return canvas
}

// ------------------------------------------------------------------- plates

/** The in-world pixel font scale: 2 when zoomed out to the whole floor (zoom 1),
 *  1 otherwise, so names stay legible on a phone without ever blurring. */
export function glyphScale(zoom: number): number {
  return zoom === 1 ? 2 : 1
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

function monitorMode(pose: Pose): MonitorMode {
  if (pose.offline || pose.blocked) return 'off'
  if (pose.magnifier) return 'diff'
  if (pose.kind === 'typing') return 'terminal'
  if (pose.kind === 'reading') return pose.tool === 'web_extract' || pose.tool === 'web_search' ? 'browser' : 'doc'
  if (pose.kind === 'walk') return 'idle'
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
  hollowDot?: boolean
}

function pillPlate(text: string, g: number, opts: PlateOpts): Sprite {
  const tw = textWidth(text, g)
  const dot = opts.dot ? 4 * g + 2 * g : 0
  const w = tw + dot + 4 * g
  const h = 7 * g + 2 * g
  const key = `pill:${text}:${g}:${opts.bg}:${opts.border}:${opts.ink}:${opts.dot ?? ''}:${opts.hollowDot ? 1 : 0}`
  return getSprite(key, w, h, (ctx) => {
    ctx.fillStyle = opts.border
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = opts.bg
    ctx.fillRect(g, g, w - 2 * g, h - 2 * g)
    if (opts.dot) {
      const ds = 4 * g
      ctx.fillStyle = opts.dot
      ctx.fillRect(2 * g, (h - ds) / 2, ds, ds)
      if (opts.hollowDot) {
        ctx.fillStyle = opts.bg
        ctx.fillRect(2 * g + g, (h - ds) / 2 + g, 2 * g, 2 * g)
      }
    }
    drawText(ctx, text, 2 * g + dot, g, g, opts.ink)
  })
}

function bubblePlate(text: string, g: number): Sprite {
  const tw = textWidth(text, g)
  const w = tw + 4 * g
  const h = 7 * g + 4 * g
  const key = `bubble:${text}:${g}`
  return getSprite(key, w, h, (ctx) => {
    ctx.fillStyle = PALETTE.sand200
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = PALETTE.navy600
    ctx.fillRect(0, 0, w, 1)
    ctx.fillRect(0, h - 1, w, 1)
    ctx.fillRect(0, 0, 1, h)
    ctx.fillRect(w - 1, 0, 1, h)
    // tail
    ctx.fillRect(Math.floor(w / 2) - g, h - 1, 2 * g, g)
    drawText(ctx, text, 2 * g, 2 * g, g, SCREEN.bubbleInk)
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
  const s = blitScale(r.vp.zoom, r.dpr)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = EXTRAS.bg
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const centre = worldToPixel(r.vp.x, r.vp.z)
  const ox = ctx.canvas.width / 2 - centre.x * s
  const oy = ctx.canvas.height / 2 - centre.y * s
  const toDev = (x: number, z: number) => {
    const p = worldToPixel(x, z)
    return { x: ox + p.x * s, y: oy + p.y * s }
  }
  const blit = (spr: Sprite, dx: number, dy: number) => {
    ctx.drawImage(spr.canvas, Math.round(dx), Math.round(dy), spr.w * s, spr.h * s)
  }

  // stone batur platform framing the floor — a quiet exterior hint at zoom 1
  const tl = toDev(-FLOOR.w / 2, -FLOOR.d / 2)
  ctx.fillStyle = '#1f3123'
  ctx.fillRect(Math.round(tl.x - 4 * s), Math.round(tl.y - 4 * s), WORLD_W * s + 8 * s, WORLD_H * s + 8 * s)
  ctx.fillStyle = PALETTE.terra600
  ctx.fillRect(Math.round(tl.x - 2 * s), Math.round(tl.y - 2 * s), WORLD_W * s + 4 * s, WORLD_H * s + 4 * s)

  blit({ canvas: r.static, w: WORLD_W, h: WORLD_H }, tl.x, tl.y)

  const g = glyphScale(r.vp.zoom)

  // desks + chairs, z-sorted (south last) so back rows sit behind front rows
  const deskOrder = [...r.metas].sort((a, b) => a.desk.z - b.desk.z)
  for (const meta of deskOrder) {
    const agent = r.byId.get(meta.id)
    const pose = agent ? poseFor(agent, r.now, r.comms) : OFFLINE_POSE
    const foot = deskObstacle(meta.desk, meta.id)
    const dx = toDev(foot.x1, foot.z1)
    const dw = Math.max(1, Math.round((foot.x2 - foot.x1) * TILE))
    const dh = Math.max(1, Math.round((foot.z2 - foot.z1) * TILE))
    const mode = monitorMode(pose)
    const desk = getSprite(`desk:${dw}x${dh}:${mode}`, dw, dh, (c) => drawDesk(c, dw, dh, mode))
    blit(desk, dx.x, dx.y)
    const seat = seatPoint(meta)
    const sd = toDev(seat[0], seat[1])
    blit(getSprite(`chair:${CHAIR_PX}`, CHAIR_PX, CHAIR_PX, (c) => drawChair(c, CHAIR_PX)), sd.x - (CHAIR_PX / 2) * s, sd.y - (CHAIR_PX / 2) * s)
    if (pose.offline) {
      ctx.fillStyle = 'rgba(16, 24, 40, 0.45)'
      ctx.fillRect(Math.round(dx.x), Math.round(dx.y), dw * s, dh * s)
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
    const { meta, agent, pose, walking } = item
    const head = toDev(item.x, item.z)
    const status = agent?.status ?? 'offline'
    const accent = (status === 'offline' ? PALETTE.muted : undefined) ?? teamAccent(meta.team)
    const dim = pose.offline || r.stale

    // agent sprite (offline = empty chair, no chibi)
    if (!pose.offline) {
      const frame = walking ? Math.floor(r.t * 6) % 4 : pose.kind === 'idle' || pose.kind === 'relax' ? Math.floor(r.t * 1.5) % 2 : pose.kind === 'typing' ? Math.floor(r.t * 4) % 2 : 0
      const spr = agentSprite(meta.look, pose.kind, frame)
      blit(spr, head.x - (CHIBI_W / 2) * s, head.y - CHIBI_H * s)
    }

    // vertical stack above the head: bubble, status chip, nameplate, counters
    let aboveY = head.y - CHIBI_H * s - 2 * s

    // speech bubble while busy / blocked
    if (pose.blocked || pose.kind === 'typing' || pose.kind === 'reading' || pose.kind === 'working') {
      const dots = pose.blocked ? '!' : dotsFrame(r.t)
      const bubble = bubblePlate(dots, g)
      blit(bubble, head.x - (bubble.w * s) / 2, aboveY - bubble.h * s)
      aboveY -= bubble.h * s + 2 * s
    }

    // status chip: blocked / reviewing / tool
    const chipText = statusChip(agent, pose)
    if (chipText) {
      const chipOpts = pose.blocked
        ? { bg: STATUS.blocked, border: PALETTE.navy900, ink: EXTRAS.inkOnTerra }
        : pose.magnifier
          ? { bg: PALETTE.navy800, border: STATUS.reviewing, ink: STATUS.reviewing }
          : { bg: PALETTE.navy800, border: PALETTE.navy600, ink: PALETTE.inkDim }
      const chip = pillPlate(chipText, g, chipOpts)
      blit(chip, head.x - (chip.w * s) / 2, aboveY - chip.h * s)
      aboveY -= chip.h * s + 1 * s
    }

    // nameplate: team accent border, status dot, name
    const name = pillPlate(meta.name, g, {
      bg: dim ? PALETTE.navy800 : PALETTE.navy900,
      border: accent,
      ink: dim ? PALETTE.muted : PALETTE.ink,
      dot: statusColor(agent, pose),
      hollowDot: status === 'idle',
    })
    blit(name, head.x - (name.w * s) / 2, aboveY - name.h * s)
    aboveY -= name.h * s + 1 * s

    // counters + task id, one dim line (privacy: task id only, never the title)
    const counter = countersLine(agent, pose)
    if (counter) {
      const cpl = pillPlate(counter, g, { bg: PALETTE.navy900, border: PALETTE.navy700, ink: dim ? PALETTE.muted : PALETTE.inkDim })
      blit(cpl, head.x - (cpl.w * s) / 2, aboveY - cpl.h * s)
      aboveY -= cpl.h * s
    }

    if (pose.offline) {
      const zzz = pillPlate('Z Z Z', g, { bg: PALETTE.navy800, border: PALETTE.muted, ink: PALETTE.muted })
      blit(zzz, head.x - (zzz.w * s) / 2, aboveY - zzz.h * s)
    }
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
    const k = age / 1.5
    const x = fp[0] + (tp[0] - fp[0]) * k
    const z = fp[1] + (tp[1] - fp[1]) * k - Math.sin(k * Math.PI) * 0.6
    const p = toDev(x, z)
    const env = getSprite('envelope', 10, 8, (c2) => drawEnvelope(c2))
    blit(env, p.x - (env.w / 2) * s, p.y - (env.h / 2) * s)
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
  if (pose.blocked) return agent ? blockedChipText(agent) : 'butuh izin'
  if (pose.magnifier) return 'review'
  if (pose.kind === 'typing' || pose.kind === 'reading' || pose.kind === 'working') return pose.tool || 'kerja'
  if (pose.kind === 'walk') return 'delegasi'
  return ''
}

function countersLine(agent: Agent | undefined, pose: Pose): string {
  if (!agent || pose.offline) return ''
  const m = agent.today?.messages ?? 0
  const t = agent.today?.tool_calls ?? 0
  const task = agent.task ? `#${agent.task.slice(0, 8)}` : ''
  const cnt = `${m}m ${t}t`
  return task ? `${cnt} ${task}` : cnt
}

// ------------------------------------------------------------------ helpers

/** The full roster (all desks), used when nothing else is available. */
export function allMetas(): AgentMeta[] {
  return rosterAgents()
}
