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

/** Woven mat for the lobby rug. */
export function rugTexture(): THREE.CanvasTexture {
  if (rugTex) return rugTex
  const [c, ctx] = canvas(256)
  ctx.fillStyle = '#8e3f3a'
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = 'rgba(232,208,170,0.55)'
  ctx.lineWidth = 4
  for (let i = 0; i < 5; i++) {
    ctx.strokeRect(16 + i * 6, 16 + i * 6, 224 - i * 12, 224 - i * 12)
  }
  ctx.strokeStyle = 'rgba(40,26,22,0.25)'
  ctx.lineWidth = 2
  for (let i = 0; i < 256; i += 8) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, 256)
    ctx.stroke()
  }
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
