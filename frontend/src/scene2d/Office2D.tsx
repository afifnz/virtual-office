/**
 * The 2D office canvas — side view (elevation) with pan + zoom.
 *
 * One floor at a time. Desktop: camera at 150 px/unit at zoom 2 (1000×688
 * stage), zoom 1 is half scale. Phone: the default camera *fits the whole
 * floor* (0.39 at 390×692 — every desk and nameplate visible, avatar ≈58 CSS
 * px, like the R&D mockup); zooming in from there is what makes panning
 * necessary. The static stage is cached per (floor × theme); the dynamic pass
 * draws desks, vector avatars, the live board, clock and lift car.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StatusPayload, Agent, Comm } from '../lib/types'
import type { AgentMeta } from '../lib/agents'
import { agentsFor, officeTZ } from '../lib/roster'
import { FLOORS, LIFT, type FloorId } from '../lib/rooms'
import type { MoveIntent, RigCommand } from '../lib/view'
import { SPOT_VIEW } from '../lib/view'
import { clockInTimeZone } from '../lib/theme'
import type { ThemeName } from './palette'
import { pickTargets, placeAgents, renderFrame } from './render'
import { buildingHit, buildingReport, renderBuildingFrame } from './render-building'
import { buildingSeats, SCENE_ZOOM } from './building'
import { trafficReport, trafficAt } from './traffic'
import { labelAgentsFor, layoutSideLabels, sideGate } from './labels'
import {
  PHONE_CTRL_BAND,
  SIDE_AVATAR_H,
  SIDE_H,
  SIDE_ROOM_H,
  SIDE_W,
  clampSideCam,
  clampSideCamY,
  screenToDesign,
  sideSeats,
  sideTransform,
  sideWallGate,
  worldXToDesign,
  type SideViewport,
} from './side'
import { MAX_ZOOM, clampZoom, fitZoom } from './viewport'
import { useIsMobile } from '../hooks/useViewport'

export interface OfficeProps {
  status: StatusPayload | null
  command: RigCommand
  moveIntent: React.MutableRefObject<MoveIntent>
  onNear: (id: string | null) => void
  onMove: () => void
  onPick: (id: string) => void
  /** click a floor band in the building view → open that floor */
  onFloor?: (floor: FloorId) => void
  /** true while the stage is wider than the canvas, i.e. panning does something */
  onPan?: (canPan: boolean) => void
  theme: ThemeName
  dpr?: [number, number]
}

const PAN_SPEED = 380 // design px per second while a key/pad is held
/** Phone zoom step: the fit is 0.78, so a whole step would jump past the floor. */
const PHONE_ZOOM_STEP = 0.25
/**
 * The building overview may zoom past 1:1 (the per-floor camera stops at 2).
 * On a desktop 2 is already the whole 1000×688 sheet, so 3 is what makes the
 * two-axis pan meaningful; on a phone the fit is the floor of the range.
 */
const BUILDING_MAX_ZOOM = 3

function initialVp(command: RigCommand): SideViewport {
  const floor = command.floor ?? 1
  return { camX: SIDE_W / 2, zoom: 1, floor }
}

function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

