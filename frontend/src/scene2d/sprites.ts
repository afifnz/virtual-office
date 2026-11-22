/**
 * Procedural sprites — every pixel is a fillRect, no external assets.
 *
 * `drawAgent` turns a `Look` (the same fields the 3D scene reads) into a chibi
 * at 12×16 px; desks, chairs and furniture (keyed by `lib/rooms.ts` OBSTACLES
 * ids) are all drawn the same way. Sprites are cached per (look, pose, frame)
 * in an offscreen canvas so the render loop only blits.
 */
import type { Look } from '../lib/agents'
import type { PoseKind } from './anim'
import { hashId } from '../lib/roster'
import { PALETTE, SCREEN, STATUS } from './palette'

export const CHIBI_W = 12
export const CHIBI_H = 16
/** The drawn head block (8×7 at the top of the chibi): the box a nameplate or
 *  speech bubble must never sit on when it belongs to somebody else. */
export const HEAD_W = 8
export const HEAD_H = 7

const OUTLINE = '#1A2027' // cool near-black for eyes, outlines, shoes

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
    px(ctx, tx0 + 1, ty + 1, 6, 3, PALETTE.concrete100)
    px(ctx, tx0 + 2, ty + 2, 4, 1, PALETTE.concrete600)
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
  px(ctx, x + w - 5, y + 1, 3, 3, PALETTE.concrete600)
  px(ctx, x + w - 4, y + 2, 1, 1, SCREEN.green)
}

/**
 * A desk drawn into w×h: white concrete top, pale front panel, steel legs and
 * a monitor in the middle (design §3.2).
 */
export function drawDesk(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mode: 'terminal' | 'doc' | 'browser' | 'diff' | 'idle' | 'off' = 'off',
): void {
  const front = Math.max(3, Math.min(6, Math.round(h * 0.35)))
  const top = h - front
  // white concrete top with a pale edge highlight
  px(ctx, 0, 0, w, top, PALETTE.concrete100)
  px(ctx, 0, 0, w, 1, PALETTE.concrete200)
  // pale front panel + steel kick
  px(ctx, 0, top, w, front, PALETTE.concrete200)
  px(ctx, 0, h - 1, w, 1, PALETTE.steel500)
  // steel legs under the front corners
  const leg = Math.max(1, Math.round(w * 0.08))
  px(ctx, 1, top, leg, front, PALETTE.steel500)
  px(ctx, w - 1 - leg, top, leg, front, PALETTE.steel500)
  // monitor, centred on the top surface
  const mw = Math.max(8, Math.min(16, Math.round(w * 0.5)))
  const mh = Math.max(6, Math.min(10, Math.round(top * 0.6)))
  const mx = Math.round((w - mw) / 2)
  const my = Math.max(1, Math.round((top - mh) / 2))
  px(ctx, mx + Math.round((mw - 3) / 2), my + mh, 3, 1, PALETTE.steel700)
  drawMonitor(ctx, mx, my, mw, mh, mode)
}

/**
 * A chair drawn into s×s: graphite back rest behind, seat below.
 * `occupied = false` draws the empty seat of an offline agent — a hollow
 * graphite frame instead of a filled seat, so "nobody is here" reads without
 * relying on colour alone.
 */
export function drawChair(ctx: CanvasRenderingContext2D, s: number, occupied = true): void {
  const back = Math.max(3, Math.round(s * 0.45))
  if (!occupied) {
    // hollow frame: outline only, the floor shows through the middle
    px(ctx, 0, 0, s, 1, PALETTE.steel500)
    px(ctx, 0, back - 1, s, 1, PALETTE.steel500)
    px(ctx, 0, 0, 1, back, PALETTE.steel500)
    px(ctx, s - 1, 0, 1, back, PALETTE.steel500)
    px(ctx, 0, back, s, 2, PALETTE.steel700)
    px(ctx, 0, s - 1, s, 1, PALETTE.steel500)
    return
  }
  px(ctx, 0, 0, s, back, PALETTE.steel700)
  px(ctx, 0, 0, s, 1, PALETTE.steel500)
  px(ctx, 0, back, s, Math.max(2, Math.round(s * 0.3)), PALETTE.steel500)
  px(ctx, 0, s - 1, s, 1, PALETTE.steel300)
}

