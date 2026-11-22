import { useState } from 'react'
import { agentMeta, teamIds, teamMeta } from '../lib/roster'
import type { Agent, StatusPayload } from '../lib/types'
import { relTime, statusLabel } from '../lib/format'

/** Rooms in scene order; a roster may add a custom team, which lands last. */
const ORDER = (): string[] => teamIds()

/**
 * Agent list: a docked sidebar on desktop, a bottom sheet on a phone. Each team
 * is a collapsible group (the sheet starts with every team open; a header tap
 * folds it away), and clicking a row flies to that desk.
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
  const byId = new Map<string, Agent>()
  for (const a of status?.agents ?? []) byId.set(a.id, a)

  const [folded, setFolded] = useState<string[]>([])
  const toggleTeam = (team: string) =>
    setFolded((prev) => (prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team]))

  const rows = ORDER().map((team) => {
    const agents = (status?.agents ?? [])
      .filter((a) => agentMeta(a.id).team === team)
      .sort((a, b) => a.id.localeCompare(b.id))
    return { team, agents }
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
        {rows.map(({ team, agents }) => {
          const open = !folded.includes(team)
          return (
            <section key={team} className={`roster-team ${open ? '' : 'is-folded'}`}>
              <h3>
                <button
                  type="button"
                  className="team-toggle"
                  aria-expanded={open}
                  onClick={() => toggleTeam(team)}
                >
                  <i className={`team-bar ${team}`} aria-hidden="true" />
                  {teamMeta(team).label}
                  <span>{agents.length}</span>
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
