/**
 * Walking routes between a desk and a point of interest. Pure functions, so
 * verify/layout_check.ts can replay every errand against the furniture.
 */
import { deskExit, nearestNode, type FloorId } from './rooms'
import { navPath, type Pt } from './nav'

export interface DeskLike {
  desk: { x: number; z: number; rot: number; floor: FloorId }
}

/** Seat point in world space (the avatar's hip sits this far behind the desk). */
export function seatPoint(meta: DeskLike): Pt {
  return [meta.desk.x + Math.sin(meta.desk.rot) * 0.42, meta.desk.z + Math.cos(meta.desk.rot) * 0.42]
}

/** desk exit → nav graph → destination, all on the desk's own floor */
export function onward(meta: DeskLike, to: Pt): Pt[] {
  const exit = deskExit(meta.desk)
  const a = nearestNode(exit[0], exit[1], meta.desk.floor)
  const b = nearestNode(to[0], to[1], meta.desk.floor)
  // navPath() leaves out its start node: walk to it first, or the leg from the
  // desk exit runs straight to the *second* node, through whatever is between
  return [[exit[0], exit[1]], [a.x, a.z], ...navPath(a.id, b.id), to]
}

/**
 * `from` → nav graph → desk exit → seat, all on the desk's own floor. `from`
 * must be a point whose straight leg to its nearest node is clear: a POI or a
 * nav node, never a mid-leg spot (use retrace for that).
 */
export function homeward(meta: DeskLike, from: Pt): Pt[] {
  const exit = deskExit(meta.desk)
  const a = nearestNode(from[0], from[1], meta.desk.floor)
  const b = nearestNode(exit[0], exit[1], meta.desk.floor)
  const seat = seatPoint(meta)
  return [[a.x, a.z], ...navPath(a.id, b.id), [exit[0], exit[1]], seat]
}

/** Walk back over the legs already taken: path[idx-1] .. path[0] (the desk exit), then the seat. */
export function retrace(meta: DeskLike, path: Pt[], idx: number): Pt[] {
  const back = path.slice(0, Math.min(idx, path.length)).reverse()
  return [...back, seatPoint(meta)]
}

/** Personal space, metres between body centres. */
export const BODY = 0.55
/** How far ahead a walker looks for someone in the way. */
const LOOK = 1.6
/**
 * Sidestep when passing. 0.5 clears a colleague who is standing still on the
 * route; verify/layout_check.ts proves every nav edge keeps body half-width +
 * this much room to the furniture.
 */
export const SIDESTEP = 0.5

/**
 * Local avoidance on top of the nav graph. Anyone ahead in the walker's lane
 * makes it keep right (people passing in a corridor); someone right in front
 * makes the lower-priority one (id order, so exactly one of the two) slow down
 * and wait, for at most ~2 s so a standing colleague can never block a route.
 */
export function avoid(
  id: string,
  w: { x: number; z: number; yielded: number },
  dirX: number,
  dirZ: number,
  walkers: ReadonlyMap<string, { x: number; z: number }>,
): { side: number; speed: number; hold: boolean } {
  if (dirX === 0 && dirZ === 0) return { side: 0, speed: 1, hold: false }
  let side = 0
  let speed = 1
  let hold = false
  for (const [other, p] of walkers) {
    if (other === id) continue
    const rx = p.x - w.x
    const rz = p.z - w.z
    const ahead = rx * dirX + rz * dirZ
    // keep the sidestep until the colleague is a body length behind, or the
    // walker swings back into them while still level
    if (ahead <= -BODY || ahead > LOOK) continue
    const lateral = Math.abs(rx * -dirZ + rz * dirX)
    if (lateral > BODY + SIDESTEP) continue
    side = SIDESTEP
    if (ahead > 0 && ahead < BODY + 0.35 && lateral < BODY) {
      // yield by id order; a long wait gives up and squeezes past on the right
      if (id > other && w.yielded < 2.2) {
        speed = Math.min(speed, Math.max(0, (ahead - BODY * 0.7) / 0.6))
        hold = true
      } else {
        speed = Math.min(speed, 0.55)
      }
    }
  }
  return { side, speed, hold }
}
