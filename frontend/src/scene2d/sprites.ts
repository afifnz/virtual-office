/**
 * Procedural sprites — every pixel is a fillRect, no external assets.
 *
 * `drawAgent` turns a `Look` (the same fields the 3D scene reads) into a chibi
 * at 12×16 px; desks, chairs, furniture (keyed by `lib/rooms.ts` OBSTACLES
 * ids), the orange cat and the comms envelope are all drawn the same way.
 * Sprites are cached per (look, pose, frame) in an offscreen canvas so the
 * render loop only blits.
 */
import type { Look } from '../lib/agents'
import type { PoseKind } from './anim'
import { hashId } from '../lib/roster'
import { PALETTE, SCREEN, EXTRAS, STATUS } from './palette'

export const CHIBI_W = 12
export const CHIBI_H = 16

const OUTLINE = '#241812' // warm near-black for eyes, outlines, shoes

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c
  ctx.fillRect(x, y, w, h)
}

// --------------------------------------------------------------------- cache

export interface Sprite {
  canvas: HTMLCanvasElement
  w: number
  h: number
}

const spriteCache = new Map<string, Sprite>()

/**
 * Draw-once sprite cache: builds an offscreen canvas of w×h, runs `draw` into
 * it, and reuses it for the same key. `imageSmoothingEnabled=false` keeps the
 * nearest-neighbour edges crisp when the sprite is blitted at an integer scale.
 */
