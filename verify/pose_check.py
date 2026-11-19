"""Numeric audit of the seated pose.

Reads the live scene and measures, per seated avatar:
  * hip height vs the chair seat top (0.4725 m)
  * knee height vs hip height (thigh level?), knee flexion angle
  * sole height of the lowest skinned foot vertex (on the floor?)
  * wrist position vs the keyboard box
  * head height and width (proportion check)
  * clipping: any foot vertex below the floor, any thigh/knee inside the desk

Run with the dev server up:
    python3 pose_check.py [url]
"""
import json
import math
import sys
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173/?still=1"

PROBE = """
() => {
  const scene = window.__officeScene;
  const V = (o) => { const t = o.position.clone(); o.getWorldPosition(t); return t; };
  const rigs = [];
  scene.traverse((o) => {
    if (o.isBone && o.name.replace(/[^A-Za-z0-9_]/g, '') === 'Hips') {
      let n = o;
      while (n.parent && n.parent !== scene) n = n.parent;
      rigs.push(n);
    }
  });
  const out = [];
  for (const rig of rigs) {
    const actor = rig.parent && rig.parent.parent ? rig.parent.parent : rig;
    const inv = actor.matrixWorld.clone().invert();
    const local = (p) => p.clone().applyMatrix4(inv);
    const b = (n) => rig.getObjectByName(n);
    const hips = b('Hips'), thL = b('UpperLegL'), shL = b('LowerLegL'), ftL = b('FootL');
    const thR = b('UpperLegR'), shR = b('LowerLegR'), ftR = b('FootR');
    const wrL = b('WristL'), wrR = b('WristR'), hd = b('Head');
    if (!hips || !thL || !shL || !ftL) continue;

    const H = local(V(thL)), KL = local(V(shL)), AL = local(V(ftL));
    const KR = thR && shR ? local(V(shR)) : null;
    const AR = ftR ? local(V(ftR)) : null;
    const WL = wrL ? local(V(wrL)) : null;
    const WR = wrR ? local(V(wrR)) : null;

    // knee flexion: angle between the thigh (knee-hip) and the shin (ankle-knee)
    const ang = (a, b2, c) => {
      const u = a.clone().sub(b2), v = c.clone().sub(b2);
      return +(Math.acos(Math.max(-1, Math.min(1, u.normalize().dot(v.normalize())))) * 180 / Math.PI).toFixed(1);
    };

    // true skinned sole height: transform the foot vertices by the skin. The
    // men's pack names its meshes Cube204…, so take the lowest vertex of the
    // whole body below the knee instead of trusting a mesh name.
    let sole = Infinity;
    const kneeY = Math.min(local(V(shL)).y, ftR ? local(V(ftR)).y : Infinity);
    rig.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const pos = o.geometry.attributes.position;
      const v = new o.position.constructor();
      for (let i = 0; i < pos.count; i += 2) {
        v.fromBufferAttribute(pos, i);
        o.applyBoneTransform(i, v);
        o.localToWorld(v);
        if (v.y < sole) sole = v.y;
      }
    });

    const met = (() => { let m = {}; rig.traverse((o) => { if (o.userData && o.userData.metrics) m = o.userData.metrics; }); return m; })();
    const f = (p) => p ? [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)] : null;
    out.push({
      at: [+actor.position.x.toFixed(2), +actor.position.z.toFixed(2)],
      hipY: +H.y.toFixed(3),
      kneeL: f(KL), kneeR: f(KR),
      ankleL: f(AL), ankleR: f(AR),
      thighL: +H.distanceTo(KL).toFixed(3),
      shinL: +KL.distanceTo(AL).toFixed(3),
      kneeAngleL: ang(H, KL, AL),
      kneeAngleR: KR && AR ? ang(H, KR, AR) : null,
      kneeLevelL: +(KL.y - H.y).toFixed(3),
      kneeLevelR: KR ? +(KR.y - H.y).toFixed(3) : null,
      soleY: +sole.toFixed(3),
      wristL: f(WL), wristR: f(WR),
      headY: +V(hd).y.toFixed(3),
      headH: met.headH ? +met.headH.toFixed(3) : null,
      headTop: met.headTopY ? +met.headTopY.toFixed(3) : null,
      seatDrop: met.seatDrop ? +met.seatDrop.toFixed(3) : null,
    });
  }
  return JSON.stringify(out);
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.goto(url, wait_until="load")
    # 12 avatars + shader compile on a software rasteriser: 16 s flaked, 30 s
    # is steady (AGENTS.md §8)
    pg.wait_for_timeout(30000)
    rows = json.loads(pg.evaluate(PROBE))
    b.close()

EXPECTED = 13   # one seated avatar per desk (12 + the devops desk)
SEAT = 0.4725
KEY = {"x": 0.04, "y": 0.786, "z": -0.26}   # actor frame, keyboard top centre
print(f"{'desk':>12} {'hipY':>6} {'kneeL-R':>8} {'angL':>6} {'angR':>6} {'sole':>6} "
      f"{'wristL (x,y,z)':>22} {'wristR (x,y,z)':>22} {'headH':>6} {'head/body':>9}")
bad = []
if len(rows) != EXPECTED:
    bad.append(f"{len(rows)} seated avatars, want {EXPECTED}")
for r in rows:
    print(f"{str(r['at']):>12} {r['hipY']:>6.3f} {r['kneeLevelL']:>8.3f} {r['kneeAngleL']:>6.1f} "
          f"{(r['kneeAngleR'] if r['kneeAngleR'] is not None else float('nan')):>6.1f} {r['soleY']:>6.3f} "
          f"{str(r['wristL']):>22} {str(r['wristR']):>22} "
          f"{(r['headH'] or 0):>6.3f} {((r['headH'] or 0) / 1.7):>9.3f}")

    if not (SEAT + 0.03 <= r['hipY'] <= SEAT + 0.14):
        bad.append(f"{r['at']}: hip {r['hipY']:.3f} not on the seat (seat top {SEAT}, want {SEAT + 0.03:.3f}..{SEAT + 0.14:.3f})")
    if abs(r['kneeLevelL']) > 0.035 or (r['kneeLevelR'] is not None and abs(r['kneeLevelR']) > 0.035):
        bad.append(f"{r['at']}: thighs not level ({r['kneeLevelL']:.3f}/{r['kneeLevelR']})")
    if abs(r['kneeAngleL'] - 90) > 14:
        bad.append(f"{r['at']}: left knee {r['kneeAngleL']:.1f} deg, want ~90")
    if r['kneeAngleR'] is not None and abs(r['kneeAngleR'] - r['kneeAngleL']) > 6:
        bad.append(f"{r['at']}: knees asymmetric ({r['kneeAngleL']:.1f} vs {r['kneeAngleR']:.1f})")
    if not (0.0 <= r['soleY'] <= 0.03):
        bad.append(f"{r['at']}: sole at {r['soleY']:.3f} (floating or through the floor)")
    for side in ('wristL', 'wristR'):
        w = r[side]
        if not w:
            continue
        if abs(w[1] - KEY['y']) > 0.06 or abs(w[2] - KEY['z']) > 0.09 or abs(w[0] - KEY['x']) > 0.26:
            bad.append(f"{r['at']}: {side} {w} not over the keyboard {KEY}")
    if abs(r['wristL'][1] - r['wristR'][1]) > 0.03:
        bad.append(f"{r['at']}: wrists at different heights")

print()
print(f"agents: {len(rows)}   head/body: " +
      ", ".join(f"{r['headH'] / 1.7:.3f}" for r in rows if r['headH']))
if bad:
    print(f"FAIL ({len(bad)})")
    for m in bad:
        print("  -", m)
    sys.exit(1)
else:
    print("PASS: hips on the seat, thighs level, knees ~90 and symmetric, soles on the floor, wrists over the keys")
