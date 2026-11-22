import type { RigCommand } from './view'
import { agentMeta } from './roster'

/**
 * Camera focus for one desk.
 *
 * Same lookup as `agentFocus` in `scene/Office.tsx`, but without importing the
 * scene module: `App` resolves a focus before the lazy scene chunk has loaded,
 * and a value import from `scene/Office` would drag three.js back into the
 * entry bundle. Pure desk coordinates, no three. The floor comes from the
 * agent's desk, so a deep link to an agent lands on the right floor.
 */
export function agentFocus(id: string): RigCommand['focus'] {
  const meta = agentMeta(id)
  return { x: meta.desk.x, z: meta.desk.z, rot: meta.desk.rot, floor: meta.desk.floor }
}
