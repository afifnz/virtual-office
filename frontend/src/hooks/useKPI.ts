import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchKPI } from '../lib/api'
import type { KpiPayload, KpiWindowKey } from '../lib/types'

/** The server caches a window for 60 s; polling faster would only hit that cache. */
const REFRESH_MS = 60_000

export interface KpiState {
  data: KpiPayload | null
  error: string | null
  loading: boolean
  /** true when the last refresh failed but the previous report is still shown */
  stale: boolean
  refresh: () => void
}

/**
 * Fetches /api/kpi only while the panel is open. A failed request keeps the
 * last good report and surfaces the error; with no report at all the panel
 * renders an explicit "tidak tersedia" state instead of an empty chart.
 */
export function useKPI(win: KpiWindowKey, enabled: boolean): KpiState {
  const [data, setData] = useState<KpiPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [stale, setStale] = useState(false)

  const abort = useRef<AbortController | null>(null)
  const timer = useRef<number | null>(null)
  const alive = useRef(true)
  const tickRef = useRef<() => void>(() => {})

  const tick = useCallback(() => {
    if (!alive.current) return
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    setLoading(true)

    fetchKPI(win, ac.signal)
      .then((payload) => {
        if (!alive.current || ac.signal.aborted) return
        setData(payload)
        setError(null)
        setStale(false)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive.current || ac.signal.aborted) return
        setError(err instanceof Error ? err.message : 'gagal memuat KPI')
        setStale(true)
        setLoading(false)
      })
  }, [win])

  useEffect(() => {
    tickRef.current = tick
  }, [tick])

  useEffect(() => {
    alive.current = true
    if (!enabled) {
      abort.current?.abort()
      return () => {
        alive.current = false
      }
    }

    const clear = () => {
      if (timer.current !== null) {
        globalThis.clearInterval(timer.current)
        timer.current = null
      }
    }

    // Fetch immediately, then once a minute for as long as the panel stays
    // open. An interval (not a single timeout) is what keeps a long-open panel
    // fresh; the server cache makes the extra hits cheap.
    tick()
    clear()
    timer.current = globalThis.setInterval(() => tickRef.current(), REFRESH_MS)
    return () => {
      alive.current = false
      clear()
      abort.current?.abort()
    }
  }, [enabled, win])

  const refresh = useCallback(() => {
    setError(null)
    tick()
  }, [tick])

  return { data, error, loading, stale, refresh }
}
