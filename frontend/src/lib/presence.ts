/** Shared live presence: where the walkers currently are. */
export const walkerPositions = new Map<string, { x: number; z: number }>()

/** POIs someone is walking to or standing at: one person per spot. */
export const poiTaken = new Map<string, string>()
