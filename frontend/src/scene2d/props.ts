/**
 * Decorative props — pixel-art silhouettes that make a floor read as a room at
 * a glance: a reception counter's chair, a waiting sofa with a backrest and
 * arms, a pantry with a fridge and a water dispenser, four chairs round the
 * meeting table, plants, a lift call panel.
 *
 * These props are **visual only**. They never enter `lib/rooms.ts` OBSTACLES,
 * so the walkability proof (`verify/layout_check.ts`: aisles, nav edges, POI
 * legs, passing room) keeps the exact coordinates it was verified with. Every
 * prop therefore stands either inside an existing obstacle footprint (a chair
 * tucked under its table, a monitor on a counter) or in a dead strip no nav
 * edge crosses (the lobby's north-west seating group, a corner plant).
 *
 * Authored in world units on the 16 px grid and painted with fillRect only —
 * no assets, no gradients, no alpha. Tones come from `palette.ts`.
 */
import type { FloorId } from '../lib/rooms'
import { FLOOR_MOTIF, PALETTE } from './palette'

export type PropKind =
  | 'rug'
  | 'chair'
  | 'armchair'
  | 'sofa'
  | 'coffee-table'
  | 'side-table'
  | 'bench'
  | 'stool'
  | 'plant'
  | 'planter'
  | 'floor-lamp'
  | 'screen'
  | 'dispenser'
  | 'fridge'
  | 'cabinet'
  | 'sideboard'
  | 'call-panel'

/** The side a prop opens towards: a chair's seat, a sofa's seat, a screen. */
export type Face = 'n' | 's' | 'e' | 'w'

export interface Prop {
  floor: FloorId
  kind: PropKind
  /** top-left corner, world units */
  x: number
  z: number
  /** footprint, world units */
  w: number
  h: number
  face?: Face
  /** rugs and planters paint before the furniture, so a table can stand on them */
  layer?: 'under' | 'over'
  /** rug tone: dark for the L1/L3 slabs, light for the L2 slab */
  tone?: 'dark' | 'light'
}

const UNDER: PropKind[] = ['rug']

/**
 * The props of the building, per floor. Coordinates were chosen against the
 * nav graph: every prop keeps ≥ 0.5 world units from a walk line, and the ones
 * inside a room (meeting chairs, nook chairs) sit inside that room's furniture
 * group.
 */
