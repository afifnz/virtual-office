/**
 * Frame gate — paints every floor × theme through the real `renderFrame` with a
 * recording 2D context, so a render-loop crash is caught before a browser ever
 * sees it.
 *
 * Why this exists: the L1 lobby has exactly one desk, and its agent spends most
 * of a delegation walk inside the lift. The seated list for the floor is then
 * empty, and the painter threw `Cannot read properties of undefined (reading
 * 'status')` on the first such frame — the loop died and `__office2dReady` never
 * became true. A single-agent floor, an all-walking floor and an empty roster
 * are now first-class cases, not accidents.
 *
 * It also pins the three things a screenshot used to be needed for:
 *   - the status board reads `<online>/<total> online` (never "aktif");
 *   - the lift header (`L3` + team) and the car chip (`▸ L1`) are different
 *     labels, and the chip names the destination, not the current floor;
 *   - the boards are opaque and the sun/moon never sits behind one.
 *
 *   frontend/node_modules/.bin/esbuild verify/render_check.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/render_check.mjs
 *   node /tmp/render_check.mjs        # "RENDER OK", exit 0
 *
 * No browser, no canvas package: the context is a recorder that keeps the fill
 * colour, alpha and bounding box of every paint op, which is all the assertions
 * need. Drawing code that reads pixels would be a different tool.
 */
import type { Agent, Comm } from '../frontend/src/lib/types'
import { agentsFor } from '../frontend/src/lib/roster'
import { FLOOR_IDS, type FloorId } from '../frontend/src/lib/rooms'
import {
  clearAvatarCache,
  clearStaticCache,
  createStaticLayer,
  placeAgents,
  renderFrame,
} from '../frontend/src/scene2d/render'
import type { ThemeName } from '../frontend/src/scene2d/palette'
import {
  SIDE_BOARD_H,
  SIDE_BOARD_TOP,
  SIDE_BOARDS,
  SIDE_GLASS_TOP,
  SIDE_H,
  SIDE_RAIL_TOP,
  SIDE_W,
} from '../frontend/src/scene2d/side'
import { sunMoonBox } from '../frontend/src/scene2d/city'
import { liftCarLabel, liftHeaderLabel, liftHeaderTeam } from '../frontend/src/scene2d/props-side'
import type { AgentMeta } from '../frontend/src/lib/agents'

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

// ------------------------------------------------------------- 2D recorder

interface Op {
  name: string
  box: [number, number, number, number]
  fill: string
  alpha: number
}
interface Recorder {
  ops: Op[]
  texts: string[]
}

const newRecorder = (): Recorder => ({ ops: [], texts: [] })

