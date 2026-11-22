/**
 * Theme decision checker: proves the pure behaviour of frontend/src/lib/theme
 * without a browser — the 06:00–18:00 local window (inclusive of 06:00,
 * exclusive of 18:00), the override precedence, the ICU midnight-'24' quirk,
 * the timezone fallback and DST correctness. All instants are fixed epoch
 * millis; 'now' is never read.
 *
 *   frontend/node_modules/.bin/esbuild verify/theme_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/theme_check.mjs
 *   node /tmp/theme_check.mjs
 */
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  DEFAULT_TZ,
  chooseSetting,
  localHour,
  resolveTheme,
  resolveThemeChoice,
  themeForHour,
  themeFromQuery,
  type Theme,
  type ThemeSetting,
} from '../frontend/src/lib/theme'

let fails = 0
const fail = (msg: string) => {
  fails++
  console.log('FAIL', msg)
}
const ok = (msg: string) => console.log('ok  ', msg)

// ---------------------------------------------------------------- constants

if (DAY_START_HOUR !== 6) fail(`DAY_START_HOUR = ${DAY_START_HOUR}, want 6`)
if (DAY_END_HOUR !== 18) fail(`DAY_END_HOUR = ${DAY_END_HOUR}, want 18`)
if (DEFAULT_TZ !== 'Asia/Jakarta') fail(`DEFAULT_TZ = ${DEFAULT_TZ}, want Asia/Jakarta`)
else ok('constants: window 06:00–18:00, default tz Asia/Jakarta')

// Jakarta is UTC+7 with no DST, so these UTC instants pin the local wall
// clock on 2026-06-15. (The lib never relies on Jakarta lacking DST — these
// are just fixed test fixtures.)
const JKT = (localH: number, localM: number) => Date.UTC(2026, 5, 15, localH - 7, localM)

const autoJkt = (nowMs: number, prefersDark = false) =>
  resolveTheme({ nowMs, tz: 'Asia/Jakarta', setting: 'auto', prefersDark })

const expect = (
  label: string,
  got: { theme: Theme; source: string },
  wantTheme: Theme,
  wantSource: string,
) => {
  if (got.theme !== wantTheme || got.source !== wantSource) {
    fail(`${label} → ${got.theme}/${got.source}, want ${wantTheme}/${wantSource}`)
  } else ok(`${label} → ${wantTheme} (${wantSource})`)
}

// -------------------------------------------- 1. the 06:00–18:00 local window

expect('05:59 Jakarta', autoJkt(JKT(5, 59)), 'night', 'auto')
expect('06:00 Jakarta', autoJkt(JKT(6, 0)), 'day', 'auto')
expect('17:59 Jakarta', autoJkt(JKT(17, 59)), 'day', 'auto')
expect('18:00 Jakarta', autoJkt(JKT(18, 0)), 'night', 'auto')
expect('00:00 Jakarta', autoJkt(JKT(0, 0)), 'night', 'auto')
expect('23:59 Jakarta', autoJkt(JKT(23, 59)), 'night', 'auto')

// themeForHour / localHour agree with the window at its edges
if (themeForHour(5) !== 'night' || themeForHour(6) !== 'day') fail('themeForHour edge at 06:00 wrong')
if (themeForHour(17) !== 'day' || themeForHour(18) !== 'night') fail('themeForHour edge at 18:00 wrong')
else ok('themeForHour: [06, 18) is day, outside is night')

// The ICU midnight quirk: 00:00 local formats the hour as '24', must read 0.
const midnightHour = localHour(JKT(0, 0), 'Asia/Jakarta')
if (midnightHour !== 0) fail(`localHour at midnight = ${midnightHour}, want 0 (ICU '24' quirk)`)
else ok("localHour maps ICU's midnight '24' to 0")

// ------------------------------------------------- 2. override wins any hour

expect(
  "setting 'day' at 23:00 Jakarta",
  resolveTheme({ nowMs: JKT(23, 0), tz: 'Asia/Jakarta', setting: 'day', prefersDark: false }),
  'day',
  'override',
)
expect(
  "setting 'night' at 12:00 Jakarta",
  resolveTheme({ nowMs: JKT(12, 0), tz: 'Asia/Jakarta', setting: 'night', prefersDark: false }),
  'night',
  'override',
)

// ------------------------------------- 3. office clock beats the OS preference

expect(
  'auto + valid tz + prefersDark at 12:00',
  autoJkt(JKT(12, 0), true),
  'day',
  'auto',
)
expect(
  'auto + valid tz + !prefersDark at 23:00',
  autoJkt(JKT(23, 0), false),
  'night',
  'auto',
)
expect(
  'auto + no tz + prefersDark',
  resolveTheme({ nowMs: JKT(12, 0), tz: null, setting: 'auto', prefersDark: true }),
  'night',
  'prefers-color-scheme',
)
expect(
  'auto + blank tz + !prefersDark',
  resolveTheme({ nowMs: JKT(12, 0), tz: '   ', setting: 'auto', prefersDark: false }),
  'day',
  'prefers-color-scheme',
)

// --------------------------------------------------------- 4. ?theme= deep link

