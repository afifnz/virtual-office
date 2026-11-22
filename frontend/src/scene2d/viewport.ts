/**
 * World ↔ pixel math for the 2D office.
 *
 * The world is 28 × 20 units (`lib/rooms.ts` FLOOR), x ∈ [-14,14], z ∈ [-10,10].
 * One unit = TILE px at zoom 1, +z grows downward on screen (the back wall at
 * z=-10 is at the top, the MASUK door at z=+10 at the bottom). Zoom is integer
 * 1..4 so every blit is nearest-neighbour; a fractional device-pixel-ratio is
 * absorbed by an integer backing-store factor, never by blurring.
 *
 * Everything here is pure — no DOM, so verify/anim_check.ts replays it headless.
 */
import { FLOOR } from '../lib/rooms'

/** Pixels per world unit at zoom 1. */
export const TILE = 16
/** World extents (28 × 20). */
export const FLOOR_W = FLOOR.w
export const FLOOR_D = FLOOR.d
/** The offscreen world surface at zoom 1, in px (448 × 320). */
export const WORLD_W = FLOOR_W * TILE
export const WORLD_H = FLOOR_D * TILE

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export interface Viewport {
  /** world-space centre of the view */
  x: number
  z: number
  /** integer zoom, 1..4 */
  zoom: number
}

export interface PixelPoint {
  x: number
  y: number
}

export interface WorldPoint {
  x: number
  z: number
}

/** Snap any zoom to the integer range 1..4. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)))
}

/** world → zoom-1 pixel space. Origin = the north-west corner of the floor. */
export function worldToPixel(x: number, z: number): PixelPoint {
  return { x: (x + FLOOR_W / 2) * TILE, y: (z + FLOOR_D / 2) * TILE }
}

/** zoom-1 pixel space → world. Inverse of worldToPixel. */
export function pixelToWorld(px: number, py: number): WorldPoint {
  return { x: px / TILE - FLOOR_W / 2, z: py / TILE - FLOOR_D / 2 }
}

/** world → screen (CSS px), through the viewport centre and zoom. */
export function worldToScreen(vp: Viewport, viewW: number, viewH: number, x: number, z: number): PixelPoint {
  const centre = worldToPixel(vp.x, vp.z)
  const p = worldToPixel(x, z)
  return {
    x: viewW / 2 + (p.x - centre.x) * vp.zoom,
    y: viewH / 2 + (p.y - centre.y) * vp.zoom,
  }
}

/** screen (CSS px) → world, the inverse of worldToScreen. */
export function screenToWorld(vp: Viewport, viewW: number, viewH: number, sx: number, sy: number): WorldPoint {
  const centre = worldToPixel(vp.x, vp.z)
  const px = centre.x + (sx - viewW / 2) / vp.zoom
  const py = centre.y + (sy - viewH / 2) / vp.zoom
  return pixelToWorld(px, py)
}

/**
 * Clamp the pan so the floor never leaves the view. When the whole floor fits
 * (view ≥ world at this zoom) the centre is pinned to the origin.
 */
export function clampCenter(vp: Viewport, viewW: number, viewH: number): Viewport {
  const visW = viewW / vp.zoom // zoom-1 px
  const visH = viewH / vp.zoom
  const halfW = FLOOR_W / 2
  const halfD = FLOOR_D / 2
  const x = visW >= WORLD_W ? 0 : Math.min(halfW - visW / 2 / TILE, Math.max(-halfW + visW / 2 / TILE, vp.x))
  const z = visH >= WORLD_H ? 0 : Math.min(halfD - visH / 2 / TILE, Math.max(-halfD + visH / 2 / TILE, vp.z))
  return { x, z, zoom: vp.zoom }
}

/**
 * Integer blit factor that keeps pixel-art crisp on a fractional DPR: the world
 * offscreen is drawn at this many backing-store px per world px.
 */
export function blitScale(zoom: number, dpr: number): number {
  return Math.max(1, Math.floor(zoom * dpr))
}

export interface PickPoint {
  id: string
  x: number
  z: number
}

/** Nearest point within `radius` world units of (x, z), or null. */
export function nearestAt(pts: ReadonlyArray<PickPoint>, x: number, z: number, radius: number): string | null {
  let best: string | null = null
  let bestD = radius
  for (const p of pts) {
    const d = Math.hypot(p.x - x, p.z - z)
    if (d < bestD) {
      bestD = d
      best = p.id
    }
  }
  return best
}
