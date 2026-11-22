/**
 * The 2D office canvas: one <canvas> with pan/zoom and a per-frame painter.
 *
 * Replaces the three.js scene behind the same props. The viewport is integer
 * zoom 1..4 over one floor at a time (TILE=16; L1 28×20, L2 20×16, L3 24×18);
 * the backing store is sized to the CSS box times devicePixelRatio and the
 * frame is blitted with an integer factor so pixel-art stays nearest-neighbour
 * crisp on fractional DPRs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StatusPayload, Agent, Comm } from '../lib/types'
import type { AgentMeta } from '../lib/agents'
import { agentsFor } from '../lib/roster'
import type { MoveIntent, RigCommand } from '../lib/view'
import { SPOT_VIEW } from '../lib/view'
import { pickTargets, placeAgents, renderFrame, staticLayerFor } from './render'
import { TILE, clampCenter, clampZoom, fitZoom, nearestAt, screenToWorld, type Viewport } from './viewport'

export interface OfficeProps {
  status: StatusPayload | null
  command: RigCommand
  moveIntent: React.MutableRefObject<MoveIntent>
  onNear: (id: string | null) => void
  onMove: () => void
  onPick: (id: string) => void
  dpr?: [number, number]
}

const PAN_SPEED = 6 // world units per second while a key/pad is held

function initialVp(command: RigCommand): Viewport {
  const floor = command.floor ?? 1
  const spot = SPOT_VIEW[floor][command.spot] ?? SPOT_VIEW[floor].lobby ?? { x: 0, z: 0, zoom: 2 }
  return { x: spot.x, z: spot.z, zoom: spot.zoom, floor }
}

/**
 * The zoom control speaks in honest percentages: zoom 1 draws 1 world px per
 * CSS px, so it is 100 % (a 448×320 floor), zoom 2 is 200 %. Calling zoom 1
 * "50 %" made the phone default look like a fractional zoom when it was not.
 */
function zoomPercent(zoom: number): string {
  return `${zoom * 100}%`
}

