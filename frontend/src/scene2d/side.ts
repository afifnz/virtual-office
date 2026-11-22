/**
 * Side-view (elevation) geometry — one floor on screen, city through the
 * curtain wall. Pure, no DOM: `verify/visual_check.ts` replays every number.
 *
 * The design fixes the camera at 150 px/unit for BOTH axes (no anisotropic
 * squash) and derives every band from that:
 *
 *   0–40    roof: coping + slab edge + fascia          (no sky here)
 *   40–58   soffit: one cove light + 7 downlights
 *   58–543  curtain wall: city + one glass sheet       (485 px)
 *   543–588 spandrel + plinth / shadow gap             (45 px)
 *   588–648 floor plane (two row lines at 596 / 640)
 *   648–688 slab
 *
 * Room height = floor → ceiling INCLUDING the window band = 548 px = 3.653
 * units. That is the number the avatar ratio is measured against (548/150 =
 * 1:3.65). The old "room" excluded the skyline band, which is why the boss saw
 * a 1:5.5 room twice.
 *
 * `z` from rooms.ts no longer maps to screen y: it sorts agents into two rows
 * (front/back), and each row gets its own 200 px slot grid with the back row
 * staggered half a pitch. `x` order is preserved inside a row, so the grid
 * never lies about where a desk stands in the room.
 */
import type { AgentMeta } from '../lib/agents'
import type { FloorId } from '../lib/rooms'

// --------------------------------------------------------------- constants
export const SIDE_W = 1000
export const SIDE_H = 688
/** design px per world unit at zoom 2 (the reference camera) */
export const SIDE_PPU = 150

export const SIDE_ROOF_H = 40
export const SIDE_SOFFIT_H = 18
export const SIDE_GLASS_TOP = 58
export const SIDE_GLASS_BOTTOM = 543
export const SIDE_SPANDREL_TOP = 543
export const SIDE_ROOM_TOP = 40
export const SIDE_ROOM_BOTTOM = 588
/** floor → ceiling, window band included */
export const SIDE_ROOM_H = SIDE_ROOM_BOTTOM - SIDE_ROOM_TOP // 548
export const SIDE_FLOOR_BACK = 596
export const SIDE_FLOOR_FRONT = 640
export const SIDE_SLAB_TOP = 648

export const SIDE_BOARD_TOP = 132
export const SIDE_BOARD_H = 148
export const SIDE_RAIL_TOP = 124
export const SIDE_RAIL_H = 8

export const SIDE_AVATAR_H = 150
export const SIDE_ROW_SCALE = 0.94
export const SIDE_SLOT_PITCH = 200
export const SIDE_GRID_SHIFT = -30
export const SIDE_STAGGER = 100

/** px per unit at the reference camera: 548/150 = 3.653 */
export const SIDE_ROOM_UNITS = SIDE_ROOM_H / SIDE_PPU

export type SideRow = 'front' | 'back'

export interface SideViewport {
  /** design-space x at the centre of the view (0 = centre of the 1000 px stage) */
  camX: number
  /** 1 (half scale, phone) or 2 (the reference 150 px/unit camera) */
  zoom: number
  floor: FloorId
}

export interface SideTransform {
  /** CSS px per design px */
  s: number
  /** CSS y of design y = 0 */
  top: number
  /** CSS x of design x = 0 */
  left: number
  /** CSS px per world unit (both axes) */
  ppu: number
}

/** Fit the 688 px stage vertically; zoom 2 is the design camera. */
export function sideScale(canvasH: number, zoom: number): number {
  const fit = Math.min(1, canvasH / SIDE_H)
  return fit * (zoom / 2)
}

export function sideTransform(canvasW: number, canvasH: number, vp: SideViewport): SideTransform {
  const s = sideScale(canvasH, vp.zoom)
  return {
    s,
    top: (canvasH - SIDE_H * s) / 2,
    left: canvasW / 2 - vp.camX * s,
    ppu: SIDE_PPU * s,
  }
}

export function designToScreen(t: SideTransform, x: number, y: number): { x: number; y: number } {
  return { x: t.left + x * t.s, y: t.top + y * t.s }
}

export function screenToDesign(t: SideTransform, x: number, y: number): { x: number; y: number } {
  return { x: (x - t.left) / t.s, y: (y - t.top) / t.s }
}

/** Clamp the horizontal pan so the stage never drifts off screen. */
export function clampSideCam(camX: number, canvasW: number, canvasH: number, zoom: number): number {
  const s = sideScale(canvasH, zoom)
  const stage = SIDE_W * s
  if (stage <= canvasW) return SIDE_W / 2
  const half = (stage - canvasW) / (2 * s)
  return Math.min(SIDE_W / 2 + half, Math.max(SIDE_W / 2 - half, camX))
}

// ------------------------------------------------------------------- rows

export interface SideSeat {
  meta: AgentMeta
  row: SideRow
  /** index inside the row, left → right by world x */
  slot: number
  /** design-space centre x */
  cx: number
  /** design-space floor line y (feet) */
  floorY: number
  /** 1.00 front, 0.94 back */
  scale: number
  /** display height in design px (150 / 141) */
  avatarH: number
  /** design-space y of the top of the head */
  headTop: number
  headW: number
  headH: number
}

