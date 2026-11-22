import { useIsMobile } from '../hooks/useViewport'
import type { StatusPayload } from '../lib/types'
import type { FloorId } from '../lib/rooms'
import { FloorTabs } from './FloorTabs'
import { tzLabel } from '../lib/roster'
import { compact } from '../lib/format'
import type { ThemeMode, ThemeOverride, ThemeSource } from '../lib/theme'

const DOTS: Array<{ key: string; label: string }> = [
  { key: 'working', label: 'bekerja' },
  { key: 'reviewing', label: 'review' },
  { key: 'idle', label: 'menganggur' },
  { key: 'blocked', label: 'terblokir' },
]

interface HudProps {
  status: StatusPayload | null
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
  floor: FloorId
  onFloor: (floor: FloorId) => void
  theme: ThemeMode
  themeOverride: ThemeOverride | null
  themeSource: ThemeSource
  onTheme: (value: ThemeOverride) => void
}

/** Day / night / auto. `?theme=` and the stored choice both land here. */
function ThemeControl({ theme, themeOverride, themeSource, onTheme }: Pick<HudProps, 'theme' | 'themeOverride' | 'themeSource' | 'onTheme'>) {
  const active: ThemeOverride = themeOverride ?? 'auto'
  const options: Array<{ value: ThemeOverride; glyph: string; label: string; title: string }> = [
    { value: 'day', glyph: '☀', label: 'Terang', title: 'Tema terang (Daylight Atrium)' },
    { value: 'night', glyph: '☾', label: 'Gelap', title: 'Tema gelap (Sky Lobby)' },
    { value: 'auto', glyph: 'A', label: 'Auto', title: 'Ikut jam kantor (06:00–18:00 terang)' },
  ]
  return (
    <div className="theme-ctrl" role="group" aria-label="Tema" data-mode={theme} data-source={themeSource}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={active === o.value ? 'is-active' : ''}
          aria-pressed={active === o.value}
          title={o.title}
          onClick={() => onTheme(o.value)}
        >
          <span className="theme-glyph" aria-hidden="true">{o.glyph}</span>
          <span className="theme-word">{o.label}</span>
        </button>
      ))}
    </div>
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
  const { status, expanded, onToggleExpanded, stale } = props
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
        <span className="theme-state" title={`sumber tema: ${props.themeSource}`}>
          {props.theme === 'day' ? 'TERANG' : 'GELAP'} · {tzLabel()}
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

          <FloorTabs floor={props.floor} status={props.status} onFloor={props.onFloor} variant="hud" />

          <ThemeControl
            theme={props.theme}
            themeOverride={props.themeOverride}
            themeSource={props.themeSource}
            onTheme={props.onTheme}
          />

          {mobile ? (
            <button
              type="button"
              className="hud-caret"
              aria-expanded={expanded}
              aria-label={expanded ? 'Ringkas HUD' : 'Buka detail HUD'}
              onClick={onToggleExpanded}
            >
              {expanded ? '▾' : '▴'}
            </button>
          ) : null}

          {detail}
        </div>

        {stale ? <div className="stale">data lama — mencoba ulang…</div> : null}
      </header>

      {/* Desktop keeps the panel toggles in a bottom toolbar, so the HUD stays a
          thin bar and the canvas owns everything in between. Floor switching
          lives in the FloorTabs overlay above the canvas. */}
      {!mobile ? (
        <footer className="toolbar">
          <PanelToggles {...props} />
        </footer>
      ) : null}
    </>
  )
}
