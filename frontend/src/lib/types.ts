/** Wire types for GET /api/status — mirrors the Go contract exactly. */

export type AgentStatus = 'idle' | 'working' | 'reviewing' | 'blocked' | 'offline'

export interface CurrentActivity {
  kind: string
  tools: string[]
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

export type TeamId = 'lobby' | 'dev' | 'edu'
