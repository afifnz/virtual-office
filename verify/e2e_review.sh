#!/usr/bin/env bash
# End-to-end proof of the review fixes against the real binary.
set -u
# This suite drives one client (127.0.0.1) through every endpoint many times in a
# row, which is exactly what the per-IP limiter exists to stop. Turning it off
# keeps the checks about the API contract; the limiter itself is covered by
# `go test ./internal/ratelimit` and the curl proof in the PR.
export RATE_LIMIT=off
BIN=/workspace/.gotmp/bin/office-api
OUT=/workspace/.gotmp/e2e
rm -rf "$OUT"; mkdir -p "$OUT"
pass=0; fail=0
ok()   { pass=$((pass+1)); echo "ok   $*"; }
bad()  { fail=$((fail+1)); echo "FAIL $*"; }
check(){ # check <desc> <expected-substring> <actual>
  if printf '%s' "$3" | grep -qF -- "$2"; then ok "$1"; else bad "$1 (got: $(printf '%s' "$3" | head -c 300))"; fi
}
checknot(){ if printf '%s' "$3" | grep -qF -- "$2"; then bad "$1 (leaked: $2)"; else ok "$1"; fi; }

wait_up() { # wait_up <port>
  for _ in $(seq 1 50); do
    curl -sf "http://127.0.0.1:$1/api/health" >/dev/null 2>&1 && return 0
    sleep 0.1
  done
  return 1
}

run() { # run <log> <port> [env...] -- starts in background, returns pid
  local log=$1 port=$2; shift 2
  env "$@" PORT=$port "$BIN" >"$log" 2>&1 &
  echo $!
}

echo "=============================================================="
echo "1. default roster matches the frontend seed (Ndoro Kakung/Bima, lobby)"
echo "=============================================================="
pid=$(run "$OUT/1.log" 8211 HERMES_HOME=/tmp/hh)
wait_up 8211
cfg=$(curl -s localhost:8211/api/config)
check "default id is Ndoro Kakung / ASISTEN UTAMA / lobby" '"id":"default","name":"Ndoro Kakung","role":"ASISTEN UTAMA","team":"lobby"' "$cfg"
check "dev is Bima / SDLC LEAD" '"id":"dev","name":"Bima","role":"SDLC LEAD","team":"dev"' "$cfg"
check "team ids are lobby/dev/edu" '"teams":[{"id":"lobby","label":"Pendopo"},{"id":"dev","label":"Tim Dev"},{"id":"edu","label":"Tim Edu"}]' "$cfg"
check "layout publishes grid 4.5 x 4.0 and aisle 1.6" '"layout":{"floor":{"w":40,"d":30},"grid":{"dx":4.5,"dz":4},"aisle":1.6}' "$cfg"
check "pendopo is not published as a team id" 'Pendopo' "$cfg"
checknot "no legacy team id" '"id":"pendopo"' "$cfg"
kill "$pid" 2>/dev/null

echo
echo "=============================================================="
echo "2. roster override adds a desk and moves the office timezone"
echo "=============================================================="
pid=$(run "$OUT/2.log" 8212 HERMES_HOME=/tmp/hh \
  OFFICE_ROSTER_JSON='{"tz":"Asia/Makassar","agents":[{"id":"resepsionis","name":"Wati","role":"RESEPSIONIS","team":"lobby"}]}')
wait_up 8212
cfg=$(curl -s localhost:8212/api/config)
check "override agent appears" '"id":"resepsionis","name":"Wati","role":"RESEPSIONIS","team":"lobby"' "$cfg"
check "roster tz wins over OFFICE_TZ" '"tz":"Asia/Makassar"' "$cfg"
check "health reports the roster tz" '"tz":"Asia/Makassar"' "$(curl -s localhost:8212/api/health)"
check "legacy agents keep their seed name" '"id":"default","name":"Ndoro Kakung"' "$cfg"
kill "$pid" 2>/dev/null

echo
echo "=============================================================="
echo "3. an unknown timezone in the roster is fatal (exit 2)"
echo "=============================================================="
env HERMES_HOME=/tmp/hh PORT=8213 OFFICE_ROSTER_JSON='{"tz":"Mars/Olympus"}' "$BIN" >"$OUT/3.log" 2>&1
code=$?
if [ "$code" -eq 2 ]; then ok "exit code 2 for Mars/Olympus"; else bad "exit code $code, want 2"; fi
check "the error names the zone" 'Mars/Olympus' "$(cat "$OUT/3.log")"

