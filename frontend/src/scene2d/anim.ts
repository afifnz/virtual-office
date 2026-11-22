/**
 * Agent pose mapping: turns one /api/status row into the pose drawn on the 2D
 * canvas. Pure and deterministic — no DOM, no Math.random — so
 * verify/anim_check.ts replays the whole table headless.
 *
 * Everything derives from fields that already exist in `types.ts`; the backend
 * contract is untouched. The walking state machine itself (following the route
 * frame by frame) lives in Office2D.tsx; this module only says *where* a
 * delegate walk is headed.
 */
import type { Agent, Comm } from '../lib/types'
import { rosterAgents } from '../lib/roster'
import { toolLabel } from '../lib/format'

export type PoseKind =
  | 'offline' // empty chair, dimmed
  | 'blocked' // seated + yellow chip + pulse
  | 'typing' // hands up/down over the keyboard
  | 'reading' // book/scroll, slower "..."
  | 'working' // generic work pose + tool chip
  | 'walk' // delegating: walking to a target desk/POI
  | 'relax' // reply + idle: relaxed bob, coffee
  | 'idle' // idle bob in the chair

export interface WalkTarget {
  kind: 'desk' | 'poi'
  id: string
}

export interface Pose {
  kind: PoseKind
  /** where a walking agent is headed (only when kind === 'walk') */
  walkTo?: WalkTarget
  /** active tool label ('' when none) */
  tool: string
  typing: boolean
  reading: boolean
  blocked: boolean
  offline: boolean
  /** reviewing pose with the diff/magnifier screen */
  magnifier: boolean
  /** a delegate comm is in flight (paper airplane) */
  comming: boolean
}

const TYPING_TOOLS = new Set(['terminal', 'execute_code', 'patch', 'write_file'])
const READING_TOOLS = new Set(['read_file', 'search_files', 'web_extract', 'web_search', 'session_search'])

/** A delegate comm from this agent still counts within ±30 s. */
const DELEGATE_WINDOW_S = 30

/** Newest delegate comm from this agent within the window, or null. */
function recentDelegate(agent: Agent, now: number, comms: Comm[]): Comm | null {
  let best: Comm | null = null
  for (const c of comms) {
    if (c.from !== agent.id || c.kind !== 'delegate') continue
    if (Math.abs(now - c.ts) > DELEGATE_WINDOW_S) continue
    if (!best || c.ts > best.ts) best = c
  }
  return best
}

/** Delegating: the delegate_task tool fired, or a fresh delegate comm exists. */
function isDelegating(agent: Agent, now: number, comms: Comm[]): boolean {
  const viaTool = agent.current?.kind === 'tool' && agent.current.tools.includes('delegate_task')
  const viaComm = recentDelegate(agent, now, comms) !== null
  return viaTool || viaComm
}

/**
 * Target of a delegate walk: the comm's recipient desk when it sits on the
 * walker's own floor, else the nearest meeting POI on the walker's floor
 * (cross-floor visits are a lift journey, M2/M3 — the walk never leaves the
 * walker's floor).
 */
function walkTarget(agent: Agent, now: number, comms: Comm[]): WalkTarget {
  const c = recentDelegate(agent, now, comms)
  const to = c?.to
  const self = rosterAgents().find((a) => a.id === agent.id)
  const floor = self?.desk.floor ?? 1
  if (to) {
    const target = rosterAgents().find((a) => a.id === to)
    if (target && target.desk.floor === floor) return { kind: 'desk', id: to }
  }
  return { kind: 'poi', id: floor === 3 ? 'standup' : 'rapat' }
}

function base(kind: PoseKind, extra: Partial<Pose> = {}): Pose {
  return {
    kind,
    tool: '',
    typing: false,
    reading: false,
    blocked: false,
    offline: false,
    magnifier: false,
    comming: false,
    ...extra,
  }
}

/**
 * Map one agent to its pose. Priority: offline > blocked > walk (delegate) >
 * typing > reading > generic working > relax (reply) > idle.
 */
export function poseFor(agent: Agent, now: number, comms: Comm[]): Pose {
  const tools = agent.current?.tools ?? []
  const kind = agent.current?.kind ?? ''

  if (agent.status === 'offline') return base('offline', { offline: true })
  if (agent.status === 'blocked') return base('blocked', { blocked: true })

  if (isDelegating(agent, now, comms)) {
    return base('walk', {
      walkTo: walkTarget(agent, now, comms),
      tool: toolLabel(tools),
      comming: recentDelegate(agent, now, comms) !== null,
    })
  }

  const hasTyping = tools.some((t) => TYPING_TOOLS.has(t))
  const hasReading = tools.some((t) => READING_TOOLS.has(t))

  if (agent.status === 'reviewing') {
    if (hasTyping) return base('typing', { typing: true, magnifier: true, tool: toolLabel(tools) })
    return base('reading', { reading: true, magnifier: true, tool: toolLabel(tools) })
  }

  if (agent.status === 'working') {
    if (hasTyping) return base('typing', { typing: true, tool: toolLabel(tools) })
    if (hasReading) return base('reading', { reading: true, tool: toolLabel(tools) })
    return base('working', { tool: toolLabel(tools) })
  }

  if (kind === 'reply') return base('relax')
  return base('idle')
}

/**
 * Generic blocked chip label. The raw `blocked.reason` must never reach the
 * canvas — it may contain private detail — so this text is fixed.
 */
export function blockedChipText(agent: Agent): string {
  const n = agent.blocked?.tools ?? 0
  return n > 0 ? `butuh izin · ${n} alat` : 'butuh izin'
}
