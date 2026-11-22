/**
 * Nameplates for the side view — measured in CSS px, laid out above the head.
 *
 * Pure: no DOM. The painter uses the same numbers, and `verify/visual_check.ts`
 * replays the layout headless. Widths come from `measureSans`, a conservative
 * table for the UI font (the canvas then draws with `maxWidth` so a platform
 * whose sans is a hair wider can never overflow its plate).
 *
 * Rules (design §7.4):
 *  - 24 px tall, radius 11, 11.5 px bold, fill = surface @ 0.92;
 *  - always 8 px above the head;
 *  - if the ideal slot is taken, step up 27 px (height + 3) and draw a 1 px
 *    connector from the plate to the head — a plate never floats;
 *  - hard gate: 0 plate↔plate, 0 plate↔other-head, avatar bbox overlap ≤ 20 %.
 */
import type { SideSeat } from './side'

export const PLATE_H = 24
export const PLATE_GAP = 8
export const PLATE_STEP = 27
export const PLATE_RADIUS = 11
export const PLATE_PAD = 7
export const PLATE_FONT = 11.5
export const PLATE_DOT = 6
export const PLATE_DOT_GAP = 5
export const NAME_MAX = 8

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SideLabelAgent {
  id: string
  name: string
  /** head centre x, design px */
  cx: number
  /** top of the head, design px */
  headTop: number
  headW: number
  headH: number
  /** status shape colour; null hides the shape */
  dot: string | null
  /** 'circle' | 'ring' | 'diamond' | 'square' | 'triangle' */
  shape?: 'circle' | 'ring' | 'diamond' | 'square' | 'triangle'
  offline: boolean
}

export interface PlacedPlate extends Rect {
  id: string
  /** connector from the plate's bottom-centre down to the head */
  connector: boolean
}

/**
 * Conservative advance widths (em) for the UI sans. Uppercase names are the
 * common case, so they are measured a touch wide on purpose.
 */
const NARROW = new Set(['i', 'l', 'j', 'I', '.', ',', ':', ';', "'", '!', '|', '1'])
const WIDE = new Set(['M', 'W', 'm', 'w', '@'])

export function measureSans(text: string, size = PLATE_FONT, weight = 700): number {
  const bold = weight >= 600 ? 1.04 : 1
  let em = 0
  for (const ch of text) {
    if (ch === ' ') em += 0.29
    else if (NARROW.has(ch)) em += 0.3
    else if (WIDE.has(ch)) em += 0.9
    else if (ch >= 'A' && ch <= 'Z') em += 0.73
    else if (ch >= '0' && ch <= '9') em += 0.61
    else if (ch >= 'a' && ch <= 'z') em += 0.57
    else em += 0.6
  }
  return Math.round(em * size * bold * 10) / 10
}

/** The first word, uppercased and capped — a plate must fit its slot. */
export function shortName(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? '').toUpperCase()
  return first.slice(0, NAME_MAX)
}

