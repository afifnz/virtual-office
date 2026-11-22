/**
 * FPS probe for the front desk (Chromium, real device). NOT part of the build.
 *
 * The sandbox has no browser, so every fps number in the PR must come from
 * this probe — anything else is an estimate and must be labelled as such.
 *
 * How to run:
 *   1. serve the build:  cd frontend && npm run build && npm run preview
 *   2. open a URL with an explicit theme and floor, e.g.
 *        http://127.0.0.1:4173/?theme=day&floor=3
 *        http://127.0.0.1:4173/?theme=night&floor=3
 *      (do NOT use ?still=1 for this probe — a frozen scene has no fps)
 *   3. DevTools → Console → paste this whole file → Enter.
 *      Or via CDP: Runtime.evaluate({ expression: <this file>, awaitPromise: true, returnByValue: true })
 *   4. repeat at 390×844 with device emulation, and once with the API stopped
 *      (offline seed, both themes).
 *
 * The probe reports:
 *   - rAF fps over 5 s (what the user actually sees)
 *   - mean / p95 frame interval
 *   - the painter's own render cost from window.__office2dPerf()
 *   - the resolved theme and floor, so a screenshot can be tied to a run
 */
(async () => {
  const seconds = 5
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 60 && window.__office2dReady !== true; i++) await sleep(100)
  if (window.__office2dReady !== true) {
    const bad = { ok: false, problem: '__office2dReady never became true' }
    console.log('fps probe', bad)
    return bad
  }
  await sleep(400)

  const intervals = []
  let last = performance.now()
  const start = last
  await new Promise((resolve) => {
    const tick = (ts) => {
      intervals.push(ts - last)
      last = ts
      if (ts - start < seconds * 1000) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })

  const sorted = [...intervals].sort((a, b) => a - b)
  const avg = intervals.reduce((n, v) => n + v, 0) / Math.max(1, intervals.length)
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0
  const vp = typeof window.__office2dVp === 'function' ? window.__office2dVp() : null
  const theme = typeof window.__office2dTheme === 'function' ? window.__office2dTheme() : null
  const perf = typeof window.__office2dPerf === 'function' ? window.__office2dPerf() : null

  const result = {
    ok: true,
    measuredIn: 'this browser, this device',
    seconds,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    theme,
    floor: vp?.floor ?? null,
    zoom: vp?.zoom ?? null,
    fps: Math.round((1000 / Math.max(0.001, avg)) * 10) / 10,
    avgFrameMs: Math.round(avg * 100) / 100,
    p95FrameMs: Math.round(p95 * 100) / 100,
    frames: intervals.length,
    painter: perf,
    note:
      perf && perf.estimatedFps
        ? 'painter.estimatedFps is a lower bound derived from render cost; fps is the measured rAF rate'
        : 'no painter report',
  }
  console.log('fps probe', result)
  return result
})()
