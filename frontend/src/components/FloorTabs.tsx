import { useEffect } from 'react'
import { FLOORS, FLOOR_IDS, type FloorId } from '../lib/rooms'
import { rosterAgents } from '../lib/roster'
import { countStatuses } from '../lib/status'
import type { AgentStatus, StatusPayload } from '../lib/types'
import type { ViewMode } from '../lib/view'

/**
 * The view tabs: GEDUNG (all three floors + the city) then L1 Lobby, L2 Tim
 * Edu, L3 Tim Dev. A DOM bar floating over the TOP of the canvas (an overlay,
 * so the canvas keeps its full size budget) — the single control for switching
 * views, replacing the old room buttons. GEDUNG is the default; each floor tab
 * names its floor and shows how many agents sit there plus a compact
 * status-dot summary so the other floors are readable at a glance.
 *
 * Keyboard 0/B goes to the building, 1/2/3 to a floor; the guard keeps digits
 * typed into a text field (none today, but panels evolve) from leaking into
 * navigation.
 */
interface FloorTabsProps {
  floor: FloorId
  status: StatusPayload | null
  mode: ViewMode
  onFloor: (floor: FloorId) => void
  onBuilding: () => void
  /** 'overlay' floats above the canvas; 'hud' sits in the HUD row */
  variant?: 'overlay' | 'hud'
}

/** The statuses worth scanning on a foreign floor (same dots as the HUD legend). */
const SUMMARY: Array<{ key: AgentStatus; label: string }> = [
  { key: 'working', label: 'bekerja' },
  { key: 'reviewing', label: 'mereview' },
  { key: 'waiting', label: 'menunggu anak' },
  { key: 'blocked', label: 'terblokir' },
]

export function FloorTabs({ floor, status, mode, onFloor, onBuilding, variant = 'overlay' }: FloorTabsProps) {
  const floorOf = new Map(rosterAgents().map((m) => [m.id, m.desk.floor]))
  const agentsByFloor: Record<FloorId, StatusPayload['agents']> = { 1: [], 2: [], 3: [] }
  for (const a of status?.agents ?? []) {
    const f = floorOf.get(a.id)
    if (f) agentsByFloor[f].push(a)
  }
  const all = [...agentsByFloor[1], ...agentsByFloor[2], ...agentsByFloor[3]]
  const allCounts = countStatuses(all)
  const totalDesks = rosterAgents().length

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (e.key === '0' || e.key.toLowerCase() === 'b') {
        onBuilding()
        return
      }
      const f = e.key === '1' ? 1 : e.key === '2' ? 2 : e.key === '3' ? 3 : 0
      if (f) onFloor(f as FloorId)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [onBuilding, onFloor])

  return (
    <nav className={`floor-tabs ${variant === 'hud' ? 'in-hud' : ''}`} aria-label="Tampilan">
      <button
        type="button"
        className={`floor-tab building-tab ${mode === 'building' ? 'is-active' : ''}`}
        aria-pressed={mode === 'building'}
        onClick={onBuilding}
        title={`Gedung — 3 lantai sekaligus (${all.length}/${totalDesks} agen)`}
      >
        <span className="floor-tab-id">GEDUNG</span>
        <span className="floor-tab-name">3 lantai · kota</span>
        <span className="floor-tab-meta">
          <b className="floor-tab-count">{all.length}</b>
          {SUMMARY.map((s) =>
            allCounts.get(s.key) ? (
              <span key={s.key} className="floor-tab-stat" title={`${s.label}: ${allCounts.get(s.key)}`}>
                <i className={`dot ${s.key}`} aria-hidden="true" />
                {allCounts.get(s.key)}
              </span>
            ) : null,
          )}
        </span>
      </button>
      {FLOOR_IDS.map((f) => {
        const agents = agentsByFloor[f]
        const counts = countStatuses(agents)
        return (
          <button
            key={f}
            type="button"
            className={`floor-tab ${mode === 'floor' && floor === f ? 'is-active' : ''}`}
            aria-pressed={mode === 'floor' && floor === f}
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
