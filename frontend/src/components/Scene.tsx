import { Suspense, lazy } from 'react'
import type { OfficeProps } from '../scene/Office'

/**
 * The 3D office is loaded on demand. three.js + @react-three/fiber are ~1 MB of
 * the entry bundle and nothing the visitor reads first (HUD, roster, feed,
 * task board) needs them: the scene chunk is requested on the first render and
 * downloads in parallel while the HUD paints.
 */
const OfficeScene = lazy(() => import('../scene/Office').then((m) => ({ default: m.Office })))

/** Skeleton shown for the few hundred ms the scene chunk is in flight. */
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

export function Scene(props: OfficeProps) {
  return (
    <Suspense fallback={<ScenePlaceholder />}>
      <OfficeScene {...props} />
    </Suspense>
  )
}