/** Plate width for a name (status shape included unless `dot` is false). */
export function plateWidth(text: string, hasDot = true, size = PLATE_FONT): number {
  return Math.ceil(measureSans(text, size, 700) + PLATE_PAD * 2 + (hasDot ? PLATE_DOT + PLATE_DOT_GAP : 0))
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Share of the smaller avatar bbox covered by the intersection. */
export function overlapShare(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  const smaller = Math.min(a.w * a.h, b.w * b.h)
  return smaller > 0 ? inter / smaller : 0
}

/**
 * Place every plate above its head, stepping up when the ideal slot is taken.
 * `reserved` holds the boards/rail area (plates may not sit on a board).
 */
export function layoutSideLabels(
  agents: readonly SideLabelAgent[],
  bounds: { w: number; h: number },
  reserved: readonly Rect[] = [],
): { plates: PlacedPlate[]; violations: string[] } {
  const occupied: Rect[] = [...reserved]
  const heads = agents.map((a) => ({
    id: a.id,
    x: a.cx - a.headW / 2,
    y: a.headTop,
    w: a.headW,
    h: a.headH,
  }))
  const plates: PlacedPlate[] = []
  const violations: string[] = []

  for (const a of agents) {
    const text = shortName(a.name)
    const w = plateWidth(text, Boolean(a.dot))
    const idealX = Math.round(a.cx - w / 2)
    const idealBottom = a.headTop - PLATE_GAP
    let x = idealX
    let y = Math.round(idealBottom - PLATE_H)
    let placed = false
    let connector = false

    // step up 27 px at a time (design §7.4), then nudge sideways
    for (let step = 0; step <= 6 && !placed; step++) {
      y = Math.round(idealBottom - PLATE_H - step * PLATE_STEP)
      for (const dx of [0, -14, 14, -28, 28, -42, 42]) {
        x = Math.round(idealX + dx)
        if (x < 1 || x + w > bounds.w - 1 || y < 1) continue
        const box: Rect = { x, y, w, h: PLATE_H }
        if (occupied.some((r) => rectsOverlap(box, r))) continue
        if (heads.some((hd) => hd.id !== a.id && rectsOverlap(box, hd))) continue
        placed = true
        connector = step > 0
        break
      }
    }
    if (!placed) {
      x = Math.max(1, Math.min(idealX, bounds.w - w - 1))
      y = Math.max(1, Math.round(idealBottom - PLATE_H))
      violations.push(`${a.id}: no free plate slot above the head`)
    }
    const plate: PlacedPlate = { id: a.id, x, y, w, h: PLATE_H, connector }
    plates.push(plate)
    occupied.push(plate)
  }

  return { plates, violations }
}

export interface SideGateReport {
  plates: number
  plateOverlaps: number
  plateOnHead: number
  avatarOverlapPct: number
  minSameRowPx: number
  minPlateHeadGap: number
  violations: string[]
}

/**
 * The hard gate from design §7.4, run for L1/L2/L3 before the scene is drawn.
 * Returns measured numbers, not booleans, so the check can print them.
 */
export function sideGate(
  seats: readonly SideSeat[],
  plates: readonly PlacedPlate[],
  bounds: { w: number; h: number },
): SideGateReport {
  const violations: string[] = []
  let plateOverlaps = 0
  for (let i = 0; i < plates.length; i++) {
    for (let j = i + 1; j < plates.length; j++) {
      if (rectsOverlap(plates[i]!, plates[j]!)) {
        plateOverlaps++
        violations.push(`${plates[i]!.id} plate overlaps ${plates[j]!.id}`)
      }
    }
  }

  const headOf = (s: SideSeat): Rect => ({
    x: s.cx - s.headW / 2,
    y: s.headTop,
    w: s.headW,
    h: s.headH,
  })
  let plateOnHead = 0
  for (const p of plates) {
    for (const s of seats) {
      if (s.meta.id === p.id) continue
      if (rectsOverlap(p, headOf(s))) {
        plateOnHead++
        violations.push(`${p.id} plate covers ${s.meta.id}'s head`)
      }
    }
  }

  const boxes = seats.map((s) => ({
    id: s.meta.id,
    x: s.cx - s.avatarH * 0.19,
    y: s.headTop,
    w: s.avatarH * 0.38,
    h: s.avatarH,
  }))
  let worstOverlap = 0
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      worstOverlap = Math.max(worstOverlap, overlapShare(boxes[i]!, boxes[j]!))
    }
  }
  if (worstOverlap > 0.2) violations.push(`avatar bbox overlap ${(worstOverlap * 100).toFixed(1)} % > 20 %`)

  let minSameRow = Infinity
  for (const row of ['front', 'back'] as const) {
    const xs = seats.filter((s) => s.row === row).map((s) => s.cx).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) minSameRow = Math.min(minSameRow, xs[i]! - xs[i - 1]!)
  }
  if (Number.isFinite(minSameRow) && minSameRow < 180) violations.push(`same-row pitch ${minSameRow.toFixed(1)} px < 180`)

  let minGap = Infinity
  for (const s of seats) {
    const p = plates.find((q) => q.id === s.meta.id)
    if (!p) continue
    minGap = Math.min(minGap, s.headTop - (p.y + p.h))
  }

  for (const p of plates) {
    if (p.x < 1 || p.y < 1 || p.x + p.w > bounds.w - 1 || p.y + p.h > bounds.h - 1) {
      violations.push(`${p.id} plate leaves the canvas`)
    }
  }

  return {
    plates: plates.length,
    plateOverlaps,
    plateOnHead,
    avatarOverlapPct: Math.round(worstOverlap * 1000) / 10,
    minSameRowPx: Number.isFinite(minSameRow) ? Math.round(minSameRow * 10) / 10 : 0,
    minPlateHeadGap: Number.isFinite(minGap) ? Math.round(minGap * 10) / 10 : 0,
    violations,
  }
}

/** Build the label descriptors from seats + a status map. */
export function labelAgentsFor(
  seats: readonly SideSeat[],
  statuses: ReadonlyMap<string, { status: string; shape?: SideLabelAgent['shape']; colour: string }>,
): SideLabelAgent[] {
  return seats.map((s) => {
    const st = statuses.get(s.meta.id)
    const offline = !st || st.status === 'offline'
    return {
      id: s.meta.id,
      name: s.meta.name,
      cx: s.cx,
      headTop: s.headTop,
      headW: s.headW,
      headH: s.headH,
      dot: offline ? '#556073' : st!.colour,
      shape: offline ? 'square' : st!.shape ?? 'circle',
      offline,
    }
  })
}
