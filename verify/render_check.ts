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
import { THEME_STATUS, type ThemeName } from '../frontend/src/scene2d/palette'
import {
  SIDE_BOARD_H,
  SIDE_BOARD_TOP,
  SIDE_BOARDS,
  SIDE_GLASS_TOP,
  SIDE_H,
  SIDE_RAIL_TOP,
  SIDE_W,
  PHONE_BOARD_MARGIN,
  PHONE_CTRL_BAND,
  boardsFor,
  fitScale,
  sideSeats,
  sideTransform,
  visibleDesignRect,
} from '../frontend/src/scene2d/side'
import { fitZoom } from '../frontend/src/scene2d/viewport'
import { PLATE_DOT, PLATE_DOT_GAP, PLATE_H, PLATE_PAD, plateWidth, shortName } from '../frontend/src/scene2d/labels'
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
  /** Width of `s` in the *current* font: a real 2D context measures, we only
   *  need an honest bound for "does this text leave its card". */
  const fontPx = (): number => {
    const m = /(\d+(?:\.\d+)?)px/.exec(String(styles.font))
    return m ? Number(m[1]) : 8
  }
  const textW = (s: string): number => String(s).length * fontPx() * 0.62
  const methods: Record<string, (...a: never[]) => unknown> = {
    fillRect: ((x: number, y: number, w: number, h: number) => push('fillRect', [x, y, x + w, y + h])) as never,
    strokeRect: (() => undefined) as never,
    fillText: ((t: string, x: number, y: number) => {
      rec.texts.push(String(t))
      push(`fillText:${t}`, [x, y, x + textW(String(t)), y + fontPx()])
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
    // the camera transform is recorded, not applied: the gate can then prove
    // the painter put the dynamic pass under it (see §6)
    translate: ((x: number, y: number) => push('translate', [x, y, 0, 0])) as never,
    scale: ((x: number, y: number) => push('scale', [x, y, 0, 0])) as never,
    rotate: (() => undefined) as never,
    setTransform: (() => undefined) as never,
    measureText: ((s: string) => ({ width: textW(String(s)) })) as never,
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

// -------------------------------------------- 2b. waiting / stale on the wall

// `waiting` and `stale` are states the canvas has to tell apart from working:
// the plate/board must paint waiting in its own amber and a stale verdict as
// idle, never as one more working dot.
{
  const waitingAgents = metasOf().map((m) =>
    agent({
      id: m.id,
      status: 'waiting',
      current: { kind: 'tool', tools: ['delegate_task'] },
      children: { total: 1, running: 1 },
      last_kind: 'tool',
    }),
  )
  const staleAgents = metasOf().map((m) =>
    // the real backend shape: already demoted to idle, flagged stale
    agent({ id: m.id, status: 'idle', current: { kind: 'tool', tools: ['terminal'] }, stale: true, last_kind: 'tool' }),
  )
  const paint = (theme: ThemeName, agents: Agent[]) => {
    const rec = newRecorder()
    renderFrame(recordCtx(rec), {
      theme,
      metas: metasOf(),
      byId: new Map(agents.map((a) => [a.id, a])),
      now: NOW,
      comms: [],
      vp: { camX: SIDE_W / 2, zoom: 2, floor: 3 },
      viewW,
      viewH,
      dpr: 1,
      still: true,
      t: 0,
      hour: 14,
      minute: 5,
    })
    return rec
  }
  for (const theme of THEMES) {
    const waitColour = THEME_STATUS[theme].waiting.toUpperCase()
    const idleColour = THEME_STATUS[theme].idle.toUpperCase()
    const w = paint(theme, waitingAgents)
    expect(`${theme}: a waiting desk is painted in the waiting colour`, w.ops.some((o) => o.fill.toUpperCase() === waitColour), true)
    const s = paint(theme, staleAgents)
    expect(`${theme}: a stale verdict never paints the waiting colour`, s.ops.some((o) => o.fill.toUpperCase() === waitColour), false)
    expect(`${theme}: stale desks paint the idle colour`, s.ops.some((o) => o.fill.toUpperCase() === idleColour), true)
  }
  ok('waiting paints its own amber; stale working desks paint as idle')
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

// ------------------------------------------------ 6. the phone frame (390×692)

/**
 * A 390×692 canvas is the phone: 390×844 minus the 96 px HUD and the 56 px bar.
 * The default camera FITS THE WHOLE FLOOR: the 1000×688 sheet is scaled to
 * 390 px (0.39, avatar 58.5 CSS px) and the dynamic pass is drawn under the
 * same camera, so all eight L3 desks, their plates and the three boards are on
 * screen at once. Three regressions this gates:
 *
 *   a. the painter drawing desks/plates at 1:1 design px (390 px of design =
 *      only 2.6 floor units — the "BAGA…" screenshot) instead of under the
 *      camera transform;
 *   b. a plate touching the canvas edge;
 *   c. a board hanging off the sheet.
 */
{
  const PW = 390
  const PH = 692
  const band = PHONE_CTRL_BAND
  const fit = fitScale(PW, PH, band)
  const fitZ = fitZoom(3, PW, PH, band)
  const win = visibleDesignRect(PW, PH, fitZ, SIDE_W / 2, band)
  const margin = Math.ceil(4 / fit)
  // the wall is laid out from the real viewport: 8 CSS px in from each edge
  const boardMargin = Math.ceil(PHONE_BOARD_MARGIN / fit)
  const wall = boardsFor(true, win, boardMargin)
  const tPhone = sideTransform(PW, PH, { camX: SIDE_W / 2, zoom: fitZ, floor: 3 }, band)
  /** Board cards are 148 px tall fills; the label text is char-split by tracking. */
  const cardXs = (c: FakeCanvas): number[] =>
    c.rec.ops
      .filter((o) => o.name === 'fill' && Math.round(o.box[3] - o.box[1]) === SIDE_BOARD_H && o.box[2] - o.box[0] > 80)
      .map((o) => Math.round(o.box[0]))
  /**
   * (c) no board label leaves its card — and therefore none leaves the canvas.
   * Every text op in the board band (y 132…280) must fit inside one of the
   * three cards; the clock's "WIB" and "L3" are in here, and the 5 px edge
   * margin is exactly what put them against the screen edge.
   */
  const checkBoardText = (ops: Op[], where: string): number => {
    let n = 0
    for (const o of ops) {
      if (!o.name.startsWith('fillText:')) continue
      if (o.box[1] < SIDE_BOARD_TOP - 1 || o.box[1] > SIDE_BOARD_TOP + SIDE_BOARD_H - 4) continue
      n++
      const text = o.name.slice('fillText:'.length)
      const card = wall.find((b) => o.box[0] >= b.x - 0.5 && o.box[2] <= b.x + b.w + 0.5)
      if (!card) {
        fail(`${where}: board text "${text}" spans x ${o.box[0].toFixed(0)}…${o.box[2].toFixed(0)}, outside the cards`)
      }
      const sx = tPhone.left + o.box[0] * tPhone.s
      const sw = (o.box[2] - o.box[0]) * tPhone.s
      if (sx < 8 - 1e-6 || sx + sw > PW - 8 + 1e-6) {
        fail(`${where}: board text "${text}" leaves the canvas (x ${sx.toFixed(1)}…${(sx + sw).toFixed(1)} of ${PW})`)
      }
    }
    return n
  }
  let phoneFrames = 0
  let platesSeen = 0
  let boardTexts = 0
  let desksSeen = 0
  let cameraFrames = 0
  for (const theme of THEMES) {
    for (const floor of FLOOR_IDS) {
      clearStaticCache()
      const rec = newRecorder()
      renderFrame(recordCtx(rec), {
        theme,
        metas: metasOf(),
        byId: new Map(fullRoster().map((a) => [a.id, a])),
        now: NOW,
        comms: [],
        vp: { camX: SIDE_W / 2, zoom: fitZ, floor },
        viewW: PW,
        viewH: PH,
        band,
        dpr: 1,
        still: true,
        t: 0,
        hour: 14,
        minute: 5,
      })
      phoneFrames++
      const texts = rec.texts
      const count = texts.find((t) => /^\d+\/\d+$/.test(t))
      const want = `${[0, 1, 4, 8][floor]}/${[0, 1, 4, 8][floor]}`
      if (count !== want) fail(`L${floor}/${theme} phone: board count ${count}, want ${want}`)
      boardTexts += checkBoardText(rec.ops, `L${floor}/${theme} phone frame`)

      /**
       * (a) the camera really is applied to the dynamic pass: a
       * translate(t.left, t.top) + scale(t.s, t.s) pair must follow the stage
       * bitmap, and the desks must be painted inside it.
       */
      const stageIdx = rec.ops.findIndex((o) => o.name === 'drawImage' && Math.abs(o.box[2] - SIDE_W * tPhone.s) < 1)
      const camIdx = rec.ops.findIndex(
        (o, i) => i > stageIdx && o.name === 'translate' && Math.abs(o.box[0] - tPhone.left) < 0.5 && Math.abs(o.box[1] - tPhone.top) < 0.5,
      )
      const scaleIdx = rec.ops.findIndex((o, i) => i > camIdx && o.name === 'scale' && Math.abs(o.box[0] - tPhone.s) < 1e-6)
      if (stageIdx < 0) fail(`L${floor}/${theme} phone: the stage bitmap is not drawn at ${SIDE_W * tPhone.s} px wide`)
      else if (camIdx < 0) fail(`L${floor}/${theme} phone: the painter never translates the dynamic pass to the camera (desks at 1:1 design px)`)
      else if (scaleIdx < 0) fail(`L${floor}/${theme} phone: the painter never scales the dynamic pass by ${tPhone.s}`)
      else cameraFrames++

      // (a) every desk of this floor is painted inside the canvas
      const seats = sideSeats(metasOf().filter((m) => m.desk.floor === floor))
      for (const s of seats) {
        const dx = s.cx - 64 * s.scale
        const dy = s.floorY - 58 * s.scale
        const dw = 128 * s.scale
        const found = rec.ops.some(
          (o) =>
            o.name === 'fill' &&
            Math.abs(o.box[0] - dx) < 0.6 &&
            Math.abs(o.box[1] - dy) < 0.6 &&
            Math.abs(o.box[2] - (dx + dw)) < 0.6,
        )
        if (!found) {
          fail(`L${floor}/${theme} phone: ${s.meta.id}'s desk slab is not painted`)
          continue
        }
        const sx = tPhone.left + dx * tPhone.s
        const sy = tPhone.top + dy * tPhone.s
        const sw = dw * tPhone.s
        const sh = 6 * s.scale * tPhone.s
        if (sx < 0 || sy < 0 || sx + sw > PW || sy + sh > PH) {
          fail(`L${floor}/${theme} phone: ${s.meta.id}'s desk is cut by the canvas (x ${sx.toFixed(1)}…${(sx + sw).toFixed(1)}, y ${sy.toFixed(1)}…${(sy + sh).toFixed(1)})`)
        } else desksSeen++
      }

      // every seated agent still gets a plate, and the whole plate — not just
      // the text origin — stays inside the canvas with 4 CSS px of clearance
      for (const s of seats) {
        const name = shortName(s.meta.name)
        const op = rec.ops.find((o) => o.name === `fillText:${name}`)
        if (!op) {
          fail(`L${floor}/${theme} phone: ${s.meta.id} has no nameplate`)
          continue
        }
        platesSeen++
        // the text sits PLATE_PAD + dot + gap inside the plate, mid-height
        const plateX = op.box[0] - PLATE_PAD - PLATE_DOT - PLATE_DOT_GAP
        const plateY = op.box[1] - PLATE_H / 2 - 0.5
        const plateW = plateWidth(name, true)
        const sx = tPhone.left + plateX * tPhone.s
        const sy = tPhone.top + plateY * tPhone.s
        const sw = plateW * tPhone.s
        const sh = PLATE_H * tPhone.s
        if (sx < 4 - 1e-6 || sy < 4 - 1e-6 || sx + sw > PW - 4 + 1e-6 || sy + sh > PH - 4 + 1e-6) {
          fail(
            `L${floor}/${theme} phone: plate ${name} spans x ${sx.toFixed(1)}…${(sx + sw).toFixed(1)} of ${PW}, y ${sy.toFixed(1)}…${(sy + sh).toFixed(1)} of ${PH} (need 4 px)`,
          )
        }
      }
    }
  }
  if (phoneFrames) ok(`${phoneFrames} phone frames (${FLOOR_IDS.length} floors × ${THEMES.length} themes at ${PW}×${PH}, fit zoom ${fitZ}) paint ${platesSeen} plates and ${desksSeen} desks inside the canvas`)
  if (cameraFrames === phoneFrames) ok(`all ${phoneFrames} phone frames apply the camera to the dynamic pass (translate ${tPhone.left},${tPhone.top} + scale ${tPhone.s})`)
  if (boardTexts) ok(`${boardTexts} board labels (status count, legend, clock) sit inside their card at ${PW}×${PH}`)

  // the two cached stages: three boards for the phone, six for the desktop
  const phoneSheets = created.map(cardXs).filter((xs) => xs.length === 3)
  if (!phoneSheets.length) fail(`no cached phone stage hangs 3 boards (saw ${created.map((c) => cardXs(c).length).join(',')})`)
  else if (JSON.stringify(phoneSheets[0]) !== JSON.stringify([21, 153, 863])) {
    fail(`phone stage boards at x ${phoneSheets[0].join(',')}, want 21,153,863`)
  } else {
    ok(`phone stage hangs 3 boards at x ${phoneSheets[0].join(',')} — 8 CSS px in from each edge (pinboard/burndown/architecture dropped)`)
    // the cached shell's own labels (team, ZONA, PAPAN STATUS, online, WIB, L3)
    const sheet = created.find((c) => cardXs(c).length === 3)
    if (!sheet) fail('phone stage shell is missing')
    else {
      const n = checkBoardText(sheet.rec.ops, 'phone stage shell')
      if (n < 6) fail(`phone stage shell paints only ${n} board labels`)
      else ok(`phone stage shell: ${n} board labels inside the cards, none outside the canvas`)
    }
  }
  const wideSheets = created.map(cardXs).filter((xs) => xs.length === 6)
  if (!wideSheets.length) fail('the wide stage is gone — desktop would lose its six boards')
  else if (JSON.stringify(wideSheets[0]) !== JSON.stringify([4, 124, 338, 532, 696, 900])) {
    fail(`wide stage boards at x ${wideSheets[0].join(',')}, want 4,124,338,532,696,900`)
  } else ok(`wide stage still hangs 6 boards at x ${wideSheets[0].join(',')} (desktop untouched)`)
}

console.log('')
if (fails) {
  console.log(`RENDER FAIL — ${fails} problem(s), ${checks} ok`)
  process.exit(1)
}
console.log(`RENDER OK — ${checks} checks, ${frames} frames, ${created.length} offscreen sheets`)
