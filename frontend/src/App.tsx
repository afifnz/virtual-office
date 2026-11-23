import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Scene } from './components/Scene'
import type { MoveIntent, RigCommand } from './lib/view'
import { Hud } from './components/Hud'
import { Roster } from './components/Roster'
import { Feed, type FeedTab } from './components/Feed'
import { TaskBoard } from './components/TaskBoard'
import { KPI } from './components/KPI'
import { ProximityCard } from './components/ProximityCard'
import { DPad } from './components/DPad'
import { useStatus } from './hooks/useStatus'
import { useIsMobile, useIsTouch } from './hooks/useViewport'
import { resolveAgentId } from './lib/agents'
import { agentFocus } from './lib/focus'
import { agentMeta, officeTZ } from './lib/roster'
import { SPOT_FLOOR } from './lib/view'
import type { FloorId } from './lib/rooms'
import {
  applyTheme,
  effectiveOverride,
  parseThemeParam,
  prefersDark,
  readStoredOverride,
  resolveTheme,
  writeStoredOverride,
  type ThemeOverride,
} from './lib/theme'

/** `?floor=1|2|3` — the highest-priority deep link; absent/invalid → null. */
function queryFloor(): FloorId | null {
  const raw = new URLSearchParams(window.location.search).get('floor')
  const n = Number(raw)
  return n === 1 || n === 2 || n === 3 ? (n as FloorId) : null
}