export function getSprite(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Sprite {
  const hit = spriteCache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  draw(ctx)
  const sprite = { canvas, w, h }
  spriteCache.set(key, sprite)
  return sprite
}

/** Stable, key-order-independent serialisation of a Look for the cache key. */
function lookKey(look: Look): string {
  return [
    look.skin, look.hair, look.style, look.shirt, look.pants, look.accent,
    look.sculptedHead ? 1 : 0, look.skirt ? 1 : 0, look.glasses ? 1 : 0,
    look.headphones ?? '', look.longSleeve ? 1 : 0, look.peci ? 1 : 0,
    look.mustache ? 1 : 0, look.stubble ? 1 : 0, look.build, look.tall,
    look.female ? 1 : 0,
  ].join('|')
}

/** Cached chibi for one look + pose + frame. */
export function agentSprite(look: Look, pose: PoseKind, frame: number): Sprite {
  const key = `agent:${hashId(lookKey(look))}:${pose}:${frame}`
  return getSprite(key, CHIBI_W, CHIBI_H, (ctx) => drawAgent(ctx, look, pose, frame))
}

// -------------------------------------------------------------------- chibi

/** Draw hair by style over the head block (head at hx,hy, 8×7). */
function drawHair(ctx: CanvasRenderingContext2D, look: Look, hx: number, hy: number): void {
  const c = look.hair
  const top = () => px(ctx, hx, hy, 8, 2, c)
  const sides = (len: number, left = true, right = true) => {
    if (left) px(ctx, hx, hy + 2, 1, len, c)
    if (right) px(ctx, hx + 7, hy + 2, 1, len, c)
  }
  switch (look.style) {
    case 'crop':
      top()
      break
    case 'short':
      top()
      sides(1)
      break
    case 'side':
      top()
      sides(2, true, false)
      break
    case 'long':
      top()
      sides(5)
      break
    case 'bun':
      top()
      px(ctx, hx + 2, hy - 2, 4, 2, c)
      break
    case 'curly':
      top()
      px(ctx, hx, hy, 2, 1, c)
      px(ctx, hx + 3, hy - 1, 2, 1, c)
      px(ctx, hx + 6, hy, 2, 1, c)
      break
    case 'messy':
      px(ctx, hx, hy, 8, 1, c)
      px(ctx, hx + 1, hy - 1, 1, 1, c)
      px(ctx, hx + 4, hy - 1, 1, 1, c)
      px(ctx, hx + 6, hy, 1, 1, c)
      break
  }
}

/**
 * Draw a 12×16 chibi at the origin, feet at y=16. `pose` selects the pose
 * variant and `frame` its animation frame (walk=4, typing/bob=2).
 */
export function drawAgent(ctx: CanvasRenderingContext2D, look: Look, pose: PoseKind, frame: number): void {
  const skin = look.skin
  const hair = look.hair
  const shirt = look.shirt
  const pants = look.pants
  const accent = look.accent

  const f4 = ((frame % 4) + 4) % 4
  const f2 = ((frame % 2) + 2) % 2

  // build widens the torso, tall lengthens the legs
  const torsoW = Math.max(8, Math.min(11, Math.round(10 * look.build)))
  const tx0 = Math.floor((CHIBI_W - torsoW) / 2)
  const bob = pose === 'idle' || pose === 'relax' ? f2 : 0
  const tilt = pose === 'blocked' ? f2 : 0

  // head (8×7) + hair + face
  const hx = 2 + tilt
  const hy = bob
  px(ctx, hx, hy, 8, 7, skin)
  drawHair(ctx, look, hx, hy)
  if (look.peci) {
    px(ctx, hx, hy, 8, 2, OUTLINE)
    px(ctx, hx, hy + 2, 8, 1, OUTLINE)
  }
  // eyes
  px(ctx, hx + 2, hy + 3, 1, 1, OUTLINE)
  px(ctx, hx + 5, hy + 3, 1, 1, OUTLINE)
  if (look.glasses) {
    px(ctx, hx + 1, hy + 3, 1, 1, OUTLINE)
    px(ctx, hx + 6, hy + 3, 1, 1, OUTLINE)
    px(ctx, hx + 2, hy + 3, 4, 1, OUTLINE)
  }
  if (look.mustache && !look.female) px(ctx, hx + 2, hy + 5, 4, 1, hair)
  if (look.stubble && !look.female) px(ctx, hx + 2, hy + 6, 4, 1, OUTLINE)
  if (look.headphones) {
    px(ctx, hx, hy + 2, 1, 2, look.headphones)
    px(ctx, hx + 7, hy + 2, 1, 2, look.headphones)
    px(ctx, hx + 1, hy, 6, 1, look.headphones)
  }

  // torso (shirt)
  const ty = 7 + bob
  px(ctx, tx0, ty, torsoW, 4, shirt)
  if (look.longSleeve) {
    px(ctx, tx0 - 1, ty, 1, 3, shirt)
    px(ctx, tx0 + torsoW, ty, 1, 3, shirt)
  } else {
    if (tx0 >= 1) px(ctx, tx0 - 1, ty, 1, 3, skin)
    px(ctx, tx0 + torsoW, ty, 1, 3, skin)
  }
  // accent stripe on the chest
  px(ctx, tx0 + 1, ty + 1, torsoW - 2, 1, accent)

  // pose extras in front of the torso
  if (pose === 'reading') {
    px(ctx, tx0 + 1, ty + 1, 6, 3, PALETTE.sand200)
    px(ctx, tx0 + 2, ty + 2, 4, 1, PALETTE.navy600)
  } else if (pose === 'typing') {
    const hy_ = ty + 3 - f2
    px(ctx, tx0 + 2, hy_, 2, 1, skin)
    px(ctx, tx0 + torsoW - 4, hy_, 2, 1, skin)
  }

  // legs (pants) or skirt
  const ly = 11 + bob
  if (look.skirt) {
    px(ctx, tx0 - 1, ly, torsoW + 2, 2, pants)
    px(ctx, tx0 + 1, ly + 2, torsoW - 2, 2, pants)
  } else {
    px(ctx, tx0, ly, 2, 3, pants)
    px(ctx, tx0 + torsoW - 2, ly, 2, 3, pants)
  }
  // walk cycle: alternate the forward foot up one row
  const stepL = pose === 'walk' && f4 < 2 ? 1 : 0
  const stepR = pose === 'walk' && f4 >= 2 ? 1 : 0
  px(ctx, tx0, ly + 3 - stepL, 2, 2, OUTLINE)
  px(ctx, tx0 + torsoW - 2, ly + 3 - stepR, 2, 2, OUTLINE)
}

// --------------------------------------------------------------------- desk

/** Screen content by activity mode (design §3.3). */
export function drawMonitor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  mode: 'terminal' | 'doc' | 'browser' | 'diff' | 'idle' | 'off',
): void {
  px(ctx, x, y, w, h, SCREEN.bg)
  if (mode === 'off') return
  if (mode === 'idle') {
    px(ctx, x, y + h - 1, w, 1, STATUS.offline)
    return
  }
  if (mode === 'terminal') {
    for (let r = 0; r < 3; r++) px(ctx, x + 1, y + 2 + r * 2, w - 2, 1, SCREEN.green)
    return
  }
  if (mode === 'doc') {
    for (let r = 0; r < 3; r++) px(ctx, x + 1, y + 2 + r * 2, Math.max(1, w - 3 - r), 1, SCREEN.paper)
    return
  }
  if (mode === 'browser') {
    px(ctx, x, y, w, 2, SCREEN.blue)
    for (let r = 0; r < 3; r++) px(ctx, x + 1, y + 3 + r * 2, w - 2, 1, SCREEN.paper)
    return
  }
  // diff: red + green lines and a magnifier
  px(ctx, x + 1, y + 1, w - 2, 1, STATUS.danger)
  px(ctx, x + 1, y + 3, w - 2, 1, STATUS.ok)
  px(ctx, x + w - 5, y + 1, 3, 3, PALETTE.navy600)
  px(ctx, x + w - 4, y + 2, 1, 1, SCREEN.green)
}

