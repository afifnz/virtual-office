/**
 * Label layout for the 2D office — pure, no DOM, so `verify/visual_check.ts`
 * can replay it headless.
 *
 * Plates are measured in **CSS pixels**, not world pixels: the world is scaled
 * by the integer zoom, the labels are not. That is what keeps 13 nameplates
 * readable on a floor whose desks stand only 1.62 world units apart (26 world
 * px, i.e. 52 CSS px at zoom 2): a plate drawn in world px would be as wide as
 * the neighbouring desk and the two texts would shred each other.
 *
 * Sizes therefore scale with the *screen*, not with the zoom, and every plate
 * carries the whole first name (max 6 letters) so a desk is readable at a
 * glance without opening a panel:
 *   compact (zoom 1) — name only, pixel font at scale 2 (the plan's readable
 *                      minimum: 1 world px = 1 CSS px here). The 13 plates are
 *                      wider than the 26 CSS px desk pitch, so placeStacks
 *                      staggers them vertically.
 *   full    (zoom 2) — name + status chip at scale 1 (the world is 2× bigger,
 *                      so a 7 px glyph already spans 2 world px)
 *   detail  (zoom ≥3) — name + chip + counters/task id
 *
 * A three-letter stub is never drawn: the only reason to shorten a name is the
 * 6-letter cap that keeps "NDORO KAKUNG" inside a desk slot.
 */
import { textWidth } from './pixelfont'

export type PlateMode = 'compact' | 'full' | 'detail'

/** Maximum letters on a nameplate: the first word, capped. */
export const NAME_MAX = 6

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Padding inside a plate, px. */
export const PLATE_PAD = 2
/** Gap between two stacked plates, px. */
export const PLATE_GAP = 1
/** Status dot size, px. */
export const DOT = 4
/** Plate height: a 7 px glyph row plus the padding above and below. */
export const PLATE_H = 7 + 2 * PLATE_PAD
/** Gap between the top of a head and the bottom of its nameplate, px. */
export const NAME_GAP = 3
/** Plaque height for the zone labels, px. */
export const PLAQUE_H = 9

/**
 * Which plates a zoom draws. The nameplate is always the whole first name; the
 * mode only decides whether the status chip (zoom ≥2) and the counters
 * (zoom ≥3) join it.
 */
export function plateMode(zoom: number): PlateMode {
  if (zoom <= 1) return 'compact'
  if (zoom >= 3) return 'detail'
  return 'full'
}

/**
 * CSS px per glyph pixel. Zoom 1 draws 1 world px per CSS px, so the 5×7 font
 * would be 7 CSS px tall — the design's §viewport asks for a 2× font there so
 * the name stays readable on a phone. Zoom ≥2 doubles the world itself, so
 * scale 1 already lands on 2 CSS px per glyph pixel. Always an integer.
 */
export function plateScale(zoom: number): number {
  return zoom <= 1 ? 2 : 1
}

/**
 * The name a plate shows: the first word, uppercased and capped at NAME_MAX.
 * Long roster names ("Ndoro Kakung") would otherwise overflow their desk slot.
 */
export function shortName(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? '').toUpperCase()
  return first.slice(0, NAME_MAX)
}

/** Plate width for a text at a pixel-font scale (optionally with a status dot). */
export function plateWidth(text: string, opts: { dot?: boolean; scale?: number } = {}): number {
  const s = opts.scale ?? 1
  const dot = opts.dot ? (DOT + 2) * s : 0
  return textWidth(text, s) + dot + 2 * PLATE_PAD * s
}

/** Bubble plates carry a 1 px border and a 2 px tail, both scaled. */
export function bubbleWidth(text: string, scale = 1): number {
  return plateWidth(text, { scale }) + 2 * scale
}