const OPAQUE = (fill: string, alpha: number): boolean =>
  alpha >= 1 && !/^rgba\(/i.test(fill) && !/transparent/i.test(fill)

/** A CanvasRenderingContext2D stand-in that records what is painted where. */
function recordCtx(rec: Recorder): CanvasRenderingContext2D {
  const styles: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textBaseline: 'top',
    textAlign: 'start',
    lineCap: 'butt',
    lineJoin: 'miter',
    filter: 'none',
  }
  let path: [number, number, number, number] | null = null
  const grow = (x: number, y: number) => {
    if (!path) path = [x, y, x, y]
    else {
      path[0] = Math.min(path[0], x)
      path[1] = Math.min(path[1], y)
      path[2] = Math.max(path[2], x)
      path[3] = Math.max(path[3], y)
    }
  }
  const push = (name: string, box: [number, number, number, number]) => {
    rec.ops.push({ name, box, fill: String(styles.fillStyle), alpha: Number(styles.globalAlpha) })
  }
  const gradient = { addColorStop() {} }
  const methods: Record<string, (...a: never[]) => unknown> = {
    fillRect: ((x: number, y: number, w: number, h: number) => push('fillRect', [x, y, x + w, y + h])) as never,
    strokeRect: (() => undefined) as never,
    fillText: ((t: string, x: number, y: number) => {
      rec.texts.push(String(t))
      push(`fillText:${t}`, [x, y, x + 1, y + 1])
    }) as never,
    drawImage: ((_img: unknown, x: number, y: number, w = 0, h = 0) => push('drawImage', [x, y, x + w, y + h])) as never,
    beginPath: (() => {
      path = null
    }) as never,
    closePath: (() => undefined) as never,
    moveTo: ((x: number, y: number) => grow(x, y)) as never,
    lineTo: ((x: number, y: number) => grow(x, y)) as never,
    quadraticCurveTo: ((cx: number, cy: number, x: number, y: number) => {
      grow(cx, cy)
      grow(x, y)
    }) as never,
    rect: ((x: number, y: number, w: number, h: number) => {
      grow(x, y)
      grow(x + w, y + h)
    }) as never,
    arc: ((x: number, y: number, r: number) => {
      grow(x - r, y - r)
      grow(x + r, y + r)
    }) as never,
    ellipse: ((x: number, y: number, rx: number, ry: number) => {
      grow(x - rx, y - ry)
      grow(x + rx, y + ry)
    }) as never,
    fill: (() => {
      if (path) push('fill', [...path] as [number, number, number, number])
    }) as never,
    stroke: (() => undefined) as never,
    clip: (() => undefined) as never,
    save: (() => undefined) as never,
    restore: (() => undefined) as never,
    translate: (() => undefined) as never,
    scale: (() => undefined) as never,
    rotate: (() => undefined) as never,
    setTransform: (() => undefined) as never,
    measureText: ((s: string) => ({ width: String(s).length * 6 })) as never,
    createLinearGradient: (() => gradient) as never,
    createRadialGradient: (() => gradient) as never,
  }
  return new Proxy(styles, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop === 'canvas') return undefined
      if (prop in methods) return methods[prop]
      return target[prop]
    },
    set(target, prop, value) {
      if (typeof prop === 'string') target[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

interface FakeCanvas {
  width: number
  height: number
  style: Record<string, string>
  rec: Recorder
  getContext: () => CanvasRenderingContext2D
}

const created: FakeCanvas[] = []
const makeCanvas = (): FakeCanvas => {
  const rec = newRecorder()
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    style: {},
    rec,
    getContext: () => recordCtx(rec),
  }
  created.push(canvas)
  return canvas
}
;(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
    return makeCanvas()
  },
}

// --------------------------------------------------------------- fixtures

const NOW = 1_760_000_000

const agent = (o: Partial<Agent> & { id: string; status: Agent['status'] }): Agent => ({
  id: o.id,
  status: o.status,
  last_active: NOW,
  current: null,
  today: { sessions: 1, messages: 2, tool_calls: 3, tokens: 0, hourly: [] },
  total: { sessions: 1, messages: 2 },
  task: null,
  source: null,
  blocked: null,
  ...o,
})

/** A delegate comm from `from` to `to` at `ts`. */
const comm = (from: string, to: string, ts = NOW): Comm => ({ ts, from, to, kind: 'delegate', task: null })

const MIXED: Agent['status'][] = ['working', 'reviewing', 'idle', 'blocked']

/** The everyday roster: every desk online, a spread of statuses. */
function fullRoster(): Agent[] {
  return agentsFor([]).map((m, i) =>
    agent({
      id: m.id,
      status: MIXED[i % MIXED.length]!,
      current: { kind: 'tool', tools: i % 3 === 0 ? ['terminal'] : ['read_file'] },
    }),
  )
}

/** Every agent is walking (a delegate) — no floor has a seated agent. */
function allWalking(): { agents: Agent[]; comms: Comm[] } {
  const metas = agentsFor([])
  const comms: Comm[] = metas.map((m) => {
    const other = metas.find((n) => n.desk.floor !== m.desk.floor) ?? metas[0]!
    return comm(m.id, other.id)
  })
  const agents = metas.map((m) => agent({ id: m.id, status: 'working', current: { kind: 'tool', tools: ['delegate_task'] } }))
  return { agents, comms }
}

const metasOf = (): AgentMeta[] => agentsFor([])

interface Case {
  name: string
  agents: Agent[]
  comms: Comm[]
}

/** The offline seed: /api/status failed, so every row is `offline`. */
function allOffline(): Agent[] {
  return agentsFor([]).map((m) => agent({ id: m.id, status: 'offline' }))
}

