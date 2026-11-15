import * as THREE from 'three'

let floorTex: THREE.CanvasTexture | null = null
let matTex: THREE.CanvasTexture | null = null
let rugTex: THREE.CanvasTexture | null = null

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  return [c, c.getContext('2d')!]
}

/** Terracotta tile floor with grout and a little grain. */
export function floorTexture(): THREE.CanvasTexture {
  if (floorTex) return floorTex
  const [c, ctx] = canvas(256)
  ctx.fillStyle = '#b8a189'
  ctx.fillRect(0, 0, 256, 256)
  const tiles = 2
  const s = 256 / tiles
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const v = 0.94 + ((x + y) % 2) * 0.06
      ctx.fillStyle = `rgb(${Math.round(190 * v)},${Math.round(163 * v)},${Math.round(133 * v)})`
      ctx.fillRect(x * s + 2, y * s + 2, s - 4, s - 4)
      // veins
      ctx.strokeStyle = 'rgba(120,96,74,0.10)'
      ctx.lineWidth = 1
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.moveTo(x * s + 10 + i * 30, y * s + 6)
        ctx.bezierCurveTo(
          x * s + 20 + i * 30, y * s + 40,
          x * s + 4 + i * 30, y * s + 80,
          x * s + 16 + i * 30, y * s + s - 6,
        )
        ctx.stroke()
      }
    }
  }
  ctx.strokeStyle = 'rgba(90,72,58,0.35)'
  ctx.lineWidth = 2
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath()
    ctx.moveTo(i * s, 0)
    ctx.lineTo(i * s, 256)
    ctx.moveTo(0, i * s)
    ctx.lineTo(256, i * s)
    ctx.stroke()
  }
  floorTex = new THREE.CanvasTexture(c)
  floorTex.wrapS = THREE.RepeatWrapping
  floorTex.wrapT = THREE.RepeatWrapping
  floorTex.repeat.set(11, 8)
  floorTex.colorSpace = THREE.SRGBColorSpace
  floorTex.anisotropy = 8
  return floorTex
}

