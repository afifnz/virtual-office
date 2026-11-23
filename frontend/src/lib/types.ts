/** Wire types for GET /api/status — mirrors the Go contract exactly. */

export type AgentStatus = 'idle' | 'working' | 'reviewing' | 'waiting' | 'blocked' | 'offline'

export interface CurrentActivity {
  kind: string
  tools: string[]
}

/** Subagent sessions spawned by the agent's last delegate_task call. */
export interface ChildCount {
  total: number
  running: number
}

export interface BlockedInfo {
  reason: string
  since: number
  tools: number
}

export interface TodayCounters {
  sessions: number
  messages: number
  tool_calls: number
  tokens: number
  hourly: number[]
}

export interface TotalCounters {
  sessions: number
  messages: number
}

export interface Agent {
  id: string
  status: AgentStatus
  last_active: number
  current: CurrentActivity | null
  today: TodayCounters
  total: TotalCounters
  task: string | null
  source: string | null
  blocked: BlockedInfo | null
  /**
   * Additive truth fields. A stale working/reviewing verdict was demoted to
   * idle by the backend; the UI must not count it as working.
   */
  stale?: boolean
  /** Kind of the newest event behind the verdict (tool, tool_result, reply…). */
  last_kind?: string
  /** Present while the agent waits on the subagents it delegated to. */
  children?: ChildCount | null
}

export type FeedKind = 'task' | 'tool' | 'tool_result' | 'reply' | 'request' | 'delegation_result'

export interface FeedEvent {
  agent: string
  ts: number
  kind: FeedKind | string
  tools: string[]
  source: string | null
}

export interface Task {
  id: string
  owner: string
  from: string
  via: string
  status: 'running' | 'done' | 'blocked' | string
  blocked: BlockedInfo | null
  started: number
  last: number
  ended: number | null
  tools: number
  messages: number
}

export interface Comm {
  ts: number
  from: string
  to: string
  kind: 'delegate' | 'result' | 'failed' | 'steer' | 'request' | string
  task: string
  via?: string
}

export interface Gateway {
  state: string
  version: string
  updated_at: string
}

export interface StatusPayload {
  now: number
  gateway: Gateway
  agents: Agent[]
  feed: FeedEvent[]
  tasks: Task[]
  comms: Comm[]
}

/** Wire types for GET /api/kpi — mirrors derive.KPIReport. */
export type KpiWindowKey = '7d' | '30d'

export interface KpiTokens {
  available: boolean
  total: number | null
  messages_with_tokens: number
}

export interface KpiAgent {
  id: string
  sessions: number
  messages: number
  tool_calls: number
  active_days: number
  active_hours: number
  median_gap_s: number | null
  p90_gap_s: number | null
  active_seconds: number
  blocked_seconds: number
  blocked_pct: number | null
  last_active: number
  tokens: KpiTokens
}

export interface KpiTotals {
  sessions: number
  messages: number
  tool_calls: number
  active_agents: number
  active_seconds: number
  blocked_seconds: number
  blocked_pct: number | null
  tokens: KpiTokens
}

export interface KpiDataQuality {
  profiles_read: number
  profiles_ok: number
  profiles_err: number
  profiles_failed?: string[]
  messages_capped: boolean
  /** false means state.db has no token column at all — never render 0 tokens */
  token_column: boolean
  cost_available: boolean
}

export interface KpiPayload {
  window: KpiWindowKey
  from: number
  to: number
  generated_at: number
  cache_ttl_s: number
  agents: KpiAgent[]
  totals: KpiTotals
  data: KpiDataQuality
}

export type TeamId = 'lobby' | 'dev' | 'edu'