/** Persist the active floor in the URL so any view stays shareable. */
function writeFloorToUrl(floor: FloorId): void {
  if (typeof history === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('floor', String(floor))
  history.replaceState(null, '', url)
}

export default function App() {
  const { data, error, stale, lastOk } = useStatus()
  const mobile = useIsMobile()
  const touch = useIsTouch()

  // The floor is the single source of truth; the command carries it to the
  // canvas, which re-fits that floor. Deep-link priority: ?floor= wins over
  // ?spot=; ?face=/#id pick the agent's own floor unless ?floor= is explicit.
  const [command, setCommand] = useState<RigCommand>(() => {
    const spot = new URLSearchParams(window.location.search).get('spot')
    const floor = queryFloor() ?? (spot ? SPOT_FLOOR[spot] : undefined)
    // default: the whole floor ("tampak"), so every desk is on screen from the
    // first frame — a cropped cluster is a bug, not a zoom
    return { spot: floor !== undefined ? spot ?? 'tampak' : 'tampak', nonce: 0, floor: floor ?? 1 }
  })
  const [rosterOpen, setRosterOpen] = useState(!mobile)
  const [feedOpen, setFeedOpen] = useState(!mobile)
  const [taskOpen, setTaskOpen] = useState(false)
  const [kpiOpen, setKpiOpen] = useState(false)
  const [tab, setTab] = useState<FeedTab>('aktivitas')
  const [hudOpen, setHudOpen] = useState(false)
  const [nearId, setNearId] = useState<string | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [chipVisible, setChipVisible] = useState(true)
  // the phone shows the whole floor by default, so there is nothing to pan to
  // until the user zooms in — the pad appears only then (never over a desk)
  const [canPan, setCanPan] = useState(false)
  const moveIntent = useRef<MoveIntent>({ x: 0, z: 0 })

  // theme: stored override → ?theme= → the office clock (never the device clock)
  const [themeOverride, setThemeOverride] = useState<ThemeOverride | null>(() =>
    effectiveOverride(readStoredOverride(), parseThemeParam(new URLSearchParams(window.location.search).get('theme'))),
  )
  const theme = useMemo(
    () => resolveTheme(lastOk ? data?.now ?? null : null, officeTZ(), themeOverride, prefersDark()),
    [data?.now, lastOk, themeOverride],
  )
  useEffect(() => {
    applyTheme(theme.mode, theme.source)
  }, [theme])
  const chooseTheme = useCallback((value: ThemeOverride) => {
    setThemeOverride(value === 'auto' ? null : value)
    writeStoredOverride(value)
  }, [])

  const now = data?.now ?? Date.now() / 1000
  const agentById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof data>['agents'][number]>()
    for (const a of data?.agents ?? []) m.set(a.id, a)
    return m
  }, [data])

  const displayId = pickedId ?? nearId
  const displayAgent = displayId ? agentById.get(displayId) : undefined

  /** Switch floors: re-fit the floor (desktop fit, mobile zoom 1 + pan) and keep the URL shareable. */
  const goFloor = useCallback((floor: FloorId) => {
    setCommand((c) => ({ spot: 'tampak', nonce: c.nonce + 1, floor }))
    setPickedId(null)
    writeFloorToUrl(floor)
  }, [])

  const flyToAgent = useCallback((id: string, tight = false) => {
    if (!id) {
      setPickedId(null)
      return
    }
    const focus = agentFocus(id)
    setCommand((c) => ({
      spot: 'agent',
      nonce: c.nonce + 1,
      focus: focus ?? undefined,
      tight,
      floor: focus?.floor ?? c.floor,
    }))
    setPickedId(id)
    setChipVisible(true)
    if (typeof history !== 'undefined') history.replaceState(null, '', `#${id}`)
  }, [])

  const onPick = useCallback(
    (id: string) => {
      if (!id) {
        setPickedId(null)
        return
      }
      flyToAgent(id)
      if (mobile) {
        setFeedOpen(false)
        setRosterOpen(false)
      }
    },
    [flyToAgent, mobile],
  )

  // deep links: /#coder opens that desk, /?face=coder gets a face portrait.
  // The agent's own floor wins, except an explicit ?floor= which outranks both.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const explicit = queryFloor()
    const face = resolveAgentId(params.get('face') ?? '')
    const hash = resolveAgentId(decodeURIComponent(window.location.hash.replace('#', '')))
    const id = face ?? hash
    if (!id) return
    if (explicit) {
      if (agentMeta(id).desk.floor === explicit) setPickedId(id)
      return
    }
    flyToAgent(id, Boolean(face))
  }, [flyToAgent])

  // keep desktop panels open, phones clean
  useEffect(() => {
    setRosterOpen(!mobile)
    setFeedOpen(!mobile)
    if (!mobile) setHudOpen(false)
  }, [mobile])

  // the mobile chip fades out on its own
  useEffect(() => {
    if (!mobile || !displayId) return
    setChipVisible(true)
    const t = window.setTimeout(() => setChipVisible(false), 5000)
    return () => window.clearTimeout(t)
  }, [displayId, mobile])

  const onMove = useCallback(() => setPickedId((p) => p), [])

  return (
    <div
      className={`app ${mobile ? 'is-mobile' : ''} ${rosterOpen && !mobile ? 'has-roster' : ''} ${
        feedOpen && !mobile ? 'has-feed' : ''
      }`}
    >
      <div className="canvas-wrap">
        <Scene
          status={data}
          command={command}
          moveIntent={moveIntent}
          onNear={setNearId}
          onMove={onMove}
          onPick={onPick}
          onPan={setCanPan}
          theme={theme.mode}
          dpr={mobile ? [1, 1.5] : [1, 1.8]}
        />
      </div>

      <Hud
        status={data}
        rosterOpen={rosterOpen}
        onToggleRoster={() => setRosterOpen((v) => !v)}
        feedOpen={feedOpen}
        onToggleFeed={() => setFeedOpen((v) => !v)}
        taskOpen={taskOpen}
        onToggleTasks={() => setTaskOpen((v) => !v)}
        kpiOpen={kpiOpen}
        onToggleKPI={() => {
          setKpiOpen((v) => !v)
          setTaskOpen(false)
        }}
        expanded={hudOpen}
        onToggleExpanded={() => setHudOpen((v) => !v)}
        stale={stale}
        floor={command.floor ?? 1}
        onFloor={goFloor}
        theme={theme.mode}
        themeOverride={themeOverride}
        themeSource={theme.source}
        onTheme={chooseTheme}
      />

      {rosterOpen ? (
        <Roster
          status={data}
          now={now}
          onPick={flyToAgent}
          onClose={() => setRosterOpen(false)}
          mobile={mobile}
        />
      ) : null}

      {feedOpen ? (
        <Feed
          status={data}
          now={now}
          tab={tab}
          onTab={setTab}
          onClose={() => setFeedOpen(false)}
          mobile={mobile}
        />
      ) : null}

      {taskOpen ? (
        <TaskBoard status={data} now={now} onClose={() => setTaskOpen(false)} mobile={mobile} />
      ) : null}

      {kpiOpen ? <KPI mobile={mobile} onClose={() => setKpiOpen(false)} /> : null}

      {displayAgent && (!mobile || chipVisible) ? (
        <ProximityCard
          agent={displayAgent}
          now={now}
          onClose={() => setPickedId(null)}
          onFly={flyToAgent}
          compactMode={mobile}
        />
      ) : null}

      {/* the sheet and the taskboard are modal: the pad and bar step aside so
          nothing ever sits on top of the movement controls. The pad itself is
          only there while panning can do something (the phone default fits the
          whole floor). */}
      {mobile && !feedOpen && !taskOpen && !kpiOpen ? (
        <>
          {canPan ? <DPad intent={moveIntent} /> : null}
          <nav className="mobile-bar" aria-label="Panel">
            <button
              type="button"
              className={feedOpen ? 'is-active' : ''}
              onClick={() => {
                setFeedOpen((v) => !v)
                setTaskOpen(false)
              }}
            >
              <span aria-hidden="true">≡</span> Feed
            </button>
            <button
              type="button"
              className={taskOpen ? 'is-active' : ''}
              onClick={() => {
                setTaskOpen((v) => !v)
                setFeedOpen(false)
              }}
            >
              <span aria-hidden="true">▤</span> Tugas
            </button>
            <button
              type="button"
              className={kpiOpen ? 'is-active' : ''}
              onClick={() => {
                setKpiOpen(true)
                setFeedOpen(false)
                setTaskOpen(false)
              }}
            >
              <span aria-hidden="true">▥</span> KPI
            </button>
            <button type="button" onClick={() => setRosterOpen((v) => !v)}>
              <span aria-hidden="true">☰</span> Agen
            </button>
          </nav>
        </>
      ) : null}

      {error && !data ? (
        <div className="boot">
          <p>tidak bisa memuat /api/status</p>
          <small>{error}</small>
        </div>
      ) : null}

      {touch && !mobile ? <p className="hint">geser untuk melihat · tombol 1/2/3 untuk pindah lantai</p> : null}
    </div>
  )
}
