import * as THREE from 'three'

/**
 * Labels (nameplates, wall signs, board titles) are drawn to a 2D canvas and
 * used as sprite textures. That keeps text crisp at any distance and avoids a
 * font fetch — the office must render identically offline.
 */
export interface LabelSpec {
  text: string
  sub?: string
  color?: string
  subColor?: string
  bg?: string
  border?: string
  bar?: string
  px?: number
  /**
   * Cap the width/height ratio of the plate. Long names and long subtitles
   * (blocked reasons, tool lists) otherwise grow the sprite without limit and
   * the plate runs off the frame — which reads as a cut-off nameplate. When a
   * plate would exceed the cap the type is stepped down first; only the
   * *subtitle* is ever ellipsized, never the name.
   */
  maxAspect?: number
}

interface Plate {
  cw: number
  ch: number
  padX: number
  padY: number
  barW: number
  px: number
  subPx: number
  text: string
  textW: number
  subW: number
  textAsc: number
  textDesc: number
  subAsc: number
  subDesc: number
  subText: string
  gap: number
}

const cache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>()

const FONT = (px: number) =>
  `600 ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
const SUB_FONT = (px: number) => `500 ${px}px ui-sans-serif, system-ui, sans-serif`

function measure(ctx: CanvasRenderingContext2D, text: string, px: number, sub: boolean) {
  ctx.font = sub ? SUB_FONT(px) : FONT(px)
  const m = ctx.measureText(text)
  return {
    w: Math.ceil(m.width),
    asc: Math.ceil(m.actualBoundingBoxAscent || px * 0.75),
    desc: Math.ceil(m.actualBoundingBoxDescent || px * 0.25),
  }
}

/** Lay one plate out at a given type size; ink metrics decide the box. */
function layout(ctx: CanvasRenderingContext2D, spec: LabelSpec, px: number): Plate {
  const padX = Math.round(px * 0.45)
  const padY = Math.round(px * 0.34)
  const subPx = Math.round(px * 0.42)
  const gap = Math.round(px * 0.14)
  const barW = spec.bar ? Math.round(px * 0.16) : 0
  const main = measure(ctx, spec.text, px, false)
  const sub = spec.sub ? measure(ctx, spec.sub, subPx, true) : null
  const cw = Math.max(main.w, sub?.w ?? 0) + padX * 2 + barW
  const ch = padY * 2 + main.asc + main.desc + (sub ? gap + sub.asc + sub.desc : 0)
  return {
    cw,
    ch,
    padX,
    padY,
    barW,
    px,
    subPx,
    text: spec.text,
    textW: main.w,
    subW: sub?.w ?? 0,
    textAsc: main.asc,
    textDesc: main.desc,
    subAsc: sub?.asc ?? 0,
    subDesc: sub?.desc ?? 0,
    subText: spec.sub ?? '',
    gap,
  }
}

/** Trim the subtitle (never the name) until the plate fits the aspect cap. */
function fitSub(ctx: CanvasRenderingContext2D, plate: Plate, maxAspect: number): Plate {
  if (!plate.subText) return plate
  const limit = Math.max(24, maxAspect * plate.ch - plate.padX * 2 - plate.barW)
  const s = trimTo(ctx, plate.subText, plate.subPx, limit, true)
  if (s === plate.subText) return plate
  return { ...plate, subText: s, subW: measure(ctx, s, plate.subPx, true).w }
}

/** Last resort for a very long *name*: shorten it deliberately, with an ellipsis. */
function fitName(ctx: CanvasRenderingContext2D, plate: Plate, maxAspect: number): Plate {
  const limit = Math.max(24, maxAspect * plate.ch - plate.padX * 2 - plate.barW)
  if (plate.textW <= limit) return plate
  const s = trimTo(ctx, plate.text, plate.px, limit, false)
  return { ...plate, text: s, textW: measure(ctx, s, plate.px, false).w }
}

function trimTo(
  ctx: CanvasRenderingContext2D,
  text: string,
  px: number,
  limit: number,
  sub: boolean,
): string {
  if (measure(ctx, text, px, sub).w <= limit) return text
  let s = text
  while (s.length > 1 && measure(ctx, `${s}…`, px, sub).w > limit) s = s.slice(0, -1)
  return `${s.replace(/[\s·,;:-]+$/, '')}…`
}

export function labelTexture(spec: LabelSpec): { tex: THREE.CanvasTexture; aspect: number } {
  const key = JSON.stringify(spec)
  const hit = cache.get(key)
  if (hit) return hit

  const measureCtx = document.createElement('canvas').getContext('2d')!
  const maxAspect = spec.maxAspect ?? Infinity

  let plate = layout(measureCtx, spec, spec.px ?? 58)
  // Trim the subtitle first (blocked reasons are long and expendable), then the
  // name only if it alone still overflows the cap.
  plate = fitSub(measureCtx, plate, maxAspect)
  plate = fitName(measureCtx, plate, maxAspect)

  const { cw, ch } = plate
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, cw, ch)

  if (spec.bg) {
    const r = Math.round(plate.px * 0.28)
    ctx.fillStyle = spec.bg
    roundRect(ctx, 0, 0, cw, ch, r)
    ctx.fill()
  }
  if (spec.border) {
    const r = Math.round(plate.px * 0.28)
    ctx.strokeStyle = spec.border
    ctx.lineWidth = Math.max(2, plate.px * 0.05)
    roundRect(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, cw - ctx.lineWidth, ch - ctx.lineWidth, r)
    ctx.stroke()
  }
  if (spec.bar) {
    ctx.fillStyle = spec.bar
    roundRect(ctx, plate.padX * 0.3, plate.padY * 0.7, plate.barW, ch - plate.padY * 1.4, plate.barW / 2)
    ctx.fill()
  }

  // Baseline from the measured ascent, so descenders (the "g" in Kakung, the
  // "y" in Wahyu) always land inside the canvas instead of on its edge.
  const x = plate.padX + plate.barW
  const baseY = plate.padY + plate.textAsc
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = spec.color ?? '#f6efe3'
  ctx.font = FONT(plate.px)
  ctx.fillText(plate.text, x, baseY)

  if (spec.sub) {
    ctx.fillStyle = spec.subColor ?? 'rgba(246,239,227,0.62)'
    ctx.font = SUB_FONT(plate.subPx)
    ctx.fillText(plate.subText, x, baseY + plate.textDesc + plate.gap + plate.subAsc)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  const out = { tex, aspect: cw / ch }
  cache.set(key, out)
  return out
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Wooden/gradient backing plate for wall boards. */
export function boardTexture(sub: string, accent = '#c9a06a'): { tex: THREE.CanvasTexture; aspect: number } {
  return labelTexture({
    text: sub,
    color: '#f3e7d2',
    bg: 'rgba(38,27,21,0.92)',
    border: accent,
    px: 44,
  })
}