export function Office2D({ status, command, moveIntent, onNear, onMove, onPick, onFloor, onPan, theme }: OfficeProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const vpRef = useRef<SideViewport>(initialVp(command))
  /** the whole-building overview is a camera mode, not a different scene */
  const buildingRef = useRef(command.mode === 'building')
  buildingRef.current = command.mode === 'building'
  // null until the first resize knows the canvas: the label then shows the fit
  // (78 % on a phone), never a provisional 100 %
  const [zoomLabel, setZoomLabel] = useState<number | null>(null)
  const fitPending = useRef(SPOT_VIEW[vpRef.current.floor][command.spot]?.fit !== false)
  const lastFitRef = useRef(0)
  const panRef = useRef(false)
  const onPanRef = useRef(onPan)
  onPanRef.current = onPan
  const viewRef = useRef({ w: 0, h: 0, dpr: 1 })
  const tRef = useRef(0)
  const readyRef = useRef(false)
  const keysRef = useRef(new Set<string>())
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const dragRef = useRef<{ x: number; y: number; id: number; moved: number } | null>(null)
  const pinchRef = useRef<{ d: number } | null>(null)
  const nearRef = useRef<string | null>(null)
  const themeRef = useRef<ThemeName>(theme)
  themeRef.current = theme
  // The phone layout floats the pad over the canvas, so the painter keeps a
  // bottom band clear for it. Derived from the layout breakpoint, never from the
  // canvas width: a desktop window narrowed by the roster rail is < 760 px too
  // and must keep its 150 px/unit camera.
  const phone = useIsMobile()
  const bandRef = useRef(phone ? PHONE_CTRL_BAND : 0)
  bandRef.current = phone ? PHONE_CTRL_BAND : 0
  const perfRef = useRef<{ samples: number[]; frames: number; last: number }>({ samples: [], frames: 0, last: 0 })

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
    now: status?.now ?? 0,
    comms: status?.comms ?? [],
  })
  useEffect(() => {
    frame.current = { metas, byId, now: status?.now ?? 0, comms: status?.comms ?? [] }
  }, [metas, byId, status])

  // spot / focus / view-mode commands from the HUD, roster and deep links
  useEffect(() => {
    const floor = command.floor ?? vpRef.current.floor
    if (command.mode === 'building') {
      // overview: park on the sheet centre (the building is centred) and fit
      const { w, h } = viewRef.current
      const fit = w > 0 && h > 0 ? fitZoom(floor, w, h, bandRef.current) : 1
      vpRef.current = { camX: SIDE_W / 2, camY: SIDE_H / 2, zoom: fit, floor }
      fitPending.current = false
      lastFitRef.current = fit
      setZoomLabel(fit)
      return
    }
    if (command.focus) {
      fitPending.current = false
      const focusFloor = command.focus.floor
      const seat = command.focus.id
        ? sideSeats(frame.current.metas.filter((m) => m.desk.floor === focusFloor)).find(
            (s) => s.meta.id === command.focus!.id,
          )
        : undefined
      vpRef.current = {
        camX: seat?.cx ?? worldXToDesign(command.focus.x, FLOORS[focusFloor].w),
        zoom: 2,
        floor: focusFloor,
      }
    } else {
      const sv = SPOT_VIEW[floor][command.spot]
      vpRef.current = { camX: SIDE_W / 2, zoom: sv ? 2 : 2, floor }
      fitPending.current = true
      const { w, h } = viewRef.current
      if (w > 0 && h > 0) {
        vpRef.current = { camX: SIDE_W / 2, zoom: fitZoom(floor, w, h, bandRef.current), floor }
        fitPending.current = false
      }
    }
    setZoomLabel(vpRef.current.zoom)
  }, [command])

  const zoomBy = useCallback((delta: number) => {
    const { w, h } = viewRef.current
    const band = bandRef.current
    // the phone's floor is the fit: you can zoom in, never out past the floor
    const min = band > 0 ? fitZoom(vpRef.current.floor, w, h, band) : undefined
    const step = band > 0 ? PHONE_ZOOM_STEP : buildingRef.current ? 0.5 : 1
    const max = buildingRef.current ? BUILDING_MAX_ZOOM : MAX_ZOOM
    const zoom = clampZoom(vpRef.current.zoom + delta * step, min, max)
    const camY = clampSideCamY(vpRef.current.camY ?? SIDE_H / 2, w, h, zoom, band)
    vpRef.current = { ...vpRef.current, zoom, camX: clampSideCam(vpRef.current.camX, w, h, zoom, band), camY }
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
    const fit = fitZoom(vpRef.current.floor, w, h, bandRef.current)
    // re-fit on the first layout, on a floor change, and whenever the view is
    // still at the fit (rotation, address-bar resize) — never over a zoom the
    // user chose
    if (fitPending.current || Math.abs(vpRef.current.zoom - lastFitRef.current) < 1e-6) {
      vpRef.current = { camX: SIDE_W / 2, zoom: fit, floor: vpRef.current.floor }
      fitPending.current = false
      setZoomLabel(fit)
    }
    lastFitRef.current = fit
    vpRef.current = {
      ...vpRef.current,
      camX: clampSideCam(vpRef.current.camX, w, h, vpRef.current.zoom, bandRef.current),
      camY: clampSideCamY(vpRef.current.camY ?? SIDE_H / 2, w, h, vpRef.current.zoom, bandRef.current),
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
      let ky = 0
      const k = keysRef.current
      if (k.has('a') || k.has('arrowleft')) kx -= 1
      if (k.has('d') || k.has('arrowright')) kx += 1
      kx += mi.x
      if (buildingRef.current) {
        // the building is taller than a phone canvas once zoomed in: W/↑ (and
        // the pad's forward arrow) look up, S/↓ look down
        if (k.has('w') || k.has('arrowup')) ky += 1
        if (k.has('s') || k.has('arrowdown')) ky -= 1
        ky += mi.z
      }
      if (kx !== 0 || ky !== 0) {
        const { w, h } = viewRef.current
        const band = bandRef.current
        const zoom = vpRef.current.zoom
        vpRef.current = {
          ...vpRef.current,
          camX: clampSideCam(vpRef.current.camX - kx * PAN_SPEED * dt, w, h, zoom, band),
          camY: clampSideCamY(
            (vpRef.current.camY ?? SIDE_H / 2) - ky * PAN_SPEED * dt,
            w,
            h,
            zoom,
            band,
          ),
        }
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
        const f = frame.current
        const clock = clockInTimeZone(f.now || 0, officeTZ()) ?? { hour: 12, minute: 0 }
        const t0 = performance.now()
        const building = buildingRef.current
        // keep the street clock in step even while a floor is on screen, so
        // opening GEDUNG after an hour never replays the whole session
        if (!building) trafficAt(tRef.current)
        if (building) {
          renderBuildingFrame(ctx, {
            theme: themeRef.current,
            metas: f.metas,
            byId: f.byId,
            now: f.now,
            comms: f.comms,
            vp: vpRef.current,
            viewW: w,
            viewH: h,
            band: bandRef.current,
            dpr,
            still: still || reducedMotion,
            t: tRef.current,
          })
        } else {
          renderFrame(ctx, {
            theme: themeRef.current,
            metas: f.metas,
            byId: f.byId,
            now: f.now,
            comms: f.comms,
            vp: vpRef.current,
            viewW: w,
            viewH: h,
            band: bandRef.current,
            dpr,
            still: still || reducedMotion,
            t: tRef.current,
            hour: clock.hour,
            minute: clock.minute,
          })
        }
        const cost = performance.now() - t0
        const perf = perfRef.current
        perf.samples.push(cost)
        if (perf.samples.length > 180) perf.samples.shift()
        perf.frames++
        perf.last = cost

        // proximity: nearest agent to the viewport centre. In the building view
        // that is the nearest of all 13 seats; on a floor, only that floor's.
        const placed = placeAgents(f.metas, f.byId, f.now, f.comms, tRef.current)
        const tr = sideTransform(w, h, vpRef.current, bandRef.current)
        // the D-pad only earns its place once there is something to pan to:
        // at the fit zoom the whole building/floor is on screen and it is hidden
        const usableH = Math.max(0, h - bandRef.current)
        const canPan = building
          ? SIDE_W * tr.s > w + 0.5 || SIDE_H * tr.s > usableH + 0.5
          : SIDE_W * tr.s > w + 0.5
        if (canPan !== panRef.current) {
          panRef.current = canPan
          onPanRef.current?.(canPan)
        }
        const centre = screenToDesign(tr, w / 2, h / 2)
        let near: string | null = null
        let best = Infinity
        if (building) {
          // screenToDesign returns STAGE px; the building geometry is design
          // px (one SCENE_ZOOM smaller), so divide before measuring
          const cx = centre.x / SCENE_ZOOM
          const cy = centre.y / SCENE_ZOOM
          for (const seat of buildingSeats(f.metas)) {
            const d = Math.hypot(seat.cx - cx, seat.floorY - seat.avatarH / 2 - cy)
            if (d < best) {
              best = d
              near = seat.meta.id
            }
          }
          if (best > 26) near = null
        } else {
          const targets = pickTargets(placed).filter((p) => p.floor === vpRef.current.floor)
          for (const p of targets) {
            const d = Math.hypot(p.designX - centre.x, p.designY - p.h / 2 - centre.y)
            if (d < best) {
              best = d
              near = p.id
            }
          }
          if (best > 160) near = null
        }
        if (near !== nearRef.current) {
          nearRef.current = near
          onNear(near)
        }
      }

      if (!readyRef.current) {
        readyRef.current = true
        const w2 = window as unknown as Record<string, unknown>
        w2.__office2dReady = true
        w2.__office2dVp = () => vpRef.current
        w2.__office2dTheme = () => themeRef.current
        w2.__office2dPerf = () => perfReport(perfRef.current)
        w2.__office2dMode = () => (buildingRef.current ? 'building' : 'floor')
        // street life (traffic + light + crowd), no privacy data
        w2.__office2dTraffic = () => trafficReport(tRef.current)
        // building geometry + gates for the browser probe (no privacy data)
        w2.__office2dBuilding = () => {
          const placedNow = placeAgents(frame.current.metas, frame.current.byId, frame.current.now, frame.current.comms, tRef.current)
          return buildingReport(
            frame.current.metas,
            placedNow.map((p) => ({ id: p.meta.id, floor: p.floor, inLift: p.inLift, liftTo: p.liftTo })),
            tRef.current,
          )
        }
        // verify-office probe hook: per-floor facts, no privacy data
        w2.__office2dFloors = () => {
          const metasNow = frame.current.metas
          const byFloor = (fl: number) => metasNow.filter((m) => m.desk.floor === fl)
          return {
            floor: vpRef.current.floor,
            zoom: vpRef.current.zoom,
            theme: themeRef.current,
            mode: buildingRef.current ? 'building' : 'floor',
            camera: buildingRef.current ? 'building' : 'side',
            floors: [1, 2, 3].map((fl) => ({
              floor: fl,
              desks: byFloor(fl).length,
              agents: byFloor(fl).filter((m) => (frame.current.byId.get(m.id)?.status ?? 'offline') !== 'offline').length,
              lift: {
                x: (LIFT[fl as 1 | 2 | 3].shaft.x1 + LIFT[fl as 1 | 2 | 3].shaft.x2) / 2,
                z: (LIFT[fl as 1 | 2 | 3].shaft.z1 + LIFT[fl as 1 | 2 | 3].shaft.z2) / 2,
              },
            })),
          }
        }
        w2.__office2dLayout = (fl: 1 | 2 | 3 = vpRef.current.floor) => layoutReport(fl, frame.current.metas)
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
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault()
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

  // pointer: drag to pan (horizontal), tap to pick, pinch to zoom
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
        pinchRef.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) }
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
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        if (pinchRef.current.d > 0 && d > 0) {
          const band = bandRef.current
          const { w, h } = viewRef.current
          const min = band > 0 ? fitZoom(vpRef.current.floor, w, h, band) : undefined
          const max = buildingRef.current ? BUILDING_MAX_ZOOM : MAX_ZOOM
          const zoom = clampZoom(vpRef.current.zoom * (d / pinchRef.current.d), min, max)
          vpRef.current = {
            ...vpRef.current,
            zoom,
            camX: clampSideCam(vpRef.current.camX, w, h, zoom, band),
            camY: clampSideCamY(vpRef.current.camY ?? SIDE_H / 2, w, h, zoom, band),
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
        const tr = sideTransform(w, h, vpRef.current, bandRef.current)
        vpRef.current = {
          ...vpRef.current,
          camX: clampSideCam(vpRef.current.camX - dx / tr.s, w, h, vpRef.current.zoom, bandRef.current),
          camY: buildingRef.current
            ? clampSideCamY(
                (vpRef.current.camY ?? SIDE_H / 2) - dy / tr.s,
                w,
                h,
                vpRef.current.zoom,
                bandRef.current,
              )
            : vpRef.current.camY,
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
          const tr = sideTransform(w, h, vpRef.current, bandRef.current)
          const pt = screenToDesign(tr, e.clientX - rect.left, e.clientY - rect.top)
          if (buildingRef.current) {
            // stage px → design px (the building sheet is one SCENE_ZOOM smaller
            // than the stage the pointer was mapped onto)
            const hit = buildingHit(buildingSeats(frame.current.metas), pt.x / SCENE_ZOOM, pt.y / SCENE_ZOOM)
            if (hit && 'id' in hit) onPick(hit.id)
            else if (hit && 'floor' in hit) onFloor?.(hit.floor)
            else onPick('')
            return
          }
          const placed = placeAgents(frame.current.metas, frame.current.byId, frame.current.now, frame.current.comms, tRef.current)
          const targets = pickTargets(placed).filter((p) => p.floor === vpRef.current.floor)
          let hit: string | null = null
          let best = Infinity
          for (const p of targets) {
            const inside = Math.abs(pt.x - p.designX) <= p.w / 2 && pt.y >= p.designY - p.h && pt.y <= p.designY + 8
            const dist = Math.hypot(pt.x - p.designX, pt.y - (p.designY - p.h / 2))
            if (inside && dist < best) {
              best = dist
              hit = p.id
            }
          }
          if (!hit) {
            for (const p of targets) {
              const dist = Math.hypot(pt.x - p.designX, pt.y - (p.designY - p.h / 2))
              if (dist < 46 && dist < best) {
                best = dist
                hit = p.id
              }
            }
          }
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
  }, [onFloor, onMove, onPick])

  return (
    <div className="scene2d" ref={wrapRef}>
      <canvas ref={canvasRef} className="scene2d-canvas" role="application" aria-label="Kantor agen 2D, tampak samping" />
      <div className="zoom-ctrl" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Perkecil">
          −
        </button>
        <span aria-hidden="true">{zoomLabel === null ? '' : zoomPercent(zoomLabel)}</span>
        <button type="button" onClick={() => zoomBy(1)} aria-label="Perbesar">
          +
        </button>
      </div>
    </div>
  )
}

/** Rolling frame-cost report (measured, in this browser). */
function perfReport(perf: { samples: number[]; frames: number; last: number }) {
  const s = [...perf.samples].sort((a, b) => a - b)
  const avg = s.length ? s.reduce((n, v) => n + v, 0) / s.length : 0
  const p95 = s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]! : 0
  return {
    frames: perf.frames,
    samples: s.length,
    avgRenderMs: Math.round(avg * 100) / 100,
    p95RenderMs: Math.round(p95 * 100) / 100,
    lastRenderMs: Math.round(perf.last * 100) / 100,
    estimatedFps: avg > 0 ? Math.round(1000 / Math.max(16.7, avg) / 0.01) / 100 : null,
  }
}

/** The side-view layout + gates, exposed for the browser probe. */
function layoutReport(floor: 1 | 2 | 3, metas: AgentMeta[]) {
  const seats = sideSeats(metas.filter((m) => m.desk.floor === floor))
  const labels = labelAgentsFor(
    seats,
    new Map(seats.map((s) => [s.meta.id, { status: 'working', shape: 'circle' as const, colour: '#F2B434' }])),
  )
  const { plates } = layoutSideLabels(labels, { w: SIDE_W, h: SIDE_H })
  return {
    floor,
    rows: {
      front: seats.filter((s) => s.row === 'front').map((s) => ({ id: s.meta.id, x: s.cx })),
      back: seats.filter((s) => s.row === 'back').map((s) => ({ id: s.meta.id, x: s.cx })),
    },
    avatarH: { front: SIDE_AVATAR_H, back: SIDE_AVATAR_H * 0.94 },
    roomH: SIDE_ROOM_H,
    ratio: Math.round((SIDE_ROOM_H / SIDE_AVATAR_H) * 100) / 100,
    gate: sideGate(seats, plates, { w: SIDE_W, h: SIDE_H }),
    wall: sideWallGate(),
    seats: seats.map((s) => ({ id: s.meta.id, row: s.row, slot: s.slot, x: s.cx, floorY: s.floorY, avatarH: s.avatarH })),
  }
}

export default Office2D
