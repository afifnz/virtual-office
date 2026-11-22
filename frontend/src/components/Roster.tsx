import { useState } from 'react'
import { agentMeta } from '../lib/roster'
import { FLOORS } from '../lib/rooms'
import type { Agent, StatusPayload } from '../lib/types'
import { relTime, statusLabel } from '../lib/format'

type FloorId = 1 | 2 | 3

/** Floors in climb order; every floor shows even when it has no agents yet. */
const FLOOR_ORDER: FloorId[] = [1, 2, 3]

/** Compact per-group status summary, e.g. "4 aktif · 1 idle". */
function floorSummary(agents: Agent[]): string {
  const counts = new Map<string, number>()
  for (const a of agents) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([status, n]) => `${n} ${statusLabel(status)}`)
  return parts.join(' · ')
}

/**
 * Agent list: a docked sidebar on desktop, a bottom sheet on a phone. Rows are
 * grouped by floor (L1 LOBBY / L2 TIM EDU / L3 TIM DEV); each group header
 * shows the agent count and a compact status summary, and a header tap folds
 * the group away. Clicking a row flies to that desk — App switches to the
 * agent's floor and focuses it through onPick.
 */
export function Roster({
  status,
  now,
  onPick,
  onClose,
  mobile,
}: {
  status: StatusPayload | null
  now: number
  onPick: (id: string) => void
  onClose: () => void
  mobile: boolean
}) {
  const [folded, setFolded] = useState<number[]>([])
  const toggleFloor = (floor: number) =>
    setFolded((prev) => (prev.includes(floor) ? prev.filter((f) => f !== floor) : [...prev, floor]))

  const rows = FLOOR_ORDER.map((floor) => {
    const agents = (status?.agents ?? [])
      .filter((a) => agentMeta(a.id).desk.floor === floor)
      .sort((a, b) => a.id.localeCompare(b.id))
    return { floor, agents }
  })

  return (
    <aside className={`roster ${mobile ? 'is-sheet' : ''}`} aria-label="Daftar agen">
      <div className="panel-head">
        <h2>Agen</h2>
        <button type="button" className="icon-btn small" onClick={onClose} aria-label="Tutup daftar agen">
          ✕
        </button>
      </div>
      <div className="roster-body">
        {rows.map(({ floor, agents }) => {
          const open = !folded.includes(floor)
          return (
            <section key={floor} className={`roster-team ${open ? '' : 'is-folded'}`}>
              <h3>
                <button
                  type="button"
                  className="team-toggle"
                  aria-expanded={open}
                  onClick={() => toggleFloor(floor)}
                >
                  <i className={`team-bar floor-${floor}`} aria-hidden="true" />
                  L{floor} {FLOORS[floor].label}
                  <span>{agents.length}</span>
                  <small className="roster-summary">{floorSummary(agents)}</small>
                  <b aria-hidden="true">{open ? '▾' : '▸'}</b>
                </button>
              </h3>
              {open
                ? agents.map((a) => {
                    const meta = agentMeta(a.id)
                    return (
                      <button key={a.id} type="button" className="roster-row" onClick={() => onPick(a.id)}>
                        <i className={`dot ${a.status}`} aria-hidden="true" />
                        <span className="roster-name">
                          <strong>{meta.name}</strong>
                          <small>{meta.role}</small>
                        </span>
                        <span className="roster-meta">
                          <em>{statusLabel(a.status)}</em>
                          <small>{a.last_active ? relTime(a.last_active, now) : '—'}</small>
                        </span>
                      </button>
                    )
                  })
                : null}
            </section>
          )
        })}
        {rows.every((r) => r.agents.length === 0) ? <p className="empty">menunggu data…</p> : null}
      </div>
    </aside>
  )
}
