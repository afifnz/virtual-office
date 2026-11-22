import { useMemo, useState } from 'react'
import { agentMeta } from '../lib/roster'
import type { StatusPayload, Task } from '../lib/types'
import { relTime } from '../lib/format'

type TeamFilter = 'semua' | 'dev' | 'edu' | 'lobby'

const COLUMNS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'running', label: 'Berjalan', hint: 'sedang dikerjakan' },
  { id: 'review', label: 'Review', hint: 'menunggu pemeriksaan' },
  { id: 'blocked', label: 'Terblokir', hint: 'butuh perhatian' },
  { id: 'done', label: 'Selesai', hint: 'sesi tertutup' },
]

/** Taskboard overlay: columns, team filter, full-screen on phones. */
export function TaskBoard({
  status,
  now,
  onClose,
  mobile,
}: {
  status: StatusPayload | null
  now: number
  onClose: () => void
  mobile: boolean
}) {
  const [team, setTeam] = useState<TeamFilter>('semua')
  const tasks = status?.tasks ?? []

  const grouped = useMemo(() => {
    const out: Record<string, Task[]> = { running: [], review: [], blocked: [], done: [] }
    for (const t of tasks) {
      const meta = t.owner ? agentMeta(t.owner) : null
      if (team !== 'semua' && meta?.team !== team) continue
      const isReviewer = t.owner === 'reviewer' || t.owner === 'edu-reviewer'
      const col =
        t.status === 'blocked'
          ? 'blocked'
          : t.status === 'running'
            ? isReviewer
              ? 'review'
              : 'running'
            : 'done'
      out[col]!.push(t)
    }
    return out
  }, [tasks, team])

  const total = tasks.length

  return (
    <section className={`taskboard ${mobile ? 'is-full' : ''}`} aria-label="Taskboard">
      <div className="panel-head">
        <h2>
          Taskboard <small>{total} sesi</small>
        </h2>
        <button type="button" className="icon-btn small" onClick={onClose} aria-label="Tutup taskboard">
          ✕
        </button>
      </div>

      <div className="filters" role="tablist" aria-label="Filter tim">
        {(['semua', 'dev', 'edu', 'lobby'] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={team === f}
            className={`filter ${team === f ? 'is-active' : ''}`}
            onClick={() => setTeam(f)}
          >
            {f === 'semua' ? 'Semua' : f === 'lobby' ? 'Pendopo' : f === 'dev' ? 'Tim Dev' : 'Tim Edu'}
          </button>
        ))}
      </div>

      <div className="board">
        {COLUMNS.map((col) => {
          const list = grouped[col.id] ?? []
          return (
            <div key={col.id} className={`column ${col.id}`}>
              <h3>
                {col.label}
                <span>{list.length}</span>
              </h3>
              <div className="column-body">
                {list.length === 0 ? <p className="empty">{col.hint}</p> : null}
                {list.map((t) => {
                  const meta = agentMeta(t.owner)
                  return (
                    <article key={t.id} className="task-card">
                      <header>
                        <strong>{meta.name}</strong>
                        <code>{t.id}</code>
                      </header>
                      <p className="task-meta">
                        dari <b>{t.from === 'user' ? 'Pengguna' : agentMeta(t.from).name}</b> · {t.via}
                      </p>
                      <footer>
                        <span>{t.messages} pesan</span>
                        <span>{t.tools} alat</span>
                        <time>{relTime(t.last, now)}</time>
                      </footer>
                      {/* privacy: never show the raw blocked reason — a generic line + tool count only */}
                      {t.blocked ? <p className="task-blocked">butuh izin · {t.blocked.tools} alat</p> : null}
                    </article>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
