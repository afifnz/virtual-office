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
import { SPOTS } from './lib/rooms'

export default function App() {
  const { data, error, stale } = useStatus()
  const mobile = useIsMobile()
  const touch = useIsTouch()

  // ?spot=<id> opens the camera at a named spot (used by verify/ scripts)
  const [command, setCommand] = useState<RigCommand>(() => {
    const spot = new URLSearchParams(window.location.search).get('spot')
    return { spot: spot && spot in SPOTS ? spot : 'lobby', nonce: 0 }
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
  const moveIntent = useRef<MoveIntent>({ x: 0, z: 0 })

  const now = data?.now ?? Date.now() / 1000
  const agentById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof data>['agents'][number]>()
    for (const a of data?.agents ?? []) m.set(a.id, a)
    return m
  }, [data])

  const displayId = pickedId ?? nearId
  const displayAgent = displayId ? agentById.get(displayId) : undefined

  const goTo = useCallback((spot: string) => {
    setCommand((c) => ({ spot, nonce: c.nonce + 1 }))
    setPickedId(null)
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

  // deep link: /#coder opens that desk, /?face=coder gets a face portrait
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const face = resolveAgentId(params.get('face') ?? '')
    if (face) {
      flyToAgent(face, true)
      return
    }
    const hash = resolveAgentId(decodeURIComponent(window.location.hash.replace('#', '')))
    if (hash) flyToAgent(hash)
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
    <div className={`app ${mobile ? 'is-mobile' : ''}`}>
      <div className="canvas-wrap">
        <Scene
          status={data}
          command={command}
          moveIntent={moveIntent}
          onNear={setNearId}
          onMove={onMove}
          onPick={onPick}
          dpr={mobile ? [1, 1.5] : [1, 1.8]}
        />
      </div>

      <Hud
        status={data}
        spot={command.spot}
        onSpot={goTo}
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
          nothing ever sits on top of the movement controls */}
      {mobile && !feedOpen && !taskOpen && !kpiOpen ? (
        <>
          <DPad intent={moveIntent} />
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

      {touch && !mobile ? <p className="hint">geser untuk melihat · tombol ruang untuk pindah</p> : null}
    </div>
  )
}
