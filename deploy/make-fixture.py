#!/usr/bin/env python3
"""Build a throwaway HERMES_HOME with several profiles, for local dev + screenshots.

    python3 deploy/make-fixture.py /tmp/hermes-demo

Creates state.db files with the same schema the Go API reads and seeds a
 believable mix: someone working, someone mid-review, a blocked agent, idle
 desks and an offline profile. Never point HERMES_HOME at this in production.
"""
import json
import os
import sqlite3
import sys
import time

SCHEMA = """
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    profile_name TEXT,
    source TEXT,
    parent_session_id TEXT,
    started_at REAL,
    updated_at REAL,
    ended_at REAL,
    end_reason TEXT,
    model_config TEXT
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    role TEXT,
    content TEXT,
    tool_name TEXT,
    tool_calls TEXT,
    created_at REAL,
    tokens INTEGER
);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);
"""


def db_for(home: str, profile: str) -> sqlite3.Connection:
    path = (
        os.path.join(home, "state.db")
        if profile == "default"
        else os.path.join(home, "profiles", profile, "state.db")
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    return con


def session(con, sid, profile, source, parent, start, end, end_reason, model_config=None):
    con.execute(
        "INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)",
        (sid, profile, source, parent, start, end, end_reason[0], end_reason[1], model_config),
    )


def msg(con, sid, role, content, ts, tool=None, calls=None, tokens=0):
    con.execute(
        "INSERT INTO messages (session_id, role, content, tool_name, tool_calls, created_at, tokens)"
        " VALUES (?,?,?,?,?,?,?)",
        (sid, role, content, tool, json.dumps(calls) if calls else None, ts, tokens),
    )


def delegate_call(goal, profile):
    return [
        {
            "id": "call_delegate",
            "type": "function",
            "function": {
                "name": "delegate_task",
                "arguments": json.dumps({"tasks": [{"goal": goal, "profile": profile}]}),
            },
        }
    ]


def hourly_history(con, sid, start_hour, count_hours, per_hour, now):
    """Seed older messages so the sparkline and 'today' counters look alive."""
    for h in range(count_hours):
        ts_base = now - (start_hour - h) * 3600
        for i in range(per_hour):
            msg(
                con,
                sid,
                "assistant" if i % 3 else "user",
                "…",
                ts_base - i * 37,
                tool="terminal" if i % 4 == 0 else None,
                tokens=180 + (i * 13) % 220,
            )


def main():
    home = sys.argv[1] if len(sys.argv) > 1 else "/tmp/hermes-demo"
    now = time.time()
    os.makedirs(home, exist_ok=True)

    with open(os.path.join(home, "gateway_state.json"), "w") as f:
        json.dump(
            {
                "state": "running",
                "version": "0.23.1",
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now)),
            },
            f,
        )

    # ---- default / Ndoro Kakung: working right now, and delegating to Tim Dev
    con = db_for(home, "default")
    sid = "a1b2c3d4e5f60718"
    session(con, sid, "default", "telegram", None, now - 900, now - 3, (None, None))
    msg(con, sid, "user", "rapikan taskboard kantor", now - 900)
    msg(con, sid, "assistant", "siap, saya pecah dulu", now - 870, tokens=220)
    msg(con, sid, "assistant", "", now - 12, calls=delegate_call("benerin API status", "dev"), tokens=310)
    msg(con, sid, "tool", "delegated", now - 3, tool="delegate_task", tokens=40)
    hourly_history(con, sid, 9, 9, 3, now)

    # an older, finished session from earlier today
    old = "00aa11bb22cc33dd"
    session(con, old, "default", "telegram", None, now - 5 * 3600, now - 4 * 3600, ("ok", None))
    msg(con, old, "user", "buat ringkasan mingguan", now - 5 * 3600)
    msg(con, old, "assistant", "sudah dikirim", now - 4 * 3600, tokens=180)
    con.commit()
    con.close()

    # ---- dev / Bima: the routed subagent works inside the parent's DB
    con = sqlite3.connect(os.path.join(home, "state.db"))
    child = "9f8e7d6c5b4a3021"
    session(
        con, child, "default", "subagent", sid,
        now - 640, now - 2, (None, None),
        json.dumps({"_subagent_id": "sa-0-" + sid}),
    )
    msg(con, child, "user", "benerin API status", now - 640)
    msg(con, child, "assistant", "", now - 300, calls=[{
        "id": "c1", "type": "function",
        "function": {"name": "terminal", "arguments": json.dumps({"command": "go test ./..."})},
    }], tokens=420)
    msg(con, child, "tool", "ok  officeapi/internal/api", now - 2, tool="terminal", tokens=90)
    con.commit()
    con.close()

    # ---- coder / Dimas: blocked on two failing builds
    con = db_for(home, "coder")
    sid = "c0de0001"
    session(con, sid, "coder", "subagent", None, now - 1200, now - 90, (None, None))
    msg(con, sid, "user", "fix build", now - 1200)
    msg(con, sid, "assistant", "", now - 400, calls=[{
        "id": "c1", "type": "function",
        "function": {"name": "terminal", "arguments": json.dumps({"command": "npm run build"})},
    }], tokens=200)
    msg(con, sid, "tool", '{"error": "TS2307: cannot find module \'./Hand\'"}', now - 200, tool="terminal")
    msg(con, sid, "tool", '{"error": "exit code 2"}', now - 90, tool="terminal")
    hourly_history(con, sid, 6, 6, 2, now)
    con.commit()
    con.close()

    # ---- reviewer / Yoga: reviewing right now
    con = db_for(home, "reviewer")
    sid = "reve1e2"
    session(con, sid, "reviewer", "subagent", None, now - 500, now - 5, (None, None))
    msg(con, sid, "user", "review diff kantor", now - 500)
    msg(con, sid, "assistant", "", now - 60, calls=[{
        "id": "c1", "type": "function",
        "function": {"name": "read_file", "arguments": json.dumps({"path": "src/App.tsx"})},
    }], tokens=260)
    msg(con, sid, "tool", "…", now - 5, tool="read_file", tokens=300)
    con.commit()
    con.close()

    # ---- planner / Raka and tester / Sari: idle since this morning
    for profile, sid, hours in (("planner", "p1anne4", 2.4), ("tester", "tes7e2", 1.2)):
        con = db_for(home, profile)
        session(con, sid, profile, "oneshot", None, now - hours * 3600 - 600, now - hours * 3600, ("ok", None))
        msg(con, sid, "user", "rencana", now - hours * 3600 - 600)
        msg(con, sid, "assistant", "sudah", now - hours * 3600, tokens=140)
        hourly_history(con, sid, 4, 4, 2, now)
        con.commit()
        con.close()

    # ---- coder2 / Bagas: the second implementer, green tests and moving on
    con = db_for(home, "coder2")
    sid = "c0de0002"
    session(con, sid, "coder2", "subagent", None, now - 800, now - 40, (None, None))
    msg(con, sid, "user", "kerjakan tiket kedua", now - 800)
    msg(con, sid, "assistant", "", now - 120, calls=[{
        "id": "c1", "type": "function",
        "function": {"name": "terminal", "arguments": json.dumps({"command": "npm run build"})},
    }], tokens=240)
    msg(con, sid, "tool", "vite v5 built in 12.4s", now - 40, tool="terminal", tokens=80)
    hourly_history(con, sid, 5, 5, 2, now)
    con.commit()
    con.close()

    # ---- edu team: Ayu is writing, the other two are away
    con = db_for(home, "edu")
    sid = "edu1lead"
    session(con, sid, "edu", "telegram", None, now - 700, now - 6, (None, None))
    msg(con, sid, "user", "susun modul pertemuan 5", now - 700)
    msg(con, sid, "assistant", "", now - 20, calls=[{
        "id": "c1", "type": "function",
        "function": {"name": "write_file", "arguments": json.dumps({"path": "modul-5.md"})},
    }], tokens=380)
    msg(con, sid, "tool", "written", now - 6, tool="write_file", tokens=120)
    con.commit()
    con.close()

    for profile in ("edu-designer", "edu-writer"):
        con = db_for(home, profile)
        sid = profile + "1"
        session(con, sid, profile, "oneshot", None, now - 4 * 3600, now - 3 * 3600, ("ok", None))
        msg(con, sid, "user", "lanjut", now - 4 * 3600)
        msg(con, sid, "assistant", "beres", now - 3 * 3600, tokens=90)
        con.commit()
        con.close()

    # edu-reviewer and uiux stay offline (no state.db on purpose)

    print(f"fixture siap di {home}")
    for root, _dirs, files in os.walk(home):
        for f in files:
            p = os.path.join(root, f)
            print(f"  {p}  {os.path.getsize(p)} B")


if __name__ == "__main__":
    main()
