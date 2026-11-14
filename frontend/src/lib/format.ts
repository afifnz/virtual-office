import type { AgentStatus, FeedKind } from './types'

/** Compact age label in Indonesian units: 12dtk, 4mnt, 3j, 2hr. */
export function relTime(ts: number, now: number): string {
  if (!ts) return '—'
  const s = Math.max(0, now - ts)
  if (s < 60) return `${Math.round(s)}dtk`
  if (s < 3600) return `${Math.round(s / 60)}mnt`
  if (s < 86400) return `${Math.round(s / 3600)}j`
  return `${Math.round(s / 86400)}hr`
}

/** WIB wall clock (the office runs on Jakarta time). */
export function wibClock(ts: number): string {
  const d = new Date((ts + 7 * 3600) * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: 'bekerja',
  reviewing: 'review',
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
