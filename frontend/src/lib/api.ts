import type { Agent, StatusPayload } from './types'

/** Endpoint is same-origin in production; vite proxies it in dev. */
const STATUS_URL = '/api/status'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function fetchStatus(signal: AbortSignal): Promise<StatusPayload> {
  const res = await fetch(STATUS_URL, {
    signal,
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status)
  const json: unknown = await res.json()
  if (!isStatus(json)) throw new ApiError('bentuk JSON tidak dikenal', res.status)
  return json
}

export async function fetchAgent(id: string, signal: AbortSignal): Promise<Agent> {
  const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, {
    signal,
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status)
  return (await res.json()) as Agent
}

/** Minimal structural check — the API is ours, but a proxy error page is not. */
function isStatus(v: unknown): v is StatusPayload {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.now === 'number' &&
    Array.isArray(o.agents) &&
    Array.isArray(o.feed) &&
    Array.isArray(o.tasks) &&
    Array.isArray(o.comms)
  )
}