echo
echo "=============================================================="
echo "4. a roster id that is a path is rejected (exit 2)"
echo "=============================================================="
env HERMES_HOME=/tmp/hh PORT=8214 OFFICE_ROSTER_JSON='{"agents":[{"id":"../../../../tmp/leak","name":"Leak"}]}' "$BIN" >"$OUT/4.log" 2>&1
code=$?
if [ "$code" -eq 2 ]; then ok "exit code 2 for ../../../../tmp/leak"; else bad "exit code $code, want 2"; fi
check "the error explains the id rule" 'tidak valid' "$(cat "$OUT/4.log")"
if [ -f /tmp/leak ]; then bad "traversal wrote /tmp/leak"; else ok "nothing was written outside HERMES_HOME"; fi

echo
echo "=============================================================="
echo "5. credentials in REMOTE_API_URL never reach a client"
echo "=============================================================="
# upstream: a plain office on 8215
pid_up=$(run "$OUT/5up.log" 8215 HERMES_HOME=/tmp/hh)
wait_up 8215
pid=$(run "$OUT/5.log" 8216 OFFICE_SOURCE=remote REMOTE_API_URL="http://user:s3cret@127.0.0.1:8215")
wait_up 8216
cfg=$(curl -s localhost:8216/api/config)
health=$(curl -s localhost:8216/api/health)
check "config still reaches the upstream" '"source":"remote"' "$cfg"
check "remote_api_url is published" '"remote_api_url":"http://127.0.0.1:8215"' "$cfg"
checknot "config has no password" 's3cret' "$cfg"
checknot "config has no userinfo" 'user:' "$cfg"
checknot "health has no password" 's3cret' "$health"
checknot "health home has no userinfo" 'user:' "$health"
check "health home is the redacted upstream" '"home":"http://127.0.0.1:8215"' "$health"
checknot "startup log has no password" 's3cret' "$(cat "$OUT/5.log")"
kill "$pid" 2>/dev/null
kill "$pid_up" 2>/dev/null

echo
echo "--- dead upstream: the 502 body must be redacted too ---"
pid=$(run "$OUT/5b.log" 8217 OFFICE_SOURCE=remote REMOTE_API_URL="http://user:s3cret@127.0.0.1:1")
wait_up 8217
body=$(curl -s localhost:8217/api/status)
code=$(curl -s -o /dev/null -w '%{http_code}' localhost:8217/api/status)
check "dead upstream answers 502" '502' "$code"
checknot "502 body has no password" 's3cret' "$body"
checknot "502 body has no userinfo" 'user:' "$body"
checknot "log has no password" 's3cret' "$(cat "$OUT/5b.log")"
kill "$pid" 2>/dev/null

echo
echo "=============================================================="
echo "6. every state.db unreadable -> 503, not an empty healthy office"
echo "=============================================================="
rm -rf /tmp/hbad; mkdir -p /tmp/hbad/profiles/dev /tmp/hbad/profiles/edu
printf 'this is not sqlite' > /tmp/hbad/profiles/dev/state.db
printf 'this is not sqlite' > /tmp/hbad/profiles/edu/state.db
pid=$(run "$OUT/6.log" 8218 HERMES_HOME=/tmp/hbad)
for _ in $(seq 1 50); do
  code=$(curl -s -o /dev/null -w '%{http_code}' localhost:8218/api/health 2>/dev/null)
  [ "$code" = "503" ] && break
  sleep 0.1
done
health=$(curl -s localhost:8218/api/health)
status=$(curl -s localhost:8218/api/status)
scode=$(curl -s -o /dev/null -w '%{http_code}' localhost:8218/api/status)
check "health answers 503" '503' "$code"
check "health says ok:false" '"ok":false' "$health"
check "health says degraded:true" '"degraded":true' "$health"
check "health counted both DBs" '"dbs_checked":2' "$health"
check "health reports two failures" '"dbs_err":2' "$health"
check "health reports no successes" '"dbs_ok":0' "$health"
check "health lists the failed profiles" '"dbs_failed":["dev","edu"]' "$health"
check "status answers 503" '503' "$scode"
check "status explains why" 'semua state.db gagal dibuka' "$status"
kill "$pid" 2>/dev/null