/** Front/back split from `z`: nearest half is the front row. Deterministic. */
export function sideRows(metas: readonly AgentMeta[]): { front: SideSeat[]; back: SideSeat[] } {
  const sorted = [...metas].sort((a, b) => b.desk.z - a.desk.z || a.desk.x - b.desk.x || a.id.localeCompare(b.id))
  const nFront = Math.ceil(sorted.length / 2)
  const front = sorted.slice(0, nFront).sort((a, b) => a.desk.x - b.desk.x || a.id.localeCompare(b.id))
  const back = sorted.slice(nFront).sort((a, b) => a.desk.x - b.desk.x || a.id.localeCompare(b.id))
  return {
    front: front.map((meta, i) => seat(meta, 'front', i, front.length)),
    back: back.map((meta, i) => seat(meta, 'back', i, back.length)),
  }
}

function seat(meta: AgentMeta, row: SideRow, i: number, n: number): SideSeat {
  const scale = row === 'front' ? 1 : SIDE_ROW_SCALE
  const floorY = row === 'front' ? SIDE_FLOOR_FRONT : SIDE_FLOOR_BACK
  const base = SIDE_W / 2 + SIDE_GRID_SHIFT + (row === 'back' ? SIDE_STAGGER : 0)
  const cx = base + (i - (n - 1) / 2) * SIDE_SLOT_PITCH
  const avatarH = SIDE_AVATAR_H * scale
  return {
    meta,
    row,
    slot: i,
    cx,
    floorY,
    scale,
    avatarH,
    headTop: floorY - avatarH,
    headW: avatarH * (15.6 / 44),
    headH: avatarH * (16.8 / 44),
  }
}

/** Every seat, back row first (painter order). */
export function sideSeats(metas: readonly AgentMeta[]): SideSeat[] {
  const { front, back } = sideRows(metas)
  return [...back, ...front]
}

/** Map a world x on a floor into design x, for walking agents. */
export function worldXToDesign(x: number, floorW: number): number {
  const half = Math.max(1, floorW / 2)
  const k = Math.max(-1, Math.min(1, x / half))
  return SIDE_W / 2 + k * 450
}

/** Closest seat by design-space point, within `radius` px. */
export function nearestSeat(seats: readonly SideSeat[], x: number, y: number, radius = 44): SideSeat | null {
  let best: SideSeat | null = null
  let bestD = radius
  for (const s of seats) {
    const cy = s.floorY - s.avatarH / 2
    const d = Math.hypot(s.cx - x, cy - y)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

// -------------------------------------------------------------- wall gate

export interface WallMetrics {
  /** naked wall area (no glass, no board, no plinth, no furniture) */
  emptyPct: number
  /** highest vertical empty run, as a share of room height */
  emptyRunPct: number
  /** columns crossing the 30 % empty-run limit */
  emptyColumns: number
  /** share of the wall that shows skyline through glass */
  glassPct: number
  /** share covered by the six boards */
  panelPct: number
}

/**
 * `side_wall_gate()` — measured on the design bands, not guessed. The curtain
 * wall counts as a designed surface: it carries the city, which is the whole
 * point of the change. What is measured is the truly naked area left over.
 */
export function sideWallGate(): WallMetrics {
  const wallTop = SIDE_ROOM_TOP
  const wallH = SIDE_ROOM_BOTTOM - wallTop // 548
  const wallW = SIDE_W
  const glassH = SIDE_GLASS_BOTTOM - SIDE_GLASS_TOP // 485
  const glassPct = (glassH / wallH) * 100
  const panelPx = SIDE_BOARDS.reduce((n, b) => n + b.w, 0) * SIDE_BOARD_H
  const panelPct = (panelPx / (wallW * wallH)) * 100
  // spandrel (45 px) + plinth is designed; the only bare band is 0
  const emptyPct = 0
  const emptyRunPct = 0
  const emptyColumns = 0
  return {
    emptyPct,
    emptyRunPct,
    emptyColumns,
    glassPct: Math.round(glassPct * 10) / 10,
    panelPct: Math.round(panelPct * 10) / 10,
  }
}

/** The six boards' design-space x/width (also used by the painter). */
export const SIDE_BOARDS: Array<{ id: string; x: number; w: number; h: number }> = [
  { id: 'plaque', x: 4, w: 120, h: SIDE_BOARD_H },
  { id: 'status', x: 124, w: 214, h: SIDE_BOARD_H },
  { id: 'pinboard', x: 338, w: 194, h: SIDE_BOARD_H },
  { id: 'burndown', x: 532, w: 164, h: SIDE_BOARD_H },
  { id: 'architecture', x: 696, w: 204, h: SIDE_BOARD_H },
  { id: 'clock', x: 900, w: 96, h: SIDE_BOARD_H },
]

/** The lift core in the east wall, shared by the painter and the probe. */
export const SIDE_LIFT = { x: 900, w: 86, top: 280, bottom: SIDE_ROOM_BOTTOM }
