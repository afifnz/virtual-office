/**
 * Camera for the side view.
 *
 * The stage is a fixed 1000×688 design sheet (see `side.ts`). Desktop pans
 * horizontally and zooms between 1× (half scale) and 2× (the 150 px/unit
 * reference camera). The phone defaults to the *whole floor*: the fit zoom
 * (0.78 at 390×692) shows every desk and nameplate, and zooming in from there
 * is what makes panning necessary. Vertical panning is locked: there are
 * exactly two rows, both inside the sheet.
 *
 * Pure: `verify/anim_check.ts` replays the transform headless.
 */
import { FLOORS, type FloorId } from '../lib/rooms'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  SIDE_H,
  SIDE_W,
  clampSideCam,
  fitZoomFor,
  sideScale,
  sideTransform,
  type SideViewport,
} from './side'

export type Viewport = SideViewport
export { MAX_ZOOM, MIN_ZOOM, SIDE_W, SIDE_H, sideTransform, sideScale, clampSideCam }

/**
 * Clamp a zoom. With the default minimum (desktop) the camera is a fixed
 * section, so the value snaps to whole steps 1 and 2. A phone passes its fit
 * zoom as `min` (< 1) and keeps the fractional value: the fit is 0.78, and
 * rounding it would re-crop the floor.
 */
export function clampZoom(zoom: number, min = MIN_ZOOM): number {
  if (min < MIN_ZOOM) return Math.min(MAX_ZOOM, Math.max(min, Math.round(zoom * 100) / 100))
  return Math.min(MAX_ZOOM, Math.max(min, Math.round(zoom)))
}

/**
 * The default camera.
 *
 * Desktop: 2× whenever the canvas can show the full stage, 1× otherwise.
 * Phone (`band > 0`): the fit zoom, i.e. the whole floor inside the canvas —
 * all eight L3 desks and their plates, never a cropped cluster.
 */
export function fitZoom(_floor: FloorId, viewW: number, viewH: number, band = 0): number {
  if (viewW <= 0 || viewH <= 0) return MIN_ZOOM
  if (band > 0) return fitZoomFor(viewW, viewH, band)
  return viewW >= 720 && viewH >= 420 ? 2 : 1
}

export function clampCam(camX: number, viewW: number, viewH: number, zoom: number, band = 0): number {
  return clampSideCam(camX, viewW, viewH, zoom, band)
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
