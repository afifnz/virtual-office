/**
 * Clean-vector avatar (canvas 2D). Paths + gradients, anti-aliased, never a
 * pixel sprite and never an upscaled small bitmap.
 *
 * One unit = 1/44 of the display height, so the proportions below do not
 * depend on the size. The sprite is painted at the final size (times the DPR
 * bucket) and blitted 1:1 — there is no nearest-neighbour resize anywhere.
 *
 * Drawing order per station is: floor shadow → chair → body → desk → keyboard
 * → hands → monitor. The desk is opaque in front of the lap, and the hands are
 * a separate overlay so they can sit on the keys.
 */
import type { Look } from '../lib/agents'

export type AvatarPose = 'seated' | 'typing' | 'reading' | 'working' | 'idle' | 'relax' | 'walk' | 'blocked'

/** Mix two hex colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const ca = hex(a)
  const cb = hex(b)
  if (!ca || !cb) return a
  const k = Math.min(1, Math.max(0, t))
  return `#${[0, 1, 2]
    .map((i) => Math.round(ca[i]! * (1 - k) + cb[i]! * k).toString(16).padStart(2, '0'))
    .join('')}`
}

/** Shade a hex colour: k < 1 darker, k > 1 lighter. */
export function shade(hexColour: string, k: number): string {
  const c = hex(hexColour)
  if (!c) return hexColour
  const out = c.map((v) => Math.max(0, Math.min(255, Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1)))))
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function hex(h: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2)
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

/** Stable cache key for one look + pose + frame + DPR bucket. */
export function avatarKey(look: Look, pose: AvatarPose, frame: number, bucket: number): string {
  return `av:${lookHash(look)}:${pose}:${frame}:${bucket}`
}

