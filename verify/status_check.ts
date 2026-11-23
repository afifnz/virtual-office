/**
 * Status-truth gate — replays the `waiting` / `stale` rules headless, without a
 * browser. It pins the three things the dashboard used to get wrong:
 *
 *   1. a stale working/reviewing verdict is NOT counted as bekerja anywhere
 *      (HUD header, floor tabs, roster summary all use the same helper);
 *   2. `waiting` is its own state — the chip says "menunggu anak", the parent is
 *      not counted as working, and the `⤷ N` badge follows children.running;
 *   3. the counts stay consistent: per-floor counts add up to the floor size and
 *      every status resolves to a colour that exists in both themes.
 *
 *   frontend/node_modules/.bin/esbuild verify/status_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/status_check.mjs
 *   node /tmp/status_check.mjs        # "STATUS OK", exit 0
 */
import type { Agent, AgentStatus } from '../frontend/src/lib/types'
import {
  childBadge,
  countStatuses,
  effectiveStatus,
  isStaleAgent,
  isWorkingNow,
  runningChildren,
  staleNote,
  statusSummary,
  statusText,
} from '../frontend/src/lib/status'
import { statusKey } from '../frontend/src/scene2d/render'
import { THEME_STATUS } from '../frontend/src/scene2d/palette'
import { agentsFor } from '../frontend/src/lib/roster'

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
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a !== b) fail(`${label}: got ${a}, want ${b}`)
  else ok(`${label} = ${b}`)
}

/** One /api/status row with the fields the gate cares about. */
const agent = (o: Partial<Agent> & { id: string; status: AgentStatus }): Agent => ({
  id: o.id,
  status: o.status,
  last_active: 1_800_000_000,
  current: null,
  today: { sessions: 0, messages: 0, tool_calls: 0, tokens: 0, hourly: [] },
  total: { sessions: 0, messages: 0 },
  task: null,
  source: null,
  blocked: null,
  ...o,
})

const NOW = 1_800_000_000

// ------------------------------------------------- 1. waiting is its own state

const waiting = agent({
  id: 'dev',
  status: 'waiting',
  current: { kind: 'tool', tools: ['delegate_task'] },
  children: { total: 2, running: 1 },
})

expect('waiting is not folded into idle', effectiveStatus(waiting), 'waiting')
expect('waiting is not working', isWorkingNow(waiting), false)
expect('waiting is not stale', isStaleAgent(waiting), false)
expect('waiting chip text', statusText(waiting), 'menunggu anak')
expect('waiting child badge follows running (not total)', childBadge(waiting), '⤷ 1')
expect('waiting running children', runningChildren(waiting), 1)
expect('waiting canvas key', statusKey(waiting), 'waiting')
// The tool stays published; the UI just must not call it work.
expect('waiting keeps delegate_task in current.tools', waiting.current?.tools, ['delegate_task'])

expect('running 0 → no badge', childBadge(agent({ id: 'x', status: 'waiting', children: { total: 2, running: 0 } })), null)
expect('no children → no badge', childBadge(agent({ id: 'x', status: 'working' })), null)

// ------------------------------------------------------------- 2. stale truth

// The real backend row: the verdict is ALREADY demoted to idle, with stale:true
// and the last event kind. The UI must still recognise it (dim + "tidak aktif"),
// which was the bug the reviewer caught: gating on status==='working' made the
// whole stale presentation dead code against real data.
const realStale = agent({ id: 'planner', status: 'idle', stale: true, last_kind: 'tool_result', current: { kind: 'tool_result', tools: ['terminal'] } })
const staleWork = agent({ id: 'planner2', status: 'working', current: { kind: 'tool', tools: [] }, stale: true, last_kind: 'tool' })

expect('real stale row (status idle + stale) is recognised', isStaleAgent(realStale), true)
expect('real stale row shows the stale label', statusText(realStale), 'tidak aktif')
expect('real stale row counts as idle', effectiveStatus(realStale), 'idle')
expect('real stale row is not working', isWorkingNow(realStale), false)
expect('real stale note names the last event', staleNote(realStale), 'tidak aktif · hasil alat terakhir')
expect('stale canvas key is idle', statusKey(realStale), 'idle')

// Defensive: a client that sends stale next to working must also read stale.
expect('stale working is not working', isWorkingNow(staleWork), false)
expect('stale working counts as idle', effectiveStatus(staleWork), 'idle')
expect('stale reviewing counts as idle', effectiveStatus(agent({ id: 'reviewer', status: 'reviewing', stale: true })), 'idle')
expect('stale card label', statusText(staleWork), 'tidak aktif')
expect('stale note names the last event (tool)', staleNote(staleWork), 'tidak aktif · pakai alat terakhir')
expect('stale note without kind', staleNote(agent({ id: 'y', status: 'idle', stale: true })), 'tidak aktif')
expect('stale working canvas key is idle', statusKey(staleWork), 'idle')

// A missing `stale` field (older backend) must change nothing.
const legacy = agent({ id: 'coder', status: 'working', current: { kind: 'tool', tools: ['terminal'] } })
expect('legacy row (no stale field) is still working', isWorkingNow(legacy), true)
expect('legacy row status text', statusText(legacy), 'bekerja')

// ------------------------------------------------ 3. header / tab arithmetic

