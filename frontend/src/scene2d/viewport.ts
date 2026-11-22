/**
 * World ↔ pixel math for the 2D office — per floor.
 *
 * The building has three floors (lib/rooms.ts FLOORS): L1 28×20, L2 20×16,
 * L3 24×18 world units, one floor on screen at a time (x ∈ [-w/2,w/2], z ∈
 * [-d/2,d/2]). One unit = TILE px at zoom 1, +z grows downward on screen (the
 * north wall at z=-d/2 is at the top). Zoom is integer 1..4 so every blit is
 * nearest-neighbour; a fractional device-pixel-ratio is absorbed by an integer
 * backing-store factor, never by blurring.
 *
 * Everything here is pure — no DOM, so verify/anim_check.ts replays it headless.
 */
import { FLOORS, type FloorId } from '../lib/rooms'

/** Pixels per world unit at zoom 1. */
export const TILE = 16

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export interface Viewport {
  /** world-space centre of the view */
  x: number
  z: number
  /** integer zoom, 1..4 */
  zoom: number
  /** which floor the view shows */
  floor: FloorId
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

/** Share of the view the floor may fill, so the walls never touch the edge. */
export const FIT_MARGIN = 0.94

/** The offscreen world surface at zoom 1 for one floor, in px. */
export function worldSize(floor: FloorId): { w: number; h: number } {
  const f = FLOORS[floor]
  return { w: f.w * TILE, h: f.d * TILE }
}

/**
 * The largest integer zoom at which the whole floor still fits the view. This
 * is the default view ("tampak"): a desk cluster that leaves the screen is a
 * bug, not a zoom level. Verified numbers (TILE=16, margin 0.94): a 1000×688
 * desktop canvas fits zoom 2 on all three floors; 390×692 mobile fits zoom 1.
 */
export function fitZoom(floor: FloorId, viewW: number, viewH: number): number {
  if (viewW <= 0 || viewH <= 0) return MIN_ZOOM
  const { w, h } = worldSize(floor)
  const z = Math.min(viewW / (w * FIT_MARGIN), viewH / (h * FIT_MARGIN))
  return clampZoom(Math.floor(z))
}

/** world → zoom-1 pixel space. Origin = the north-west corner of the floor. */
export function worldToPixel(x: number, z: number, floor: FloorId): PixelPoint {
  const f = FLOORS[floor]
  return { x: (x + f.w / 2) * TILE, y: (z + f.d / 2) * TILE }
}

/** zoom-1 pixel space → world. Inverse of worldToPixel. */
export function pixelToWorld(px: number, py: number, floor: FloorId): WorldPoint {
  const f = FLOORS[floor]
  return { x: px / TILE - f.w / 2, z: py / TILE - f.d / 2 }
}

/** world → screen (CSS px), through the viewport centre and zoom. */
export function worldToScreen(vp: Viewport, viewW: number, viewH: number, x: number, z: number): PixelPoint {
  const centre = worldToPixel(vp.x, vp.z, vp.floor)
  const p = worldToPixel(x, z, vp.floor)
  return {
    x: viewW / 2 + (p.x - centre.x) * vp.zoom,
    y: viewH / 2 + (p.y - centre.y) * vp.zoom,
  }
}

/** screen (CSS px) → world, the inverse of worldToScreen. */
export function screenToWorld(vp: Viewport, viewW: number, viewH: number, sx: number, sy: number): WorldPoint {
  const centre = worldToPixel(vp.x, vp.z, vp.floor)
  const px = centre.x + (sx - viewW / 2) / vp.zoom
  const py = centre.y + (sy - viewH / 2) / vp.zoom
  return pixelToWorld(px, py, vp.floor)
}

/**
 * Clamp the pan so the floor never leaves the view. When the whole floor fits
 * (view ≥ world at this zoom) the centre is pinned to the origin.
 */
export function clampCenter(vp: Viewport, viewW: number, viewH: number): Viewport {
  const visW = viewW / vp.zoom // zoom-1 px
  const visH = viewH / vp.zoom
  const { w, h } = worldSize(vp.floor)
  const f = FLOORS[vp.floor]
  const halfW = f.w / 2
  const halfD = f.d / 2
  const x = visW >= w ? 0 : Math.min(halfW - visW / 2 / TILE, Math.max(-halfW + visW / 2 / TILE, vp.x))
  const z = visH >= h ? 0 : Math.min(halfD - visH / 2 / TILE, Math.max(-halfD + visH / 2 / TILE, vp.z))
  return { x, z, zoom: vp.zoom, floor: vp.floor }
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