const CASES: Case[] = [
  { name: 'full roster', agents: fullRoster(), comms: [] },
  { name: 'all offline (API down)', agents: allOffline(), comms: [] },
  {
    name: 'single agent (L1) walking',
    agents: [agent({ id: 'default', status: 'working', current: { kind: 'tool', tools: ['delegate_task'] } })],
    comms: [comm('default', 'coder')],
  },
  { name: 'empty roster (status.agents = [])', agents: [], comms: [] },
  { name: 'everyone walking', ...allWalking() },
]

const THEMES: ThemeName[] = ['day', 'night']
const FRAMES = [0, 0.9, 1.7, 2.6, 3.4, 5.1, 8.3, 13.0]

// ------------------------------------------------------- 1. no throw, painted

const viewW = 1280
const viewH = 800
let frames = 0
let painted = 0
const textsByKey = new Map<string, string[]>()

for (const theme of THEMES) {
  for (const floor of FLOOR_IDS) {
    for (const c of CASES) {
      const byId = new Map(c.agents.map((a) => [a.id, a]))
      const rec = newRecorder()
      const ctx = recordCtx(rec)
      for (const t of FRAMES) {
        rec.ops.length = 0
        rec.texts.length = 0
        try {
          renderFrame(ctx, {
            theme,
            metas: metasOf(),
            byId,
            now: NOW,
            comms: c.comms,
            vp: { camX: SIDE_W / 2, zoom: 2, floor },
            viewW,
            viewH,
            dpr: 1,
            still: false,
            t,
            hour: 14,
            minute: 5,
          })
        } catch (err) {
          fail(`L${floor}/${theme}/${c.name} t=${t} threw: ${(err as Error).message}`)
          continue
        }
        frames++
        const rects = rec.ops.filter((o) => o.name === 'fillRect').length
        // the stage is one blit; the dynamic pass is the desks/avatars/plates
        const blits = rec.ops.filter((o) => o.name === 'drawImage')
        // the stage is blitted whole (letterboxed to the view, never cropped)
        const stage = blits.some((o) => {
          const [x1, y1, x2, y2] = o.box
          return x2 - x1 >= SIDE_W * 0.99 && y2 - y1 >= SIDE_H * 0.99
        })
        if (!stage) fail(`L${floor}/${theme}/${c.name} t=${t}: the stage does not cover the view (blits ${blits.length})`)
        else if (rects < 20) fail(`L${floor}/${theme}/${c.name} t=${t}: only ${rects} fillRect (dynamic pass missing)`)
        else painted++
        textsByKey.set(`${floor}:${theme}:${c.name}:${t}`, [...rec.texts])
      }
    }
  }
}

if (frames === 0) fail('no frame ran at all')
else ok(`${painted}/${frames} frames painted (${FLOOR_IDS.length} floors × ${THEMES.length} themes × ${CASES.length} rosters × ${FRAMES.length} frames)`)

// ------------------------------------------------- 2. the status board wording

