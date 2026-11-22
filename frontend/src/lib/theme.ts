/**
 * Keputusan tema kantor — Terang (day) vs Gelap (night) — as a PURE module.
 *
 * Rules (boss decision, binding):
 *  - The day window is 06:00–18:00 in the office's LOCAL time. Inclusive of
 *    06:00, exclusive of 18:00. Everything else is night.
 *  - Precedence: manual override / `?theme=` deep link → auto (office clock)
 *    → `prefers-color-scheme`. In auto mode a valid tz ALWAYS beats the OS
 *    dark-mode preference; `prefersDark` only applies when the caller has no
 *    tz and no override. The office clock wins over the OS preference.
 *
 * Contracts:
 *  (a) ONE time source. Pure functions take `nowMs` from the CALLER — the
 *      caller should pass the server `now` from /api/status, not the device
 *      clock, so a stale device clock cannot flip the theme. This module
 *      never reads `Date.now()` and never touches the browser's own clock.
 *  (b) NO flicker. The theme is decided here and applied when the next static
 *      layer is rendered — never swapped mid-frame. The renderer re-resolves
 *      on a whole-layer repaint, not on a timer.
 *  (c) Missing/blank/invalid tz: in auto mode the office falls back to
 *      DEFAULT_TZ (Asia/Jakarta) and reports source 'fallback-tz'. Intl
 *      throws RangeError for unknown zones; we catch it here.
 *  (d) Asia/Jakarta has no DST, but this code does NOT rely on that: all
 *      local hours come from `Intl.DateTimeFormat` with the caller's zone,
 *      so DST transitions are handled by ICU — offsets are never computed
 *      by hand and never hardcoded (+07:00 appears nowhere).
 *
 * Pure: no React, no DOM access, no `Date.now()` — fully headless-testable
 * (see verify/theme_check.ts).
 */

export const DAY_START_HOUR = 6
export const DAY_END_HOUR = 18
export const DEFAULT_TZ = 'Asia/Jakarta'

export type Theme = 'day' | 'night'
export type ThemeSetting = 'auto' | 'day' | 'night'

export type ThemeSource = 'override' | 'auto' | 'fallback-tz' | 'prefers-color-scheme'

export interface ThemeChoice {
  theme: Theme
  source: ThemeSource
}

/**
 * The local wall-clock hour (0–23) of `nowMs` in `tz`, or null when `tz` is
 * rejected by Intl (RangeError). ICU formats midnight as '24' under
 * hour12: false — that quirk is normalised to 0 here.
 */
function tryLocalHour(nowMs: number, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date(nowMs))
    const raw = parts.find((p) => p.type === 'hour')?.value
    if (raw === undefined) return null
    let hour = parseInt(raw, 10)
    if (hour === 24) hour = 0 // ICU quirk: midnight formats as '24'
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
    return hour
  } catch {
    return null
  }
}

/**
 * Local wall-clock hour of `nowMs` in `tz`. Falls back to DEFAULT_TZ when
 * `tz` is invalid; throws only if even DEFAULT_TZ is rejected (never in
 * practice — kept as a hard error instead of a silent wrong answer).
 */
export function localHour(nowMs: number, tz: string): number {
  const hour = tryLocalHour(nowMs, tz)
  if (hour !== null) return hour
  const fallback = tryLocalHour(nowMs, DEFAULT_TZ)
  if (fallback === null) throw new RangeError(`Intl rejected the default timezone ${DEFAULT_TZ}`)
  return fallback
}

/** Day when DAY_START_HOUR <= hour < DAY_END_HOUR, night otherwise. */
export function themeForHour(hour: number): Theme {
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR ? 'day' : 'night'
}

/**
 * Resolve the theme for one instant. Precedence:
 *   setting 'day'/'night' → override (wins at any hour)
 *   setting 'auto' + valid tz → office clock (source 'auto')
 *   setting 'auto' + invalid tz → office clock in DEFAULT_TZ (source 'fallback-tz')
 *   setting 'auto' + no tz at all → the OS preference (source 'prefers-color-scheme')
 *
 * `prefersDark` is ONLY consulted in the last branch — it must never override
 * a valid office clock in auto mode (the office clock wins over the OS).
 */
export function resolveTheme(opts: {
  nowMs: number
  tz: string | null | undefined
  setting: ThemeSetting
  prefersDark: boolean
}): ThemeChoice {
  if (opts.setting === 'day' || opts.setting === 'night') {
    return { theme: opts.setting, source: 'override' }
  }
  const tz = typeof opts.tz === 'string' ? opts.tz.trim() : ''
  if (tz !== '') {
    const hour = tryLocalHour(opts.nowMs, tz)
    if (hour !== null) return { theme: themeForHour(hour), source: 'auto' }
    // Unknown zone: fall back to the default office zone, but say so.
    const fallback = tryLocalHour(opts.nowMs, DEFAULT_TZ)
    if (fallback === null) throw new RangeError(`Intl rejected the default timezone ${DEFAULT_TZ}`)
    return { theme: themeForHour(fallback), source: 'fallback-tz' }
  }
  // No office clock at all and no override: the OS preference is the last resort.
  return { theme: opts.prefersDark ? 'night' : 'day', source: 'prefers-color-scheme' }
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/**
 * Compose the two explicit sources into the setting `resolveTheme` receives.
 *
 * Precedence: the manual HUD override (persisted in localStorage) wins over
 * the `?theme=` deep link, because the manual toggle is the most recent human
 * action while the query string is a test/screenshot affordance. A manual
 * 'auto' and a query 'auto' are equivalent — both mean "let the office clock
 * decide". Anything absent falls through to 'auto'.
 */
export function chooseSetting(
  manual: ThemeSetting | null | undefined,
  query: ThemeSetting | null | undefined,
): ThemeSetting {
  if (manual === 'day' || manual === 'night') return manual
  if (query === 'day' || query === 'night') return query
  return 'auto'
}

/**
 * One-call entry point for the renderer: compose manual + query, then resolve.
 * Keeping the two steps here (instead of in the component) is what makes the
 * full precedence chain testable headless.
 */
export function resolveThemeChoice(opts: {
  nowMs: number
  tz: string | null | undefined
  manual?: ThemeSetting | null
  query?: ThemeSetting | null
  prefersDark: boolean
}): ThemeChoice {
  return resolveTheme({
    nowMs: opts.nowMs,
    tz: opts.tz,
    setting: chooseSetting(opts.manual, opts.query),
    prefersDark: opts.prefersDark,
  })
}

/**
 * Parse `?theme=day|night|auto` out of a query string, accepting a leading
 * '?', a bare 'theme=...' string, or a full URL (only its query part is
 * read). Returns null when the parameter is absent or not a valid setting.
 */
export function themeFromQuery(search: string): ThemeSetting | null {
  let s = search.trim()
  if (s === '') return null
  const q = s.indexOf('?')
  if (q >= 0) s = s.slice(q + 1)
  const h = s.indexOf('#')
  if (h >= 0) s = s.slice(0, h)
  if (s.startsWith('?')) s = s.slice(1)
  for (const pair of s.split('&')) {
    if (pair === '') continue
    const eq = pair.indexOf('=')
    const key = eq < 0 ? pair : pair.slice(0, eq)
    if (decode(key) !== 'theme') continue
    const value = eq < 0 ? '' : decode(pair.slice(eq + 1))
    if (value === 'day' || value === 'night' || value === 'auto') return value
    return null
  }
  return null
}
