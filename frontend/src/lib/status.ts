/**
 * Status truth helpers — the single place that decides what a /api/status row
 * *counts as* in the UI.
 *
 * The backend publishes two additive facts next to `status`:
 *   - `stale`: a working/reviewing verdict was demoted because nothing happened
 *     for OFFICE_STALE_SECONDS. It must not be counted as working anywhere.
 *   - `waiting` status + `children`: the agent is blocked on its own subagents.
 *     Waiting is not working either — the child is the one doing the work.
 *
 * Everything that counts (HUD header, floor tabs, roster summary) goes through
 * `effectiveStatus`/`countStatuses`, so the numbers on screen always agree.
 */
import type { Agent, AgentStatus } from './types'
import { kindLabel, statusLabel } from './format'

/** True when the backend flagged this verdict as stale (it already demoted it). */
export function isStaleAgent(a: Agent): boolean {
  // The backend emits `{status:"idle", stale:true}` — the status is *already*
  // demoted, so the flag alone decides. (Older rows have no flag at all.)
  return a.stale === true
}

/** The status a counter should use: a stale verdict reads as idle. */
export function effectiveStatus(a: Agent): AgentStatus {
  return isStaleAgent(a) ? 'idle' : a.status
}

/** Working right now means working/reviewing and not stale. Waiting is not working. */
export function isWorkingNow(a: Agent): boolean {
  const s = effectiveStatus(a)
  return s === 'working' || s === 'reviewing'
}

/** Number of subagent sessions still running under this agent. */
export function runningChildren(a: Agent): number {
  return a.children?.running ?? 0
}

/** `⤷ N` badge for a waiting parent, or null when nothing is running. */
export function childBadge(a: Agent): string | null {
  const n = runningChildren(a)
  return n > 0 ? `⤷ ${n}` : null
}

/** Human label for a row: "menunggu anak", "tidak aktif", "bekerja", … */
export function statusText(a: Agent): string {
  if (isStaleAgent(a)) return 'tidak aktif'
  return statusLabel(a.status)
}

/** Why a stale desk looks idle: "tidak aktif · pakai alat terakhir". */
export function staleNote(a: Agent): string {
  const kind = a.last_kind ? kindLabel(a.last_kind) : ''
  return kind ? `tidak aktif · ${kind} terakhir` : 'tidak aktif'
}

/** Counts keyed by effective status. */
export function countStatuses(agents: ReadonlyArray<Agent>): Map<AgentStatus, number> {
  const counts = new Map<AgentStatus, number>()
  for (const a of agents) {
    const s = effectiveStatus(a)
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return counts
}

/** Compact group summary, e.g. "2 bekerja · 1 menunggu anak · 3 menganggur". */
export function statusSummary(agents: ReadonlyArray<Agent>): string {
  return [...countStatuses(agents).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([status, n]) => `${n} ${statusLabel(status)}`)
    .join(' · ')
}
