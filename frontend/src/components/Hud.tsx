import { useIsMobile, useIsNarrow } from '../hooks/useViewport'
import type { StatusPayload } from '../lib/types'
import { teamMeta, tzLabel } from '../lib/roster'
import { compact } from '../lib/format'

const DOTS: Array<{ key: string; label: string }> = [
  { key: 'working', label: 'bekerja' },
  { key: 'reviewing', label: 'review' },
  { key: 'idle', label: 'menganggur' },
  { key: 'blocked', label: 'terblokir' },
]

const SPOT_IDS = ['lobby', 'dev', 'edu'] as const

interface HudProps {
  status: StatusPayload | null
  spot: string
  onSpot: (id: string) => void
  rosterOpen: boolean
  onToggleRoster: () => void
  feedOpen: boolean
  onToggleFeed: () => void
  taskOpen: boolean
  onToggleTasks: () => void
  kpiOpen: boolean
  onToggleKPI: () => void
  expanded: boolean
  onToggleExpanded: () => void
  stale: boolean
}

/** Room buttons: four spots, the active one lit in terracotta. */
function SpotNav({ spot, onSpot }: { spot: string; onSpot: (id: string) => void }) {
  const narrow = useIsNarrow()
  return (
    <nav className="spots" aria-label="Pindah ruang">
      {SPOT_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className={`spot-btn ${spot === id ? 'is-active' : ''}`}
          onClick={() => onSpot(id)}
          title={teamMeta(id).sub}
        >
          {narrow ? (teamMeta(id).label.split(' ')[1] ?? teamMeta(id).name) : teamMeta(id).name}
        </button>
      ))}
      <button
        type="button"
        className={`spot-btn ${spot === 'luar' ? 'is-active' : ''}`}
        onClick={() => onSpot('luar')}
        title="Tampak luar gedung"
      >
        Luar
      </button>
    </nav>
  )
}

/** Panel toggles: the desktop bottom toolbar owns them; phones use the bar. */
function PanelToggles({
  rosterOpen,
  onToggleRoster,
  feedOpen,
  onToggleFeed,
  taskOpen,
  onToggleTasks,
  kpiOpen,
  onToggleKPI,
}: Pick<
  HudProps,
  | 'rosterOpen'
  | 'onToggleRoster'
  | 'feedOpen'
  | 'onToggleFeed'
  | 'taskOpen'
  | 'onToggleTasks'
  | 'kpiOpen'
  | 'onToggleKPI'
>) {
  return (
    <div className="hud-actions">
      <button
        type="button"
        className={`icon-btn ${rosterOpen ? 'is-active' : ''}`}
        onClick={onToggleRoster}
        aria-label="Daftar agen"
        aria-pressed={rosterOpen}
      >
        <span aria-hidden="true">☰</span>
        <span className="btn-label">Agen</span>
      </button>
      <button
        type="button"
        className={`icon-btn ${feedOpen ? 'is-active' : ''}`}
        onClick={onToggleFeed}
        aria-label="Feed"
        aria-pressed={feedOpen}
      >
        <span aria-hidden="true">≡</span>
        <span className="btn-label">Feed</span>
      </button>
      <button
        type="button"
        className={`icon-btn ${taskOpen ? 'is-active' : ''}`}
        onClick={onToggleTasks}
        aria-label="Taskboard"
        aria-pressed={taskOpen}
      >
        <span aria-hidden="true">▤</span>
        <span className="btn-label">Tugas</span>
      </button>
      <button
        type="button"
        className={`icon-btn ${kpiOpen ? 'is-active' : ''}`}
        onClick={onToggleKPI}
        aria-label="KPI per agen"
        aria-pressed={kpiOpen}
      >
        <span aria-hidden="true">▥</span>
        <span className="btn-label">KPI</span>
      </button>
    </div>
  )
}

export function Hud(props: HudProps) {
  const { status, spot, onSpot, expanded, onToggleExpanded, stale } = props
  const mobile = useIsMobile()

  const counts = new Map<string, number>()
  for (const a of status?.agents ?? []) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)
  const today = (status?.agents ?? []).reduce(
    (acc, a) => ({
      messages: acc.messages + a.today.messages,
      tools: acc.tools + a.today.tool_calls,
    }),
    { messages: 0, tools: 0 },
  )

  const detail = (
    <div className="hud-detail">
      <div className="legend">
        {DOTS.map((d) => (
          <span key={d.key} className="legend-item">
            <i className={`dot ${d.key}`} aria-hidden="true" />
            {d.label} <b>{counts.get(d.key) ?? 0}</b>
          </span>
        ))}
      </div>
      <div className="hud-today">
        <span>
          hari ini <b>{compact(today.messages)}</b> pesan · <b>{compact(today.tools)}</b> alat
        </span>
        <span className={`gw ${status?.gateway.state === 'running' ? 'ok' : 'warn'}`}>
          gateway {status?.gateway.state ?? '—'}
          {status?.gateway.version ? ` ${status.gateway.version}` : ''}
        </span>
      </div>
    </div>
  )

  return (
    <>
      <header className={`hud ${expanded ? 'is-open' : ''}`}>
        <div className="hud-row">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-text">
              <strong>AGENT OFFICE</strong>
              {!mobile ? <small>kantor virtual · {tzLabel()}</small> : null}
            </span>
          </div>

          {mobile ? (
            <>
              <button
                type="button"
                className="hud-caret"
                aria-expanded={expanded}
                aria-label={expanded ? 'Ringkas HUD' : 'Buka detail HUD'}
                onClick={onToggleExpanded}
              >
                {expanded ? '▾' : '▴'}
              </button>
              <SpotNav spot={spot} onSpot={onSpot} />
            </>
          ) : null}

          {detail}
        </div>

        {stale ? <div className="stale">data lama — mencoba ulang…</div> : null}
      </header>

      {/* Desktop keeps navigation and panel toggles in a bottom toolbar, so the
          HUD stays a thin bar and the canvas owns everything in between. */}
      {!mobile ? (
        <footer className="toolbar">
          <SpotNav spot={spot} onSpot={onSpot} />
          <PanelToggles {...props} />
        </footer>
      ) : null}
    </>
  )
}
