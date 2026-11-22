import { useEffect } from 'react'
import { FLOORS, FLOOR_IDS, type FloorId } from '../lib/rooms'
import { rosterAgents } from '../lib/roster'
import type { StatusPayload } from '../lib/types'

/**
 * The floor tabs: L1 Lobby / L2 Tim Edu / L3 Tim Dev. A DOM bar floating over
 * the TOP of the canvas (an overlay, so the canvas keeps its full size budget)
 * — the single control for switching floors, replacing the old room buttons.
 * Each tab names its floor, shows how many agents sit there and a compact
 * status-dot summary so the other floors are readable at a glance.
 *
 * Keyboard 1/2/3 switches floors too; the guard keeps digits typed into a
 * text field (none today, but panels evolve) from leaking into navigation.
 */
interface FloorTabsProps {
  floor: FloorId
  status: StatusPayload | null
  onFloor: (floor: FloorId) => void
}

/** The three statuses worth scanning on a foreign floor (same dots as the HUD legend). */
const SUMMARY: Array<{ key: string; label: string }> = [
  { key: 'working', label: 'bekerja' },
  { key: 'reviewing', label: 'mereview' },
  { key: 'blocked', label: 'terblokir' },
]

export function FloorTabs({ floor, status, onFloor }: FloorTabsProps) {
  const floorOf = new Map(rosterAgents().map((m) => [m.id, m.desk.floor]))
  const agentsByFloor: Record<FloorId, StatusPayload['agents']> = { 1: [], 2: [], 3: [] }
  for (const a of status?.agents ?? []) {
    const f = floorOf.get(a.id)
    if (f) agentsByFloor[f].push(a)
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      const f = e.key === '1' ? 1 : e.key === '2' ? 2 : e.key === '3' ? 3 : 0
      if (f) onFloor(f as FloorId)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [onFloor])

  return (
    <nav className="floor-tabs" aria-label="Lantai">
      {FLOOR_IDS.map((f) => {
        const agents = agentsByFloor[f]
        const counts = new Map<string, number>()
        for (const a of agents) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)
        return (
          <button
            key={f}
            type="button"
            className={`floor-tab ${floor === f ? 'is-active' : ''}`}
            aria-pressed={floor === f}
            onClick={() => onFloor(f)}
            title={`${FLOORS[f].label} — ${FLOORS[f].sub}`}
          >
            <span className="floor-tab-id">L{f}</span>
            <span className="floor-tab-name">{FLOORS[f].name}</span>
            <span className="floor-tab-meta">
              <b className="floor-tab-count">{agents.length}</b>
              {SUMMARY.map((s) =>
                counts.get(s.key) ? (
                  <span key={s.key} className="floor-tab-stat" title={`${s.label}: ${counts.get(s.key)}`}>
                    <i className={`dot ${s.key}`} aria-hidden="true" />
                    {counts.get(s.key)}
                  </span>
                ) : null,
              )}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
