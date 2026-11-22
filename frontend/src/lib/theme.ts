/**
 * Theme resolution — the single source of truth for day/night.
 *
 * Pure: no React, no DOM, no `Date.now()` inside the rule. The caller passes
 * `now` (seconds from `/api/status`, an ISO string, or a Date), the office
 * timezone from `/api/config` (`tz`), the manual override and the OS
 * preference. Everything else is arithmetic on the local hour.
 *
 * Rules (design §2.1 / R&D §11):
 *  - daytime window is 06:00 ≤ local hour < 18:00 in the **office** timezone;
 *  - an explicit override (`day` / `night`) always wins;
 *  - `?theme=day|night` is an override too (it wins over the stored one, so a
 *    screenshot is deterministic on any machine);
 *  - a missing timezone falls back to `prefers-color-scheme`;
 *  - an unknown timezone falls back to Asia/Jakarta and reports `fallback-tz`;
 *  - the device clock is never consulted: without a server `now` we hold the
 *    OS preference instead of guessing.
 *
 * `verify/theme_check.ts` replays all of it headless (WIB boundaries, DST).
 */

export type ThemeMode = 'day' | 'night'
export type ThemeOverride = 'day' | 'night' | 'auto'

export type ThemeSource =
  | 'override'
  | 'auto'
  | 'fallback-tz'
  | 'prefers-color-scheme'

export const DAY_START_HOUR = 6
export const DAY_END_HOUR = 18
export const FALLBACK_TZ = 'Asia/Jakarta'
export const THEME_STORAGE_KEY = 'office-theme'

export interface ThemeResolution {
  mode: ThemeMode
  source: ThemeSource
  /** local hour 0–23 used for the decision (null when no clock was available) */
  hour: number | null
  /** timezone actually used */
  tz: string
}

/** Parse `?theme=` — only day/night/auto are valid, anything else is null. */
export function parseThemeParam(raw: string | null | undefined): ThemeOverride | null {
  const v = (raw ?? '').trim().toLowerCase()
  return v === 'day' || v === 'night' || v === 'auto' ? v : null
}

/** `true` when `Intl` accepts the zone; never throws. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(0)
    return true
  } catch {
    return false
  }
}

/** Local hour in `tz` (0–23), or null when the zone is unusable. */
export function hourInTimeZone(nowISO: string | number | Date, tz: string): number | null {
  return clockInTimeZone(nowISO, tz)?.hour ?? null
}

/** Local hour + minute in `tz`, or null when the zone/clock is unusable. */
export function clockInTimeZone(
  nowISO: string | number | Date,
  tz: string,
): { hour: number; minute: number } | null {
  if (!isValidTimeZone(tz)) return null
  const d = toDate(nowISO)
  if (!d) return null
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return { hour: hour % 24, minute: minute % 60 }
  } catch {
    return null
  }
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    // `/api/status.now` is Unix seconds; tolerate milliseconds too.
    const ms = value < 1e12 ? value * 1000 : value
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Resolve the theme. `now` may be null while `/api/status` has not answered —
 * in that case we hold the OS preference (never the device clock).
 */
export function resolveTheme(
  nowISO: string | number | Date | null | undefined,
  tz: string | null | undefined,
  override: ThemeOverride | null | undefined,
  prefersDark: boolean,
): ThemeResolution {
  const zone = (tz ?? '').trim()
  if (override === 'day' || override === 'night') {
    return {
      mode: override,
      source: 'override',
      hour: zone && isValidTimeZone(zone) ? hourInTimeZone(nowISO ?? 0, zone) : null,
      tz: zone || FALLBACK_TZ,
    }
  }

  const preferMode: ThemeMode = prefersDark ? 'night' : 'day'
  if (!zone) {
    return { mode: preferMode, source: 'prefers-color-scheme', hour: null, tz: FALLBACK_TZ }
  }

  const valid = isValidTimeZone(zone)
  const usedTz = valid ? zone : FALLBACK_TZ
  if (nowISO === null || nowISO === undefined) {
    return { mode: preferMode, source: 'prefers-color-scheme', hour: null, tz: usedTz }
  }

  const hour = hourInTimeZone(nowISO, usedTz)
  if (hour === null) {
    return { mode: preferMode, source: 'prefers-color-scheme', hour: null, tz: usedTz }
  }
  const day = hour >= DAY_START_HOUR && hour < DAY_END_HOUR
  return {
    mode: day ? 'day' : 'night',
    source: valid ? 'auto' : 'fallback-tz',
    hour,
    tz: usedTz,
  }
}

/** The stored manual override, or null. Safe outside a browser. */
export function readStoredOverride(): ThemeOverride | null {
  if (typeof window === 'undefined') return null
  try {
    return parseThemeParam(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return null
  }
}

/** Persist (or clear, for `auto`) the manual override. */
export function writeStoredOverride(value: ThemeOverride | null): void {
  if (typeof window === 'undefined') return
  try {
    if (value && value !== 'auto') window.localStorage.setItem(THEME_STORAGE_KEY, value)
    else window.localStorage.removeItem(THEME_STORAGE_KEY)
  } catch {
    /* private mode: the in-memory state still works */
  }
}

/**
 * Merge the two override sources. An explicit URL value is per-request and
 * wins over the stored one; `?theme=auto` clears it for that request.
 */
export function effectiveOverride(
  stored: ThemeOverride | null,
  url: ThemeOverride | null,
): ThemeOverride | null {
  if (url === 'auto') return null
  if (url === 'day' || url === 'night') return url
  return stored === 'auto' ? null : stored
}

/** Apply the resolved mode to <html data-theme>. */
export function applyTheme(mode: ThemeMode, source?: ThemeSource): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (root.dataset.theme !== mode) root.dataset.theme = mode
  if (source) root.dataset.themeSource = source
}

export function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

// ---------------------------------------------------------------- contrast

/** WCAG 2.x relative luminance of an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  const c = parseHex(hex)
  if (!c) return 0
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = c
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two opaque hex colours (≥ 1). */
export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg)
  const b = relativeLuminance(bg)
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

/** Composite `fg` at `alpha` over opaque `bg`, returning an opaque hex. */
export function compositeOver(fg: string, alpha: number, bg: string): string {
  const a = parseHex(fg)
  const b = parseHex(bg)
  if (!a || !b) return fg
  const k = Math.min(1, Math.max(0, alpha))
  const mix = (x: number, y: number) => Math.round(x * k + y * (1 - k))
  return `#${[mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
