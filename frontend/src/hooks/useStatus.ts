import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchStatus } from '../lib/api'
import { rosterAgents } from '../lib/roster'
import type { Agent, StatusPayload } from '../lib/types'

const POLL_MS = 4000
const BACKOFF_MS = [6000, 12000, 24000, 30000]

/**
 * A snapshot built from the roster alone, every agent `offline`. The office is
 * rendered from /api/status, so without it the room used to go empty; an API
 * outage must still show the desks that exist.
 */
function offlinePayload(): StatusPayload {
  const agents: Agent[] = rosterAgents().map((a) => ({
    id: a.id,
    status: 'offline',
    last_active: 0,
    current: null,
    today: { sessions: 0, messages: 0, tool_calls: 0, tokens: 0, hourly: [] },
    total: { sessions: 0, messages: 0 },
    task: null,
    source: null,
    blocked: null,
  }))
  return {
    now: Date.now() / 1000,
    gateway: { state: 'unknown', version: '', updated_at: '' },
    agents,
    feed: [],
    tasks: [],
    comms: [],
  }
}

export interface StatusState {
  data: StatusPayload | null
  error: string | null
  /** true when the last poll failed but we still show the previous snapshot */
  stale: boolean
  lastOk: number | null
  refresh: () => void
}

/**
 * Polls /api/status every 4 s with an AbortController per request. Failures
 * back off 6/12/24/30 s and keep the last good snapshot on screen. Polling
 * stops while the tab is hidden and resumes (immediately) when it returns.
 */
export function useStatus(): StatusState {
  const [data, setData] = useState<StatusPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastOk, setLastOk] = useState<number | null>(null)

  const timer = useRef<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  const failures = useRef(0)
  const alive = useRef(true)
  const tickRef = useRef<() => void>(() => {})

  function clear(): void {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  function schedule(ms: number): void {
    clear()
    if (document.visibilityState === 'hidden') return
    timer.current = window.setTimeout(() => tickRef.current(), ms)
  }

  const tick = useCallback(() => {
    if (!alive.current) return
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac

    fetchStatus(ac.signal)
      .then((payload) => {
        if (!alive.current || ac.signal.aborted) return
        failures.current = 0
        setData(payload)
        setError(null)
        setLastOk(Date.now())
        schedule(POLL_MS)
      })
      .catch((err: unknown) => {
        if (!alive.current || ac.signal.aborted) return
        failures.current += 1
        const wait = BACKOFF_MS[Math.min(failures.current - 1, BACKOFF_MS.length - 1)] ?? 30000
        // Keep the last good snapshot; if we never had one, render the roster offline.
        setData((prev) => prev ?? offlinePayload())
        setError(err instanceof Error ? err.message : 'gagal memuat status')
        schedule(wait)
      })
  }, [])

  useEffect(() => {
    tickRef.current = tick
  }, [tick])

  useEffect(() => {
    alive.current = true
    tick()

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        failures.current = 0
        tick()
      } else {
        clear()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', onVisible)
      clear()
      abort.current?.abort()
    }
  }, [tick])

  const refresh = useCallback(() => {
    failures.current = 0
    tick()
  }, [tick])

  return { data, error, stale: data !== null && error !== null, lastOk, refresh }
}
