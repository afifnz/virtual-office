import { useMemo } from 'react'
import { agentMeta } from '../lib/roster'
import type { StatusPayload } from '../lib/types'
import { kindLabel, officeClock, relTime, toolLabel } from '../lib/format'

export type FeedTab = 'aktivitas' | 'komunikasi'

/** Activity / communication feed. A panel on desktop, a sheet on mobile. */
export function Feed({
  status,
  now,
  tab,
  onTab,
  onClose,
  mobile,
}: {
  status: StatusPayload | null
  now: number
  tab: FeedTab
  onTab: (t: FeedTab) => void
  onClose: () => void
  mobile: boolean
}) {
  const events = status?.feed ?? []
  const comms = status?.comms ?? []

  const rows = useMemo(() => {
    let prevAgent = ''
    let prevTs = 0
    return events.map((e, i) => {
      const sameAgent = e.agent === prevAgent && Math.abs(prevTs - e.ts) < 300
      prevAgent = e.agent
      prevTs = e.ts
      return { e, i, sameAgent }
    })
  }, [events])

  return (
    <section className={`feed ${mobile ? 'is-sheet' : ''}`} aria-label="Feed aktivitas">
      <div className="panel-head">
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'aktivitas'}
            className={tab === 'aktivitas' ? 'is-active' : ''}
            onClick={() => onTab('aktivitas')}
          >
            Aktivitas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'komunikasi'}
            className={tab === 'komunikasi' ? 'is-active' : ''}
            onClick={() => onTab('komunikasi')}
          >
            Komunikasi
          </button>
        </div>
        <button type="button" className="icon-btn small" onClick={onClose} aria-label="Tutup feed">
          ✕
        </button>
      </div>

      <div className="feed-body">
        {tab === 'aktivitas' ? (
          rows.length === 0 ? (
            <p className="empty">belum ada aktivitas</p>
          ) : (
            <ul>
              {rows.map(({ e, i, sameAgent }) => {
                const meta = agentMeta(e.agent)
                return (
                  <li key={`${e.agent}-${e.ts}-${i}`} className="feed-row">
                    <span className={`feed-rail ${e.kind}`} aria-hidden="true" />
                    <div className="feed-main">
                      {!sameAgent ? (
                        <div className="feed-who">
                          <strong>{meta.name}</strong>
                          <small>{meta.role}</small>
                        </div>
                      ) : null}
                      <div className="feed-line">
                        <span className={`feed-kind ${e.kind}`}>{kindLabel(e.kind)}</span>
                        {e.tools.length ? <span className="chip">{toolLabel(e.tools)}</span> : null}
                        {e.source ? <span className="feed-src">{e.source}</span> : null}
                        <time>{relTime(e.ts, now)}</time>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )
        ) : comms.length === 0 ? (
          <p className="empty">belum ada komunikasi</p>
        ) : (
          <ul>
            {comms.map((c, i) => {
              const from = c.from === 'user' ? { name: 'Pengguna', role: 'MANUSIA' } : agentMeta(c.from)
              const to = agentMeta(c.to)
              return (
                <li key={`${c.ts}-${i}`} className="comm-row">
                  <time>{officeClock(c.ts)}</time>
                  <div className="comm-main">
                    <span className="comm-from">{from.name}</span>
                    <span className={`comm-arrow ${c.kind}`} aria-hidden="true">
                      →
                    </span>
                    <span className="comm-to">{to.name}</span>
                    <span className={`chip kind ${c.kind}`}>{c.kind}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
