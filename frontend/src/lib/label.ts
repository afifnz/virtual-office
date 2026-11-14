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
}

const cache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>()

export function labelTexture(spec: LabelSpec): { tex: THREE.CanvasTexture; aspect: number } {
  const key = JSON.stringify(spec)
  const hit = cache.get(key)
  if (hit) return hit

  const px = spec.px ?? 58
  const padX = Math.round(px * 0.45)
  const padY = Math.round(px * 0.32)
  const subPx = Math.round(px * 0.42)

  const measure = document.createElement('canvas').getContext('2d')!
  const font = `600 ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
  measure.font = font
  const textW = Math.ceil(measure.measureText(spec.text).width)
  let subW = 0
  if (spec.sub) {
    measure.font = `500 ${subPx}px ui-sans-serif, system-ui, sans-serif`
    subW = Math.ceil(measure.measureText(spec.sub).width)
  }
  const contentW = Math.max(textW, subW)
  const barW = spec.bar ? Math.round(px * 0.16) : 0

  const cw = contentW + padX * 2 + barW
  const ch = spec.sub ? padY * 2 + px + subPx + Math.round(px * 0.18) : padY * 2 + px

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, cw, ch)

  if (spec.bg) {
    const r = Math.round(px * 0.28)
    ctx.fillStyle = spec.bg
    roundRect(ctx, 0, 0, cw, ch, r)
    ctx.fill()
  }
  if (spec.border) {
    const r = Math.round(px * 0.28)
    ctx.strokeStyle = spec.border
    ctx.lineWidth = Math.max(2, px * 0.05)
    roundRect(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, cw - ctx.lineWidth, ch - ctx.lineWidth, r)
    ctx.stroke()
  }
  if (spec.bar) {
    ctx.fillStyle = spec.bar
    roundRect(ctx, padX * 0.3, padY * 0.7, barW, ch - padY * 1.4, barW / 2)
    ctx.fill()
  }

  ctx.textBaseline = 'top'
  ctx.fillStyle = spec.color ?? '#f6efe3'
  ctx.font = font
  ctx.fillText(spec.text, padX + barW, padY)

  if (spec.sub) {
    ctx.fillStyle = spec.subColor ?? 'rgba(246,239,227,0.62)'
    ctx.font = `500 ${subPx}px ui-sans-serif, system-ui, sans-serif`
    ctx.fillText(spec.sub, padX + barW, padY + px + Math.round(px * 0.16))
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
