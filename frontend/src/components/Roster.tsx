import { agentMeta, teamIds, teamMeta } from '../lib/roster'
import type { Agent, StatusPayload } from '../lib/types'
import { relTime, statusLabel } from '../lib/format'

/** Rooms in scene order; a roster may add a custom team, which lands last. */
const ORDER = (): string[] => teamIds()

/** Left rail: every agent grouped by team, click to fly to the desk. */
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

  const rows = ORDER().map((team) => {
    const agents = (status?.agents ?? [])
      .filter((a) => agentMeta(a.id).team === team)
      .sort((a, b) => a.id.localeCompare(b.id))
    return { team, agents }
  })

  return (
    <aside className={`roster ${mobile ? 'is-drawer' : ''}`} aria-label="Daftar agen">
      <div className="panel-head">
        <h2>Agen</h2>
        <button type="button" className="icon-btn small" onClick={onClose} aria-label="Tutup daftar agen">
          ✕
        </button>
      </div>
      <div className="roster-body">
        {rows.map(({ team, agents }) => (
          <section key={team} className="roster-team">
            <h3>
              <i className={`team-bar ${team}`} aria-hidden="true" />
              {teamMeta(team).label}
              <span>{agents.length}</span>
            </h3>
            {agents.map((a) => {
              const meta = agentMeta(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  className="roster-row"
                  onClick={() => onPick(a.id)}
                >
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
            })}
          </section>
        ))}
        {rows.every((r) => r.agents.length === 0) ? <p className="empty">menunggu data…</p> : null}
      </div>
    </aside>
  )
}
