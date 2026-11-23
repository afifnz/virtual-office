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
 *   2. open  http://127.0.0.1:4173/?still=1&theme=day&floor=3  (desktop 1280x800)
 *   3. DevTools → Console → paste this whole file → Enter.
 *      Or from CI/CDP:
 *        Runtime.evaluate({ expression: <this file>, awaitPromise: true, returnByValue: true })
 *   4. repeat at 390x844 with DevTools device emulation.
 *
 * Exit criteria: `ok: true`. Anything in `problems` is a regression.
 *
 * MANUAL STEP (offline seed): stop the Go API (or block /api/*) and reload.
 * The seed roster must still render all 13 desks across L1/L2/L3, every agent
 * OFFLINE, with the "data lama" banner in the HUD. When the probe sees an
 * all-offline roster it asserts exactly that (floorsInfo.allOffline +
 * floorsInfo.staleShown); the visual check of the dimmed desks is the manual
 * screenshot review.
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
  for (const sel of ['.roster', '.feed', '.card', '.prox-chip', '.zoom-ctrl', '.dpad', '.floor-tabs']) {
    const el = document.querySelector(sel)
    const r = rect(el)
    if (!r) continue
    const visible = el.offsetParent !== null && getComputedStyle(el).display !== 'none'
    panels[sel] = r
    if (!visible) continue
    if (sel === '.zoom-ctrl' || sel === '.dpad' || sel === '.floor-tabs') continue // they live inside the canvas on purpose
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

  // 3. side camera: the fit (≈0.78 on a phone) up to the 150 px/unit camera at
  //    2, horizontal pan inside the 1000 px stage
  const zoomText = document.querySelector('.zoom-ctrl span')?.textContent ?? null
  const vp = typeof window.__office2dVp === 'function' ? window.__office2dVp() : null
  if (vp && canvasRect) {
    if (!(vp.zoom > 0.2 && vp.zoom <= 2)) problems.push(`side camera zoom is ${vp.zoom}, want 0.2..2`)
    if (!Number.isFinite(vp.camX) || vp.camX < 0 || vp.camX > 1000) problems.push(`camX ${vp.camX} outside the 1000 px stage`)
    if (zoomText !== `${Math.round(vp.zoom * 100)}%`) notes.push(`zoom label ${zoomText} vs vp.zoom ${vp.zoom}`)
  } else {
    problems.push('window.__office2dVp() is missing')
  }

  // 3a. theme: ?theme= must win, and <html data-theme> must follow
  const themeParam = new URLSearchParams(window.location.search).get('theme')
  const themeNow = typeof window.__office2dTheme === 'function' ? window.__office2dTheme() : null
  const themeAttr = document.documentElement.dataset.theme
  if (themeParam === 'day' || themeParam === 'night') {
    if (themeNow !== themeParam) problems.push(`?theme=${themeParam} but canvas theme is ${themeNow}`)
    if (themeAttr !== themeParam) problems.push(`?theme=${themeParam} but <html data-theme> is ${themeAttr}`)
  } else if (themeAttr !== 'day' && themeAttr !== 'night') {
    problems.push(`<html data-theme> is ${themeAttr}, want day|night`)
  }

  // 3b. the floor tabs: three of them, and clicking one switches vp.floor
  let tabs = null
  const tabEls = [...document.querySelectorAll('.floor-tabs .floor-tab')]
  if (tabEls.length !== 3) {
    problems.push(`expected 3 floor tabs, found ${tabEls.length}`)
  } else if (typeof window.__office2dVp === 'function') {
    const before = window.__office2dVp().floor
    // click L2 (index 1), or L3 when already on L2, so the floor must change
    const idx = before === 2 ? 2 : 1
    tabEls[idx].click()
    await sleep(200)
    const after = window.__office2dVp().floor
    tabs = { clicked: idx + 1, before, after }
    if (after === before) problems.push(`clicking floor tab L${idx + 1} did not change vp.floor (${before} → ${after})`)
    if (!new URLSearchParams(window.location.search).get('floor')) {
      problems.push('switching floors did not write ?floor= to the URL')
    }
  }

  // 3c. the canvas is painted on EVERY floor (blank-floor regression)
  const paintSample = () => {
    const ctx = canvas.getContext('2d')
    const { data } = ctx.getImageData(0, 0, Math.min(64, canvas.width), Math.min(64, canvas.height))
    let opaque = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++
    return Math.round((opaque / (data.length / 4)) * 100) / 100
  }
  const paintedByFloor = {}
  if (tabEls.length === 3 && canvas) {
    for (let f = 1; f <= 3; f++) {
      tabEls[f - 1].click()
      await sleep(250)
      const vpNow = typeof window.__office2dVp === 'function' ? window.__office2dVp() : null
      try {
        const p = paintSample()
        paintedByFloor[f] = p
        if (p < 0.5) problems.push(`L${f} canvas looks blank (${(p * 100).toFixed(0)}% opaque top-left)`)
      } catch (e) {
        problems.push(`cannot read the canvas on L${f}: ${String(e)}`)
      }
      if (vpNow && vpNow.floor !== f) problems.push(`clicking tab L${f} left vp.floor=${vpNow.floor}`)
    }
  }

  // 3d. per-floor facts from the debug hook: seed desk split + lift coordinates
  //     (the lift is asserted via data here; the visual steel shaft is checked
  //     by the manual screenshot step — see the header comment)
  let floorsInfo = null
  if (typeof window.__office2dFloors === 'function') {
    floorsInfo = window.__office2dFloors()
    const split = floorsInfo.floors.map((f) => f.desks)
    const total = split.reduce((a, b) => a + b, 0)
    if (total !== 13) problems.push(`seed desks total ${total}, want 13 (offline seed must still render)`)
    if (split.join(',') !== '1,4,8') problems.push(`seed desks split ${split.join('/')}, want 1/4/8`)
    for (const f of floorsInfo.floors) {
      if (!Number.isFinite(f.lift?.x) || !Number.isFinite(f.lift?.z)) {
        problems.push(`L${f.floor}: lift coordinates missing from __office2dFloors()`)
      }
    }
    // offline path: every agent offline ⇒ the stale banner must be up
    const allOffline = floorsInfo.floors.every((f) => f.agents === 0)
    const staleShown = !!document.querySelector('.stale')
    floorsInfo.allOffline = allOffline
    floorsInfo.staleShown = staleShown
    if (allOffline && !staleShown) problems.push('all agents offline but the stale banner (.stale) is not shown')
  } else {
    problems.push('window.__office2dFloors() is missing')
  }

  // 3e. side layout gate: rows, ratio, plates, wall (headless twin in visual_check)
  let layout = null
  if (typeof window.__office2dLayout === 'function') {
    layout = window.__office2dLayout(vp?.floor ?? 3)
    if (!(layout.ratio >= 3 && layout.ratio <= 4)) problems.push(`room:avatar ratio 1:${layout.ratio}, want 1:3–1:4`)
    if (layout.gate.plateOverlaps !== 0) problems.push(`${layout.gate.plateOverlaps} plate overlaps on L${layout.floor}`)
    if (layout.gate.plateOnHead !== 0) problems.push(`${layout.gate.plateOnHead} plates cover another head on L${layout.floor}`)
    if (layout.gate.avatarOverlapPct > 20) problems.push(`avatar overlap ${layout.gate.avatarOverlapPct} % > 20 %`)
    if (layout.wall.glassPct < 80) problems.push(`glass+city only ${layout.wall.glassPct} % of the wall`)
    if (layout.rows.front.length + layout.rows.back.length !== 8 && layout.floor === 3) {
      problems.push(`L3 rows ${layout.rows.front.length}+${layout.rows.back.length}, want 4+4`)
    }
    if (layout.rows.front.map((r) => r.x).join(',') !== '170,370,570,770' && layout.floor === 3) {
      problems.push(`L3 front slots ${layout.rows.front.map((r) => r.x).join(',')}`)
    }
  } else {
    problems.push('window.__office2dLayout() is missing')
  }

  // 4. the canvas is actually painted (a blank canvas is all-transparent)
  let painted = null
  try {
    painted = paintSample()
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
    tabs,
    roster,
    paintedByFloor,
    floorsInfo,
    layout,
    theme: { param: themeParam, canvas: themeNow, attr: themeAttr },
    painted: painted === null ? null : Math.round(painted * 100) / 100,
    notes,
    problems,
  }
  console.log('office2d probe', result)
  return result
})()