/** FNV-1a over the look fields that change the drawing. */
export function lookHash(look: Look): string {
  const s = [
    look.skin,
    look.hair,
    look.style,
    look.shirt,
    look.pants,
    look.accent,
    look.glasses ? 1 : 0,
    look.headphones ?? '',
    look.peci ? 1 : 0,
    look.mustache ? 1 : 0,
    look.stubble ? 1 : 0,
    look.female ? 1 : 0,
    look.build.toFixed(3),
    look.tall.toFixed(3),
  ].join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * How different two looks read. The gate wants every pair of the eight dev
 * looks ≥ 1.0; the weakest pair (YOGA↔WAHYU) lands around 1.37 because they
 * share a hairstyle but differ in hair colour, shirt, build and stubble.
 */
export function lookDistance(a: Look, b: Look): number {
  let d = 0
  if (a.style !== b.style) d += 0.9
  if (a.hair !== b.hair) d += 0.4
  if (a.shirt !== b.shirt) d += 0.3
  if (a.skin !== b.skin) d += 0.2
  d += Math.abs(a.build - b.build) * 2
  if (Boolean(a.glasses) !== Boolean(b.glasses)) d += 0.35
  if ((a.headphones ?? '') !== (b.headphones ?? '')) d += 0.35
  if (Boolean(a.peci) !== Boolean(b.peci)) d += 0.35
  if (Boolean(a.mustache) !== Boolean(b.mustache)) d += 0.35
  if (Boolean(a.stubble) !== Boolean(b.stubble)) d += 0.35
  if (Boolean(a.female) !== Boolean(b.female)) d += 0.25
  return Math.round(d * 100) / 100
}

/**
 * Paint one avatar. `cx`/`floorY` are in the target canvas' units, `h` is the
 * display height. `frame` only moves hands/head (0/1).
 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  look: Look,
  pose: AvatarPose,
  frame: number,
  cx: number,
  floorY: number,
  h: number,
): void {
  const u = h / 44
  const Y = (v: number) => floorY - h + v * u
  const walking = pose === 'walk'
  const bob = pose === 'idle' || pose === 'relax' ? (frame % 2 === 0 ? 0 : 0.35) : 0
  const typing = pose === 'typing'
  const hrx = 7.8 * (1 + (look.build - 1) * 0.7)
  const torsoW = 7.6 * look.build

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // ------------------------------------------------------------- legs
  if (walking) {
    const swing = frame % 2 === 0 ? 1.2 : -1.2
    drawLeg(ctx, look, u, cx - 3.2 * u, Y(32.2 + bob), Y(43.6), 0, swing)
    drawLeg(ctx, look, u, cx + 3.2 * u, Y(32.2 + bob), Y(43.6), 0, -swing)
  } else {
    // seated: thigh forward, shin down, shoe flat on the floor line
    // seated, front-on: two legs under the desk, thighs foreshortened, shins
    // down to the floor. The desk covers the lap, so no one-sided "sideways"
    // leg that reads as a broken body.
    const legY = 31.8 + bob
    for (const side of [-1, 1]) {
      const hipX = cx + side * 3.3 * u
      const kneeX = cx + side * 3.5 * u
      ctx.strokeStyle = shade(look.pants, 0.46)
      ctx.lineWidth = 6.0 * u
      ctx.beginPath()
      ctx.moveTo(hipX, Y(legY))
      ctx.lineTo(kneeX, Y(35.8 + bob))
      ctx.stroke()
      ctx.strokeStyle = shade(look.pants, 1.06)
      ctx.lineWidth = 4.8 * u
      ctx.beginPath()
      ctx.moveTo(hipX, Y(legY))
      ctx.lineTo(kneeX, Y(35.8 + bob))
      ctx.stroke()
      ctx.strokeStyle = shade(look.pants, 0.5)
      ctx.lineWidth = 4.4 * u
      ctx.beginPath()
      ctx.moveTo(kneeX, Y(35.8 + bob))
      ctx.lineTo(kneeX, Y(41.4))
      ctx.stroke()
      ctx.strokeStyle = shade(look.pants, 0.92)
      ctx.lineWidth = 3.4 * u
      ctx.beginPath()
      ctx.moveTo(kneeX, Y(35.8 + bob))
      ctx.lineTo(kneeX, Y(41.4))
      ctx.stroke()
      const shoe = shade(look.pants, 0.55)
      ctx.fillStyle = shoe
      ctx.strokeStyle = shade(look.pants, 0.4)
      ctx.lineWidth = 0.7 * u
      rr(ctx, kneeX - 3.4 * u, Y(40.8), 6.8 * u, 3.0 * u, 1.2 * u)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#E7EAEE'
      rr(ctx, kneeX - 3.2 * u, Y(43.0), 6.4 * u, 0.7 * u, 0.4 * u)
      ctx.fill()
    }
  }

  // ------------------------------------------------------------ torso
  const torsoTop = 20.6 + bob
  const torsoBottom = 33.6 + bob
  const grad = ctx.createLinearGradient(cx - torsoW * u, Y(torsoTop), cx + torsoW * u, Y(torsoBottom))
  grad.addColorStop(0, shade(look.shirt, 1.14))
  grad.addColorStop(0.55, look.shirt)
  grad.addColorStop(1, shade(look.shirt, 0.84))
  ctx.fillStyle = grad
  ctx.strokeStyle = shade(look.shirt, 0.56)
  ctx.lineWidth = 0.85 * u
  ctx.beginPath()
  ctx.moveTo(cx - torsoW * u, Y(torsoBottom))
  ctx.quadraticCurveTo(cx - torsoW * 1.03 * u, Y(26), cx - torsoW * 0.92 * u, Y(torsoTop + 1.4))
  ctx.quadraticCurveTo(cx - torsoW * 0.6 * u, Y(torsoTop - 0.6), cx, Y(torsoTop - 0.9))
  ctx.quadraticCurveTo(cx + torsoW * 0.6 * u, Y(torsoTop - 0.6), cx + torsoW * 0.92 * u, Y(torsoTop + 1.4))
  ctx.quadraticCurveTo(cx + torsoW * 1.03 * u, Y(26), cx + torsoW * u, Y(torsoBottom))
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // hard second tone down the near side (reads at 150 px)
  ctx.save()
  ctx.clip()
  ctx.fillStyle = shade(look.shirt, 0.78)
  ctx.globalAlpha = 0.58
  ctx.fillRect(cx + torsoW * 0.35 * u, Y(torsoBottom), torsoW * 0.7 * u, (torsoBottom - torsoTop) * u)
  ctx.globalAlpha = 1
  // V collar
  ctx.fillStyle = shade(look.shirt, 0.62)
  ctx.beginPath()
  ctx.moveTo(cx - 2.6 * u, Y(torsoTop - 0.4))
  ctx.lineTo(cx + 2.6 * u, Y(torsoTop - 0.4))
  ctx.lineTo(cx, Y(torsoTop + 4.0))
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // team accent strip
  ctx.fillStyle = look.accent
  rr(ctx, cx - 1.1 * u, Y(torsoTop + 4.6), 2.2 * u, 6.2 * u, 1.0 * u)
  ctx.fill()

  // ------------------------------------------------------------- arms
  // far arm (behind the torso), then near arm
  drawArm(ctx, look, u, cx - torsoW * 0.9 * u, Y(torsoTop + 1.8), Y(27.2 + bob), walking, 0)
  drawArm(ctx, look, u, cx + torsoW * 0.9 * u, Y(torsoTop + 1.8), Y(27.2 + bob), walking, 1)

  // -------------------------------------------------------------- neck
  ctx.fillStyle = shade(look.skin, 0.9)
  ctx.strokeStyle = shade(look.skin, 0.5)
  ctx.lineWidth = 0.7 * u
  rr(ctx, cx - 2.6 * u, Y(17.8 + bob), 5.2 * u, 4.6 * u, 1.2 * u)
  ctx.fill()
  ctx.stroke()

  // -------------------------------------------------------------- head
  drawHead(ctx, look, u, cx, Y(10.0 + bob), hrx, 8.4, typing, frame)

  ctx.restore()
}

function drawLeg(
  ctx: CanvasRenderingContext2D,
  look: Look,
  u: number,
  x: number,
  yTop: number,
  yFloor: number,
  _pad: number,
  swing: number,
): void {
  ctx.strokeStyle = shade(look.pants, 0.5)
  ctx.lineWidth = 5.6 * u
  ctx.beginPath()
  ctx.moveTo(x, yTop)
  ctx.lineTo(x + swing * u * 0.4, yFloor - 2.6 * u)
  ctx.stroke()
  ctx.strokeStyle = shade(look.pants, 1.02)
  ctx.lineWidth = 4.5 * u
  ctx.beginPath()
  ctx.moveTo(x, yTop)
  ctx.lineTo(x + swing * u * 0.4, yFloor - 2.6 * u)
  ctx.stroke()
  ctx.fillStyle = shade(look.pants, 0.55)
  rr(ctx, x - 2.0 * u, yFloor - 3.2 * u, 7.2 * u, 3.2 * u, 1.2 * u)
  ctx.fill()
  ctx.fillStyle = '#E7EAEE'
  rr(ctx, x - 1.8 * u, yFloor - 0.9 * u, 6.8 * u, 0.7 * u, 0.4 * u)
  ctx.fill()
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  look: Look,
  u: number,
  shoulderX: number,
  shoulderY: number,
  elbowY: number,
  walking: boolean,
  side: number,
): void {
  const elbowX = shoulderX + (side === 0 ? -1.4 : 2.4) * u
  const handX = shoulderX + (side === 0 ? 1.6 : 4.4) * u
  const handY = walking ? elbowY + 3.4 * u : elbowY + 0.6 * u
  ctx.strokeStyle = shade(look.shirt, 0.56)
  ctx.lineWidth = 4.7 * u
  ctx.beginPath()
  ctx.moveTo(shoulderX, shoulderY)
  ctx.quadraticCurveTo(elbowX, (shoulderY + elbowY) / 2, elbowX, elbowY)
  ctx.quadraticCurveTo(elbowX, handY, handX, handY)
  ctx.stroke()
  ctx.strokeStyle = shade(look.shirt, 1.08)
  ctx.lineWidth = 3.6 * u
  ctx.beginPath()
  ctx.moveTo(shoulderX, shoulderY)
  ctx.quadraticCurveTo(elbowX, (shoulderY + elbowY) / 2, elbowX, elbowY)
  ctx.quadraticCurveTo(elbowX, handY, handX, handY)
  ctx.stroke()
  // cuff
  ctx.strokeStyle = shade(look.shirt, 0.7)
  ctx.lineWidth = 3.8 * u
  ctx.beginPath()
  ctx.moveTo(handX - 0.9 * u, handY - 0.4 * u)
  ctx.lineTo(handX, handY)
  ctx.stroke()
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  look: Look,
  u: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  typing: boolean,
  frame: number,
): void {
  // ears first (behind the head)
  for (const side of [-1, 1]) {
    ctx.fillStyle = shade(look.skin, 0.92)
    ctx.strokeStyle = shade(look.skin, 0.5)
    ctx.lineWidth = 0.6 * u
    ctx.beginPath()
    ctx.ellipse(cx + side * rx * 0.98 * u, cy + 1.9 * u, 1.2 * u, 1.6 * u, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  const grad = ctx.createLinearGradient(cx - rx * u, cy - ry * u, cx + rx * u, cy + ry * u)
  grad.addColorStop(0, shade(look.skin, 1.1))
  grad.addColorStop(0.6, look.skin)
  grad.addColorStop(1, shade(look.skin, 0.84))
  ctx.fillStyle = grad
  ctx.strokeStyle = shade(look.skin, 0.5)
  ctx.lineWidth = 0.85 * u
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx * u, ry * u, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // cheek tone, clipped to the head
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx * u, ry * u, 0, 0, Math.PI * 2)
  ctx.clip()
  ctx.globalAlpha = 0.41
  ctx.fillStyle = shade(look.skin, 0.8)
  ctx.beginPath()
  ctx.ellipse(cx + rx * 0.45 * u, cy + 3.2 * u, rx * 0.55 * u, ry * 0.4 * u, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  if (look.stubble && !look.female) {
    ctx.globalAlpha = 0.27
    ctx.fillStyle = look.hair
    ctx.beginPath()
    ctx.ellipse(cx, cy + ry * 0.55 * u, rx * 0.86 * u, ry * 0.5 * u, 0, 0, Math.PI)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.restore()

  // brows
  const browY = cy - 0.4 * u
  ctx.strokeStyle = shade(look.hair, 0.8)
  ctx.lineWidth = 0.9 * u
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx + side * 4.6 * u, browY)
    ctx.lineTo(cx + side * 1.3 * u, browY - 0.3 * u)
    ctx.stroke()
  }

  // eyes: sclera + iris + glint
  const eyeY = cy + 1.9 * u
  const blink = typing && frame % 4 === 3 ? 0.18 : 1
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.ellipse(cx + side * 2.9 * u, eyeY, 1.35 * u, 1.5 * u * blink, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = shade(look.hair, 0.55)
    ctx.beginPath()
    ctx.ellipse(cx + side * 2.9 * u, eyeY, 0.85 * u, 1.15 * u * blink, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.arc(cx + side * 2.9 * u + 0.35 * u, eyeY - 0.4 * u, 0.28 * u, 0, Math.PI * 2)
    ctx.fill()
  }

  // nose: a shade triangle, not a line
  ctx.fillStyle = shade(look.skin, 0.74)
  ctx.beginPath()
  ctx.moveTo(cx - 0.2 * u, eyeY + 1.1 * u)
  ctx.lineTo(cx + 1.1 * u, eyeY + 2.7 * u)
  ctx.lineTo(cx - 0.6 * u, eyeY + 2.7 * u)
  ctx.closePath()
  ctx.fill()

  // mouth
  ctx.strokeStyle = shade(look.skin, 0.48)
  ctx.lineWidth = 1.1 * u
  ctx.beginPath()
  ctx.arc(cx, eyeY + 3.6 * u, 2.2 * u, Math.PI * 0.12, Math.PI * 0.88)
  ctx.stroke()

  if (look.mustache && !look.female) {
    ctx.fillStyle = shade(look.hair, 0.9)
    rr(ctx, cx - 2.6 * u, eyeY + 2.5 * u, 5.2 * u, 1.2 * u, 0.6 * u)
    ctx.fill()
  }

  // ------------------------------------------------------------- hair
  drawHair(ctx, look, u, cx, cy, rx, ry)

  if (look.peci) {
    ctx.fillStyle = '#20202A'
    ctx.strokeStyle = '#111118'
    ctx.lineWidth = 0.7 * u
    rr(ctx, cx - rx * 0.86 * u, cy - ry * 1.06 * u, rx * 1.72 * u, 3.6 * u, 1.0 * u)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#2E2E3A'
    rr(ctx, cx - rx * 0.8 * u, cy - ry * 1.02 * u, rx * 1.6 * u, 0.8 * u, 0.4 * u)
    ctx.fill()
  }

  if (look.headphones) {
    ctx.strokeStyle = shade(look.headphones, 0.55)
    ctx.lineWidth = 1.4 * u
    ctx.beginPath()
    ctx.arc(cx, cy - 0.6 * u, rx * 1.04 * u, Math.PI * 1.12, Math.PI * 1.88)
    ctx.stroke()
    for (const side of [-1, 1]) {
      ctx.fillStyle = look.headphones
      ctx.strokeStyle = shade(look.headphones, 0.5)
      ctx.lineWidth = 0.6 * u
      rr(ctx, cx + side * rx * 0.98 * u - 1.6 * u, cy + 0.6 * u, 3.2 * u, 4.0 * u, 1.2 * u)
      ctx.fill()
      ctx.stroke()
    }
  }

  if (look.glasses) {
    ctx.strokeStyle = shade(look.hair, 0.5)
    ctx.lineWidth = 0.8 * u
    ctx.fillStyle = 'rgba(206,228,244,0.24)'
    for (const side of [-1, 1]) {
      rr(ctx, cx + side * 2.9 * u - 2.2 * u, eyeY - 1.7 * u, 4.4 * u, 3.4 * u, 1.0 * u)
      ctx.fill()
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(cx - 0.8 * u, eyeY)
    ctx.lineTo(cx + 0.8 * u, eyeY)
    ctx.stroke()
  }
}

function drawHair(
  ctx: CanvasRenderingContext2D,
  look: Look,
  u: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  const hair = look.hair
  const grad = ctx.createLinearGradient(cx, cy - ry * u, cx, cy - ry * 0.1 * u)
  grad.addColorStop(0, shade(hair, 1.45))
  grad.addColorStop(1, shade(hair, 0.95))
  ctx.fillStyle = grad
  ctx.strokeStyle = shade(hair, 0.5)
  ctx.lineWidth = 0.8 * u

  const cap = (squash: number, lift: number) => {
    ctx.beginPath()
    ctx.ellipse(cx, cy - ry * 0.28 * u - lift * u, rx * 1.02 * u, ry * squash * u, 0, Math.PI, Math.PI * 2)
    ctx.lineTo(cx + rx * 1.02 * u, cy - 2.0 * u)
    ctx.lineTo(cx - rx * 1.02 * u, cy - 2.0 * u)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  switch (look.style) {
    case 'crop': {
      if (look.build >= 1.08) {
        // square crown + sideburn
        ctx.beginPath()
        ctx.moveTo(cx - rx * 1.08 * u, cy + 0.4 * u)
        ctx.lineTo(cx - rx * 1.08 * u, cy - ry * 0.72 * u)
        ctx.lineTo(cx - rx * 0.55 * u, cy - ry * 1.04 * u)
        ctx.lineTo(cx + rx * 0.55 * u, cy - ry * 1.04 * u)
        ctx.lineTo(cx + rx * 1.08 * u, cy - ry * 0.72 * u)
        ctx.lineTo(cx + rx * 1.08 * u, cy - 1.6 * u)
        ctx.lineTo(cx + rx * 0.72 * u, cy - 2.4 * u)
        ctx.lineTo(cx - rx * 0.72 * u, cy - 2.4 * u)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = shade(hair, 0.95)
        rr(ctx, cx + rx * 0.86 * u, cy + 0.2 * u, 1.4 * u, 3.0 * u, 0.5 * u)
        ctx.fill()
      } else {
        cap(0.62, 0.2)
        // rounded fade: one lighter band at the crown
        ctx.fillStyle = shade(hair, 1.2)
        ctx.globalAlpha = 0.35
        ctx.beginPath()
        ctx.ellipse(cx, cy - ry * 0.75 * u, rx * 0.8 * u, 1.6 * u, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }
      break
    }
    case 'short': {
      cap(0.66, 0.3)
      if (look.build >= 1.02) {
        // crew cut: flat top
        ctx.fillStyle = shade(hair, 1.1)
        rr(ctx, cx - rx * 0.86 * u, cy - ry * 0.92 * u, rx * 1.72 * u, 1.4 * u, 0.6 * u)
        ctx.fill()
      } else {
        // quiff at the front
        ctx.fillStyle = shade(hair, 1.18)
        ctx.beginPath()
        ctx.ellipse(cx + rx * 0.42 * u, cy - ry * 0.92 * u, rx * 0.55 * u, 1.7 * u, -0.25, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      break
    }
    case 'side': {
      cap(0.64, 0.25)
      // swept fringe to the right
      ctx.beginPath()
      ctx.moveTo(cx - rx * 0.9 * u, cy - ry * 0.55 * u)
      ctx.quadraticCurveTo(cx + rx * 0.2 * u, cy - ry * 0.95 * u, cx + rx * 1.02 * u, cy - ry * 0.18 * u)
      ctx.quadraticCurveTo(cx + rx * 0.5 * u, cy - ry * 0.55 * u, cx - rx * 0.2 * u, cy - ry * 0.38 * u)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      break
    }
    case 'long': {
      cap(0.66, 0.25)
      for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(cx + side * rx * 0.9 * u, cy - ry * 0.5 * u)
        ctx.quadraticCurveTo(cx + side * rx * 1.16 * u, cy + ry * 0.6 * u, cx + side * rx * 0.98 * u, cy + ry * 1.35 * u)
        ctx.lineTo(cx + side * rx * 0.5 * u, cy + ry * 1.3 * u)
        ctx.quadraticCurveTo(cx + side * rx * 0.66 * u, cy + ry * 0.4 * u, cx + side * rx * 0.55 * u, cy - ry * 0.4 * u)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
      break
    }
    case 'bun': {
      cap(0.62, 0.2)
      ctx.beginPath()
      ctx.arc(cx, cy - ry * 1.02 * u, 2.7 * u, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = shade(hair, 1.2)
      ctx.beginPath()
      ctx.arc(cx - 0.7 * u, cy - ry * 1.02 * u, 0.9 * u, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'curly': {
      cap(0.6, 0.15)
      for (const [dx, dy, r] of [
        [-0.72, -0.68, 2.4],
        [-0.2, -0.86, 2.6],
        [0.38, -0.82, 2.3],
        [0.82, -0.5, 2.1],
      ] as const) {
        ctx.beginPath()
        ctx.arc(cx + dx * rx * u, cy + dy * ry * u, r * u, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      break
    }
    case 'messy': {
      cap(0.58, 0.1)
      for (const [dx, tip] of [
        [-0.6, -1.04],
        [0.02, -1.18],
        [0.62, -1.0],
      ] as const) {
        ctx.beginPath()
        ctx.moveTo(cx + (dx - 0.22) * rx * u, cy - ry * 0.72 * u)
        ctx.lineTo(cx + dx * rx * u, cy + tip * ry * u)
        ctx.lineTo(cx + (dx + 0.24) * rx * u, cy - ry * 0.7 * u)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
      break
    }
  }
}

/**
 * Hands overlay — drawn AFTER the keyboard so they sit on the keys. Two hands
 * at ±3.4 units, the left one 0.4 unit lower, two finger notches and a soft
 * hand shadow on the keycaps.
 */
export function drawAvatarHands(
  ctx: CanvasRenderingContext2D,
  look: Look,
  pose: AvatarPose,
  frame: number,
  cx: number,
  floorY: number,
  h: number,
  deskTopY: number,
): void {
  if (pose === 'walk') return
  void floorY
  const u = h / 44
  const typing = pose === 'typing'
  const lift = typing ? (frame % 2 === 0 ? 0 : 0.55) : 0
  const y = deskTopY - 2.0 * u - lift * u
  ctx.save()
  ctx.lineJoin = 'round'
  for (const side of [-1, 1]) {
    const x = cx + side * 3.2 * u
    const dy = side === -1 ? 0.35 * u : 0
    // hand shadow on the keys
    ctx.fillStyle = 'rgba(0,0,0,0.42)'
    ctx.beginPath()
    ctx.ellipse(x + 0.3 * u, y + 2.2 * u + dy, 2.0 * u, 0.6 * u, 0, 0, Math.PI * 2)
    ctx.fill()
    // hand
    ctx.fillStyle = shade(look.skin, 1.04)
    ctx.strokeStyle = shade(look.skin, 0.5)
    ctx.lineWidth = 0.55 * u
    rr(ctx, x - 1.7 * u, y + dy, 3.4 * u, 2.0 * u, 1.0 * u)
    ctx.fill()
    ctx.stroke()
    // finger notches
    ctx.strokeStyle = shade(look.skin, 0.72)
    ctx.lineWidth = 0.35 * u
    for (const nx of [-0.8, 0.0, 0.8]) {
      ctx.beginPath()
      ctx.moveTo(x + nx * u, y + 1.6 * u + dy)
      ctx.lineTo(x + nx * u, y + 1.95 * u + dy)
      ctx.stroke()
    }
    // cuff
    ctx.fillStyle = shade(look.shirt, 0.8)
    rr(ctx, x - 1.8 * u, y + 1.85 * u + dy, 3.6 * u, 0.7 * u, 0.35 * u)
    ctx.fill()
  }
  ctx.restore()
}