// ---------------------------------------------------------------- furniture

/**
 * Decorative furniture by `lib/rooms.ts` OBSTACLES id, drawn into w×h px
 * (the renderer passes the footprint-derived size). Unknown ids get a generic
 * steel cabinet so nothing on the floor disappears.
 */
export function drawFurniture(ctx: CanvasRenderingContext2D, id: string, w: number, h: number): void {
  switch (id) {
    case 'server':
      // steel rack with LED rows
      px(ctx, 0, 0, w, h, PALETTE.steel700)
      px(ctx, 0, 0, w, 1, PALETTE.steel500)
      for (let s = 0; s < 6; s++) {
        const y = 2 + s * 4
        if (y + 2 > h - 1) break
        px(ctx, 2, y, w - 4, 2, PALETTE.steel500)
        px(ctx, w - 4, y, 2, 2, s % 3 === 0 ? STATUS.ok : s % 3 === 1 ? STATUS.working : STATUS.idle)
      }
      return
    case 'meja-rapat':
    case 'rapat':
    case 'meja-nook':
    case 'standup': {
      // glass meeting / standup table: steel rim, glass pane, legs, and what is
      // actually on it (a laptop, papers, a cup) so it never reads as a slab
      px(ctx, 0, 0, w, h, PALETTE.steel500)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.glass700)
      px(ctx, 2, 2, w - 4, h - 4, PALETTE.glass500)
      px(ctx, 2, 2, w - 4, 1, PALETTE.glass300)
      px(ctx, 2, 2, 1, h - 4, PALETTE.glass300)
      // steel legs peeking out at the south corners
      px(ctx, 2, h - 3, 2, 2, PALETTE.steel500)
      px(ctx, w - 4, h - 3, 2, 2, PALETTE.steel500)
      if (w >= 20 && h >= 12) {
        // a laptop with its lid open towards the north side
        const lw = Math.min(12, Math.round(w * 0.3))
        const lh = Math.min(8, Math.max(4, Math.round(h * 0.34)))
        const lx = Math.round((w - lw) / 2) - 3
        const ly = Math.round((h - lh) / 2) - 1
        px(ctx, lx, ly, lw, lh, PALETTE.concrete900)
        px(ctx, lx + 1, ly + 1, lw - 2, lh - 3, PALETTE.glass700)
        px(ctx, lx + 2, ly + 2, Math.max(1, lw - 6), 1, PALETTE.glass300)
        px(ctx, lx, ly + lh - 1, lw, 1, PALETTE.steel700)
        // papers + a cup on the east half
        px(ctx, w - 12, h - 9, 6, 4, PALETTE.concrete100)
        px(ctx, w - 12, h - 9, 6, 1, PALETTE.concrete200)
        px(ctx, w - 7, 4, 3, 2, PALETTE.concrete100)
        px(ctx, w - 7, 4, 3, 1, PALETTE.glass300)
      }
      return
    }
    case 'meja-kopi':
    case 'sofa-table':
      // low table: steel rim, pale top, a cup and a magazine
      px(ctx, 0, 0, w, h, PALETTE.steel700)
      px(ctx, 0, 0, w, Math.max(1, h - 1), PALETTE.steel500)
      px(ctx, 1, 1, w - 2, Math.max(1, h - 3), PALETTE.concrete200)
      px(ctx, 1, 1, w - 2, 1, PALETTE.concrete100)
      if (w >= 10 && h >= 8) {
        px(ctx, 2, 3, 3, 2, PALETTE.glass500)
        px(ctx, 2, 3, 3, 1, PALETTE.glass300)
        px(ctx, w - 8, 3, 5, 3, PALETTE.concrete100)
      }
      return
    case 'kopi': {
      // pantry counter: dark backsplash on the wall side, pale worktop with a
      // front edge, a sink with a tap, an espresso machine and a row of cups —
      // the guest side is the east face
      px(ctx, 0, 0, w, h, PALETTE.concrete100)
      px(ctx, 0, 0, 2, h, PALETTE.concrete500) // backsplash against the wall
      px(ctx, 0, 0, w, 2, PALETTE.steel300)
      px(ctx, 0, h - 2, w, 2, PALETTE.steel500)
      px(ctx, w - 2, 2, 2, h - 4, PALETTE.steel300) // worktop front edge
      px(ctx, w - 1, 2, 1, h - 4, PALETTE.steel500)
      // sink: a steel recess with a pale basin and a tap
      const sw = Math.max(3, w - 5)
      px(ctx, 2, 4, sw, 9, PALETTE.steel300)
      px(ctx, 3, 5, Math.max(1, sw - 2), 7, PALETTE.concrete200)
      px(ctx, 3, 5, 1, 1, PALETTE.steel500)
      px(ctx, 2, 2, 1, 2, PALETTE.steel500)
      // espresso machine: dark body, steel group head, amber ready light
      const mh = Math.max(7, Math.min(13, Math.round(h * 0.27)))
      px(ctx, 2, 16, w - 3, mh, PALETTE.concrete900)
      px(ctx, 3, 17, Math.max(1, w - 5), 2, PALETTE.steel300)
      px(ctx, 3, 16 + mh - 4, 3, 2, PALETTE.steel500)
      px(ctx, Math.max(3, w - 4), 17, 1, 1, PALETTE.amber)
      px(ctx, 4, 16 + mh - 2, 2, 1, PALETTE.concrete200) // cup under the spout
      // cups in a row on the south half
      for (let i = 0; i < 3; i++) {
        const cy = 16 + mh + 3 + i * 3
        if (cy + 2 > h - 2) break
        px(ctx, 2, cy, 3, 2, PALETTE.concrete200)
        px(ctx, 2, cy, 3, 1, PALETTE.concrete100)
      }
      return
    }
    case 'sofa': {
      // grey fabric lounge sofa: backrest on the side against the room edge,
      // arms at both ends, cushion seams — the silhouette the review missed.
      // A vertical sofa (h > w) leans on the east wall, a horizontal one on the
      // north wall; that is how the lobby's only sofa is placed.
      const vertical = h > w
      const back = Math.max(3, Math.round((vertical ? w : h) * 0.28))
      const arm = Math.max(3, Math.round((vertical ? h : w) * 0.13))
      px(ctx, 0, 0, w, h, PALETTE.steel700)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.steel500)
      if (vertical) {
        px(ctx, w - back, 0, back, h, PALETTE.steel700)
        px(ctx, w - back, 0, 1, h, PALETTE.steel300)
        px(ctx, 0, 0, w, arm, PALETTE.steel700)
        px(ctx, 0, h - arm, w, arm, PALETTE.steel700)
        const inner = h - 2 * arm
        const seats = Math.max(2, Math.round(inner / 16))
        for (let i = 1; i < seats; i++) px(ctx, 0, arm + Math.round((inner * i) / seats), w - back, 1, PALETTE.steel700)
        px(ctx, 1, arm + 1, 1, inner - 1, PALETTE.steel300)
      } else {
        px(ctx, 0, 0, w, back, PALETTE.steel700)
        px(ctx, 0, back - 1, w, 1, PALETTE.steel300)
        px(ctx, 0, 0, arm, h, PALETTE.steel700)
        px(ctx, w - arm, 0, arm, h, PALETTE.steel700)
        const inner = w - 2 * arm
        const seats = Math.max(2, Math.round(inner / 16))
        for (let i = 1; i < seats; i++) px(ctx, arm + Math.round((inner * i) / seats), back, 1, h - back, PALETTE.steel700)
        px(ctx, arm + 1, back, inner - 1, 1, PALETTE.steel300)
      }
      return
    }
    case 'papan-dev':
    case 'papan-edu':
    case 'papan': {
      // whiteboard / sprint board mounted on the wall: the board is drawn a
      // little taller than its (thin) footprint so it reads as a panel on the
      // wall band instead of a 3 px stripe on the floor
      const bh = Math.max(h, 5)
      const y0 = h - bh
      px(ctx, 0, y0, w, bh, PALETTE.steel700)
      px(ctx, 1, y0 + 1, w - 2, bh - 2, PALETTE.concrete100)
      if (w >= 8) {
        const cols = [PALETTE.glass500, STATUS.ok, PALETTE.amber]
        for (let c = 0; c < 3; c++) {
          const cx = 2 + c * Math.max(2, Math.floor((w - 4) / 3))
          for (let r = 0; r < 2; r++) {
            const ry = y0 + 1 + r * 2
            if (ry < y0 + bh - 1 && cx < w - 2) px(ctx, cx, ry, Math.min(2, w - 2 - cx), 1, cols[c]!)
          }
        }
      }
      return
    }
    case 'printer':
      // office printer on a steel stand: paper tray, output slot, a printed
      // sheet and a ready LED, so the corner reads as a print station
      px(ctx, 0, 0, w, h, PALETTE.concrete200) // stand shadow
      px(ctx, 1, 1, w - 2, h - 3, PALETTE.concrete100) // body
      px(ctx, 1, 1, w - 2, 1, PALETTE.concrete200)
      px(ctx, 1, h - 2, 2, 2, PALETTE.steel500) // legs
      px(ctx, w - 3, h - 2, 2, 2, PALETTE.steel500)
      px(ctx, 2, 2, Math.max(2, w - 4), 2, PALETTE.concrete200) // paper tray
      px(ctx, 2, 2, Math.max(2, w - 4), 1, PALETTE.concrete100)
      px(ctx, 2, 5, Math.max(2, w - 4), 1, PALETTE.concrete700) // output slot
      px(ctx, 3, 6, Math.max(1, w - 6), 2, PALETTE.concrete200) // printed sheet
      px(ctx, w - 3, 3, 1, 1, STATUS.ok)
      return
    case 'buku':
      // bookshelf: light case, two shelf rows, book spines in muted tones
      px(ctx, 0, 0, w, h, PALETTE.steel700)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.concrete200)
      px(ctx, 1, 1, w - 2, 1, PALETTE.concrete100)
      for (let r = 0; r < 2; r++) {
        const y = 1 + r * 3
        if (y + 2 > h - 1) break
        px(ctx, 2, y, w - 4, 2, PALETTE.concrete700)
        const spine = [PALETTE.glass500, STATUS.reviewing, PALETTE.amber, STATUS.ok][r % 4]!
        const n = Math.max(3, Math.floor((w - 6) / 4))
        for (let b = 0; b < n; b++) {
          const bx = 3 + b * Math.floor((w - 6) / n)
          if (bx + 1 < w - 2) px(ctx, bx, y, 1, 2, b % 3 === 0 ? spine : PALETTE.concrete500)
        }
      }
      return
    case 'resepsionis': {
      // reception counter: pale monolith, front panel on the guest (east) side,
      // a monitor facing the receptionist, a keyboard, papers and a cup
      px(ctx, 0, 0, w, h, PALETTE.concrete100)
      px(ctx, 0, 0, 1, h, PALETTE.concrete200)
      px(ctx, w - 3, 0, 3, h, PALETTE.concrete200)
      px(ctx, w - 1, 0, 1, h, PALETTE.steel500)
      px(ctx, 0, 0, w, 1, PALETTE.steel300)
      px(ctx, 0, h - 1, w, 1, PALETTE.steel700)
      // the monitor, screen towards the receptionist (west face)
      const mw = Math.max(6, Math.min(9, w - 3))
      const mh = 6
      px(ctx, 2, 3, mw, mh, PALETTE.concrete900)
      drawMonitor(ctx, 2, 3, mw, mh, 'terminal')
      px(ctx, 2, 3 + mh, mw, 1, PALETTE.steel700)
      // keyboard, a stack of papers, a cup
      px(ctx, 2, 12, Math.max(4, w - 6), 2, PALETTE.concrete200)
      px(ctx, 2, 30, 5, 4, PALETTE.concrete200)
      px(ctx, 2, 30, 5, 1, PALETTE.concrete100)
      px(ctx, w - 5, 20, 2, 2, PALETTE.glass500)
      return
    }
    default:
      // generic cabinet: steel box with a lighter top edge
      px(ctx, 0, 0, w, h, PALETTE.steel500)
      px(ctx, 0, 0, w, 1, PALETTE.steel300)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.steel700)
  }
}

// ---------------------------------------------------------------- the extras

/** The comms envelope (paper airplane), 10×8. */
export function drawEnvelope(ctx: CanvasRenderingContext2D): void {
  px(ctx, 0, 4, 10, 2, PALETTE.concrete100)
  px(ctx, 4, 0, 2, 8, PALETTE.concrete100)
  px(ctx, 0, 4, 3, 1, PALETTE.steel500)
  px(ctx, 7, 4, 3, 1, PALETTE.steel500)
}