/**
 * A desk drawn into w×h: bright top surface, 1px highlight, dark front panel
 * and a monitor in the middle (design §3.2).
 */
export function drawDesk(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mode: 'terminal' | 'doc' | 'browser' | 'diff' | 'idle' | 'off' = 'off',
): void {
  const front = Math.max(3, Math.min(6, Math.round(h * 0.35)))
  const top = h - front
  px(ctx, 0, 0, w, top, PALETTE.sand400)
  px(ctx, 0, 0, w, 1, PALETTE.terra300)
  px(ctx, 0, top, w, front, PALETTE.terra600)
  // monitor, centred on the top surface
  const mw = Math.max(8, Math.min(16, Math.round(w * 0.5)))
  const mh = Math.max(6, Math.min(10, Math.round(top * 0.6)))
  const mx = Math.round((w - mw) / 2)
  const my = Math.max(1, Math.round((top - mh) / 2))
  px(ctx, mx + Math.round((mw - 3) / 2), my + mh, 3, 1, PALETTE.navy600)
  drawMonitor(ctx, mx, my, mw, mh, mode)
}

/** A chair drawn into s×s: back rest behind, seat below. */
export function drawChair(ctx: CanvasRenderingContext2D, s: number): void {
  const back = Math.max(3, Math.round(s * 0.45))
  px(ctx, 0, 0, s, back, PALETTE.terra600)
  px(ctx, 0, back, s, Math.max(2, Math.round(s * 0.3)), PALETTE.terra500)
  px(ctx, 0, s - 1, s, 1, PALETTE.terra300)
}

// ---------------------------------------------------------------- furniture

/**
 * Decorative furniture by `lib/rooms.ts` OBSTACLES id, drawn into w×h px
 * (the renderer passes the footprint-derived size). Unknown ids get a generic
 * crate so nothing on the floor disappears.
 */