echo
echo "--- one good DB + one corrupt DB: still 200, counts visible ---"
rm -rf /tmp/hmix; cp -r /tmp/hh /tmp/hmix
printf 'broken' > /tmp/hmix/profiles/coder/state.db
pid=$(run "$OUT/6b.log" 8219 HERMES_HOME=/tmp/hmix)
wait_up 8219
health=$(curl -s localhost:8219/api/health)
check "mixed health is 200" '"ok":true' "$health"
check "mixed health shows 1 error" '"dbs_err":1' "$health"
check "status is 200 and carries the counts" '"dbs_err":1' "$(curl -s localhost:8219/api/status)"
kill "$pid" 2>/dev/null

echo
echo "=============================================================="
echo "7. static assets: SPA fallback only for navigation, 404 + cache + gzip"
echo "=============================================================="
WEB=/tmp/webroot; rm -rf "$WEB"; mkdir -p "$WEB/assets"
printf '<!doctype html><title>office</title>' > "$WEB/index.html"
python3 - "$WEB/assets/index-abc123.js" <<'PY'
import sys
open(sys.argv[1], 'w').write("console.log('office')\n" + ("// pad\n" * 400))
PY
pid=$(run "$OUT/7.log" 8220 HERMES_HOME=/tmp/hh WEB_DIR="$WEB")
wait_up 8220

code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: text/html' localhost:8220/assets/missing-deadbeef.js)
if [ "$code" = "404" ]; then ok "missing /assets/*.js is 404 even with Accept: text/html"; else bad "missing asset = $code, want 404"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: text/html' localhost:8220/deep/link?face=dev)
if [ "$code" = "200" ]; then ok "client route falls back to index.html"; else bad "client route = $code"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: application/json' localhost:8220/deep/link)
if [ "$code" = "404" ]; then ok "non-navigation request does not get the SPA"; else bad "non-HTML route = $code, want 404"; fi

hdrs=$(curl -s -D- -o /dev/null localhost:8220/assets/index-abc123.js)
check "hashed asset is immutable" 'Cache-Control: public, max-age=31536000, immutable' "$hdrs"
check "hashed asset is gzipped" 'Content-Encoding: gzip' "$(curl -s -D- -o /dev/null -H 'Accept-Encoding: gzip' localhost:8220/assets/index-abc123.js)"
check "Vary: Accept-Encoding" 'Vary: Accept-Encoding' "$(curl -s -D- -o /dev/null -H 'Accept-Encoding: gzip' localhost:8220/assets/index-abc123.js)"
check "index.html is revalidated" 'Cache-Control: no-cache' "$(curl -s -D- -o /dev/null -H 'Accept: text/html' localhost:8220/)"
raw=$(curl -s -H 'Accept-Encoding: gzip' localhost:8220/assets/index-abc123.js | gunzip | head -c 21)
check "gzip body decompresses to the file" "console.log('office')" "$raw"
kill "$pid" 2>/dev/null

echo
echo "=============================================================="
echo "8. federation to an instance without /api/config"
echo "=============================================================="
cat >"$OUT/8up.py" <<'PY'
import http.server, json, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/status':
            body = json.dumps({"now": 1800000000, "gateway": {"state": "running"},
                               "agents": [{"id": "dev", "status": "working"}, {"id": "edu", "status": "idle"}],
                               "feed": [], "tasks": [], "comms": []}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', 8221), H).serve_forever()
PY
python3 "$OUT/8up.py" >"$OUT/8up.log" 2>&1 & up=$!
sleep 0.6
pid=$(run "$OUT/8.log" 8222 OFFICE_SOURCE=remote REMOTE_API_URL=http://127.0.0.1:8221)
wait_up 8222
cfg=$(curl -s localhost:8222/api/config)
check "roster falls back to /api/status agents" '"id":"dev"' "$cfg"
check "fallback still names the agent from the seed" '"name":"Bima"' "$cfg"
check "fallback keeps the edu agent" '"id":"edu"' "$cfg"
check "fallback is logged" 'upstream_config_fallback' "$(cat "$OUT/8.log")"
kill "$pid" 2>/dev/null
kill "$up" 2>/dev/null

echo
echo "=============================================================="
printf 'RESULT: %d ok, %d FAIL\n' "$pass" "$fail"
echo "=============================================================="
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