/** Lime plaster for the walls. */
export function plasterTexture(): THREE.CanvasTexture {
  if (matTex) return matTex
  const [c, ctx] = canvas(128)
  ctx.fillStyle = '#e9dfcc'
  ctx.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 1400; i++) {
    const a = Math.random() * 0.05
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(150,130,105,${a})`
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2)
  }
  matTex = new THREE.CanvasTexture(c)
  matTex.wrapS = THREE.RepeatWrapping
  matTex.wrapT = THREE.RepeatWrapping
  matTex.repeat.set(6, 2)
  matTex.colorSpace = THREE.SRGBColorSpace
  return matTex
}

/** Songket for the lobby rug: deep red with gold diamonds and pucuk rebung borders. */
export function rugTexture(): THREE.CanvasTexture {
  if (rugTex) return rugTex
  const [c, ctx] = canvas(256)
  ctx.fillStyle = '#7a1f2a'
  ctx.fillRect(0, 0, 256, 256)
  const gold = '#d9aa4e'
  // field: a lattice of small gold diamonds (bunga tabur)
  ctx.fillStyle = gold
  for (let y = 56; y <= 200; y += 24) {
    for (let x = 56; x <= 200; x += 24) {
      const r = (x + y) % 48 === 0 ? 7 : 4
      ctx.beginPath()
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x, y + r)
      ctx.lineTo(x - r, y)
      ctx.closePath()
      ctx.fill()
    }
  }
  // border band with pucuk rebung (bamboo-shoot triangles) pointing inward
  ctx.fillStyle = '#4e1018'
  ctx.fillRect(0, 0, 256, 34)
  ctx.fillRect(0, 222, 256, 34)
  ctx.fillRect(0, 0, 34, 256)
  ctx.fillRect(222, 0, 34, 256)
  ctx.fillStyle = gold
  for (let i = 0; i < 8; i++) {
    const p = 16 + i * 32
    const tri = (ax: number, ay: number, bx: number, by: number, tx: number, ty: number) => {
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.lineTo(tx, ty)
      ctx.closePath()
      ctx.fill()
    }
    tri(p - 12, 4, p + 12, 4, p, 30)
    tri(p - 12, 252, p + 12, 252, p, 226)
    tri(4, p - 12, 4, p + 12, 30, p)
    tri(252, p - 12, 252, p + 12, 226, p)
  }
  ctx.strokeStyle = gold
  ctx.lineWidth = 2
  ctx.strokeRect(36, 36, 184, 184)
  rugTex = new THREE.CanvasTexture(c)
  rugTex.colorSpace = THREE.SRGBColorSpace
  return rugTex
}

/** Soft radial shadow blob, cheaper and smoother than a shadow map. */
export function contactShadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128)
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  g.addColorStop(0, 'rgba(0,0,0,0.5)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.22)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/* ------------------------------------------------------------------ *
 * Nusantara motifs. All procedural (canvas), cached, no image assets.
 * ------------------------------------------------------------------ */

const motifCache = new Map<string, THREE.CanvasTexture>()

function cached(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  const hit = motifCache.get(key)
  if (hit) return hit
  const t = make()
  t.colorSpace = THREE.SRGBColorSpace
  motifCache.set(key, t)
  return t
}

/** Batik kawung in sogan colours: four palm-fruit ovals around a dot, tiled. */
export function kawungTexture(): THREE.CanvasTexture {
  return cached('kawung', () => {
    const [c, ctx] = canvas(128)
    ctx.fillStyle = '#4a2c18'
    ctx.fillRect(0, 0, 128, 128)
    const cell = 64
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const cx = x * cell + cell / 2
        const cy = y * cell + cell / 2
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2 + Math.PI / 4
          ctx.save()
          ctx.translate(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15)
          ctx.rotate(a)
          ctx.beginPath()
          ctx.ellipse(0, 0, 13, 8, 0, 0, Math.PI * 2)
          ctx.fillStyle = '#e6cf9f'
          ctx.fill()
          ctx.lineWidth = 2
          ctx.strokeStyle = '#8a5a2e'
          ctx.stroke()
          ctx.beginPath()
          ctx.ellipse(2, 0, 4, 2.2, 0, 0, Math.PI * 2)
          ctx.fillStyle = '#8a5a2e'
          ctx.fill()
          ctx.restore()
        }
        ctx.beginPath()
        ctx.arc(cx, cy, 3, 0, Math.PI * 2)
        ctx.fillStyle = '#c99a52'
        ctx.fill()
      }
    }
    // isen: the small dots between the motifs
    ctx.fillStyle = 'rgba(230,207,159,0.55)'
    for (const [x, y] of [[0, 0], [64, 0], [0, 64], [64, 64], [128, 0], [0, 128], [128, 128], [64, 128], [128, 64]]) {
      ctx.beginPath()
      ctx.arc(x!, y!, 4, 0, Math.PI * 2)
      ctx.fill()
    }
    const t = new THREE.CanvasTexture(c)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    return t
  })
}

/** Carved teak transom (gebyok/ukiran Jepara): symmetric sulur on a cut-out ground. */
export function ukirTexture(): THREE.CanvasTexture {
  return cached('ukir', () => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, 512, 128)
    const wood = '#6a4329'
    ctx.strokeStyle = wood
    ctx.lineCap = 'round'
    // frame
    ctx.lineWidth = 12
    ctx.strokeRect(6, 6, 500, 116)
    // central medallion
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.ellipse(256, 64, 30, 40, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(256, 64, 12, 18, 0, 0, Math.PI * 2)
    ctx.fillStyle = wood
    ctx.fill()
    // mirrored vines: S-curls with leaf tips
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const x0 = 256 + s * (40 + k * 54)
        ctx.lineWidth = 7
        ctx.beginPath()
        ctx.moveTo(x0, 64)
        ctx.bezierCurveTo(x0 + s * 18, 18, x0 + s * 44, 22, x0 + s * 40, 52)
        ctx.bezierCurveTo(x0 + s * 36, 76, x0 + s * 16, 70, x0 + s * 22, 56)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x0, 64)
        ctx.bezierCurveTo(x0 + s * 18, 110, x0 + s * 44, 106, x0 + s * 50, 84)
        ctx.stroke()
        ctx.beginPath()
        ctx.ellipse(x0 + s * 50, 84, 9, 5, s * 0.6, 0, Math.PI * 2)
        ctx.fillStyle = wood
        ctx.fill()
      }
    }
    // highlights: a lighter inner edge reads as relief
    ctx.globalCompositeOperation = 'source-atop'
    ctx.fillStyle = 'rgba(214,170,110,0.25)'
    ctx.fillRect(0, 0, 512, 60)
    return new THREE.CanvasTexture(c)
  })
}

/** Wayang kulit gunungan: the tree-of-life leaf, pierced leather with gold edges. */
export function gununganTexture(): THREE.CanvasTexture {
  return cached('gunungan', () => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 384
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, 256, 384)
    const leaf = () => {
      ctx.beginPath()
      ctx.moveTo(128, 8)
      ctx.bezierCurveTo(176, 90, 244, 200, 236, 300)
      ctx.lineTo(20, 300)
      ctx.bezierCurveTo(12, 200, 80, 90, 128, 8)
      ctx.closePath()
    }
    leaf()
    ctx.fillStyle = '#7a2e1f'
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#d9a441'
    ctx.stroke()
    // tree of life
    ctx.save()
    leaf()
    ctx.clip()
    ctx.strokeStyle = '#e3b65a'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(128, 296)
    ctx.lineTo(128, 60)
    ctx.stroke()
    ctx.lineWidth = 4
    for (let i = 0; i < 7; i++) {
      const y = 250 - i * 28
      const len = 70 - i * 7
      for (const s of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(128, y)
        ctx.quadraticCurveTo(128 + s * len * 0.6, y - 26, 128 + s * len, y - 8)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(128 + s * len, y - 8, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#2f6b5a'
        ctx.fill()
      }
    }
    // pierced dots (tatahan)
    ctx.fillStyle = 'rgba(0,0,0,0)'
    ctx.globalCompositeOperation = 'destination-out'
    for (let y = 40; y < 290; y += 14) {
      for (let x = 20; x < 240; x += 14) {
        if ((x + y) % 28 === 0) {
          ctx.beginPath()
          ctx.arc(x, y, 1.8, 0, Math.PI * 2)
          ctx.fillStyle = '#000'
          ctx.fill()
        }
      }
    }
    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
    // gate at the base
    ctx.fillStyle = '#5b2216'
    ctx.fillRect(84, 250, 88, 50)
    ctx.strokeStyle = '#d9a441'
    ctx.lineWidth = 4
    ctx.strokeRect(84, 250, 88, 50)
    ctx.fillStyle = '#1c120c'
    ctx.fillRect(116, 266, 24, 34)
    // handle (gapit) down the middle
    ctx.fillStyle = '#c9a26a'
    ctx.fillRect(124, 300, 8, 80)
    return new THREE.CanvasTexture(c)
  })
}

/** Woven bamboo (anyaman) for the lamp shades. */
export function anyamanTexture(): THREE.CanvasTexture {
  return cached('anyaman', () => {
    const [c, ctx] = canvas(64)
    const s = 8
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const over = (x + y) % 2 === 0
        ctx.fillStyle = over ? '#d8b77a' : '#b08d55'
        ctx.fillRect(x * s, y * s, s, s)
        ctx.strokeStyle = 'rgba(80,55,25,0.35)'
        ctx.lineWidth = 1
        ctx.beginPath()
        if (over) {
          ctx.moveTo(x * s, y * s + s / 2)
          ctx.lineTo(x * s + s, y * s + s / 2)
        } else {
          ctx.moveTo(x * s + s / 2, y * s)
          ctx.lineTo(x * s + s / 2, y * s + s)
        }
        ctx.stroke()
      }
    }
    const t = new THREE.CanvasTexture(c)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.set(4, 1)
    return t
  })
}
