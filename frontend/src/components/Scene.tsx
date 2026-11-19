import { Suspense, lazy, useEffect, useState } from 'react'
import type { OfficeProps } from '../scene/Office'

/**
 * The 3D office is loaded on demand. three.js + @react-three/fiber are ~1 MB of
 * the entry bundle and nothing the visitor reads first (HUD, roster, feed,
 * task board) needs them: the scene chunk is fetched after the panels have
 * painted, in parallel with them being readable.
 */
const OfficeScene = lazy(() => import('../scene/Office').then((m) => ({ default: m.Office })))

/** Skeleton shown until the scene chunk is requested and mounted. */
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
      <small>memuat ruangan 3D</small>
    </div>
  )
}

/**
 * Mount the scene one paint after the HUD.
 *
 * Requesting the chunk during the first render is not enough: the module is
 * evaluated and the WebGL context built in the same task, so on a fast link the
 * main thread never gets to paint the panels first (measured: HUD at ~1.8 s
 * with the eager import, ~1.6 s when the whole bundle was one file). Waiting
 * two frames lets the HUD commit and paint, then the renderer takes over.
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
      <OfficeScene {...props} />
    </Suspense>
  )
}
