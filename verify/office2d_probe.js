/**
 * Browser probe for the 2D office — the DOM half of the T1.9 gate.
 *
 * The pure geometry lives in verify/visual_check.ts (esbuild+node). This file
 * only answers the questions that need a real layout engine: does a panel cover
 * the canvas, does the roster really scroll, is the canvas painted. It is not
 * part of the build and takes no dependencies.
 *
 * How to run it (front desk, on the built app — no Playwright needed):
 *   1. serve a build:  cd frontend && npm run build && npm run preview
 *      (preview proxies /api to the Go API on 127.0.0.1:8131; or use
 *       `npm run dev` on 127.0.0.1:5173)
 *   2. open  http://127.0.0.1:4173/?still=1  (desktop 1280x800)
 *   3. DevTools → Console → paste this whole file → Enter.
 *      Or from CI/CDP:
 *        Runtime.evaluate({ expression: <this file>, awaitPromise: true, returnByValue: true })
 *   4. repeat at 390x844 with DevTools device emulation.
 *
 * Exit criteria: `ok: true`. Anything in `problems` is a regression.
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // wait for the painter's first frame (render.ts sets this after frame one)
  for (let i = 0; i < 60 && window.__office2dReady !== true; i++) await sleep(100)
  await sleep(250)

  const problems = []
  const notes = []
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  const canvasWrap = document.querySelector('.canvas-wrap')
  const canvas = document.querySelector('.scene2d-canvas')
  const canvasRect = rect(canvasWrap)

  if (window.__office2dReady !== true) problems.push('__office2dReady never became true')
  if (!canvas) problems.push('no .scene2d-canvas in the DOM')
  if (!canvasRect || canvasRect.w < 100 || canvasRect.h < 100) problems.push(`canvas wrap is ${JSON.stringify(canvasRect)}`)

  // 1. no panel may sit on top of the canvas
  const panels = {}
  for (const sel of ['.roster', '.feed', '.card', '.prox-chip', '.zoom-ctrl', '.dpad']) {
    const el = document.querySelector(sel)
    const r = rect(el)
    if (!r) continue
    const visible = el.offsetParent !== null && getComputedStyle(el).display !== 'none'
    panels[sel] = r
    if (!visible) continue
    if (sel === '.zoom-ctrl' || sel === '.dpad') continue // they live inside the canvas on purpose
    // phone sheets are modal on purpose; only the desktop layout must stay clear
    if (el.classList.contains('is-sheet') || el.classList.contains('is-full')) continue
    if (overlaps(r, canvasRect)) problems.push(`${sel} overlaps the canvas (${JSON.stringify(r)} vs ${JSON.stringify(canvasRect)})`)
  }

  // 1b. the feed is docked at the foot of the right rail (decision: dock it
  //     like the roster), never floating over the floor
  const feed = document.querySelector('.feed')
  const feedRect = rect(feed)
  if (feed && feedRect && !feed.classList.contains('is-sheet') && feed.offsetParent !== null) {
    const docked =
      feedRect.x >= canvasRect.x + canvasRect.w - 1 && feedRect.x + feedRect.w >= window.innerWidth - 2
    if (!docked) {
      problems.push(
        `.feed is not docked in the right rail (${JSON.stringify(feedRect)} vs canvas ${JSON.stringify(canvasRect)})`,
      )
    }
    notes.push(`feed docked at ${JSON.stringify(feedRect)}`)
  }

  // 2. the roster really scrolls (regression cc2add3)
  const body = document.querySelector('.roster-body')
  let roster = null
  if (body) {
    const before = body.scrollTop
    body.scrollTop = body.scrollHeight
    await sleep(60)
    roster = {
      before,
      after: body.scrollTop,
      overflow: body.scrollHeight > body.clientHeight,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      rows: body.querySelectorAll('.roster-row').length,
    }
    body.scrollTop = before
    if (!roster.overflow) problems.push('roster-body does not overflow — 13 rows are being cut')
    if (!(roster.after > roster.before)) problems.push(`roster-body did not scroll (${roster.before} → ${roster.after})`)
    if (roster.rows !== 13) problems.push(`roster has ${roster.rows} rows, want 13`)
  } else {
    notes.push('no .roster-body — the agent panel is closed (open [Agen] to test the scroll)')
  }

  // 3. zoom control shows the design's percentages and the view fits the floor
  const zoomText = document.querySelector('.zoom-ctrl span')?.textContent ?? null
  const vp = typeof window.__office2dVp === 'function' ? window.__office2dVp() : null
  if (vp && canvasRect) {
    const floorW = 448 * vp.zoom
    const floorH = 320 * vp.zoom
    if (floorW > canvasRect.w + 1 && vp.zoom > 1) problems.push(`floor ${floorW}px wider than the ${canvasRect.w}px canvas at zoom ${vp.zoom}`)
    if (floorH > canvasRect.h + 1 && vp.zoom > 1) problems.push(`floor ${floorH}px taller than the ${canvasRect.h}px canvas at zoom ${vp.zoom}`)
  } else {
    problems.push('window.__office2dVp() is missing')
  }

  // 4. the canvas is actually painted (a blank canvas is all-transparent)
  let painted = null
  try {
    const ctx = canvas.getContext('2d')
    const { data } = ctx.getImageData(0, 0, Math.min(64, canvas.width), Math.min(64, canvas.height))
    let opaque = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++
    painted = opaque / (data.length / 4)
    if (painted < 0.5) problems.push(`canvas looks blank (${(painted * 100).toFixed(0)}% opaque in the top-left corner)`)
  } catch (e) {
    problems.push(`cannot read the canvas: ${String(e)}`)
  }

  const result = {
    ok: problems.length === 0,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    ready: window.__office2dReady === true,
    vp,
    zoomText,
    canvas: canvasRect,
    panels,
    roster,
    painted: painted === null ? null : Math.round(painted * 100) / 100,
    notes,
    problems,
  }
  console.log('office2d probe', result)
  return result
})()