const cases: Array<[string, ThemeSetting | null]> = [
  ['?theme=day', 'day'],
  ['?theme=night', 'night'],
  ['?theme=auto', 'auto'],
  ['theme=day&still=1', 'day'],
  ['https://office.example/?theme=night#top', 'night'],
  ['?theme=bogus', null],
  ['?other=1', null],
  ['', null],
]
let queryOk = true
for (const [input, want] of cases) {
  const got = themeFromQuery(input)
  if (got !== want) {
    queryOk = false
    fail(`themeFromQuery(${JSON.stringify(input)}) = ${got}, want ${want}`)
  }
}
if (queryOk) ok('?theme=day|night|auto parses (bare, query, full URL); bogus/absent → null')

// -------------------------------------------------- 5. invalid tz → fallback

// 12:00 in the fallback zone (Asia/Jakarta) is day — the instant must still
// resolve correctly, only the source changes.
expect(
  "tz 'Not/AZone' at 12:00 Jakarta-equivalent",
  resolveTheme({ nowMs: JKT(12, 0), tz: 'Not/AZone', setting: 'auto', prefersDark: false }),
  'day',
  'fallback-tz',
)
expect(
  "tz 'Not/AZone' at 23:00 Jakarta-equivalent",
  resolveTheme({ nowMs: JKT(23, 0), tz: 'Not/AZone', setting: 'auto', prefersDark: false }),
  'night',
  'fallback-tz',
)

// ------------------------------------------------------------- 6. DST zones
// Europe/Amsterdam: CET (+1) in January, CEST (+2) in July. The same UTC
// instant lands on different local hours — Intl must track it, on both sides
// of both the winter and summer day windows.

const AMS = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo, d, h, mi)
const autoAms = (nowMs: number) =>
  resolveTheme({ nowMs, tz: 'Europe/Amsterdam', setting: 'auto', prefersDark: false })

expect('Amsterdam 2026-01-15T05:30Z = 06:30 CET (winter)', autoAms(AMS(2026, 0, 15, 5, 30)), 'day', 'auto')
expect('Amsterdam 2026-07-15T04:30Z = 06:30 CEST (summer)', autoAms(AMS(2026, 6, 15, 4, 30)), 'day', 'auto')
expect('Amsterdam 2026-01-15T04:30Z = 05:30 CET (winter)', autoAms(AMS(2026, 0, 15, 4, 30)), 'night', 'auto')
expect('Amsterdam 2026-07-15T03:30Z = 05:30 CEST (summer)', autoAms(AMS(2026, 6, 15, 3, 30)), 'night', 'auto')

// The local hour itself must match the wall clock across the DST boundary.
if (localHour(AMS(2026, 0, 15, 5, 30), 'Europe/Amsterdam') !== 6) {
  fail('localHour Amsterdam winter 05:30Z != 6')
}
if (localHour(AMS(2026, 6, 15, 4, 30), 'Europe/Amsterdam') !== 6) {
  fail('localHour Amsterdam summer 04:30Z != 6')
} else ok('localHour tracks the DST offset change (CET ↔ CEST), no hand-computed offsets')

// ------------------------------------- 7. manual override vs ?theme= deep link
// Full precedence chain: manual > query > office clock > OS preference.
expect(
  'manual night beats query day at 12:00',
  resolveThemeChoice({ nowMs: JKT(12, 0), tz: 'Asia/Jakarta', manual: 'night', query: 'day', prefersDark: false }),
  'night',
  'override',
)
expect(
  'manual day beats query night at 23:00',
  resolveThemeChoice({ nowMs: JKT(23, 0), tz: 'Asia/Jakarta', manual: 'day', query: 'night', prefersDark: false }),
  'day',
  'override',
)
expect(
  'query day beats the office clock at 23:00',
  resolveThemeChoice({ nowMs: JKT(23, 0), tz: 'Asia/Jakarta', manual: null, query: 'day', prefersDark: false }),
  'day',
  'override',
)
expect(
  'query night beats the office clock at 12:00',
  resolveThemeChoice({ nowMs: JKT(12, 0), tz: 'Asia/Jakarta', manual: null, query: 'night', prefersDark: false }),
  'night',
  'override',
)
expect(
  'manual auto + query auto falls through to the office clock at 23:00',
  resolveThemeChoice({ nowMs: JKT(23, 0), tz: 'Asia/Jakarta', manual: 'auto', query: 'auto', prefersDark: false }),
  'night',
  'auto',
)
expect(
  'no override, no query, valid tz -> office clock beats prefersDark',
  resolveThemeChoice({ nowMs: JKT(12, 0), tz: 'Asia/Jakarta', manual: null, query: null, prefersDark: true }),
  'day',
  'auto',
)
expect(
  'no tz and no override -> OS preference is the last resort',
  resolveThemeChoice({ nowMs: JKT(12, 0), tz: null, manual: null, query: null, prefersDark: true }),
  'night',
  'prefers-color-scheme',
)
if (chooseSetting('night', 'day') !== 'night') fail('chooseSetting: manual must win over query')
else if (chooseSetting(null, 'day') !== 'day') fail('chooseSetting: query must win when there is no manual override')
else if (chooseSetting(undefined, null) !== 'auto') fail('chooseSetting: absent both must be auto')
else ok('chooseSetting composes manual > query > auto')

// --------------------------------------------------------------- final verdict

console.log(fails === 0 ? '\nTHEME OK' : `\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
