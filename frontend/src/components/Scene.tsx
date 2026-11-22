import { Suspense, lazy, useEffect, useState } from 'react'
import type { OfficeProps } from '../scene2d/Office2D'

/**
 * The 2D office is loaded on demand. The entry bundle only needs the panels
 * (HUD, roster, feed, task board) and the small view types; the canvas painter
 * is a separate chunk fetched after the panels have painted, so first paint
 * stays light.
 */
const Office2DScene = lazy(() => import('../scene2d/Office2D').then((m) => ({ default: m.Office2D })))

/** Skeleton shown until the 2D chunk is requested and mounted. */
function ScenePlaceholder() {
  return (
    <div className="scene-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="scene-loading-desks" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <p>menyiapkan kantor…</p>
      <small>memuat kantor 2D</small>
    </div>
  )
}

/**
 * Mount the canvas one paint after the HUD.
 *
 * Requesting the chunk during the first render is not enough: the module is
 * evaluated and the canvas built in the same task, so on a fast link the main
 * thread never gets to paint the panels first. Waiting two frames lets the HUD
 * commit and paint, then the painter takes over.
 */
export function Scene(props: OfficeProps) {
  const [mount, setMount] = useState(false)

  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setMount(true))
    })
    // rAF is throttled in background tabs; the office must still appear.
    const fallback = window.setTimeout(() => setMount(true), 1500)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.clearTimeout(fallback)
    }
  }, [])

  if (!mount) return <ScenePlaceholder />

  return (
    <Suspense fallback={<ScenePlaceholder />}>
      <Office2DScene {...props} />
    </Suspense>
  )
}
