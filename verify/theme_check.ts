/**
 * Theme gate — replays the day/night rule headless, plus the contrast table
 * that made the light theme usable.
 *
 *   frontend/node_modules/.bin/esbuild verify/theme_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/theme_check.mjs
 *   node /tmp/theme_check.mjs        # "THEME OK", exit 0
 *
 * The clock is always an explicit instant: WIB is UTC+7, Amsterdam is
 * UTC+2 in July (CEST) and UTC+1 in January (CET). Nothing here reads the
 * device clock, which is exactly the property the app needs.
 */
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  FALLBACK_TZ,
  compositeOver,
  contrastRatio,
  effectiveOverride,
  hourInTimeZone,
  isValidTimeZone,
  parseThemeParam,
  resolveTheme,
} from '../frontend/src/lib/theme'
import { THEME_STATUS, THEME_TOKENS } from '../frontend/src/scene2d/palette'

let fails = 0
let checks = 0
const fail = (msg: string) => {
  fails++
  console.log('FAIL', msg)
}
const ok = (msg: string) => {
  checks++
  console.log('ok  ', msg)
}
const expect = (label: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  else ok(`${label} = ${JSON.stringify(got)}`)
}

// WIB instants (UTC+7). 2026-11-22 is a Sunday, no DST anywhere in Asia.
const WIB = {
  midnight: '2026-11-21T17:00:00Z', // 00:00 WIB
  beforeDawn: '2026-11-21T22:59:00Z', // 05:59 WIB
  dawn: '2026-11-21T23:00:00Z', // 06:00 WIB
  beforeDusk: '2026-11-22T10:59:00Z', // 17:59 WIB
  dusk: '2026-11-22T11:00:00Z', // 18:00 WIB
  lateNight: '2026-11-22T16:59:00Z', // 23:59 WIB
  noon: '2026-11-22T05:00:00Z', // 12:00 WIB
}

// ---------------------------------------------------------- 1. day window
expect('05:59 WIB', resolveTheme(WIB.beforeDawn, 'Asia/Jakarta', null, false).mode, 'night')
expect('06:00 WIB', resolveTheme(WIB.dawn, 'Asia/Jakarta', null, false).mode, 'day')
expect('17:59 WIB', resolveTheme(WIB.beforeDusk, 'Asia/Jakarta', null, false).mode, 'day')
expect('18:00 WIB', resolveTheme(WIB.dusk, 'Asia/Jakarta', null, false).mode, 'night')
expect('00:00 WIB', resolveTheme(WIB.midnight, 'Asia/Jakarta', null, false).mode, 'night')
expect('23:59 WIB', resolveTheme(WIB.lateNight, 'Asia/Jakarta', null, false).mode, 'night')
expect('12:00 WIB source', resolveTheme(WIB.noon, 'Asia/Jakarta', null, true).source, 'auto')
if (DAY_START_HOUR !== 6 || DAY_END_HOUR !== 18) fail(`window is ${DAY_START_HOUR}..${DAY_END_HOUR}, want 6..18`)
else ok('day window constants are 06:00 ≤ h < 18:00')

// --------------------------------------------------------------- 2. override
expect('override day at 23:00', resolveTheme(WIB.lateNight, 'Asia/Jakarta', 'day', false).mode, 'day')
expect('override night at 12:00', resolveTheme(WIB.noon, 'Asia/Jakarta', 'night', true).mode, 'night')
expect('override auto at 12:00', resolveTheme(WIB.noon, 'Asia/Jakarta', 'auto', true).mode, 'day')
expect('override source', resolveTheme(WIB.noon, 'Asia/Jakarta', 'night', false).source, 'override')
expect('override night beats prefers-light', resolveTheme(WIB.noon, 'Asia/Jakarta', 'night', false).mode, 'night')

// ------------------------------------------------------------- 3. URL param
expect('?theme=day', parseThemeParam('day'), 'day')
expect('?theme=night', parseThemeParam('NIGHT'), 'night')
expect('?theme=auto', parseThemeParam('auto'), 'auto')
expect('?theme=bogus', parseThemeParam('bogus'), null)
expect('?theme absent', parseThemeParam(null), null)
expect('url day beats stored night', effectiveOverride('night', 'day'), 'day')
expect('url auto clears stored', effectiveOverride('night', 'auto'), null)
expect('stored wins when no url', effectiveOverride('night', null), 'night')