export const PROPS: Prop[] = [
  // ------------------------------------------------ L1 Lobby
  // reception: the receptionist's chair behind the counter, a plant at its end
  { floor: 1, kind: 'chair', x: -5.3, z: 6.15, w: 0.9, h: 0.9, face: 'e' },
  { floor: 1, kind: 'plant', x: -4.6, z: 4.6, w: 0.8, h: 0.8 },
  // waiting area by the lift: a rug, an armchair facing the sofa, a side table
  { floor: 1, kind: 'rug', x: 10.3, z: 3.8, w: 3.6, h: 3.5, tone: 'dark' },
  { floor: 1, kind: 'armchair', x: 11.4, z: 7.3, w: 1.1, h: 1.1, face: 'n' },
  { floor: 1, kind: 'side-table', x: 12.6, z: 7.4, w: 0.8, h: 0.8 },
  { floor: 1, kind: 'plant', x: 13.05, z: 8.55, w: 0.8, h: 0.8 },
  { floor: 1, kind: 'floor-lamp', x: 10.45, z: 6.9, w: 0.6, h: 0.6 },
  // pantry: fridge and water dispenser flank the coffee counter, two stools
  { floor: 1, kind: 'fridge', x: -13.85, z: 2.4, w: 0.7, h: 0.95 },
  { floor: 1, kind: 'dispenser', x: -13.85, z: 7.25, w: 0.7, h: 0.75 },
  { floor: 1, kind: 'stool', x: -10.85, z: 6.55, w: 0.6, h: 0.6 },
  { floor: 1, kind: 'stool', x: -9.85, z: 6.55, w: 0.6, h: 0.6 },
  // meeting room: four chairs round the glass table, a screen on the wall
  { floor: 1, kind: 'chair', x: 7.15, z: -8.35, w: 0.9, h: 0.9, face: 's' },
  { floor: 1, kind: 'chair', x: 8.35, z: -8.35, w: 0.9, h: 0.9, face: 's' },
  { floor: 1, kind: 'chair', x: 5.5, z: -7.0, w: 0.9, h: 0.9, face: 'e' },
  { floor: 1, kind: 'chair', x: 9.8, z: -7.0, w: 0.9, h: 0.9, face: 'w' },
  { floor: 1, kind: 'screen', x: 6.8, z: -9.9, w: 2.4, h: 0.45, face: 's' },
  { floor: 1, kind: 'plant', x: 12.6, z: -9.25, w: 0.9, h: 0.9 },
  // lift lobby: a bench and a plant beside the shaft, the call panel at the door
  { floor: 1, kind: 'bench', x: 12.25, z: 2.85, w: 1.25, h: 0.6, face: 'n' },
  { floor: 1, kind: 'plant', x: 11.35, z: 3.15, w: 0.8, h: 0.8 },
  { floor: 1, kind: 'call-panel', x: 10.95, z: -0.25, w: 0.28, h: 0.5 },
  // north-west seating group: two facing sofas, a coffee table, a rug
  { floor: 1, kind: 'rug', x: -12.4, z: -6.4, w: 6.8, h: 4.9, tone: 'dark' },
  { floor: 1, kind: 'sofa', x: -11.6, z: -6.2, w: 3.2, h: 1.05, face: 's' },
  { floor: 1, kind: 'sofa', x: -11.6, z: -2.55, w: 3.2, h: 1.05, face: 'n' },
  { floor: 1, kind: 'coffee-table', x: -10.75, z: -4.85, w: 1.6, h: 1.2 },
  { floor: 1, kind: 'plant', x: -12.9, z: -7.1, w: 0.9, h: 0.9 },
  { floor: 1, kind: 'floor-lamp', x: -7.95, z: -2.45, w: 0.6, h: 0.6 },
  { floor: 1, kind: 'sideboard', x: -9.7, z: -9.6, w: 2.6, h: 0.5 },
  // entrance: two plants flanking the MASUK mat, a planter along the glass wall
  { floor: 1, kind: 'plant', x: -3.5, z: 7.95, w: 0.8, h: 0.8 },
  { floor: 1, kind: 'plant', x: 2.7, z: 7.95, w: 0.8, h: 0.8 },
  { floor: 1, kind: 'planter', x: 2.5, z: -9.3, w: 0.6, h: 5.2 },

  // ------------------------------------------------ L2 Tim Edu
  // the zone rug under the 2×2 block: a woven prop now, so the slab seams and
  // the rug never read as one blank plate
  { floor: 2, kind: 'rug', x: -1.7, z: -1.6, w: 3.4, h: 4.5, tone: 'light' },
  { floor: 2, kind: 'plant', x: -9.0, z: -7.0, w: 0.9, h: 0.9 },
  { floor: 2, kind: 'plant', x: 8.4, z: -7.0, w: 0.9, h: 0.9 },
  { floor: 2, kind: 'plant', x: 9.0, z: 7.0, w: 0.8, h: 0.8 },
  // the nook table gets a chair at each end (the north side is the walk-in)
  { floor: 2, kind: 'chair', x: -7.95, z: 5.15, w: 0.9, h: 0.9, face: 'e' },
  { floor: 2, kind: 'chair', x: -5.05, z: 5.15, w: 0.9, h: 0.9, face: 'w' },
  { floor: 2, kind: 'cabinet', x: 6.6, z: 6.1, w: 1.0, h: 0.6 },

  // ------------------------------------------------ L3 Tim Dev
  { floor: 3, kind: 'plant', x: -11.0, z: -8.0, w: 0.9, h: 0.9 },
  { floor: 3, kind: 'plant', x: 10.6, z: 7.6, w: 0.8, h: 0.8 },
  { floor: 3, kind: 'stool', x: 6.4, z: 7.2, w: 0.6, h: 0.6 },
  { floor: 3, kind: 'stool', x: 7.4, z: 7.2, w: 0.6, h: 0.6 },
]

