"""Numeric audit of the stylised mouth and the hair shell.

Answers two claims that a screenshot alone cannot settle:

  * the lips are symmetric about the face's vertical axis — every lip vertex is
    mirrored to another lip vertex (max error, in mm);
  * the lips do not stand off the face — the largest distance between a lip
    vertex and the skull surface under it (in mm). A "stuck-on lump" shows up
    here as several millimetres; a flush mouth as ~1 mm.

It also reports how far the top of the hair clears the skull, which is the one
way the shell can fail: a groove at the crown would let scalp poke through.

    python3 verify/mouth_check.py [url]

Defaults to the dev server on :5173. Exits 1 if the mouth fails.
"""
import json
import sys
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173/?face=default&front=1&still=1"

PROBE = """
() => {
  const scene = window.__officeScene;
  if (!scene) return JSON.stringify({ error: 'no scene' });
  let head = null;
  scene.traverse((o) => { if (o.name === 'ndoroHead') head = o; });
  if (!head) return JSON.stringify({ error: 'no ndoro head' });
  head.updateMatrixWorld(true);

  const verts = (mesh, local) => {
    const p = mesh.geometry.attributes.position;
    const out = [];
    const v = new mesh.position.constructor();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      mesh.localToWorld(v);
      out.push(local ? head.worldToLocal(v.clone()) : v.clone());
    }
    return out;
  };
  const box = (vs) => {
    const b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9 };
    for (const v of vs) {
      b.x0 = Math.min(b.x0, v.x); b.x1 = Math.max(b.x1, v.x);
      b.y0 = Math.min(b.y0, v.y); b.y1 = Math.max(b.y1, v.y);
      b.z0 = Math.min(b.z0, v.z); b.z1 = Math.max(b.z1, v.z);
    }
    return b;
  };

  // the lips: found by name on new builds, by material on older ones
  const lips = [];
  head.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name || '';
    const c = (o.material && o.material.color) ? o.material.color.getHexString() : '';
    if (n.startsWith('ndoroLips') || c === 'ab705b') lips.push(o);
  });
  let skull = null;
  head.traverse((o) => { if (o.name === 'ndoroSkull') skull = o; });
  if (!skull) {
    // the skull is the skin-coloured mesh with the most vertices
    let best = 0;
    head.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const c = (o.material && o.material.color) ? o.material.color.getHexString() : '';
      if (c === 'd9a880' && o.geometry.attributes.position.count > best) { best = o.geometry.attributes.position.count; skull = o; }
    });
  }
  // the hair: the vertex-coloured mesh with the most vertices
  let hair = null;
  head.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (!o.geometry.attributes.color) return;
    if (!hair || o.geometry.attributes.position.count > hair.geometry.attributes.position.count) hair = o;
  });

  const res = {};
  if (lips.length) {
    const all = [];
    for (const l of lips) all.push(...verts(l, true));
    const b = box(all);
    const cx = (b.x0 + b.x1) / 2;
    // symmetry: every vertex must have a mirrored partner
    let worst = 0;
    for (const v of all) {
      let best = 1e9;
      for (const w of all) {
        if (Math.abs(w.y - v.y) > 1e-4) continue;
        const d = Math.hypot(w.x + v.x - 2 * cx, w.z - v.z);
        if (d < best) best = d;
      }
      if (best > worst) worst = best;
    }
    // standoff: distance from each lip vertex to the nearest skull vertex in y
    // (the skull is a dense ellipsoid, so this is the face surface underneath)
    const sk = skull ? verts(skull, true) : [];
    let maxOut = -9;
    let meanOut = 0;
    let n = 0;
    for (const v of all) {
      let near = -9;
      for (const s of sk) {
        if (Math.abs(s.y - v.y) > 0.004 || Math.abs(s.x - v.x) > 0.012) continue;
        if (s.z > near) near = s.z;
      }
      if (near === -9) continue;
      const d = v.z - near;
      maxOut = Math.max(maxOut, d);
      meanOut += d;
      n++;
    }
    res.mouth = {
      meshes: lips.length,
      width_mm: +((b.x1 - b.x0) * 1000).toFixed(1),
      height_mm: +((b.y1 - b.y0) * 1000).toFixed(1),
      mirror_max_mm: +(worst * 1000).toFixed(3),
      standoff_max_mm: +(maxOut * 1000).toFixed(2),
      standoff_mean_mm: +(meanOut / Math.max(1, n) * 1000).toFixed(2),
    };
  }
  if (hair) {
    const cs = verts(hair, true);
    const b = box(cs);
    const sk = skull ? box(verts(skull, true)) : null;
    res.hair = {
      verts: cs.length,
      height_mm: +((b.y1 - b.y0) * 1000).toFixed(1),
      // the hair must sit outside the skull: a negative number here means the
      // scalp is poking through the top of the hair
      crown_clearance_mm: sk ? +((b.y1 - sk.y1) * 1000).toFixed(1) : null,
    };
  }
  return JSON.stringify(res);
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 900, "height": 900})
    pg.set_default_timeout(240000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(30000)
    raw = pg.evaluate(PROBE)
    b.close()

res = json.loads(raw)
print(json.dumps(res, indent=2))
m = res.get("mouth")
if not m:
    print("FAIL: no lips found")
    sys.exit(1)
ok = True
if m["mirror_max_mm"] > 0.05:
    print(f"FAIL mirror: {m['mirror_max_mm']} mm off")
    ok = False
if m["standoff_max_mm"] > 2.0:
    print(f"FAIL standoff: lips stand {m['standoff_max_mm']} mm off the face (want <= 2.0)")
    ok = False
if ok:
    print(f"MOUTH OK: mirrored within {m['mirror_max_mm']} mm, "
          f"stands {m['standoff_max_mm']} mm off the face (mean {m['standoff_mean_mm']} mm)")
    sys.exit(0)
sys.exit(1)
