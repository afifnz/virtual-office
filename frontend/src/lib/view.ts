/**
 * View types and presets shared by the HUD, the movement pad and the 2D scene.
 *
 * These used to live in `scene/CameraRig.tsx`; they moved here so that `App`,
 * `DPad` and `lib/focus` no longer need to import anything from the `scene`
 * directory (a value import from there would drag three.js into the entry
 * bundle). The old `CameraRig` re-exports the same names during the transition
 * and is removed in a later step.
 */

/** One command the HUD / deep links send to the scene. */
export interface RigCommand {
  spot: string
  nonce: number
  /** fly to an agent's desk instead of a named spot */
  focus?: { x: number; z: number; rot: number; seated?: boolean }
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
 * Where each named spot points the 2D camera. Centres are the team rooms from
 * `lib/layout.ts` TEAM_CENTRE; `tampak`/`luar` ask the canvas to zoom-fit the
 * whole floor, so no desk cluster can ever start off-screen.
 */
export const SPOT_VIEW: Record<string, SpotView> = {
  lobby: { x: 0, z: 6, zoom: 2 },
  dev: { x: -7.6, z: -4.4, zoom: 2 },
  edu: { x: 7.0, z: -4.4, zoom: 2 },
  tampak: { x: 0, z: 0, zoom: 1, fit: true },
  luar: { x: 0, z: 0, zoom: 1, fit: true },
}