export function drawFurniture(ctx: CanvasRenderingContext2D, id: string, w: number, h: number): void {
  switch (id) {
    case 'server':
      px(ctx, 0, 0, w, h, PALETTE.navy900)
      for (let s = 0; s < 6; s++) {
        px(ctx, 2, 2 + s * 4, w - 4, 2, PALETTE.navy700)
        px(ctx, w - 4, 2 + s * 4, 2, 2, s % 2 === 0 ? STATUS.ok : STATUS.working)
      }
      return
    case 'meja-rapat':
    case 'rapat':
      px(ctx, 0, 0, w, h, PALETTE.sand500)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.sand400)
      return
    case 'meja-kopi':
    case 'sofa-table':
      px(ctx, 0, Math.round(h / 2), w, Math.max(1, Math.round(h / 2)), PALETTE.sand500)
      px(ctx, 1, 0, w - 2, Math.round(h / 2), PALETTE.sand300)
      return
    case 'kopi':
      px(ctx, 0, 0, w, h, PALETTE.terra500)
      px(ctx, 0, 0, w, 2, PALETTE.terra300)
      px(ctx, 1, 2, w - 2, h - 2, PALETTE.terra600)
      return
    case 'sofa':
      px(ctx, 0, 0, w, h, PALETTE.terra500)
      px(ctx, 0, 0, w, 2, PALETTE.terra300)
      px(ctx, 0, h - 3, w, 3, PALETTE.terra600)
      return
    case 'kucing':
      drawCat(ctx, 0)
      return
    case 'berkas':
    case 'materi':
      for (let r = 0; r < 3; r++) px(ctx, 0, h - 3 - r, w, 3, r % 2 === 0 ? PALETTE.sand200 : PALETTE.sand300)
      return
    case 'gamelan':
      px(ctx, 0, 0, w, h, PALETTE.terra600)
      for (let k = 0; k < 3; k++) px(ctx, 1, 1 + k * 3, w - 2, 1, PALETTE.terra300)
      return
    case 'papan-dev':
    case 'papan-edu':
      px(ctx, 0, 0, w, h, PALETTE.navy800)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.navy700)
      for (let n = 0; n < 3; n++) {
        px(ctx, 2 + n * 4, 2, 2, 2, n === 0 ? STATUS.working : n === 1 ? STATUS.idle : STATUS.danger)
      }
      return
    case 'buku':
      px(ctx, 0, 0, w, h, PALETTE.navy900)
      for (let r = 0; r < 3; r++) {
        const c = r % 2 === 0 ? PALETTE.terra500 : PALETTE.terra600
        px(ctx, 1, 1 + r * 3, w - 2, 2, c)
      }
      return
    case 'lesehan':
      px(ctx, 0, 0, w, h, PALETTE.sand300)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.sand200)
      return
    case 'resepsionis':
      px(ctx, 0, 0, w, h, PALETTE.terra500)
      px(ctx, 0, 0, w, 2, PALETTE.terra300)
      px(ctx, 1, h - 3, w - 2, 3, PALETTE.terra600)
      return
    default:
      // generic crate: navy box with a lighter top edge
      px(ctx, 0, 0, w, h, PALETTE.navy700)
      px(ctx, 0, 0, w, 1, PALETTE.navy600)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.navy800)
  }
}

// ---------------------------------------------------------------- the extras

/** The orange lobby cat, 12×8, two frames (tail flick). */
export function drawCat(ctx: CanvasRenderingContext2D, frame: number): void {
  const f = ((frame % 2) + 2) % 2
  px(ctx, 1, 1, 8, 5, EXTRAS.cat)
  px(ctx, 1, 1, 2, 1, OUTLINE) // ears hint
  px(ctx, 7, 1, 2, 1, OUTLINE)
  px(ctx, 3, 3, 1, 1, OUTLINE)
  px(ctx, 6, 3, 1, 1, OUTLINE)
  px(ctx, 9, 2 + f, 2, 1, EXTRAS.cat) // flicking tail
}

/** The comms envelope (paper airplane), 10×8. */
export function drawEnvelope(ctx: CanvasRenderingContext2D): void {
  px(ctx, 0, 4, 10, 2, PALETTE.sand200)
  px(ctx, 4, 0, 2, 8, PALETTE.sand200)
  px(ctx, 0, 4, 3, 1, PALETTE.navy600)
  px(ctx, 7, 4, 3, 1, PALETTE.navy600)
}