const roster: Agent[] = [
  agent({ id: 'dev', status: 'waiting', current: { kind: 'tool', tools: ['delegate_task'] }, children: { total: 1, running: 1 } }),
  agent({ id: 'planner', status: 'idle', stale: true, last_kind: 'tool' }),
  agent({ id: 'coder', status: 'working', current: { kind: 'tool', tools: ['terminal'] } }),
  agent({ id: 'reviewer', status: 'reviewing' }),
  agent({ id: 'tester', status: 'idle' }),
  agent({ id: 'edu', status: 'offline' }),
]

const counts = countStatuses(roster)
expect('header "bekerja" excludes the waiting parent', counts.get('working'), 1)
expect('header counts waiting separately', counts.get('waiting'), 1)
expect('header folds the stale verdict into idle', counts.get('idle'), 2)
expect('header keeps review', counts.get('reviewing'), 1)
expect('header keeps offline', counts.get('offline'), 1)
{
  let sum = 0
  for (const n of counts.values()) sum += n
  expect('every agent counted exactly once', sum, roster.length)
  expect('nothing is double-counted as bekerja', (counts.get('working') ?? 0) + (counts.get('waiting') ?? 0), 2)
}

expect('roster summary wording', statusSummary(roster), '2 menganggur · 1 offline · 1 review · 1 menunggu anak · 1 bekerja')
expect('empty roster summary', statusSummary([]), '')

// ------------------------------------------------- 4. floor tabs stay consistent

const STATUSES: AgentStatus[] = ['working', 'waiting', 'reviewing', 'idle', 'blocked', 'offline']
const metas = agentsFor([])
const perFloor: Record<number, Agent[]> = { 1: [], 2: [], 3: [] }
metas.forEach((m, i) => {
  const status = STATUSES[i % STATUSES.length]!
  // every third working row is a stale verdict, so the tabs have to demote it
  const stale = status === 'working' && i % 3 === 0
  perFloor[m.desk.floor]!.push(
    agent({ id: m.id, status, stale, current: status === 'waiting' ? { kind: 'tool', tools: ['delegate_task'] } : null }),
  )
})

let tabTotal = 0
let tabWaiting = 0
for (const floor of [1, 2, 3] as const) {
  const agents = perFloor[floor]
  const fc = countStatuses(agents)
  let sum = 0
  for (const n of fc.values()) sum += n
  expect(`L${floor} tab: counts sum to the floor size`, sum, agents.length)
  const workingHere = agents.filter(isWorkingNow).length
  expect(
    `L${floor} tab: "bekerja"+"review" is working-and-not-stale`,
    (fc.get('working') ?? 0) + (fc.get('reviewing') ?? 0),
    workingHere,
  )
  tabTotal += agents.length
  tabWaiting += fc.get('waiting') ?? 0
  if (agents.some((a) => a.status === 'waiting')) {
    expect(`L${floor} tab: waiting has its own number`, fc.get('waiting'), agents.filter((a) => a.status === 'waiting').length)
  }
}
const all = [...perFloor[1]!, ...perFloor[2]!, ...perFloor[3]!]
const allCounts = countStatuses(all)
const scanned =
  (allCounts.get('working') ?? 0) +
  (allCounts.get('reviewing') ?? 0) +
  (allCounts.get('waiting') ?? 0) +
  (allCounts.get('blocked') ?? 0)
const rest = (allCounts.get('idle') ?? 0) + (allCounts.get('offline') ?? 0)
expect('building tab: total agents', tabTotal, metas.length)
expect('building tab: scanned statuses + idle/offline covers every agent', scanned + rest, all.length)
expect('building tab: waiting has its own number', tabWaiting, all.filter((a) => a.status === 'waiting').length)
expect(
  'building tab: waiting never inside bekerja',
  (allCounts.get('working') ?? 0) + (allCounts.get('reviewing') ?? 0),
  all.filter(isWorkingNow).length,
)
expect('waiting agents exist in the roster sample', tabWaiting > 0, true)

// --------------------------------------------- 5. colours exist in both themes

for (const theme of ['day', 'night'] as const) {
  const palette = THEME_STATUS[theme]
  for (const key of ['working', 'reviewing', 'waiting', 'idle', 'blocked', 'offline'] as const) {
    if (typeof palette[key] !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(palette[key])) {
      fail(`${theme}: no colour for status ${key}`)
    }
  }
  if (palette.waiting === palette.working) fail(`${theme}: waiting and working share a colour`)
  if (palette.waiting === palette.blocked) fail(`${theme}: waiting and blocked share a colour`)
  ok(`${theme}: waiting has its own colour ${palette.waiting}`)
}

// waiting must be visibly amber, not a grey: a real hue separation from ink.
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}
for (const theme of ['day', 'night'] as const) {
  const [r, g, b] = rgb(THEME_STATUS[theme].waiting)
  if (!(r > g && g > b)) fail(`${theme}: waiting ${THEME_STATUS[theme].waiting} is not a warm amber`)
  else ok(`${theme}: waiting is warm amber (r>${g}>${b})`)
}

// The dot/chip must read at panel size: the colour itself is documented as
// ≥ 4.5:1 on glass by theme_check; here we only guarantee it is published.
expect('themes publish waiting', Object.keys(THEME_STATUS).sort(), ['day', 'night'])

if (fails === 0) console.log(`\nSTATUS OK (${checks} checks)`)
else console.log(`\n${fails} MASALAH`)
process.exit(fails === 0 ? 0 : 1)