/** Height of one plate kind at a pixel-font scale. */
export function plateHeight(key: string, scale = 1): number {
  return (key === 'bubble' ? PLATE_H + 3 : PLATE_H) * scale
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Width of one desk slot in CSS px (desk column pitch 1.62 world units). */
export function deskSlot(zoom: number): number {
  return 1.62 * 16 * zoom
}

export interface StackPlate {
  /** cache key suffix, e.g. 'name' / 'chip' / 'bubble' */
  key: string
  w: number
  h: number
}

export interface Stack {
  id: string
  /** centre x of the stack, CSS px */
  cx: number
  /** y of the stack's bottom edge (the nameplate's bottom), CSS px */
  bottom: number
  /** plates ordered bottom → top */
  plates: StackPlate[]
}

export interface PlacedPlate extends Rect {
  id: string
  key: string
}

/** Everything the layout needs to know about one agent's plate stack. */
export interface LabelAgent {
  id: string
  name: string
  /** head centre x, CSS px */
  cx: number
  /** head top y, CSS px */
  topY: number
  offline: boolean
  /** status word for the chip; '' hides the chip */
  chip: string
  /** '...' / '!' bubble text; '' hides it */
  bubble: string
  /** counters line, detail mode only; '' hides it */
  counters: string
  /** status dot colour; undefined drops the dot (compact mode) */
  dot?: string
}

/**
 * The plate stack for every agent, bottom (nameplate) → top (bubble). Which
 * plates exist depends on the zoom: at zoom 1 only the nameplate is drawn (the
 * 13 plates are already 2× wide there); chips join at zoom 2 and counters at
 * zoom ≥3. `scale` is the pixel-font scale (see plateScale) and is applied to
 * every plate size so the layout and the painted sprite never disagree.
 */
export function buildStacks(agents: readonly LabelAgent[], mode: PlateMode, scale = 1): Stack[] {
  return agents.map((a) => {
    const stack: Stack = { id: a.id, cx: a.cx, bottom: a.topY - NAME_GAP, plates: [] }
    const nameText = shortName(a.name)
    stack.plates.push({
      key: 'name',
      w: plateWidth(nameText, { dot: Boolean(a.dot), scale }),
      h: plateHeight('name', scale),
    })
    if (mode !== 'compact') {
      if (a.chip) stack.plates.push({ key: 'chip', w: plateWidth(a.chip, { scale }), h: plateHeight('chip', scale) })
      if (mode === 'detail' && a.counters && !a.offline) {
        stack.plates.push({
          key: 'counters',
          w: plateWidth(a.counters, { scale }),
          h: plateHeight('counters', scale),
        })
      }
      if (a.offline) {
        stack.plates.push({ key: 'zzz', w: plateWidth('Z Z Z', { scale }), h: plateHeight('zzz', scale) })
      } else if (a.bubble) {
        stack.plates.push({ key: 'bubble', w: bubbleWidth(a.bubble, scale), h: plateHeight('bubble', scale) })
      }
    }
    return stack
  })
}

/**
 * Place every agent's plate stack so no two plates overlap and none leaves the
 * canvas. Stacks are processed in painter order (back rows first), so a front
 * row gives way to the row behind it instead of covering it.
 *
 * `reserved` carries rects that are already on screen (zone plaques); plates
 * never sit on top of those either. `scale` widens the deterministic search in
 * step with the plates, so the 2× nameplates at zoom 1 still find a free slot.
 */
export function placeStacks(
  stacks: readonly Stack[],
  bounds: { w: number; h: number },
  reserved: readonly Rect[] = [],
  scale = 1,
): PlacedPlate[] {
  const placed: Rect[] = [...reserved]
  const out: PlacedPlate[] = []
  const gap = PLATE_GAP * scale
  // the hand-tuned ladder from T1.9, stretched by the font scale
  const dySteps = [0, 2, 4, 6, 8, 10, 13, 16, 20, 24, 30, 36, 44, 52, 62].map((v) => v * scale)
  const dxSteps = [0, -6, 6, -12, 12, -20, 20, -30, 30].map((v) => v * scale)

  for (const st of stacks) {
    if (st.plates.length === 0) continue
    const maxW = st.plates.reduce((m, p) => Math.max(m, p.w), 0)
    const totalH = st.plates.reduce((sum, p) => sum + p.h, 0) + (st.plates.length - 1) * gap
    const maxX = Math.max(1, bounds.w - maxW - 1)
    const x0 = Math.round(Math.min(Math.max(st.cx - maxW / 2, 1), maxX))

    // Natural spot first, then lift the stack, then nudge it sideways. The
    // search is fixed and deterministic: same input, same layout.
    let chosen: { x: number; y: number } | null = null
    outer: for (const dy of dySteps) {
      for (const dx of dxSteps) {
        const x = Math.round(Math.min(Math.max(x0 + dx, 1), maxX))
        const y = Math.round(st.bottom - totalH - dy)
        if (y < 1) continue
        const box = { x, y, w: maxW, h: totalH }
        if (!placed.some((r) => rectsOverlap(box, r))) {
          chosen = { x, y }
          break outer
        }
      }
    }
    if (!chosen) chosen = { x: x0, y: Math.max(1, Math.round(st.bottom - totalH)) }

    let y = chosen.y + totalH
    for (const p of st.plates) {
      y -= p.h
      const plate: PlacedPlate = {
        id: st.id,
        key: p.key,
        x: chosen.x + Math.round((maxW - p.w) / 2),
        y,
        w: p.w,
        h: p.h,
      }
      out.push(plate)
      placed.push(plate)
      y -= PLATE_GAP
    }
  }

  return out
}

// --------------------------------------------------------------- zone plaques

export interface ZoneLabel {
  id: string
  text: string
  /** the floor this plaque hangs on */
  floor: 1 | 2 | 3
  /** world anchor */
  x: number
  z: number
}

/**
 * One plaque per zone per floor (design §3.1: "plakat nama zona ditempel di
 * dinding"). L1 carries the LOBBY plaque west of the MASUK gap on the front
 * band plus the entrance plaque; L2/L3 hang their team plaque on the north
 * wall, clear of the dark band itself and of the furniture that hugs that
 * wall (the bookshelf/whiteboard on L2, the sprint board and rack on L3), so
 * the plate never looks glued to the wall's dark edge.
 */
const ZONE_LABELS: ZoneLabel[] = [
  { id: 'zone-lobby', floor: 1, text: 'L1 LOBBY', x: -7, z: 9.55 },
  { id: 'zone-edu', floor: 2, text: 'L2 TIM EDU', x: 0, z: -6.8 },
  { id: 'zone-dev', floor: 3, text: 'L3 TIM DEV', x: 3.5, z: -8.1 },
]

/** The entrance plaque, kept from the old 3D door labels (L1 only). */
const DOOR_LABELS: ZoneLabel[] = [{ id: 'door-masuk', floor: 1, text: 'MASUK', x: 0, z: 9.55 }]

/** Every fixed in-world plaque of one floor, drawn before the agent plates reserve space. */
export function labelsOf(floor: 1 | 2 | 3): ZoneLabel[] {
  return [...ZONE_LABELS, ...DOOR_LABELS].filter((l) => l.floor === floor)
}

/** Every plaque in the building (verify scripts iterate per floor). */
export const WORLD_LABELS: ZoneLabel[] = [...ZONE_LABELS, ...DOOR_LABELS]

/** Plaque rect for a text whose centre is at (cx, cy) in CSS px. */
export function plaqueRect(text: string, cx: number, cy: number): Rect {
  const w = textWidth(text, 1) + 2 * PLATE_PAD
  return { x: Math.round(cx - w / 2), y: Math.round(cy - PLAQUE_H / 2), w, h: PLAQUE_H }
}
