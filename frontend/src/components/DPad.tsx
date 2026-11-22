import { useEffect, useRef } from 'react'
import type { MoveIntent } from '../lib/view'

/** On-screen movement pad: one tap pans the view while held, 56 px targets. */
export function DPad({ intent }: { intent: React.MutableRefObject<MoveIntent> }) {
  const held = useRef<string | null>(null)

  const set = (dir: string | null) => {
    held.current = dir
    const v = { x: 0, z: 0 }
    if (dir === 'fwd') v.z = 1
    if (dir === 'back') v.z = -1
    if (dir === 'left') v.x = -1
    if (dir === 'right') v.x = 1
    intent.current.x = v.x
    intent.current.z = v.z
  }

  useEffect(() => {
    const stop = () => set(null)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  const btn = (dir: string, label: string, glyph: string, cls: string) => (
    <button
      type="button"
      className={`dpad-btn ${cls}`}
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault()
        set(dir)
      }}
      onPointerUp={() => set(null)}
      onPointerLeave={() => held.current === dir && set(null)}
      onPointerCancel={() => set(null)}
    >
      {glyph}
    </button>
  )

  return (
    <div className="dpad" aria-label="Geser tampilan">
      {btn('fwd', 'Geser ke atas', '▲', 'up')}
      {btn('left', 'Geser ke kiri', '◀', 'left')}
      {btn('right', 'Geser ke kanan', '▶', 'right')}
      {btn('back', 'Geser ke bawah', '▼', 'down')}
    </div>
  )
}