{
  // the shell (caption) is cached with the stage, the number is live
  const shell = created.filter((c) => c.rec.texts.includes('online')).length
  if (!shell) fail('no cached board shell draws the word "online"')
  else ok(`board caption "online" is painted by ${shell} cached stage(s)`)
  const anyAktif = created.some((c) => c.rec.texts.includes('aktif'))
  expect('no "aktif" caption anywhere on the board', anyAktif, false)

  // offline seed: every row OFFLINE, the board must say so on all three floors
  for (const floor of FLOOR_IDS) {
    const t = textsByKey.get(`${floor}:night:all offline (API down):0`) ?? []
    expect(`L${floor} offline board`, t.find((x) => /^\d+\/\d+$/.test(x)), `0/${[0, 1, 4, 8][floor]}`)
  }

  const full = textsByKey.get(`3:night:full roster:0`) ?? []
  const count = full.find((t) => /^\d+\/\d+$/.test(t))
  expect('L3 full roster board count', count, '8/8')
  const empty = textsByKey.get(`3:night:empty roster (status.agents = []):0`) ?? []
  expect('L3 empty roster board count', empty.find((t) => /^\d+\/\d+$/.test(t)), '0/8')
  // L1 must still show its one desk, one avatar and Ndoro's nameplate
  {
    const rec = newRecorder()
    renderFrame(recordCtx(rec), {
      theme: 'day',
      metas: metasOf(),
      byId: new Map(fullRoster().map((a) => [a.id, a])),
      now: NOW,
      comms: [],
      vp: { camX: SIDE_W / 2, zoom: 2, floor: 1 },
      viewW,
      viewH,
      dpr: 1,
      still: true,
      t: 0,
      hour: 14,
      minute: 5,
    })
    expect('L1 nameplate', rec.texts.includes('NDORO'), true)
    // stage blit + the seated avatar sprite
    expect('L1 avatar blits', rec.ops.filter((o) => o.name === 'drawImage').length >= 2, true)
  }

  // On L1 the only agent leaves the floor on a lift journey. Find a frame where
  // he is still walking across the lobby and check the board counts him (1/1)
  // even though no desk is occupied — that "0/0" flicker was the visible half of
  // the crash.
  {
    const metas = metasOf()
    const solo = agent({ id: 'default', status: 'working', current: { kind: 'tool', tools: ['delegate_task'] } })
    const byId = new Map([[solo.id, solo]])
    const comms = [comm('default', 'coder')]
    let walkT = -1
    for (let t = 0; t < 80 && walkT < 0; t += 0.1) {
      const p = placeAgents(metas, byId, NOW, comms, t).find((q) => q.meta.id === 'default')
      if (p && p.floor === 1 && p.walking) walkT = t
    }
    if (walkT < 0) fail('no frame with the L1 agent walking across the lobby')
    else {
      const rec = newRecorder()
      renderFrame(recordCtx(rec), {
        theme: 'night',
        metas,
        byId,
        now: NOW,
        comms,
        vp: { camX: SIDE_W / 2, zoom: 2, floor: 1 },
        viewW,
        viewH,
        dpr: 1,
        still: true,
        t: walkT,
        hour: 14,
        minute: 5,
      })
      expect(`L1 board count while he walks the lobby (t=${walkT.toFixed(1)})`, rec.texts.find((t) => /^\d+\/\d+$/.test(t)), '1/1')
    }
  }
}

// ------------------------------------------------------------ 3. lift labels

{
  expect('lift header (L3)', liftHeaderLabel(3), 'L3')
  expect('lift header team (L3)', liftHeaderTeam(3), 'TIM DEV')
  expect('lift car chip (to L1)', liftCarLabel(1), '▸ L1')
  if (liftHeaderLabel(3) === liftCarLabel(3)) fail('header and car chip read the same string')
  else ok(`header "${liftHeaderLabel(3)} ${liftHeaderTeam(3)}" ≠ car chip "${liftCarLabel(3)}"`)

  // a real ride: an L3 agent delegating to the lobby, caught inside the lift
  const metas = metasOf()
  const rider = agent({ id: 'coder', status: 'working', current: { kind: 'tool', tools: ['delegate_task'] } })
  const comms = [comm('coder', 'default')]
  const byId = new Map([[rider.id, rider]])
  let rideT = -1
  for (let t = 0; t < 60 && rideT < 0; t += 0.1) {
    const placed = placeAgents(metas, byId, NOW, comms, t)
    const p = placed.find((q) => q.meta.id === 'coder')
    if (p && p.inLift && p.floor === 3 && p.liftTo === 1) rideT = t
  }
  if (rideT < 0) fail('no frame found with coder dwelling in the lift on L3 heading to L1')
  else {
    const rec = newRecorder()
    const ctx = recordCtx(rec)
    renderFrame(ctx, {
      theme: 'night',
      metas,
      byId,
      now: NOW,
      comms,
      vp: { camX: SIDE_W / 2, zoom: 2, floor: 3 },
      viewW,
      viewH,
      dpr: 1,
      still: true,
      t: rideT,
      hour: 14,
      minute: 5,
    })
    const carChip = rec.texts.filter((t) => t.startsWith('▸'))
    expect(`car chip while riding L3 → L1 (t=${rideT.toFixed(1)})`, carChip, ['▸ L1'])
    if (carChip.includes('▸ L3')) fail('car chip names the current floor while riding')
    // the header lives in the cached stage: it must still name the floor the
    // viewer is on (L3) while the car says L1
    const shell3 = created.filter((c) => c.rec.texts.includes(liftHeaderTeam(3)))
    if (!shell3.length) fail('no cached stage draws the lift header team')
    else ok(`lift header "${liftHeaderLabel(3)} ${liftHeaderTeam(3)}" stays put while the car says "▸ L1"`)
  }
}