/** The canvas fills its wrapper; wrapper size is what pan-clamp uses. */
export function Office2D({ status, command, moveIntent, onNear, onMove, onPick }: OfficeProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const vpRef = useRef<Viewport>(initialVp(command))
  const [zoomLabel, setZoomLabel] = useState(vpRef.current.zoom)
  /** a "tampak" command arrived before the canvas had a size — fit after resize */
  const fitPending = useRef(SPOT_VIEW[vpRef.current.floor][command.spot]?.fit === true)
  const viewRef = useRef({ w: 0, h: 0, dpr: 1 })
  const tRef = useRef(0)
  const readyRef = useRef(false)
  const keysRef = useRef(new Set<string>())
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const dragRef = useRef<{ x: number; y: number; id: number; moved: number } | null>(null)
  const pinchRef = useRef<{ d: number } | null>(null)
  const nearRef = useRef<string | null>(null)

  const still = useMemo(() => {
    const q = new URLSearchParams(window.location.search)
    return q.get('still') === '1'
  }, [])
  const reducedMotion = useMemo(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const metas = useMemo(() => agentsFor((status?.agents ?? []).map((a) => a.id)), [status])
  const byId = useMemo(() => {
    const m = new Map<string, Agent>()
    for (const a of status?.agents ?? []) m.set(a.id, a)
    return m
  }, [status])

  const frame = useRef<{ metas: AgentMeta[]; byId: Map<string, Agent>; now: number; comms: Comm[] }>({
    metas,
    byId,
    now: status?.now ?? Date.now() / 1000,
    comms: status?.comms ?? [],
  })
  useEffect(() => {
    frame.current = { metas, byId, now: status?.now ?? Date.now() / 1000, comms: status?.comms ?? [] }
  }, [metas, byId, status])

  // spot / focus commands from the HUD, roster and deep links
  useEffect(() => {
    if (command.focus) {
      fitPending.current = false
      vpRef.current = {
        x: command.focus.x,
        z: command.focus.z,
        zoom: command.tight ? 4 : 3,
        floor: command.focus.floor,
      }
    } else {
      const floor = command.floor ?? vpRef.current.floor
      const sv = SPOT_VIEW[floor][command.spot] ?? SPOT_VIEW[floor].lobby ?? { x: 0, z: 0, zoom: 2 }
      vpRef.current = { x: sv.x, z: sv.z, zoom: sv.zoom, floor }
      fitPending.current = sv.fit === true
      if (fitPending.current) {
        const { w, h } = viewRef.current
        if (w > 0 && h > 0) {
          vpRef.current = { x: 0, z: 0, zoom: fitZoom(floor, w, h), floor }
          fitPending.current = false
        }
      }
    }
    setZoomLabel(vpRef.current.zoom)
  }, [command])

  const zoomBy = useCallback((delta: number) => {
    const { w, h } = viewRef.current
    const zoom = clampZoom(vpRef.current.zoom + delta)
    if (w <= 0 || h <= 0) {
      vpRef.current = { ...vpRef.current, zoom }
      setZoomLabel(zoom)
      return
    }
    const world = screenToWorld(vpRef.current, w, h, w / 2, h / 2)
    vpRef.current = {
      x: world.x - (w / 2 - w / 2) / (TILE * zoom),
      z: world.z - (h / 2 - h / 2) / (TILE * zoom),
      zoom,
      floor: vpRef.current.floor,
    }
    setZoomLabel(zoom)
  }, [])

  const resize = useCallback(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const w = wrap.clientWidth
    const h = wrap.clientHeight
    if (w === 0 || h === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    viewRef.current = { w, h, dpr }
    // first size (or a pending "tampak"): fit the whole floor, never crop it
    if (fitPending.current) {
      vpRef.current = { x: 0, z: 0, zoom: fitZoom(vpRef.current.floor, w, h), floor: vpRef.current.floor }
      fitPending.current = false
      setZoomLabel(vpRef.current.zoom)
    }
  }, [])

  // the render loop, mounted once; reads the latest data from refs
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    resize()

    let raf = 0
    let last = performance.now()

    const applyPan = (dt: number) => {
      const mi = moveIntent.current
      let kx = 0
      let kz = 0
      const k = keysRef.current
      if (k.has('w') || k.has('arrowup')) kz += 1
      if (k.has('s') || k.has('arrowdown')) kz -= 1
      if (k.has('a') || k.has('arrowleft')) kx -= 1
      if (k.has('d') || k.has('arrowright')) kx += 1
      kx += mi.x
      kz += mi.z
      if (kx !== 0 || kz !== 0) {
        vpRef.current.x += kx * PAN_SPEED * dt
        vpRef.current.z -= kz * PAN_SPEED * dt
        onMove()
      }
    }

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      if (document.hidden) {
        last = ts
        return
      }
      const dt = Math.min(0.1, (ts - last) / 1000)
      last = ts
      if (!still && !reducedMotion) tRef.current += dt

      applyPan(dt)
      const { w, h, dpr } = viewRef.current
      if (w > 0 && h > 0) {
        vpRef.current = clampCenter(vpRef.current, w, h)
        const f = frame.current
        renderFrame(ctx, {
          static: staticLayerFor(vpRef.current.floor),
          metas: f.metas,
          byId: f.byId,
          now: f.now,
          comms: f.comms,
          vp: vpRef.current,
          viewW: w,
          viewH: h,
          dpr,
          stale: false,
          still: still || reducedMotion,
          t: tRef.current,
        })

        // proximity: nearest agent to the viewport centre, on this floor —
        // an in-transit delegate counts on the floor their journey is on
        const targets = pickTargets(placeAgents(f.metas, f.byId, f.now, f.comms, tRef.current)).filter(
          (p) => p.floor === vpRef.current.floor,
        )
        const centre = screenToWorld(vpRef.current, w, h, w / 2, h / 2)
        const near = nearestAt(targets, centre.x, centre.z, 2.5)
        if (near !== nearRef.current) {
          nearRef.current = near
          onNear(near)
        }
      }

      if (!readyRef.current) {
        readyRef.current = true
        ;(window as unknown as { __office2dReady?: boolean }).__office2dReady = true
        ;(window as unknown as { __office2dVp?: () => Viewport }).__office2dVp = () => vpRef.current
      }
    }
    raf = requestAnimationFrame(loop)

    const ro = new ResizeObserver(resize)
    if (wrapRef.current) ro.observe(wrapRef.current)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [moveIntent, onMove, onNear, reducedMotion, resize, still])

  // keyboard pan / zoom
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault()
      }
      keysRef.current.add(k)
      if (k === '+' || k === '=') zoomBy(1)
      if (k === '-') zoomBy(-1)
    }
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase())
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [zoomBy])

  // pointer: drag to pan, tap to pick, two fingers to pinch-zoom
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointersRef.current.size === 1) {
        dragRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 }
      } else if (pointersRef.current.size === 2) {
        dragRef.current = null
        const [a, b] = [...pointersRef.current.values()]
        const a0 = a!
        const b0 = b!
        pinchRef.current = { d: Math.hypot(a0.x - b0.x, a0.y - b0.y) }
      }
    }
    const move = (e: PointerEvent) => {
      const p = pointersRef.current.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointersRef.current.size >= 2 && pinchRef.current) {
        const [a, b] = [...pointersRef.current.values()]
        const a0 = a!
        const b0 = b!
        const d = Math.hypot(a0.x - b0.x, a0.y - b0.y)
        if (pinchRef.current.d > 0 && d > 0) {
          const factor = d / pinchRef.current.d
          const { w, h } = viewRef.current
          const cx = (a0.x + b0.x) / 2
          const cy = (a0.y + b0.y) / 2
          const rect = canvas.getBoundingClientRect()
          const world = screenToWorld(vpRef.current, w, h, cx - rect.left, cy - rect.top)
          const zoom = clampZoom(Math.round(vpRef.current.zoom * factor))
          vpRef.current = {
            x: world.x - (cx - rect.left - w / 2) / (TILE * zoom),
            z: world.z - (cy - rect.top - h / 2) / (TILE * zoom),
            zoom,
            floor: vpRef.current.floor,
          }
          setZoomLabel(zoom)
          onMove()
        }
        pinchRef.current.d = d
        return
      }

      const d = dragRef.current
      if (!d || d.id !== e.pointerId) return
      d.moved += Math.abs(dx) + Math.abs(dy)
      if (d.moved > 4) {
        const { w, h } = viewRef.current
        const zoom = vpRef.current.zoom
        if (w > 0 && h > 0 && zoom > 0) {
          vpRef.current.x -= dx / (TILE * zoom)
          vpRef.current.z -= dy / (TILE * zoom)
        }
        onMove()
      }
      d.x = e.clientX
      d.y = e.clientY
    }
    const up = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId)
      if (pointersRef.current.size < 2) pinchRef.current = null
      const d = dragRef.current
      dragRef.current = null
      if (d && d.id === e.pointerId && d.moved <= 4) {
        const rect = canvas.getBoundingClientRect()
        const { w, h } = viewRef.current
        if (w > 0 && h > 0) {
          const world = screenToWorld(vpRef.current, w, h, e.clientX - rect.left, e.clientY - rect.top)
          const targets = pickTargets(placeAgents(frame.current.metas, frame.current.byId, frame.current.now, frame.current.comms, tRef.current)).filter(
            (p) => p.floor === vpRef.current.floor,
          )
          const hit = nearestAt(targets, world.x, world.z, 0.9)
          onPick(hit ?? '')
        }
      }
    }
    const cancel = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId)
      dragRef.current = null
      pinchRef.current = null
    }

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', cancel)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', cancel)
    }
  }, [onMove, onPick])

  return (
    <div className="scene2d" ref={wrapRef}>
      <canvas ref={canvasRef} className="scene2d-canvas" role="application" aria-label="Kantor agen 2D" />
      <div className="zoom-ctrl" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Perkecil">
          −
        </button>
        <span aria-hidden="true">{zoomPercent(zoomLabel)}</span>
        <button type="button" onClick={() => zoomBy(1)} aria-label="Perbesar">
          +
        </button>
      </div>
    </div>
  )
}

export default Office2D
