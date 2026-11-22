/**
 * Props for the side view, all drawn in design px (the 1000×688 stage).
 *
 * Every object carries a contact shadow — nothing floats. Desks are three
 * layers + two legs, monitors stand on a foot + neck and face the agent,
 * chairs have a backrest, gas column and a 5-star base with casters, and the
 * glass panels use the alpha recipe from design §5.2 (never `backdrop-filter`
 * inside the render loop).
 */
import { drawText } from './pixelfont'
import { THEME_STATUS, THEME_TOKENS, type ThemeName } from './palette'
import { shade } from './avatar'
import { SIDE_BOARDS, SIDE_BOARD_TOP, SIDE_GLASS_BOTTOM, SIDE_GLASS_TOP, SIDE_LIFT, SIDE_RAIL_H, SIDE_RAIL_TOP, type SideBoard } from './side'

type Ctx = CanvasRenderingContext2D

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + k, y)
  ctx.lineTo(x + w - k, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + k)
  ctx.lineTo(x + w, y + h - k)
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h)
  ctx.lineTo(x + k, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - k)
  ctx.lineTo(x, y + k)
  ctx.quadraticCurveTo(x, y, x + k, y)
  ctx.closePath()
}

function softShadow(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha: number, _blur = 3): void {
  // A radial gradient, not ctx.filter: blur inside the render loop is exactly
  // what the design forbids (Safari < 18 silently ignores the filter too).
  const r = Math.max(1, rx)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  g.addColorStop(0, `rgba(0,0,0,${alpha})`)
  g.addColorStop(0.55, `rgba(0,0,0,${alpha * 0.55})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1, Math.max(0.08, ry / r))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function label(ctx: Ctx, text: string, x: number, y: number, size: number, colour: string, weight = 600, tracking = 0.08): void {
  ctx.save()
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.fillStyle = colour
  ctx.textBaseline = 'top'
  if (tracking) {
    // manual tracking keeps the 8 % label look without relying on CSS
    let cx = x
    for (const ch of text) {
      ctx.fillText(ch, cx, y)
      cx += ctx.measureText(ch).width + tracking * size
    }
  } else {
    ctx.fillText(text, x, y)
  }
  ctx.restore()
}

/**
 * A hanging board. Opaque by design: the skyline is painted first and must never
 * show through a card, so the fill is `surfaceSolid` at alpha 1 (never
 * `surfaceGlass`) and a 4 % noise grid breaks the flat tone the way paper does.
 * `verify/render_check.ts` asserts the backdrop is opaque and that nothing
 * translucent is painted over it afterwards.
 */
function card(ctx: Ctx, theme: ThemeName, x: number, y: number, w: number, h: number): void {
  const t = THEME_TOKENS[theme]
  ctx.save()
  ctx.fillStyle = t.surfaceSolid
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.18)' : 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 1
  rr(ctx, x, y, w, h, 8)
  ctx.fill()
  ctx.stroke()
  // paper grain: deterministic 1 px dots, inside the card only
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.035)' : 'rgba(255,255,255,0.04)'
  for (let gy = y + 5; gy < y + h - 4; gy += 5) {
    for (let gx = x + 4 + ((gy * 3) % 7); gx < x + w - 4; gx += 6) ctx.fillRect(gx, gy, 1, 1)
  }
  ctx.fillStyle = theme === 'day' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.08)'
  ctx.fillRect(x + 6, y + 1, w - 12, 1)
  ctx.restore()
}

// ------------------------------------------------------------------- desk

/** Desk in profile. Returns the y of the top surface (for keyboard/hands). */
export function drawDesk(ctx: Ctx, theme: ThemeName, cx: number, floorY: number, scale = 1): number {
  const t = THEME_TOKENS[theme]
  const w = 128 * scale
  const top = floorY - 58 * scale
  const slab = 6 * scale
  const x = cx - w / 2

  // falling shadow on the floor
  softShadow(ctx, cx, floorY + 1 * scale, w * 0.46, 4.5 * scale, theme === 'day' ? 0.17 : 0.23, 3 * scale)

  // legs / side panels
  const legW = 5 * scale
  const legTop = top + slab + 9 * scale
  for (const side of [-1, 1]) {
    const lx = cx + side * (w / 2 - 6 * scale) - legW / 2
    ctx.fillStyle = shade(t.desk, 0.7)
    ctx.fillRect(lx, legTop, legW, floorY - legTop)
    ctx.strokeStyle = shade(t.desk, 0.52)
    ctx.lineWidth = 0.3 * scale
    ctx.strokeRect(lx, legTop, legW, floorY - legTop)
    ctx.fillStyle = shade(t.desk, 0.92)
    ctx.fillRect(lx + 0.6 * scale, legTop, 0.8 * scale, floorY - legTop)
    // foot pad + AO
    ctx.fillStyle = shade(t.desk, 0.55)
    rr(ctx, lx - 1.2 * scale, floorY - 2.2 * scale, legW + 2.4 * scale, 2.2 * scale, 1 * scale)
    ctx.fill()
    softShadow(ctx, lx + legW / 2, floorY, 4 * scale, 1.4 * scale, theme === 'day' ? 0.38 : 0.44, 1 * scale)
  }

  // apron
  ctx.fillStyle = shade(t.desk, 0.76)
  ctx.fillRect(x + 5 * scale, top + slab, w - 10 * scale, 9 * scale)
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.fillRect(x + 5 * scale, top + slab, w - 10 * scale, 1.4 * scale)

  // slab
  ctx.fillStyle = t.desk
  rr(ctx, x, top, w, slab, 1.6 * scale)
  ctx.fill()
  // front edge one tone darker
  ctx.fillStyle = shade(t.desk, 0.84)
  ctx.fillRect(x, top + slab - 2.2 * scale, w, 2.2 * scale)
  // top lip: a tint, not a lighter white (white would vanish in day mode)
  ctx.fillStyle = theme === 'day' ? '#F2F6FA' : shade(t.deskTop, 0.92)
  ctx.fillRect(x + 1, top, w - 2, 2.1 * scale)
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.16)' : 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 0.6
  rr(ctx, x, top, w, slab, 1.6 * scale)
  ctx.stroke()
  return top
}

export function drawChair(ctx: Ctx, theme: ThemeName, cx: number, floorY: number, scale = 1, taken = true): void {
  const t = THEME_TOKENS[theme]
  const backColour = theme === 'day' ? '#D3DCE7' : '#2B3446'
  const seatColour = theme === 'day' ? '#C6D1DE' : '#242C3B'
  softShadow(ctx, cx, floorY + 0.5 * scale, 10.6 * scale, 3.2 * scale, theme === 'day' ? 0.28 : 0.34, 2 * scale)
  // backrest (drawn before the agent)
  ctx.fillStyle = backColour
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.22)' : 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  rr(ctx, cx - 37 * scale, floorY - 84 * scale, 74 * scale, 44 * scale, 10 * scale)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = theme === 'day' ? '#E4EBF3' : '#333D51'
  rr(ctx, cx - 33 * scale, floorY - 80 * scale, 66 * scale, 34 * scale, 8 * scale)
  ctx.fill()
  // rim light
  ctx.fillStyle = theme === 'day' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.16)'
  ctx.fillRect(cx - 28 * scale, floorY - 79 * scale, 56 * scale, 1.4 * scale)
  // seat
  ctx.fillStyle = seatColour
  rr(ctx, cx - 22 * scale, floorY - 36 * scale, 44 * scale, 6 * scale, 3 * scale)
  ctx.fill()
  if (!taken) {
    ctx.globalAlpha = 0.5
    ctx.fillStyle = t.muted
    rr(ctx, cx - 18 * scale, floorY - 33 * scale, 36 * scale, 2 * scale, 1 * scale)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  // gas column
  ctx.fillStyle = '#6B7482'
  ctx.fillRect(cx - 2 * scale, floorY - 31 * scale, 4 * scale, 22 * scale)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(cx - 1.4 * scale, floorY - 30 * scale, 1 * scale, 20 * scale)
  // 5-star base: four legs visible in elevation
  ctx.strokeStyle = '#59616E'
  ctx.lineWidth = 1.1 * scale
  const R = 26 * scale
  for (const k of [-0.96, -0.58, 0.58, 0.96]) {
    ctx.beginPath()
    ctx.moveTo(cx, floorY - 10 * scale)
    ctx.lineTo(cx + k * R, floorY - 4 * scale)
    ctx.stroke()
    // caster
    ctx.fillStyle = '#8B929E'
    ctx.beginPath()
    ctx.arc(cx + k * R, floorY - 3.6 * scale, 4 * scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#4C535E'
    ctx.lineWidth = 0.8 * scale
    ctx.stroke()
    ctx.strokeStyle = '#59616E'
    ctx.lineWidth = 1.1 * scale
  }
}

export function drawKeyboardMouse(ctx: Ctx, theme: ThemeName, cx: number, deskTop: number, scale = 1): void {
  const t = THEME_TOKENS[theme]
  // keyboard shadow + body
  softShadow(ctx, cx, deskTop + 1 * scale, 20 * scale, 1.4 * scale, theme === 'day' ? 0.3 : 0.36, 1.2 * scale)
  ctx.fillStyle = theme === 'day' ? '#C9D3DF' : '#2A3242'
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.35)' : 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 0.8
  rr(ctx, cx - 19 * scale, deskTop - 7 * scale, 38 * scale, 7 * scale, 1.4 * scale)
  ctx.fill()
  ctx.stroke()
  // key rows: dark caps so the keyboard reads at 150 px, plus a spacebar
  ctx.fillStyle = theme === 'day' ? '#7E8FA3' : '#4A5568'
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 9; c++) {
      ctx.fillRect(cx - 17 * scale + c * 4 * scale, deskTop - 6 * scale + r * 1.6 * scale, 3 * scale, 1.0 * scale)
    }
  }
  ctx.fillStyle = theme === 'day' ? '#6E7F93' : '#566176'
  ctx.fillRect(cx - 8 * scale, deskTop - 1.5 * scale, 16 * scale, 1.1 * scale)
  // mouse
  softShadow(ctx, cx + 27 * scale, deskTop + 1 * scale, 4.4 * scale, 1.8 * scale, theme === 'day' ? 0.2 : 0.3, 0.9 * scale)
  ctx.fillStyle = theme === 'day' ? '#D7DFE9' : '#313A4B'
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.22)' : 'rgba(255,255,255,0.16)'
  rr(ctx, cx + 22 * scale, deskTop - 9 * scale, 11 * scale, 9 * scale, 5 * scale)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = t.muted
  ctx.fillRect(cx + 27 * scale, deskTop - 8 * scale, 1 * scale, 3 * scale)
}

export function drawMonitor(
  ctx: Ctx,
  theme: ThemeName,
  cx: number,
  floorY: number,
  scale = 1,
  status: keyof typeof THEME_STATUS.day = 'idle',
  screen: 'terminal' | 'doc' | 'diff' | 'off' = 'terminal',
): void {
  const top = floorY - 58 * scale
  const mx = cx + 46 * scale
  // contact shadow on the desk
  softShadow(ctx, mx, top + 0.6 * scale, 10 * scale, 1.9 * scale, theme === 'day' ? 0.34 : 0.38, 1.1 * scale)
  // foot 27×3.3
  ctx.fillStyle = '#4C5563'
  rr(ctx, mx - 13.5 * scale, top - 3.3 * scale, 27 * scale, 3.3 * scale, 1.2 * scale)
  ctx.fill()
  ctx.fillStyle = '#7B8492'
  ctx.fillRect(mx - 12 * scale, top - 3.1 * scale, 24 * scale, 0.9 * scale)
  // neck 6×8.3
  ctx.fillStyle = '#4C5563'
  ctx.fillRect(mx - 3 * scale, top - 11.3 * scale, 6 * scale, 8.3 * scale)
  ctx.fillStyle = '#8D95A2'
  ctx.fillRect(mx - 2.6 * scale, top - 11 * scale, 0.8 * scale, 7.6 * scale)
  // panel 38×23, a parallelogram leaning towards the agent (left edge nearer)
  const pw = 38 * scale
  const ph = 23 * scale
  const px = mx - pw / 2
  const py = top - 11.3 * scale - ph
  const lean = 2.2 * scale
  ctx.beginPath()
  ctx.moveTo(px + lean, py)
  ctx.lineTo(px + pw, py + 1.5 * scale)
  ctx.lineTo(px + pw, py + ph)
  ctx.lineTo(px, py + ph - 1.2 * scale)
  ctx.closePath()
  ctx.fillStyle = theme === 'day' ? '#E4EAF2' : '#1D2534'
  ctx.fill()
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.28)' : 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1.2
  ctx.stroke()
  // screen
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(px + lean + 2, py + 2)
  ctx.lineTo(px + pw - 2, py + 3.2 * scale)
  ctx.lineTo(px + pw - 2, py + ph - 2.4 * scale)
  ctx.lineTo(px + 2, py + ph - 3.4 * scale)
  ctx.closePath()
  ctx.fillStyle = screen === 'off' ? '#0B1119' : theme === 'day' ? '#132033' : '#0B1119'
  ctx.fill()
  ctx.clip()
  if (screen !== 'off') {
    const accent = THEME_STATUS[theme][status]
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i === 1 ? accent : theme === 'day' ? '#8FB8E8' : '#7F9CC0'
      ctx.globalAlpha = i === 1 ? 0.85 : 0.55
      ctx.fillRect(px + 5, py + 5 + i * 4.4 * scale, (pw - 14) * (0.55 + 0.35 * (i % 2)), 1.6 * scale)
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = accent
    ctx.fillRect(px + pw - 6, py + ph - 6, 1.4, 1.4)
  }
  ctx.restore()
}

// ------------------------------------------------------------------- props

export function drawPlant(ctx: Ctx, theme: ThemeName, cx: number, floorY: number, scale = 1): void {
  const t = THEME_TOKENS[theme]
  softShadow(ctx, cx, floorY, 14 * scale, 3.4 * scale, theme === 'day' ? 0.2 : 0.3, 2 * scale)
  ctx.fillStyle = theme === 'day' ? '#B9C4D1' : '#3A4456'
  ctx.beginPath()
  ctx.moveTo(cx - 10 * scale, floorY)
  ctx.lineTo(cx + 10 * scale, floorY)
  ctx.lineTo(cx + 7 * scale, floorY - 17 * scale)
  ctx.lineTo(cx - 7 * scale, floorY - 17 * scale)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = theme === 'day' ? '#D5DEE8' : '#4B566B'
  ctx.fillRect(cx - 11 * scale, floorY - 18 * scale, 22 * scale, 2.4 * scale)
  for (const [dx, dy, r] of [
    [-5, -28, 8],
    [4, -32, 9],
    [0, -40, 7],
  ] as const) {
    ctx.fillStyle = t.plant
    ctx.beginPath()
    ctx.ellipse(cx + dx * scale, floorY + dy * scale, r * scale, r * 0.8 * scale, dx * 0.1, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = t.plantDark
    ctx.beginPath()
    ctx.ellipse(cx + dx * scale + 2 * scale, floorY + (dy + 2) * scale, r * 0.55 * scale, r * 0.45 * scale, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function drawBookshelf(ctx: Ctx, theme: ThemeName, cx: number, floorY: number, scale = 1): void {
  const w = 84 * scale
  const h = 96 * scale
  const x = cx - w / 2
  const y = floorY - h
  softShadow(ctx, cx, floorY, w * 0.5, 3 * scale, theme === 'day' ? 0.2 : 0.3, 2 * scale)
  ctx.fillStyle = theme === 'day' ? '#C9D4E1' : '#2C3648'
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.25)' : 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 1
  rr(ctx, x, y, w, h, 3)
  ctx.fill()
  ctx.stroke()
  // shelves
  for (let s = 0; s < 3; s++) {
    const sy = y + 6 + s * 29 * scale
    ctx.fillStyle = theme === 'day' ? '#AEBBCB' : '#3B465A'
    ctx.fillRect(x + 4, sy + 24 * scale, w - 8, 2 * scale)
    // book spines
    let bx = x + 7
    const colours = ['#4B9B6A', '#3B7DD8', '#C2543F', '#D98B3A', '#8B5CF6', '#4B5563']
    let i = 0
    while (bx < x + w - 8) {
      const bw = 4 + ((i * 7 + s * 3) % 4)
      ctx.fillStyle = colours[(i + s) % colours.length]!
      ctx.fillRect(bx, sy + (24 - (14 + ((i * 5) % 8))) * scale, bw * scale, (14 + ((i * 5) % 8)) * scale)
      bx += (bw + 1.4) * scale
      i++
    }
  }
}

export function drawServerRack(ctx: Ctx, theme: ThemeName, cx: number, floorY: number, scale = 1): void {
  const w = 48 * scale
  const h = 132 * scale
  const x = cx - w / 2
  const y = floorY - h
  softShadow(ctx, cx, floorY, w * 0.55, 3 * scale, theme === 'day' ? 0.22 : 0.3, 2 * scale)
  ctx.fillStyle = theme === 'day' ? '#DCE4EE' : '#202A3A'
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.25)' : 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 1
  rr(ctx, x, y, w, h, 4)
  ctx.fill()
  ctx.stroke()
  for (let r = 0; r < 8; r++) {
    const ry = y + 8 + r * 15 * scale
    ctx.fillStyle = theme === 'day' ? '#C6D1DE' : '#2C374A'
    ctx.fillRect(x + 4, ry, w - 8, 11 * scale)
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r + c) % 5 === 0 ? THEME_STATUS[theme].danger : THEME_STATUS[theme].ok
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(x + 10 + c * 9 * scale, ry + 5.5 * scale, 1.8 * scale, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }
}

// ------------------------------------------------------------------ boards

/** Six boards hanging on one rail in front of the glass (y 132–280). */
export function drawBoards(
  ctx: Ctx,
  theme: ThemeName,
  floor: 1 | 2 | 3,
  tzName = 'WIB',
  compact = false,
  boards: readonly SideBoard[] = SIDE_BOARDS,
): void {
  const t = THEME_TOKENS[theme]
  if (compact) {
    drawCompactBoards(ctx, theme, floor, tzName, boards)
    return
  }
  // rail + brackets
  ctx.fillStyle = theme === 'day' ? '#B9C5D3' : '#3A4557'
  ctx.fillRect(0, SIDE_RAIL_TOP, 1000, 3)
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.2)' : 'rgba(255,255,255,0.14)'
  for (let x = 24; x < 1000; x += 160) ctx.fillRect(x, SIDE_RAIL_TOP + 3, 3, SIDE_RAIL_H - 3)

  for (const b of SIDE_BOARDS) {
    card(ctx, theme, b.x, SIDE_BOARD_TOP, b.w, b.h)
  }

  // 1. zone plaque — the ONLY pixel-font surface besides the lift numbers
  const p = SIDE_BOARDS[0]!
  const team = floor === 1 ? 'LOBBY' : floor === 2 ? 'TIM EDU' : 'TIM DEV'
  drawText(ctx, `L${floor}`, p.x + 12, SIDE_BOARD_TOP + 14, 4, t.accent)
  label(ctx, team, p.x + 12, SIDE_BOARD_TOP + 52, 9, t.ink, 700)
  label(ctx, 'ZONA', p.x + 12, SIDE_BOARD_TOP + 68, 7.5, t.muted, 600)
  ctx.fillStyle = t.accent
  ctx.fillRect(p.x + 12, SIDE_BOARD_TOP + 82, 40, 3)
  label(ctx, 'LANTAI ' + floor, p.x + 12, SIDE_BOARD_TOP + 100, 8.5, t.inkDim, 500, 0)
  label(ctx, 'potongan · 8 unit', p.x + 12, SIDE_BOARD_TOP + 116, 7, t.muted, 500, 0)

  // 2. status board — title only; dots are live (drawStatusBoard)
  const s = SIDE_BOARDS[1]!
  label(ctx, 'PAPAN STATUS', s.x + 10, SIDE_BOARD_TOP + 9, 8, t.muted, 600)
  // "online" (hadir), never "aktif": the legend below already counts *active*
  // work (bekerja/review/idle/terblokir), so the two words must not collide.
  label(ctx, 'online', s.x + 78, SIDE_BOARD_TOP + 34, 8, t.muted, 500, 0)

  // 3. pinboard: 3×3 sticky notes
  const pin = SIDE_BOARDS[2]!
  label(ctx, 'PINBOARD', pin.x + 10, SIDE_BOARD_TOP + 9, 8, t.muted, 600)
  const sticky = ['#F6E27A', '#F4B8B8', '#B9E2AE', '#A9CDEA']
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const nx = pin.x + 10 + c * 51
      const ny = SIDE_BOARD_TOP + 26 + r * 38
      ctx.fillStyle = sticky[(r + c) % sticky.length]!
      ctx.fillRect(nx, ny, 44, 32)
      ctx.fillStyle = 'rgba(0,0,0,0.16)'
      ctx.fillRect(nx, ny + 31, 44, 1)
      ctx.fillStyle = 'rgba(20,30,45,0.32)'
      for (let l = 0; l < 3; l++) ctx.fillRect(nx + 4, ny + 7 + l * 7, 30 - l * 4, 1)
    }
  }

  // 4. burndown
  const bd = SIDE_BOARDS[3]!
  label(ctx, 'BURNDOWN', bd.x + 10, SIDE_BOARD_TOP + 9, 8, t.muted, 600)
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.16)' : 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 1
  ctx.strokeRect(bd.x + 12, SIDE_BOARD_TOP + 30, bd.w - 24, 92)
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.08)' : 'rgba(255,255,255,0.07)'
  for (let i = 1; i < 4; i++) {
    const gy = SIDE_BOARD_TOP + 30 + (92 * i) / 4
    ctx.beginPath(); ctx.moveTo(bd.x + 12, gy); ctx.lineTo(bd.x + bd.w - 12, gy); ctx.stroke()
  }
  ctx.strokeStyle = t.accent
  ctx.lineWidth = 2
  ctx.beginPath()
  const pts = [
    [0, 0.08],
    [0.25, 0.24],
    [0.5, 0.44],
    [0.75, 0.66],
    [1, 0.9],
  ] as const
  for (let i = 0; i < pts.length; i++) {
    const px = bd.x + 14 + pts[i]![0] * (bd.w - 28)
    const py = SIDE_BOARD_TOP + 32 + pts[i]![1] * 84
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
  ctx.fillStyle = t.accent
  for (const [x, y] of pts) ctx.fillRect(bd.x + 12 + x * (bd.w - 24) - 1.5, SIDE_BOARD_TOP + 32 + y * 84 - 1.5, 3, 3)

  // 5. architecture
  const ar = SIDE_BOARDS[4]!
  label(ctx, 'ARSITEKTUR', ar.x + 10, SIDE_BOARD_TOP + 9, 8, t.muted, 600)
  ctx.fillStyle = t.accent
  rr(ctx, ar.x + ar.w - 44, SIDE_BOARD_TOP + 8, 34, 12, 3)
  ctx.fill()
  label(ctx, 'WIP 3', ar.x + ar.w - 40, SIDE_BOARD_TOP + 10, 6.5, t.accentInk, 700, 0.04)
  const nodes: Array<[string, number, number]> = [
    ['L1', 12, 34],
    ['L2', 66, 34],
    ['L3', 12, 78],
    ['API', 96, 78],
  ]
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.3)' : 'rgba(255,255,255,0.24)'
  ctx.lineWidth = 1
  for (const [x1, y1, x2, y2] of [
    [38, 42, 66, 42],
    [78, 46, 96, 78],
    [38, 86, 96, 86],
    [38, 42, 38, 78],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(ar.x + x1, SIDE_BOARD_TOP + y1)
    ctx.lineTo(ar.x + x2, SIDE_BOARD_TOP + y2)
    ctx.stroke()
  }
  for (const [text, x, y] of nodes) {
    ctx.fillStyle = t.surfaceSolid
    ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.3)' : 'rgba(255,255,255,0.26)'
    rr(ctx, ar.x + x, SIDE_BOARD_TOP + y, 30, 18, 4)
    ctx.fill()
    ctx.stroke()
    label(ctx, text, ar.x + x + 6, SIDE_BOARD_TOP + y + 4, 7, t.ink, 600, 0)
  }
  label(ctx, 'cache · LRU 64', ar.x + 10, SIDE_BOARD_TOP + 128, 6.5, t.muted, 500, 0)

  // 6. clock face (hands are live)
  const cl = SIDE_BOARDS[5]!
  const ccx = cl.x + cl.w / 2
  const ccy = SIDE_BOARD_TOP + 58
  ctx.fillStyle = t.surfaceSolid
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.28)' : 'rgba(255,255,255,0.26)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(ccx, ccy, 20, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = t.muted
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    ctx.fillRect(ccx + Math.cos(a) * 16 - 0.7, ccy + Math.sin(a) * 16 - 0.7, 1.4, 1.4)
  }
  label(ctx, tzName, ccx - Math.min(20, tzName.length * 2.2), SIDE_BOARD_TOP + 96, 7, t.muted, 600, 0.06)
  label(ctx, `L${floor}`, ccx - 5, SIDE_BOARD_TOP + 110, 7, t.muted, 500, 0)
}

/**
 * The phone wall: three boards instead of six, laid out inside the design
 * window the viewport shows and at roughly double the desktop label size (a
 * 13 px label lands on 6.5 CSS px at half scale). The pinboard, burndown and
 * architecture diagram are gone — at this scale their text is 3 px tall and the
 * diagram hangs off the right edge of the screen.
 */
function drawCompactBoards(
  ctx: Ctx,
  theme: ThemeName,
  floor: 1 | 2 | 3,
  tzName: string,
  boards: readonly SideBoard[],
): void {
  const t = THEME_TOKENS[theme]
  const first = boards[0]!
  const last = boards[boards.length - 1]!
  const railL = first.x - 8
  const railR = last.x + last.w + 8

  ctx.fillStyle = theme === 'day' ? '#B9C5D3' : '#3A4557'
  ctx.fillRect(railL, SIDE_RAIL_TOP, railR - railL, 3)
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.2)' : 'rgba(255,255,255,0.14)'
  for (let x = railL + 14; x < railR - 6; x += 148) ctx.fillRect(x, SIDE_RAIL_TOP + 3, 3, SIDE_RAIL_H - 3)

  for (const b of boards) card(ctx, theme, b.x, SIDE_BOARD_TOP, b.w, b.h)

  // 1. zone plaque — still the only pixel-font surface besides the lift numbers
  const p = first
  const team = floor === 1 ? 'LOBBY' : floor === 2 ? 'TIM EDU' : 'TIM DEV'
  drawText(ctx, `L${floor}`, p.x + 14, SIDE_BOARD_TOP + 20, 5, t.accent)
  label(ctx, team, p.x + 14, SIDE_BOARD_TOP + 66, 14, t.ink, 700, 0.06)
  label(ctx, 'ZONA', p.x + 14, SIDE_BOARD_TOP + 88, 11, t.muted, 600, 0.12)
  ctx.fillStyle = t.accent
  ctx.fillRect(p.x + 14, SIDE_BOARD_TOP + 108, 52, 4)

  // 2. status board — shell only; the count and the legend are live
  const s = boards[1]!
  label(ctx, 'PAPAN STATUS', s.x + 14, SIDE_BOARD_TOP + 10, 12, t.muted, 600, 0.12)
  label(ctx, 'online', s.x + 14, SIDE_BOARD_TOP + 68, 12, t.muted, 500, 0)

  // 3. clock face (hands are live)
  const cl = last
  const ccx = cl.x + cl.w / 2
  const ccy = SIDE_BOARD_TOP + 56
  ctx.fillStyle = t.surfaceSolid
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.28)' : 'rgba(255,255,255,0.26)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(ccx, ccy, 30, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = t.muted
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    ctx.fillRect(ccx + Math.cos(a) * 25 - 1, ccy + Math.sin(a) * 25 - 1, 2, 2)
  }
  label(ctx, tzName, ccx - Math.min(26, tzName.length * 3.4), SIDE_BOARD_TOP + 104, 11, t.muted, 600, 0.06)
  label(ctx, `L${floor}`, ccx - 8, SIDE_BOARD_TOP + 122, 11, t.muted, 500, 0)
}

/** Live half of the status board: dots + counts (never cached). */
export function drawStatusBoard(
  ctx: Ctx,
  theme: ThemeName,
  agents: ReadonlyArray<{ id: string; name: string; status: string }>,
  compact = false,
  boards: readonly SideBoard[] = SIDE_BOARDS,
): void {
  if (compact) {
    drawCompactStatusBoard(ctx, theme, agents, boards[1]!)
    return
  }
  const t = THEME_TOKENS[theme]
  const s = SIDE_BOARDS[1]!
  // "online" = present in /api/status (anything but offline). It is not the
  // legend's "aktif" (working/reviewing); the count and the word agree now.
  const online = agents.filter((a) => a.status !== 'offline').length
  ctx.save()
  ctx.font = `700 22px ${FONT}`
  ctx.fillStyle = t.ink
  ctx.textBaseline = 'top'
  ctx.fillText(`${online}/${agents.length}`, s.x + 10, SIDE_BOARD_TOP + 30)
  ctx.restore()

  // one dot per agent on this floor. An empty list is legal — on L1 the only
  // agent may be walking or riding the lift — so this loop never indexes past
  // the end (that `agents[0]!` was the crash).
  const n = agents.length
  if (n > 0) {
    const gap = (s.w - 20) / n
    for (let i = 0; i < n; i++) {
      const a = agents[i]
      if (!a) continue
      const x = s.x + 10 + gap * i + gap / 2
      const y = SIDE_BOARD_TOP + 66
      ctx.fillStyle = THEME_STATUS[theme][(a.status as keyof typeof THEME_STATUS.day) ?? 'offline'] ?? t.muted
      ctx.beginPath()
      ctx.arc(x, y, 4.5, 0, Math.PI * 2)
      ctx.fill()
      label(ctx, a.name.slice(0, 1).toUpperCase(), x - 2.4, y + 8, 6.5, t.muted, 600, 0)
    }
  }
  // legend
  const counts = new Map<string, number>()
  for (const a of agents) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)
  const legend: Array<[string, string]> = [
    ['working', 'bekerja'],
    ['reviewing', 'review'],
    ['idle', 'idle'],
    ['blocked', 'terblokir'],
  ]
  legend.forEach(([key, text], i) => {
    const lx = s.x + 10 + (i % 2) * 88
    const ly = SIDE_BOARD_TOP + 96 + Math.floor(i / 2) * 16
    ctx.fillStyle = THEME_STATUS[theme][key as keyof typeof THEME_STATUS.day]
    ctx.beginPath()
    ctx.arc(lx + 3, ly + 4, 3, 0, Math.PI * 2)
    ctx.fill()
    label(ctx, `${counts.get(key) ?? 0} ${text}`, lx + 10, ly, 6.5, t.muted, 500, 0)
  })
}

/**
 * The phone status board: the number and the legend, nothing else. The per-agent
 * dot row is dropped — 8 dots across 356 design px are 20 CSS px apart and 2 px
 * wide, which is noise, not information. Everything here is drawn at ~2× the
 * desktop size so it survives the half-scale phone camera.
 */
function drawCompactStatusBoard(
  ctx: Ctx,
  theme: ThemeName,
  agents: ReadonlyArray<{ id: string; name: string; status: string }>,
  s: SideBoard,
): void {
  const t = THEME_TOKENS[theme]
  const online = agents.filter((a) => a.status !== 'offline').length

  ctx.save()
  ctx.font = `700 38px ${FONT}`
  ctx.fillStyle = t.ink
  ctx.textBaseline = 'top'
  ctx.fillText(`${online}/${agents.length}`, s.x + 14, SIDE_BOARD_TOP + 24)
  ctx.restore()

  const counts = new Map<string, number>()
  for (const a of agents) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)
  const legend: Array<[string, string]> = [
    ['working', 'bekerja'],
    ['reviewing', 'review'],
    ['idle', 'idle'],
    ['blocked', 'terblokir'],
  ]
  legend.forEach(([key, text], i) => {
    const colW = (s.w - 28) / 2
    const lx = s.x + 14 + (i % 2) * colW
    const ly = SIDE_BOARD_TOP + 94 + Math.floor(i / 2) * 24
    ctx.fillStyle = THEME_STATUS[theme][key as keyof typeof THEME_STATUS.day]
    ctx.beginPath()
    ctx.arc(lx + 4, ly + 6, 4, 0, Math.PI * 2)
    ctx.fill()
    label(ctx, `${counts.get(key) ?? 0} ${text}`, lx + 14, ly, 13, t.muted, 500, 0)
  })
}

/** Live clock hands, WIB hour/minute from the server `now`. */
export function drawClockHands(
  ctx: Ctx,
  theme: ThemeName,
  hour: number,
  minute: number,
  compact = false,
  boards: readonly SideBoard[] = SIDE_BOARDS,
): void {
  const t = THEME_TOKENS[theme]
  const cl = compact ? boards[boards.length - 1]! : SIDE_BOARDS[5]!
  const cx = cl.x + cl.w / 2
  const cy = SIDE_BOARD_TOP + (compact ? 56 : 58)
  const ha = ((hour % 12) + minute / 60) * (Math.PI / 6) - Math.PI / 2
  const ma = minute * (Math.PI / 30) - Math.PI / 2
  const handH = compact ? 13 : 9
  const handM = compact ? 21 : 14
  ctx.save()
  ctx.strokeStyle = t.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(ha) * handH, cy + Math.sin(ha) * handH)
  ctx.stroke()
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(ma) * handM, cy + Math.sin(ma) * handM)
  ctx.stroke()
  ctx.fillStyle = t.ink
  ctx.beginPath()
  ctx.arc(cx, cy, compact ? 3 : 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  label(ctx, time, cx - (compact ? 19 : 15), SIDE_BOARD_TOP + (compact ? 88 : 84), compact ? 13 : 8, t.ink, 700, 0)
}

// -------------------------------------------------------------------- lift

/**
 * Lift labels, kept apart on purpose. The shaft header names the floor this
 * section belongs to (`L3` + team); the car chip names where the car is going
 * (`▸ L1`). Two bare `L3`s on the same wall read as a duplicate, so the chip
 * carries an arrow and, while someone rides, a *different* floor than the
 * header. `verify/render_check.ts` pins both strings.
 */
export function liftHeaderLabel(floor: 1 | 2 | 3): string {
  return `L${floor}`
}

export function liftHeaderTeam(floor: 1 | 2 | 3): string {
  return floor === 1 ? 'LOBBY' : floor === 2 ? 'TIM EDU' : 'TIM DEV'
}

export function liftCarLabel(target: 1 | 2 | 3): string {
  return `▸ L${target}`
}

/** Steel + glass core on the east wall, with the three floor markers. */
export function drawLiftShaft(ctx: Ctx, theme: ThemeName, floor: 1 | 2 | 3): void {
  const t = THEME_TOKENS[theme]
  const { x, w, top, bottom } = SIDE_LIFT
  // dark outer frame + lighter inner shaft, so the core reads against the city
  ctx.fillStyle = theme === 'day' ? '#5A6675' : '#0A111C'
  ctx.fillRect(x, top, w, bottom - top)
  ctx.fillStyle = theme === 'day' ? '#DCE4EE' : '#1B2433'
  ctx.fillRect(x + 4, top + 4, w - 8, bottom - top - 8)
  // vertical rails (3 px, dark) and a cable line
  ctx.fillStyle = theme === 'day' ? '#6E7C8C' : '#3A4659'
  ctx.fillRect(x + 8, top + 8, 3, bottom - top - 16)
  ctx.fillRect(x + w - 11, top + 8, 3, bottom - top - 16)
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.25)' : 'rgba(255,255,255,0.12)'
  ctx.fillRect(x + w / 2 - 1, top + 30, 2, bottom - top - 40)
  // floor markers
  for (const f of [1, 2, 3] as const) {
    const y = 540 - (f - 1) * 100
    ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.78)' : 'rgba(0,0,0,0.55)'
    rr(ctx, x + w / 2 - 10, y - 5, 20, 11, 3)
    ctx.fill()
    drawText(ctx, `L${f}`, x + w / 2 - 5, y - 3, 1, f === floor ? t.accent : t.muted)
  }
  // header: the floor this section belongs to + its team. The number keeps the
  // pixel font (allowed role); the team name is sans, so the header never reads
  // as a second bare "L3" like the car chip used to.
  ctx.fillStyle = theme === 'day' ? '#2E3A4B' : '#0B1220'
  ctx.fillRect(x + 6, top + 2, w - 12, 18)
  drawText(ctx, liftHeaderLabel(floor), x + 10, top + 6, 2, t.accent)
  label(ctx, liftHeaderTeam(floor), x + 37, top + 7, 6.5, t.muted, 700, 0)
  // vertical LIFT label + a call panel, so the core never reads as a rack
  ctx.save()
  ctx.translate(x + 11, bottom - 28)
  ctx.rotate(-Math.PI / 2)
  ctx.font = `700 8px ${FONT}`
  ctx.fillStyle = theme === 'day' ? '#3B4A5E' : '#93A0B6'
  ctx.fillText('LIFT', 0, 0)
  ctx.restore()
  ctx.fillStyle = theme === 'day' ? '#C7D2DF' : '#232E40'
  rr(ctx, x - 7, 496, 7, 18, 2)
  ctx.fill()
  ctx.fillStyle = t.accent
  ctx.beginPath()
  ctx.moveTo(x - 5, 501); ctx.lineTo(x - 3.5, 499); ctx.lineTo(x - 2, 501); ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x - 5, 509); ctx.lineTo(x - 3.5, 511); ctx.lineTo(x - 2, 509); ctx.closePath(); ctx.fill()
  // glass door at the current floor
  const doorY = 540 - (floor - 1) * 100 - 40
  drawGlassPanel(ctx, theme, x + 12, doorY, w - 24, 80, 6, 0.42)
}

/**
 * Glass recipe (design §5.2): shadow, fill @ alpha, 1 px inner edge, outer
 * edge in day mode, one diagonal sheen, floor reflection. No blur.
 */
export function drawGlassPanel(
  ctx: Ctx,
  theme: ThemeName,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  alpha = 0.42,
): void {
  const t = THEME_TOKENS[theme]
  softShadow(ctx, x + w / 2, y + h + 6, w * 0.5, 3, 0.15, 8)
  ctx.save()
  ctx.fillStyle = t.glass.surface
  ctx.globalAlpha = alpha
  rr(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.globalAlpha = 1
  // inner edge
  ctx.strokeStyle = `rgba(255,255,255,0.55)`
  ctx.lineWidth = 1
  rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(1, r - 1))
  ctx.stroke()
  if (theme === 'day') {
    ctx.strokeStyle = 'rgba(15,36,64,0.18)'
    rr(ctx, x, y, w, h, r)
    ctx.stroke()
  }
  // one diagonal sheen, clipped to the panel
  ctx.save()
  rr(ctx, x, y, w, h, r)
  ctx.clip()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 2
  const sx = x + w * 0.18
  ctx.beginPath()
  ctx.moveTo(sx, y + h)
  ctx.lineTo(sx + h * 0.55, y)
  ctx.stroke()
  // floor reflection
  const g = ctx.createLinearGradient(0, y + h - 6, 0, y + h)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(1, 'rgba(255,255,255,0.3)')
  ctx.fillStyle = g
  ctx.fillRect(x, y + h - 6, w, 6)
  ctx.restore()
  ctx.restore()
}

/** The moving car: y is the door centre; `open` slides the panels apart. */
export function drawLiftCar(ctx: Ctx, theme: ThemeName, floor: 1 | 2 | 3, y: number, open: number, target: number): void {
  const t = THEME_TOKENS[theme]
  void floor
  const { x, w } = SIDE_LIFT
  const carW = w - 24
  const carH = 76
  const cx = x + 12
  const cy = y - carH / 2
  // car interior: dark enough to read inside the light shaft
  ctx.fillStyle = theme === 'day' ? '#2A3446' : '#0E1522'
  rr(ctx, cx, cy, carW, carH, 6)
  ctx.fill()
  ctx.fillStyle = t.lamp
  ctx.globalAlpha = 0.9
  ctx.fillRect(cx + 4, cy + 3, carW - 8, 2)
  ctx.globalAlpha = 1
  // door panels slide apart by `open` (0 closed → 1 open)
  const half = carW / 2
  const slide = Math.max(0, Math.min(1, open)) * (half - 2)
  ctx.fillStyle = theme === 'day' ? '#CBD6E3' : '#2A3446'
  ctx.fillRect(cx - slide, cy, half - slide, carH)
  ctx.fillRect(cx + half + slide, cy, half - slide, carH)
  ctx.strokeStyle = theme === 'day' ? 'rgba(15,36,64,0.24)' : 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 1
  ctx.strokeRect(cx - slide, cy, half - slide, carH)
  ctx.strokeRect(cx + half + slide, cy, half - slide, carH)
  // destination plate (amber on dark, never floating white text): the car says
  // where it is going — `▸ L1` while the header still says `L3`.
  const plateW = 40
  const plateX = cx + carW / 2 - plateW / 2
  ctx.fillStyle = theme === 'day' ? 'rgba(10,16,26,0.82)' : 'rgba(0,0,0,0.55)'
  rr(ctx, plateX, cy + 6, plateW, 18, 4)
  ctx.fill()
  label(ctx, liftCarLabel(target as 1 | 2 | 3), plateX + 7, cy + 9, 8.5, t.accent, 700, 0)
}

// ------------------------------------------------------------------- floor

/** Floor plane + slab, shared by the static layer. */
export function drawFloorPlane(ctx: Ctx, theme: ThemeName): void {
  const t = THEME_TOKENS[theme]
  // floor plane
  const g = ctx.createLinearGradient(0, 588, 0, 648)
  g.addColorStop(0, t.floor)
  g.addColorStop(1, shade(t.floor, theme === 'day' ? 0.96 : 1.08))
  ctx.fillStyle = g
  ctx.fillRect(0, 588, 1000, 60)
  // row lines
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.12)' : 'rgba(255,255,255,0.1)'
  ctx.fillRect(0, 596, 1000, 1)
  ctx.fillRect(0, 640, 1000, 1)
  // slab
  ctx.fillStyle = theme === 'day' ? '#D3DEEA' : '#141C2B'
  ctx.fillRect(0, 648, 1000, 40)
  ctx.fillStyle = theme === 'day' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.14)'
  ctx.fillRect(0, 648, 1000, 1)
}

/** Roof band: coping + slab edge (hatch) + fascia. No sky up here. */
export function drawRoof(ctx: Ctx, theme: ThemeName): void {
  ctx.fillStyle = theme === 'day' ? '#CBD6E3' : '#101827'
  ctx.fillRect(0, 0, 1000, 40)
  ctx.fillStyle = theme === 'day' ? '#E9EFF6' : '#1B2536'
  ctx.fillRect(0, 0, 1000, 8)
  ctx.fillStyle = theme === 'day' ? '#B7C4D3' : '#0C1320'
  for (let x = 0; x < 1000; x += 14) {
    ctx.fillRect(x, 8, 7, 18)
    ctx.fillRect(x + 7, 8, 7, 18)
    ctx.fillStyle = theme === 'day' ? '#C3CFDC' : '#111A29'
    ctx.fillRect(x, 8, 1, 18)
    ctx.fillStyle = theme === 'day' ? '#B7C4D3' : '#0C1320'
  }
  ctx.fillStyle = theme === 'day' ? '#D8E1EC' : '#182234'
  ctx.fillRect(0, 26, 1000, 14)
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.14)' : 'rgba(255,255,255,0.1)'
  ctx.fillRect(0, 39, 1000, 1)
}

/** Soffit: one continuous cove + 7 recessed downlights. */
export function drawSoffit(ctx: Ctx, theme: ThemeName): void {
  const t = THEME_TOKENS[theme]
  ctx.fillStyle = theme === 'day' ? '#E4EBF3' : '#151E2E'
  ctx.fillRect(0, 40, 1000, 18)
  // cove
  const g = ctx.createLinearGradient(0, 40, 0, 58)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.55, t.lamp)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.globalAlpha = theme === 'day' ? 0.55 : 0.35
  ctx.fillRect(0, 40, 1000, 18)
  ctx.globalAlpha = 1
  for (let i = 0; i < 7; i++) {
    const x = 70 + i * 143
    ctx.fillStyle = t.lamp
    ctx.globalAlpha = 0.95
    rr(ctx, x, 46, 26, 4, 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.fillRect(x + 2, 46, 22, 1)
  }
}

/** Spandrel + plinth under the sill. */
export function drawSpandrel(ctx: Ctx, theme: ThemeName): void {
  const t = THEME_TOKENS[theme]
  ctx.fillStyle = theme === 'day' ? '#D9E2EC' : '#121A29'
  ctx.fillRect(0, SIDE_GLASS_BOTTOM, 1000, 45)
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.08)' : 'rgba(255,255,255,0.06)'
  ctx.fillRect(0, SIDE_GLASS_BOTTOM, 1000, 1)
  // shadow gap / plinth
  ctx.fillStyle = theme === 'day' ? '#C3CEDC' : '#0D1420'
  ctx.fillRect(0, 566, 1000, 22)
  ctx.fillStyle = theme === 'day' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.08)'
  ctx.fillRect(0, 566, 1000, 1)
  // a quiet mullion rhythm on the spandrel
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.1)' : 'rgba(255,255,255,0.05)'
  for (let x = 250; x < 1000; x += 250) ctx.fillRect(x, SIDE_GLASS_BOTTOM, 1, 45)
  void t
}

/** Curtain wall: one continuous glass sheet + 3 mullions + 1 transom. */
export function drawCurtainWall(ctx: Ctx, theme: ThemeName): void {
  const t = THEME_TOKENS[theme]
  const top = SIDE_GLASS_TOP
  const h = SIDE_GLASS_BOTTOM - top
  // one sheet, alpha 0.18 — at 0.42 the night skyline goes dark
  ctx.fillStyle = t.glass.surface
  ctx.globalAlpha = 0.18
  ctx.fillRect(0, top, 1000, h)
  ctx.globalAlpha = 1
  // 3 mullions → 4 bays of 250
  ctx.fillStyle = theme === 'day' ? '#B9C5D3' : '#2A3446'
  for (let x = 250; x < 1000; x += 250) ctx.fillRect(x - 1, top, 3, h)
  // transom at 62 %
  ctx.fillRect(0, top + h * 0.62, 1000, 2)
  // 1 px top highlight
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  ctx.fillRect(0, top, 1000, 1)
  // 3 % deterministic noise: breaks the big gradient so it reads as glass
  ctx.fillStyle = theme === 'day' ? 'rgba(15,36,64,0.035)' : 'rgba(255,255,255,0.035)'
  for (let y = top + 2; y < top + h; y += 5) {
    for (let x = (y * 3) % 7; x < 1000; x += 6) ctx.fillRect(x, y, 1, 1)
  }
}

/** Pixel font is allowed ONLY on these two roles (design §8). */
export const PIXEL_FONT_ROLES = ['zone-plaque', 'lift-floor-number'] as const
