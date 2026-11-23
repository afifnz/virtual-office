import type { AgentStatus, FeedKind } from './types'
import { officeTZ } from './roster'

/** Compact age label in Indonesian units: 12dtk, 4mnt, 3j, 2hr. */
export function relTime(ts: number, now: number): string {
  if (!ts) return '—'
  const s = Math.max(0, now - ts)
  if (s < 60) return `${Math.round(s)}dtk`
  if (s < 3600) return `${Math.round(s / 60)}mnt`
  if (s < 86400) return `${Math.round(s / 3600)}j`
  return `${Math.round(s / 86400)}hr`
}

let clockFmt: Intl.DateTimeFormat | null = null
let clockTZ = ''

/**
 * Wall clock in the office timezone (OFFICE_TZ / the roster `tz`), not the
 * browser's. For the default Asia/Jakarta this is the same WIB clock the office
 * has always shown.
 */
export function officeClock(ts: number): string {
  const tz = officeTZ()
  if (!clockFmt || clockTZ !== tz) {
    try {
      clockFmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    } catch {
      clockFmt = null
    }
    clockTZ = tz
  }
  if (!clockFmt) {
    const d = new Date((ts + 7 * 3600) * 1000)
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  }
  return clockFmt.format(new Date(ts * 1000))
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: 'bekerja',
  reviewing: 'review',
  waiting: 'menunggu anak',
  blocked: 'terblokir',
  idle: 'menganggur',
  offline: 'offline',
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status as AgentStatus] ?? status
}

export const KIND_LABEL: Record<string, string> = {
  task: 'tugas baru',
  tool: 'pakai alat',
  tool_result: 'hasil alat',
  reply: 'membalas',
  request: 'permintaan',
  delegation_result: 'hasil delegasi',
}

export function kindLabel(kind: FeedKind | string): string {
  return KIND_LABEL[kind] ?? kind
}

/** "pakai terminal", "2 alat" */
export function toolLabel(tools: string[]): string {
  if (tools.length === 0) return ''
  if (tools.length === 1) return tools[0]!
  return `${tools.length} alat`
}

export function pct(n: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (n / total) * 100))
}

/** Compact token/large-number display. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}rb`
  return String(n)
}
