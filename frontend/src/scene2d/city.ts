/**
 * The city seen through the curtain wall: one procedural sheet, no tiles and
 * no seam. It is drawn once per (floor × theme) into the static layer and then
 * blitted — never re-generated per frame.
 *
 * Three depth layers (far / mid / near) follow aerial perspective: the far
 * layer is palest and lowest, the near layer darkest and tallest. Windows are
 * texture, not focus: small, alpha-limited, and always under a veil (22 % at
 * night, 8 % by day) so they never compete with the status dots.
 */
import { THEME_TOKENS, type ThemeName } from './palette'

/** Deterministic PRNG — same floor + theme, same skyline. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function citySize(): { w: number; h: number } {
  return { w: 1000, h: 485 }
}

/** Paint the skyline into a context whose origin is the top of the glass. */
export function drawCity(
  ctx: CanvasRenderingContext2D,
  theme: ThemeName,
  floor: 1 | 2 | 3,
  w = 1000,
  h = 485,
): void {
  const t = THEME_TOKENS[theme].city
  const rand = rng(0x9e3779b9 ^ (floor * 7919))

  // ---- sky: four stops, horizon warm at night
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, t.skyTop)
  sky.addColorStop(0.42, t.skyMid)
  sky.addColorStop(0.78, t.skyLow)
  sky.addColorStop(1, t.horizon)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // ---- sun / moon
  if (theme === 'day') {
    const sx = w * 0.72
    const sy = h * 0.2
    const halo = ctx.createRadialGradient(sx, sy, 2, sx, sy, 92)
    halo.addColorStop(0, 'rgba(255,255,255,0.95)')
    halo.addColorStop(0.35, 'rgba(255,255,255,0.35)')
    halo.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(sx, sy, 92, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.arc(sx, sy, 13, 0, Math.PI * 2)
    ctx.fill()
  } else {
    const mx = w * 0.78
    const my = h * 0.16
    const halo = ctx.createRadialGradient(mx, my, 2, mx, my, 66)
    halo.addColorStop(0, 'rgba(243,197,123,0.34)')
    halo.addColorStop(1, 'rgba(243,197,123,0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(mx, my, 66, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#F5E7C6'
    ctx.beginPath()
    ctx.arc(mx, my, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = t.skyMid
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.arc(mx + 4, my - 3, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // ---- three building layers, far → near
  const layers = [t.layers[0]!, t.layers[1]!, t.layers[2]!]
  const baseY = h * 0.98
  for (let li = 0; li < layers.length; li++) {
    const colour = layers[li]!
    const minH = h * (0.2 + li * 0.08)
    const maxH = h * (0.46 + li * 0.13)
    let x = -40 - li * 30
    while (x < w + 40) {
      const bw = 34 + rand() * (86 - li * 10)
      const bh = minH + rand() * (maxH - minH)
      const y = baseY - bh
      ctx.fillStyle = colour
      ctx.fillRect(x, y, bw, bh)
      // a lit roof edge on the near layer
      if (li === 2) {
        ctx.fillStyle = theme === 'day' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.12)'
        ctx.fillRect(x, y, bw, 1)
      }

      // windows: 2–3 px, alpha-limited texture
      const cols = Math.max(2, Math.floor((bw - 8) / 7))
      const rows = Math.max(3, Math.floor((bh - 10) / 9))
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const lit = rand()
          const wx = x + 4 + c * ((bw - 8) / cols)
          const wy = y + 6 + r * ((bh - 10) / rows)
          if (theme === 'day') {
            // daytime windows are reflections, not lamps
            ctx.fillStyle = lit > 0.55 ? t.windowWarm : t.windowCool
            ctx.globalAlpha = 0.18 + lit * 0.28
          } else {
            if (lit < 0.34) continue
            ctx.fillStyle = lit > 0.62 ? t.windowWarm : t.windowCool
            ctx.globalAlpha = 0.32 + lit * 0.32
          }
          ctx.fillRect(wx, wy, 2.2, 3.0)
          ctx.globalAlpha = 1
        }
      }
      x += bw + 3 + rand() * 7
    }
  }

  // ---- street haze at the sill
  const haze = ctx.createLinearGradient(0, h - 46, 0, h)
  const hazeAlpha = theme === 'day' ? 0.08 : 0.22
  haze.addColorStop(0, `rgba(255,255,255,0)`)
  haze.addColorStop(1, theme === 'day' ? `rgba(240,249,255,${hazeAlpha + 0.1})` : `rgba(224,160,106,${hazeAlpha})`)
  ctx.fillStyle = haze
  ctx.fillRect(0, h - 46, w, 46)

  // ---- veil: the whole skyline sits under it
  ctx.fillStyle = theme === 'day' ? `rgba(238,243,248,${hazeAlpha})` : `rgba(8,12,22,${hazeAlpha})`
  ctx.fillRect(0, 0, w, h)
}

/** A ready offscreen city sheet (used by the static-layer builder). */
export function createCityCanvas(theme: ThemeName, floor: 1 | 2 | 3): HTMLCanvasElement {
  const { w, h } = citySize()
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) drawCity(ctx, theme, floor, w, h)
  return canvas
}