/** Props of one floor, rugs first so a table always stands on top of them. */
export function propsOf(floor: FloorId): Prop[] {
  const mine = PROPS.filter((p) => p.floor === floor)
  const under = (p: Prop) => propLayer(p) === 'under'
  return [...mine.filter(under), ...mine.filter((p) => !under(p))]
}

/** Rugs and planters lie on the floor; everything else stands on it. */
export function propLayer(p: Prop): 'under' | 'over' {
  return p.layer ?? (UNDER.includes(p.kind) ? 'under' : 'over')
}

// ------------------------------------------------------------------- painter

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c
  ctx.fillRect(x, y, w, h)
}

/** A 1 px inner rim on all four edges of a w×h box. */
function rim(ctx: CanvasRenderingContext2D, w: number, h: number, c: string): void {
  px(ctx, 0, 0, w, 1, c)
  px(ctx, 0, h - 1, w, 1, c)
  px(ctx, 0, 0, 1, h, c)
  px(ctx, w - 1, 0, 1, h, c)
}

/** Draw one prop into a w×h px box (the caller rounds the world size). */
export function drawProp(ctx: CanvasRenderingContext2D, p: Prop, w: number, h: number): void {
  switch (p.kind) {
    case 'rug': {
      const light = p.tone === 'light'
      const base = light ? FLOOR_MOTIF.edu.rug : PALETTE.concrete600
      const edge = light ? FLOOR_MOTIF.edu.rugEdge : PALETTE.concrete700
      const stitch = light ? PALETTE.concrete200 : PALETTE.concrete500
      px(ctx, 0, 0, w, h, edge)
      px(ctx, 1, 1, w - 2, h - 2, base)
      // woven stitch rows: a dashed line every 3 px, so the rug never reads as
      // a blank slab (the "placeholder block" the review found)
      for (let y = 3; y < h - 2; y += 3) {
        for (let x = 2; x < w - 2; x += 4) px(ctx, x, y, Math.min(2, w - 2 - x), 1, stitch)
      }
      // fringe on the two short ends
      const fringe = 2
      for (let x = 1; x < w - 1; x += 2) {
        px(ctx, x, 0, 1, 1, stitch)
        px(ctx, x, h - 1, 1, 1, stitch)
      }
      px(ctx, 0, fringe, w, 1, edge)
      px(ctx, 0, h - fringe - 1, w, 1, edge)
      return
    }
    case 'chair': {
      // a task chair from above: backrest on the side away from `face`, two
      // armrests, a seat cushion with a lit front edge
      const f = p.face ?? 's'
      const horiz = f === 'n' || f === 's'
      const back = Math.max(2, Math.round((horiz ? h : w) * 0.3))
      const arm = Math.max(1, Math.round((horiz ? w : h) * 0.14))
      px(ctx, 0, 0, w, h, PALETTE.steel700)
      if (horiz) {
        const seatY = f === 's' ? back : 1
        const seatH = Math.max(1, h - back - 1)
        px(ctx, arm, seatY, Math.max(1, w - 2 * arm), seatH, PALETTE.steel500)
        px(ctx, arm, f === 's' ? seatY + seatH - 1 : seatY, Math.max(1, w - 2 * arm), 1, PALETTE.steel300)
        px(ctx, 1, f === 's' ? back - 1 : h - back, Math.max(1, w - 2), 1, PALETTE.steel500)
      } else {
        const seatX = f === 'e' ? back : 1
        const seatW = Math.max(1, w - back - 1)
        px(ctx, seatX, arm, seatW, Math.max(1, h - 2 * arm), PALETTE.steel500)
        px(ctx, f === 'e' ? seatX + seatW - 1 : seatX, arm, 1, Math.max(1, h - 2 * arm), PALETTE.steel300)
        px(ctx, f === 'e' ? back - 1 : w - back, 1, 1, Math.max(1, h - 2), PALETTE.steel500)
      }
      return
    }
    case 'armchair': {
      const arm = Math.max(2, Math.round(Math.min(w, h) * 0.2))
      const back = Math.max(3, Math.round(Math.min(w, h) * 0.26))
      px(ctx, 0, 0, w, h, PALETTE.steel700)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.steel500)
      const f = p.face ?? 's'
      // backrest opposite the face, arms on the two perpendicular sides
      if (f === 'n') {
        px(ctx, 0, h - back, w, back, PALETTE.steel700)
        px(ctx, 0, 1, arm, h - back, PALETTE.steel700)
        px(ctx, w - arm, 1, arm, h - back, PALETTE.steel700)
      } else if (f === 's') {
        px(ctx, 0, 0, w, back, PALETTE.steel700)
        px(ctx, 0, back, arm, h - back, PALETTE.steel700)
        px(ctx, w - arm, back, arm, h - back, PALETTE.steel700)
      } else if (f === 'e') {
        px(ctx, 0, 0, back, h, PALETTE.steel700)
        px(ctx, back, 0, w - back, arm, PALETTE.steel700)
        px(ctx, back, h - arm, w - back, arm, PALETTE.steel700)
      } else {
        px(ctx, w - back, 0, back, h, PALETTE.steel700)
        px(ctx, 0, 0, w - back, arm, PALETTE.steel700)
        px(ctx, 0, h - arm, w - back, arm, PALETTE.steel700)
      }
      // cushion highlight
      px(ctx, arm + 1, arm + 1, Math.max(1, w - 2 * arm - 2), 1, PALETTE.steel300)
      return
    }
    case 'sofa': {
      // backrest on the side away from `face`, arms on the two short sides,
      // two or three cushions with a seam — the silhouette the review missed
      const f = p.face ?? 's'
      const vertical = h > w
      const back = Math.max(3, Math.round((vertical ? w : h) * 0.26))
      const arm = Math.max(3, Math.round((vertical ? h : w) * 0.14))
      px(ctx, 0, 0, w, h, PALETTE.steel700)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.steel500)
      if (vertical) {
        if (f === 'w') px(ctx, w - back, 0, back, h, PALETTE.steel700)
        else px(ctx, 0, 0, back, h, PALETTE.steel700)
        px(ctx, 0, 0, w, arm, PALETTE.steel700)
        px(ctx, 0, h - arm, w, arm, PALETTE.steel700)
        // cushion seams across the seat
        const inner = h - 2 * arm
        const seats = Math.max(2, Math.round(inner / 18))
        for (let i = 1; i < seats; i++) px(ctx, back, arm + Math.round((inner * i) / seats), w - back, 1, PALETTE.steel700)
        px(ctx, f === 'w' ? 1 : back, 1, 1, h - 2, PALETTE.steel300)
      } else {
        if (f === 'n') px(ctx, 0, h - back, w, back, PALETTE.steel700)
        else px(ctx, 0, 0, w, back, PALETTE.steel700)
        px(ctx, 0, 0, arm, h, PALETTE.steel700)
        px(ctx, w - arm, 0, arm, h, PALETTE.steel700)
        const inner = w - 2 * arm
        const seats = Math.max(2, Math.round(inner / 18))
        for (let i = 1; i < seats; i++) px(ctx, arm + Math.round((inner * i) / seats), back, 1, h - back, PALETTE.steel700)
        px(ctx, 1, f === 'n' ? 1 : back, w - 2, 1, PALETTE.steel300)
      }
      return
    }
    case 'coffee-table': {
      px(ctx, 0, 0, w, h, PALETTE.steel700)
      px(ctx, 0, 0, w, h - 1, PALETTE.steel500)
      px(ctx, 1, 1, w - 2, h - 3, PALETTE.concrete200)
      px(ctx, 1, 1, w - 2, 1, PALETTE.concrete100)
      // a magazine and a cup on the top
      px(ctx, 2, 3, Math.max(3, Math.round(w * 0.28)), 3, PALETTE.concrete100)
      px(ctx, w - 5, h - 6, 3, 2, PALETTE.glass500)
      px(ctx, w - 5, h - 6, 3, 1, PALETTE.glass300)
      return
    }
    case 'side-table': {
      px(ctx, 0, 0, w, h, PALETTE.steel500)
      px(ctx, 1, 1, w - 2, h - 2, PALETTE.concrete200)
      px(ctx, 1, 1, w - 2, 1, PALETTE.concrete100)
      return
    }
    case 'bench': {
      const back = Math.max(2, Math.round(h * 0.28))
      px(ctx, 0, 0, w, h, PALETTE.steel700)
      px(ctx, 0, (p.face ?? 'n') === 'n' ? 0 : h - back, w, back, PALETTE.steel700)
      px(ctx, 1, (p.face ?? 'n') === 'n' ? back : 1, w - 2, h - back - 1, PALETTE.steel500)
      px(ctx, 1, (p.face ?? 'n') === 'n' ? back : 1, w - 2, 1, PALETTE.steel300)
      // legs
      px(ctx, 1, h - 1, 2, 1, PALETTE.steel300)
      px(ctx, w - 3, h - 1, 2, 1, PALETTE.steel300)
      return
    }
    case 'stool': {
      const cut = Math.max(1, Math.round(Math.min(w, h) * 0.18))
      px(ctx, cut, 0, w - 2 * cut, h, PALETTE.steel700)
      px(ctx, 0, cut, w, h - 2 * cut, PALETTE.steel700)
      px(ctx, cut, 1, w - 2 * cut, h - 2, PALETTE.steel500)
      px(ctx, 1, cut, w - 2, h - 2 * cut, PALETTE.steel500)
      px(ctx, cut + 1, 2, Math.max(1, w - 2 * cut - 2), 1, PALETTE.steel300)
      return
    }
    case 'plant': {
      const potH = Math.max(3, Math.round(h * 0.34))
      const potY = h - potH
      // pot: steel body, lighter rim
      px(ctx, 2, potY, w - 4, potH, PALETTE.steel700)
      px(ctx, 2, potY, w - 4, 1, PALETTE.steel500)
      px(ctx, 2, h - 1, w - 4, 1, PALETTE.steel500)
      // foliage: a dark mass with lighter clumps, deterministic
      const top = 0
      const fh = potY - 1
      px(ctx, 3, top, w - 6, Math.max(2, fh), PALETTE.foliageDark)
      px(ctx, 1, top + 2, 3, Math.max(1, fh - 3), PALETTE.foliageDark)
      px(ctx, w - 4, top + 2, 3, Math.max(1, fh - 3), PALETTE.foliageDark)
      px(ctx, 3, top + 1, Math.max(1, w - 8), Math.max(1, Math.round(fh * 0.45)), PALETTE.foliage)
      px(ctx, 2, top + 3, 2, 2, PALETTE.foliage)
      px(ctx, w - 5, top + 3, 2, 2, PALETTE.foliage)
      px(ctx, 4, top + 1, 2, 1, PALETTE.foliageLight)
      return
    }
    case 'planter': {
      const vertical = h > w
      px(ctx, 0, 0, w, h, PALETTE.steel700)
      px(ctx, 0, 0, w, 1, PALETTE.steel500)
      px(ctx, 0, h - 1, w, 1, PALETTE.steel500)
      if (vertical) {
        for (let y = 1; y < h - 1; y += 6) {
          px(ctx, 1, y, w - 2, Math.min(4, h - 1 - y), PALETTE.foliageDark)
          px(ctx, 2, y + 1, Math.max(1, w - 4), 2, PALETTE.foliage)
          px(ctx, 2, y + 1, 1, 1, PALETTE.foliageLight)
        }
      } else {
        for (let x = 1; x < w - 1; x += 6) {
          px(ctx, x, 1, Math.min(4, w - 1 - x), h - 2, PALETTE.foliageDark)
          px(ctx, x + 1, 2, 2, Math.max(1, h - 4), PALETTE.foliage)
        }
      }
      return
    }
    case 'floor-lamp': {
      px(ctx, Math.round(w / 2) - 1, 3, 2, h - 4, PALETTE.steel500)
      px(ctx, 1, h - 2, w - 2, 2, PALETTE.steel700)
      px(ctx, 1, 0, w - 2, 3, PALETTE.lamp)
      px(ctx, 1, 2, w - 2, 1, PALETTE.concrete600)
      px(ctx, 1, 0, w - 2, 1, PALETTE.concrete200)
      return
    }
    case 'screen': {
      px(ctx, 0, 0, w, h, PALETTE.concrete900)
      px(ctx, 1, 1, w - 2, h - 3, PALETTE.glass700)
      // a chart on the screen: two bars and a line
      const bar = Math.max(1, Math.round((h - 3) * 0.4))
      px(ctx, 3, h - 2 - bar, 2, bar, PALETTE.glass500)
      px(ctx, 7, h - 2 - Math.max(1, bar - 1), 2, Math.max(1, bar - 1), PALETTE.glass300)
      px(ctx, 11, 2, Math.max(1, w - 14), 1, PALETTE.glass500)
      px(ctx, 1, h - 2, w - 2, 1, PALETTE.steel500)
      return
    }
    case 'dispenser': {
      const bodyY = Math.max(3, Math.round(h * 0.34))
      px(ctx, 0, bodyY, w, h - bodyY, PALETTE.concrete100)
      px(ctx, 0, bodyY, w, 1, PALETTE.concrete200)
      px(ctx, 0, h - 1, w, 1, PALETTE.concrete500)
      // bottle on top
      px(ctx, 2, 0, w - 4, bodyY, PALETTE.glass500)
      px(ctx, 2, 0, w - 4, 1, PALETTE.glass300)
      // taps
      px(ctx, 1, bodyY + 1, 1, 2, PALETTE.steel500)
      px(ctx, w - 2, bodyY + 1, 1, 2, PALETTE.steel500)
      return
    }
    case 'fridge': {
      px(ctx, 0, 0, w, h, PALETTE.concrete100)
      px(ctx, 0, 0, w, 1, PALETTE.concrete200)
      px(ctx, 0, h - 1, w, 1, PALETTE.concrete500)
      // door seam + handle
      px(ctx, 0, Math.round(h * 0.45), w, 1, PALETTE.concrete500)
      px(ctx, w - 3, 2, 1, Math.round(h * 0.3), PALETTE.steel500)
      px(ctx, w - 3, Math.round(h * 0.55), 1, Math.round(h * 0.3), PALETTE.steel500)
      return
    }
    case 'cabinet': {
      px(ctx, 0, 0, w, h, PALETTE.concrete200)
      px(ctx, 0, 0, w, 1, PALETTE.concrete100)
      px(ctx, 0, h - 1, w, 1, PALETTE.steel500)
      px(ctx, Math.round(w / 2), 2, 1, h - 4, PALETTE.concrete500)
      px(ctx, 2, 3, Math.max(1, Math.round(w / 2) - 4), 1, PALETTE.concrete100)
      return
    }
    case 'sideboard': {
      px(ctx, 0, 0, w, h, PALETTE.concrete200)
      px(ctx, 0, 0, w, 1, PALETTE.steel300)
      px(ctx, 0, h - 1, w, 1, PALETTE.steel500)
      for (let x = 1; x < w - 1; x += Math.max(4, Math.round(w / 4))) px(ctx, x, 1, 1, h - 2, PALETTE.concrete500)
      return
    }
    case 'call-panel': {
      px(ctx, 0, 0, w, h, PALETTE.concrete900)
      rim(ctx, w, h, PALETTE.steel500)
      px(ctx, 1, 1, Math.max(1, w - 2), Math.max(1, h - 2), PALETTE.concrete800)
      // the amber call button, the one warm note of the lift lobby
      px(ctx, 1, 2, Math.max(1, w - 2), 2, PALETTE.amber)
      return
    }
  }
}
