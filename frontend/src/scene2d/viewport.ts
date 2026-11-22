/**
 * Camera for the side view.
 *
 * The stage is a fixed 1000×688 design sheet (see `side.ts`); the camera only
 * pans horizontally and zooms between 1× (half scale) and 2× (the 150 px/unit
 * reference camera). Vertical panning is locked: there are exactly two rows,
 * both inside the sheet. This is a section of the building, not the whole
 * floor plan — the UI says "potongan L3" for that reason.
 *
 * Pure: `verify/anim_check.ts` replays the transform headless.
 */
import { FLOORS, type FloorId } from '../lib/rooms'
import { SIDE_H, SIDE_W, clampSideCam, sideScale, sideTransform, type SideViewport } from './side'

export type Viewport = SideViewport
export { SIDE_W, SIDE_H, sideTransform, sideScale, clampSideCam }

export const MIN_ZOOM = 1
export const MAX_ZOOM = 2

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)))
}

/**
 * The default camera: 2× on a desktop canvas that can show the full stage,
 * 1× on a phone. Never a fractional zoom, never a fit-to-width that shrinks
 * the avatar along with the room.
 */
export function fitZoom(_floor: FloorId, viewW: number, viewH: number): number {
  if (viewW <= 0 || viewH <= 0) return MIN_ZOOM
  return viewW >= 720 && viewH >= 420 ? 2 : 1
}

export function clampCam(camX: number, viewW: number, viewH: number, zoom: number): number {
  return clampSideCam(camX, viewW, viewH, zoom)
}

export interface PickPoint {
  id: string
  x: number
  z: number
}

/** Nearest world point within `radius` units, or null (proximity card). */
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

/** World x span of a floor, used to map a walking agent onto the stage. */
export function floorSpan(floor: FloorId): number {
  return FLOORS[floor].w
}
