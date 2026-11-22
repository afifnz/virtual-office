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
 * Sizes therefore scale with the *screen*, not with the zoom:
 *   compact (zoom 1) — 3-letter name, no chip: fits the 26 CSS px desk pitch
 *   full    (zoom 2) — first name + status chip: fits the 52 CSS px pitch
 *   detail  (zoom ≥3) — first name + chip + counters/task id: 78 CSS px pitch
 */
import { textWidth } from './pixelfont'

export type PlateMode = 'compact' | 'full' | 'detail'

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

/** How much text a plate may carry at this zoom. */
export function plateMode(zoom: number): PlateMode {
  if (zoom <= 1) return 'compact'
  if (zoom >= 3) return 'detail'
  return 'full'
}

const NAME_MAX: Record<PlateMode, number> = { compact: 3, full: 6, detail: 6 }

/**
 * The name a plate shows: the first word, uppercased and capped. Long roster
 * names ("Ndoro Kakung") would otherwise overflow their desk slot.
 */
export function shortName(name: string, mode: PlateMode): string {
  const first = (name.trim().split(/\s+/)[0] ?? '').toUpperCase()
  return first.slice(0, NAME_MAX[mode])
}

/** Plate width for a text at pixel-font scale 1 (optionally with a status dot). */
export function plateWidth(text: string, opts: { dot?: boolean } = {}): number {
  const dot = opts.dot ? DOT + 2 : 0
  return textWidth(text, 1) + dot + 2 * PLATE_PAD
}

/** Bubble plates carry a 1 px border and a 2 px tail. */
export function bubbleWidth(text: string): number {
  return plateWidth(text) + 2
}

/** Height of one plate kind. */
export function plateHeight(key: string): number {
  return key === 'bubble' ? PLATE_H + 3 : PLATE_H
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
 * plates exist depends on the zoom: at 50 % a desk slot is 26 CSS px wide, so
 * only a three-letter nameplate fits; chips join at 100 % and counters at 150 %.
 */
export function buildStacks(agents: readonly LabelAgent[], mode: PlateMode): Stack[] {
  return agents.map((a) => {
    const stack: Stack = { id: a.id, cx: a.cx, bottom: a.topY - NAME_GAP, plates: [] }
    const nameText = shortName(a.name, mode)
    stack.plates.push({
      key: 'name',
      w: plateWidth(nameText, { dot: Boolean(a.dot) }),
      h: plateHeight('name'),
    })
    if (mode !== 'compact') {
      if (a.chip) stack.plates.push({ key: 'chip', w: plateWidth(a.chip), h: plateHeight('chip') })
      if (mode === 'detail' && a.counters && !a.offline) {
        stack.plates.push({ key: 'counters', w: plateWidth(a.counters), h: plateHeight('counters') })
      }
      if (a.offline) {
        stack.plates.push({ key: 'zzz', w: plateWidth('Z Z Z'), h: plateHeight('zzz') })
      } else if (a.bubble) {
        stack.plates.push({ key: 'bubble', w: bubbleWidth(a.bubble), h: plateHeight('bubble') })
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
 * never sit on top of those either.
 */
export function placeStacks(
  stacks: readonly Stack[],
  bounds: { w: number; h: number },
  reserved: readonly Rect[] = [],
): PlacedPlate[] {
  const placed: Rect[] = [...reserved]
  const out: PlacedPlate[] = []

  for (const st of stacks) {
    if (st.plates.length === 0) continue
    const maxW = st.plates.reduce((m, p) => Math.max(m, p.w), 0)
    const totalH =
      st.plates.reduce((sum, p) => sum + p.h, 0) + (st.plates.length - 1) * PLATE_GAP
    const maxX = Math.max(1, bounds.w - maxW - 1)
    const x0 = Math.round(Math.min(Math.max(st.cx - maxW / 2, 1), maxX))

    // Natural spot first, then lift the stack, then nudge it sideways. The
    // search is fixed and deterministic: same input, same layout.
    let chosen: { x: number; y: number } | null = null
    outer: for (const dy of [0, 2, 4, 6, 8, 10, 13, 16, 20, 24, 30, 36, 44, 52, 62]) {
      for (const dx of [0, -6, 6, -12, 12, -20, 20, -30, 30]) {
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
  /** world anchor */
  x: number
  z: number
}

/**
 * One plaque per zone (design §3.1: "plakat nama zona ditempel di dinding").
 * Dev and Edu sit on the back wall band, Pendopo on the front band west of the
 * MASUK gap — always outside the desk rows, so they never fight a nameplate.
 */
export const ZONE_LABELS: ZoneLabel[] = [
  { id: 'zone-dev', text: 'TIM DEV', x: -7, z: -9.55 },
  { id: 'zone-edu', text: 'TIM EDU', x: 7, z: -9.55 },
  { id: 'zone-lobby', text: 'PENDOPO', x: -7, z: 9.55 },
]

/** The entrance plaque, kept from the old 3D door labels. */
export const DOOR_LABELS: ZoneLabel[] = [{ id: 'door-masuk', text: 'MASUK', x: 0, z: 9.55 }]

/** Every fixed in-world plaque, drawn before the agent plates reserve space. */
export const WORLD_LABELS: ZoneLabel[] = [...ZONE_LABELS, ...DOOR_LABELS]

/** Plaque rect for a text whose centre is at (cx, cy) in CSS px. */
export function plaqueRect(text: string, cx: number, cy: number): Rect {
  const w = textWidth(text, 1) + 2 * PLATE_PAD
  return { x: Math.round(cx - w / 2), y: Math.round(cy - PLAQUE_H / 2), w, h: PLAQUE_H }
}