// -------------------------------------------------- 4. panels are opaque

{
  for (const theme of THEMES) {
    for (const floor of FLOOR_IDS) {
      clearStaticCache()
      createStaticLayer(floor, theme)
      const sheet = created[created.length - 1]!
      const ar = SIDE_BOARDS[4]!
      const R: [number, number, number, number] = [ar.x, SIDE_BOARD_TOP, ar.x + ar.w, SIDE_BOARD_TOP + SIDE_BOARD_H]
      const covers = (o: Op) => o.box[0] <= R[0] && o.box[1] <= R[1] && o.box[2] >= R[2] && o.box[3] >= R[3]
      const backdrops = sheet.rec.ops.filter((o) => covers(o))
      const backdrop = backdrops[backdrops.length - 1]
      if (!backdrop) fail(`L${floor}/${theme}: nothing paints the ARSITEKTUR card`)
      else if (!OPAQUE(backdrop.fill, backdrop.alpha)) {
        fail(`L${floor}/${theme}: ARSITEKTUR backdrop is not opaque (${backdrop.fill} @ ${backdrop.alpha})`)
      } else ok(`L${floor}/${theme}: ARSITEKTUR card is opaque (${backdrop.fill})`)

      // nothing translucent may be painted over the card afterwards
      // the card's own grain/highlight is 1 px; anything translucent that
      // covers a quarter of the card would be sky showing through it
      const area = (b: [number, number, number, number]) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
      const overlap = (a: [number, number, number, number], b: [number, number, number, number]) =>
        Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
      const idx = backdrop ? sheet.rec.ops.indexOf(backdrop) : -1
      const over = sheet.rec.ops
        .slice(idx + 1)
        .filter((o) => o.alpha < 1 && overlap(o.box, R) / area(R) > 0.25)
      if (over.length) fail(`L${floor}/${theme}: ${over.length} translucent op(s) over the card, first ${over[0]!.name} ${over[0]!.fill}`)
      else ok(`L${floor}/${theme}: no translucent paint over the card`)

      // the sun/moon must sit above the rail, never behind a board
      const sky = sunMoonBox(theme)
      const top = sky.y1 + SIDE_GLASS_TOP
      const bottom = sky.y2 + SIDE_GLASS_TOP
      if (bottom > SIDE_RAIL_TOP) fail(`L${floor}/${theme}: sun/moon reaches y=${bottom.toFixed(1)}, past the rail at ${SIDE_RAIL_TOP}`)
      else ok(`L${floor}/${theme}: sun/moon ${top.toFixed(0)}–${bottom.toFixed(0)} sits above the rail (${SIDE_RAIL_TOP})`)
    }
  }
}

// ------------------------------------------------------------- 5. determinism

{
  clearAvatarCache()
  clearStaticCache()
  const recA = newRecorder()
  const recB = newRecorder()
  const input = {
    theme: 'night' as ThemeName,
    metas: metasOf(),
    byId: new Map(fullRoster().map((a) => [a.id, a])),
    now: NOW,
    comms: [],
    vp: { camX: SIDE_W / 2, zoom: 2, floor: 3 as FloorId },
    viewW,
    viewH,
    dpr: 1,
    still: true,
    t: 3.4,
    hour: 14,
    minute: 5,
  }
  renderFrame(recordCtx(recA), input)
  renderFrame(recordCtx(recB), input)
  expect('same input → same frame', recA.ops.length === recB.ops.length && recA.ops.length > 100, true)
}

console.log('')
if (fails) {
  console.log(`RENDER FAIL — ${fails} problem(s), ${checks} ok`)
  process.exit(1)
}
console.log(`RENDER OK — ${checks} checks, ${frames} frames, ${created.length} offscreen sheets`)
