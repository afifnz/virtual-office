import { agentMeta } from '../lib/roster'
import type { Agent } from '../lib/types'
import { compact, pct, relTime, toolLabel } from '../lib/format'
import { childBadge, effectiveStatus, isStaleAgent, staleNote, statusText } from '../lib/status'

const STATUS_TEXT: Record<string, string> = {
  working: 'sedang bekerja',
  reviewing: 'sedang review',
  waiting: 'menunggu anak',
  blocked: 'terblokir',
  idle: 'menganggur',
  offline: 'offline',
}

/** Card for the agent the camera stands next to. */
export function ProximityCard({
  agent,
  now,
  onClose,
  onFly,
  compactMode = false,
}: {
  agent: Agent
  now: number
  onClose: () => void
  onFly: (id: string) => void
  compactMode?: boolean
}) {
  const meta = agentMeta(agent.id)
  const max = Math.max(1, ...agent.today.hourly)
  const badge = childBadge(agent)
  const stale = isStaleAgent(agent)
  // A stale verdict must not read as "sedang bekerja": the card says so.
  const headline = stale ? staleNote(agent) : STATUS_TEXT[agent.status] ?? agent.status
  const toolsLine =
    !stale && agent.status !== 'waiting' && agent.current?.tools.length
      ? ` · ${toolLabel(agent.current.tools)}`
      : ''

  if (compactMode) {
    return (
      <button type="button" className={`prox-chip ${stale ? 'is-stale' : ''}`} onClick={() => onFly(agent.id)}>
        <i className={`dot ${effectiveStatus(agent)}`} aria-hidden="true" />
        <strong>
          {meta.name}
          {badge ? <span className="child-badge">{badge}</span> : null}
        </strong>
        <span>{statusText(agent)}</span>
      </button>
    )
  }

  return (
    <aside className={`card ${agent.status} ${stale ? 'is-stale' : ''}`} aria-live="polite">
      <header>
        <i className={`dot ${effectiveStatus(agent)}`} aria-hidden="true" />
        <div>
          <h3>{meta.name}</h3>
          <p>{meta.role}</p>
        </div>
        <button type="button" className="icon-btn small" onClick={onClose} aria-label="Tutup kartu">
          ✕
        </button>
      </header>

      <p className="card-status">
        {headline}
        {toolsLine}
        <span>{agent.last_active ? `${relTime(agent.last_active, now)} lalu` : ''}</span>
      </p>

      {/* waiting is not work: an amber chip, and how many children are running */}
      {agent.status === 'waiting' ? (
        <p className="card-waiting">
          <span className="chip waiting">menunggu anak</span>
          {agent.children ? (
            <small>
              {agent.children.running} dari {agent.children.total} anak masih berjalan
            </small>
          ) : null}
        </p>
      ) : null}

      {/* privacy: never show the raw blocked reason — a generic line + tool count only */}
      {agent.blocked ? <p className="card-blocked">butuh izin · {agent.blocked.tools} alat</p> : null}

      <p className="card-desc">{meta.desc}</p>

      <dl className="card-stats">
        <div>
          <dt>hari ini</dt>
          <dd>{compact(agent.today.messages)} pesan</dd>
        </div>
        <div>
          <dt>alat</dt>
          <dd>{compact(agent.today.tool_calls)}</dd>
        </div>
        <div>
          <dt>token</dt>
          <dd>{compact(agent.today.tokens)}</dd>
        </div>
        <div>
          <dt>sesi</dt>
          <dd>
            {agent.today.sessions}/{agent.total.sessions}
          </dd>
        </div>
      </dl>

      <div className="spark" aria-hidden="true">
        {agent.today.hourly.map((v, i) => (
          <span
            key={i}
            className="spark-bar"
            style={{ height: `${Math.max(6, pct(v, max))}%` }}
            title={`${i}:00 WIB · ${v}`}
          />
        ))}
      </div>

      <footer>
        <span className={`chip src`}>{agent.source ?? 'profil'}</span>
        {agent.task ? <span className="chip task">tugas {agent.task}</span> : null}
        <button type="button" className="ghost-btn" onClick={() => onFly(agent.id)}>
          Dekati
        </button>
      </footer>
    </aside>
  )
}