// ------------------------------------------------------- 4. missing / bad tz
expect('missing tz + dark OS', resolveTheme(WIB.noon, '', null, true), {
  mode: 'night',
  source: 'prefers-color-scheme',
  hour: null,
  tz: FALLBACK_TZ,
})
expect('missing tz + light OS', resolveTheme(WIB.noon, undefined, null, false).mode, 'day')
const badTz = resolveTheme(WIB.noon, 'Mars/Olympus', null, false)
expect('unknown tz source', badTz.source, 'fallback-tz')
expect('unknown tz mode', badTz.mode, 'day')
expect('unknown tz zone', badTz.tz, FALLBACK_TZ)
if (isValidTimeZone('Mars/Olympus')) fail('isValidTimeZone accepted Mars/Olympus')
else ok('isValidTimeZone rejects Mars/Olympus')
if (!isValidTimeZone('Asia/Jakarta')) fail('isValidTimeZone rejected Asia/Jakarta')
else ok('isValidTimeZone accepts Asia/Jakarta')
expect('hour in WIB', hourInTimeZone(WIB.noon, 'Asia/Jakarta'), 12)
expect('hour with bad tz', hourInTimeZone(WIB.noon, 'Mars/Olympus'), null)

// ------------------------------------------------------------- 5. no clock
expect('no server now holds OS preference', resolveTheme(null, 'Asia/Jakarta', null, true).source, 'prefers-color-scheme')
expect('no server now mode', resolveTheme(null, 'Asia/Jakarta', null, false).mode, 'day')

// --------------------------------------------------------------- 6. DST tz
// Amsterdam: CEST (UTC+2) in July, CET (UTC+1) in January.
const AMS = {
  summerBefore: '2026-07-15T03:30:00Z', // 05:30 CEST
  summerAfter: '2026-07-15T04:30:00Z', // 06:30 CEST
  winterBefore: '2026-01-15T04:30:00Z', // 05:30 CET
  winterAfter: '2026-01-15T05:30:00Z', // 06:30 CET
}
expect('Amsterdam CEST 05:30', resolveTheme(AMS.summerBefore, 'Europe/Amsterdam', null, false).mode, 'night')
expect('Amsterdam CEST 06:30', resolveTheme(AMS.summerAfter, 'Europe/Amsterdam', null, false).mode, 'day')
expect('Amsterdam CET 05:30', resolveTheme(AMS.winterBefore, 'Europe/Amsterdam', null, false).mode, 'night')
expect('Amsterdam CET 06:30', resolveTheme(AMS.winterAfter, 'Europe/Amsterdam', null, false).mode, 'day')
expect('Amsterdam CEST hour', hourInTimeZone(AMS.summerAfter, 'Europe/Amsterdam'), 6)
expect('Amsterdam CET hour', hourInTimeZone(AMS.winterAfter, 'Europe/Amsterdam'), 6)

// ------------------------------------------------- 7. two other zones work
expect('Tokyo 12:00 JST', resolveTheme('2026-11-22T03:00:00Z', 'Asia/Tokyo', null, false).mode, 'day')
expect('Los Angeles 12:00 PST', resolveTheme('2026-01-15T20:00:00Z', 'America/Los_Angeles', null, false).mode, 'day')
expect('UTC 18:00', resolveTheme('2026-11-22T18:00:00Z', 'UTC', null, false).mode, 'night')

// ---------------------------------------------------------- 8. contrast table
// Text threshold 4.5:1, dot/line 3:1 (design §3.2). The background is the
// *composite* glass over the page, not white/black.
const STATUSES = ['working', 'reviewing', 'idle', 'blocked', 'offline', 'ok', 'danger'] as const
for (const theme of ['day', 'night'] as const) {
  const t = THEME_TOKENS[theme]
  const glass = compositeOver(t.glass.surface, t.glass.alpha, t.page)
  const ratios: string[] = []
  for (const s of STATUSES) {
    const ratio = contrastRatio(THEME_STATUS[theme][s], glass)
    ratios.push(`${s} ${ratio.toFixed(2)}`)
    if (ratio < 4.5) fail(`${theme} ${s} text on glass is ${ratio.toFixed(2)}:1 (< 4.5)`)
  }
  for (const [name, colour] of [
    ['ink', t.ink],
    ['ink-dim', t.inkDim],
    ['muted', t.muted],
    ['accent', t.accent],
  ] as const) {
    const ratio = contrastRatio(colour, glass)
    if (ratio < 4.5) fail(`${theme} ${name} on glass is ${ratio.toFixed(2)}:1 (< 4.5)`)
  }
  ok(`${theme} contrast on glass ${glass}: ${ratios.join(' · ')}`)
}

// The two accent inks must also survive their own accent fill (buttons/tabs).
for (const theme of ['day', 'night'] as const) {
  const t = THEME_TOKENS[theme]
  const ratio = contrastRatio(t.accentInk, t.accent)
  if (ratio < 4.5) fail(`${theme} accent-ink on accent is ${ratio.toFixed(2)}:1 (< 4.5)`)
  else ok(`${theme} accent-ink on accent ${ratio.toFixed(2)}:1`)
}

console.log(fails === 0 ? `\nTHEME OK (${checks} checks)` : `\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
