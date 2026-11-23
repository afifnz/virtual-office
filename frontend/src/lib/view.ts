/**
 * View types and presets shared by the HUD, the movement pad and the 2D scene.
 *
 * These used to live in `scene/CameraRig.tsx`; they moved here so that `App`,
 * `DPad` and `lib/focus` no longer need to import anything from the `scene`
 * directory (a value import from there would drag three.js into the entry
 * bundle). The old `CameraRig` re-exports the same names during the transition
 * and is removed in a later step.
 */
import type { FloorId } from './rooms'

/** Which camera the scene is in: the 3-floor building overview or one floor. */
export type ViewMode = 'building' | 'floor'

/**
 * Which view a fresh load opens in. GEDUNG is the default; an explicit floor
 * link wins, then `?view=`, then the legacy agent/spot links (which are all
 * floor views). Pure, so `verify/building_check.ts` can pin the precedence.
 */
export function defaultViewMode(o: {
  floor?: FloorId | null
  spot?: string | null
  view?: ViewMode | null
  agentLink?: boolean
}): ViewMode {
  if (o.floor !== null && o.floor !== undefined) return 'floor'
  if (o.view) return o.view
  if (o.spot || o.agentLink) return 'floor'
  return 'building'
}

/** One command the HUD / deep links send to the scene. */
export interface RigCommand {
  spot: string
  nonce: number
  /** which floor to show (absent → keep the current one, default 1) */
  floor?: FloorId
  /** `building` draws all three floors + the city in one frame (default) */
  mode?: ViewMode
  /** fly to an agent's desk instead of a named spot */
  focus?: { id?: string; x: number; z: number; rot: number; floor: FloorId; seated?: boolean }
  /** portrait mode: get close enough to read the face */
  tight?: boolean
}

/** Continuous movement intent from the pad / keyboard (now a pan). */
export interface MoveIntent {
  x: number
  z: number
}

/** A pure view preset: world centre + integer zoom, no three.js. */
export interface SpotView {
  x: number
  z: number
  zoom: number
  /** ignore the numbers and fit the whole floor into the canvas instead */
  fit?: boolean
}

/**
 * Where each named spot points the 2D camera, per floor. `tampak`/`luar` ask
 * the canvas to zoom-fit the whole floor, so no desk cluster can ever start
 * off-screen; the team spots centre that team's block.
 */
export const SPOT_VIEW: Record<FloorId, Record<string, SpotView>> = {
  1: {
    lobby: { x: -6, z: 6, zoom: 2 },
    tampak: { x: 0, z: 0, zoom: 1, fit: true },
    luar: { x: 0, z: 0, zoom: 1, fit: true },
  },
  2: {
    edu: { x: 0, z: 0.6, zoom: 2 },
    tampak: { x: 0, z: 0, zoom: 1, fit: true },
    luar: { x: 0, z: 0, zoom: 1, fit: true },
  },
  3: {
    dev: { x: 0, z: -0.39, zoom: 2 },
    tampak: { x: 0, z: 0, zoom: 1, fit: true },
    luar: { x: 0, z: 0, zoom: 1, fit: true },
  },
}

/**
 * Legacy deep-link compatibility: the old `?spot=` names map onto floors
 * (`lobby` → L1, `edu` → L2, `dev` → L3; `tampak`/`luar` fit the active
 * floor, which defaults to L1 — there is no exterior view any more).
 */
export const SPOT_FLOOR: Record<string, FloorId> = {
  lobby: 1,
  edu: 2,
  dev: 3,
  tampak: 1,
  luar: 1,
}
