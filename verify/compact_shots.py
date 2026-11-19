"""Before/after screenshots for the compact office layout.

Serves nothing itself: point it at a built `dist/` on a static server (the API
may be down — the app falls back to the bundled seed roster, which is exactly
the roster we want to photograph).

    python3 -m http.server 4180 -d frontend/dist &
    python3 verify/compact_shots.py --url http://127.0.0.1:4180 --out /tmp/shots/after --agents 12
    python3 verify/compact_shots.py --url http://127.0.0.1:4181 --out /tmp/shots/before --agents 11

Writes, at 1280x800 unless noted:
    iso-desktop.png   ?spot=tampak   (the isometric overview)
    iso-mobile.png    390x844, same view
    top-down.png      ?cam=0,34,0.05  (plan view: the desk blocks)
    dev.png / edu.png ?spot=dev|edu   (room close-ups)
"""
import argparse
import json
import time

from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
HIDE = (
    ".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip,.chip,.top,.tabs,.brand"
    "{display:none!important}"
)
IDS = [
    "default", "dev", "planner", "uiux", "coder", "reviewer", "tester", "devops",
    "edu", "edu-designer", "edu-writer", "edu-reviewer",
]
STATUS = {
    "default": ("working", ["telegram"]),
    "dev": ("reviewing", ["github"]),
    "planner": ("working", ["read_file"]),
    "uiux": ("idle", []),
    "coder": ("working", ["terminal"]),
    "reviewer": ("blocked", ["ast_grep"]),
    "tester": ("idle", []),
    "devops": ("working", ["terminal"]),
    "edu": ("working", ["write_file"]),
    "edu-designer": ("idle", []),
    "edu-writer": ("working", ["read_file"]),
    "edu-reviewer": ("idle", []),
}


def payload(ids):
    now = time.time()
    agents = []
    for i, aid in enumerate(ids):
        st, tools = STATUS[aid]
        agents.append({
            "id": aid, "status": st, "last_active": now - 300,
            "current": {"kind": "tool", "tools": tools} if tools else None,
            "today": {"sessions": 3 + i, "messages": 40 + i * 7, "tool_calls": 22 + i * 5,
                      "tokens": 120000 + i * 9000, "hourly": [0, 1, 2, 3, 5, 8, 6, 4, 3, 2, 1, 0]},
            "total": {"sessions": 120 + i, "messages": 2400 + i * 30},
            "task": "rapikan tata letak kantor" if st != "idle" else None,
            "source": "telegram" if i % 2 == 0 else "cli",
            "blocked": {"reason": "menunggu review", "since": now - 120, "tools": 4}
            if st == "blocked" else None,
        })
    return {"now": now, "gateway": {"state": "online", "version": "2.0.0",
                                    "updated_at": "2026-11-15T09:00:00Z"},
            "agents": agents, "feed": [], "tasks": [], "comms": []}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--agents", type=int, default=12)
    args = ap.parse_args()
    # the "before" office has no devops profile: 11 desks, no twelfth
    ids = IDS if args.agents >= 12 else [i for i in IDS if i != "devops"]
    body = json.dumps(payload(ids))

    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
        pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        pg.set_default_timeout(240000)
        pg.on("pageerror", lambda e: print("PAGEERROR:", e))
        pg.route("**/api/status", lambda r: r.fulfill(status=200, content_type="application/json", body=body))

        def shot(name, query, viewport=None, wait=14000):
            if viewport:
                pg.set_viewport_size(viewport)
            pg.goto(args.url + "/" + query, wait_until="load")
            pg.wait_for_timeout(wait)
            pg.add_style_tag(content=HIDE)
            pg.wait_for_timeout(1500)
            pg.screenshot(path=f"{args.out}/{name}.png", timeout=240000)
            print("saved", f"{args.out}/{name}.png")

        shot("iso-desktop", "?spot=tampak&still=1")
        shot("top-down", "?cam=0,34,0.05&aim=0,0,0&still=1")
        shot("dev", "?spot=dev&still=1")
        shot("edu", "?spot=edu&still=1")
        shot("iso-mobile", "?spot=tampak&still=1", viewport={"width": 390, "height": 844}, wait=10000)
        b.close()


if __name__ == "__main__":
    main()
