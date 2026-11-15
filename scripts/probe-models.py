#!/usr/bin/env python3
"""probe-models.py — verify function calling before an agent profile switches model.

The catalogue lists price and context, never tool support. A model that cannot call
tools is not a cheaper agent, it is a broken one, so every candidate is probed here
before it is written into a profile.

Three stages per model, all against an OpenAI-compatible endpoint:

  T1  single tool call      read_file(path) must come back with a valid name + args.
  T2  two tools, chained    the second call must use the value found in the first
                            tool result (/srv/team-alpha), not an invented path.
  T3  tool-result fidelity  a random token (ZZ-NNNN) delivered only inside a tool
                            message must be echoed verbatim; catches models that
                            ignore the result and hallucinate.

Latency is the median of three T1 attempts when T1 passes; token usage is summed
over the requests that actually ran. Failures keep the raw HTTP status and the
provider's error.type / error.message instead of collapsing to "failed".

MODEL IDS — CONFIRM BEFORE USE
  Only two ids are known to resolve through 9router today:
      inferhub/deepseek-v4.1-flash
      inferhub/deepseek-v4-pro
  The rest are guesses at the shape <router>/<prefix>/<model>. A wrong guess is
  reported here as model_not_found with the provider's own message, never retried
  and never rewritten into something that looks like it worked. Confirm each id in
  the live catalogue (`curl <base>/models`) before putting it in a profile.

CREDENTIALS
  Base URL and key come from the environment only; nothing is hard-coded and the
  key is scrubbed from stdout, stderr and --json output.
      PROBE_BASE_URL=http://127.0.0.1:20128/v1 PROBE_API_KEY=$KEY \\
          python3 scripts/probe-models.py --models inferhub/kimi-k2.5

  With PROBE_API_KEY unset the request goes out without an Authorization header
  (routers that trust loopback accept this) and a warning is printed.

EXIT CODES
  0  every probed model passed T1, T2 and T3
  1  at least one model failed or was skipped
  2  bad usage / missing PROBE_BASE_URL

Stdlib only, Python 3.9+.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import socket
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_MODELS = [
    # proven to resolve today — the control group
    "inferhub/deepseek-v4.1-flash",
    "inferhub/deepseek-v4-pro",
    # candidates, id shape unconfirmed
    "inferhub/ag/gemini-3.8-flash-high",
    "inferhub/gpt-6.1-terra",
    "inferhub/kimi-k2.5",
    "inferhub/zai/glm-5.3-flash",
    "inferhub/grok-4.7",
]
PROVEN_MODELS = {"inferhub/deepseek-v4.1-flash", "inferhub/deepseek-v4-pro"}

# The value the second tool call must reuse, delivered inside T2's tool message.
T2_EXPECTED_PATH = "/srv/team-alpha"

_SECRETS: list[str] = []


def scrub(text: str) -> str:
    """Remove any registered secret from a string that is about to be printed."""
    if not text:
        return ""
    for secret in _SECRETS:
        if secret:
            text = text.replace(secret, "***")
    return text


def register_secret(value: str) -> None:
    if value and value not in _SECRETS:
        _SECRETS.append(value)


def snippet(value, limit: int = 160) -> str:
    text = "" if value is None else str(value)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


# --------------------------------------------------------------------------- #
# Tools offered to the model (deliberately minimal: one string argument each)
# --------------------------------------------------------------------------- #

_TOOL_LIBRARY = {
    "read_file": {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a UTF-8 text file from disk and return its contents.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path of the file."}
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    },
    "list_dir": {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List the entries of a directory on disk.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path of the directory."}
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    },
}


def tool_specs(*names: str) -> list:
    return [_TOOL_LIBRARY[name] for name in names]


# --------------------------------------------------------------------------- #
# Transport
# --------------------------------------------------------------------------- #


class RouterError(Exception):
    """A request that never produced a usable completion."""

    def __init__(self, kind, message, status=None, err_type=None, err_code=None, raw=None):
        super().__init__(message)
        self.kind = kind               # timeout | connection | http_error | model_not_found | bad_response
        self.message = message
        self.status = status
        self.err_type = err_type
        self.err_code = err_code
        self.raw = raw

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "http_status": self.status,
            "error": {
                "type": scrub(self.err_type or ""),
                "code": scrub(self.err_code or ""),
                "message": scrub(self.message or ""),
            },
            "raw": scrub(snippet(self.raw, 600)),
        }


def parse_error_body(raw: str):
    """Pull OpenAI's {error:{type,code,message}} out of a body; fall back to the text."""
    try:
        body = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"type": None, "code": None, "message": snippet(raw, 300)}
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            return {
                "type": err.get("type"),
                "code": err.get("code")
                or (err.get("status") if isinstance(err.get("status"), str) else None),
                "message": err.get("message") or json.dumps(err)[:300],
            }
        if isinstance(err, str):
            return {"type": None, "code": None, "message": err}
        if body.get("message"):
            return {"type": body.get("type"), "code": body.get("code"), "message": body["message"]}
    return {"type": None, "code": None, "message": snippet(raw, 300)}


def looks_like_model_not_found(status, err) -> bool:
    text = " ".join(str(x or "") for x in (err.get("type"), err.get("code"), err.get("message"))).lower()
    if "model_not_found" in text or "model not found" in text or "does not exist" in text:
        return True
    if status == 404 and "model" in text:
        return True
    return False


class Client:
    def __init__(self, base_url: str, api_key: str, timeout: float, retries: int):
        self.base_url = base_url.rstrip("/")
        self.endpoint = self.base_url + "/chat/completions"
        self.api_key = api_key
        self.timeout = timeout
        self.retries = max(0, retries)

    def chat(self, model: str, messages: list, tools: list | None = None, max_tokens: int = 512):
        payload = {"model": model, "messages": messages, "max_tokens": max_tokens}
        if tools:
            payload["tools"] = tools
        return self._post(payload)

    def _post(self, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "probe-models/1.0",
        }
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        attempts = self.retries + 1
        last_error = None

        for attempt in range(1, attempts + 1):
            started = time.perf_counter()
            req = urllib.request.Request(self.endpoint, data=data, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read().decode("utf-8", "replace")
                    elapsed = (time.perf_counter() - started) * 1000.0
                    status = resp.status
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", "replace")
                elapsed = (time.perf_counter() - started) * 1000.0
                status = exc.code
                err = parse_error_body(raw)
                retryable = status in (408, 409, 429) or status >= 500
                if retryable and attempt < attempts:
                    time.sleep(min(2.0, 0.7 * attempt))
                    continue
                kind = "model_not_found" if looks_like_model_not_found(status, err) else "http_error"
                last_error = RouterError(
                    kind,
                    err.get("message") or "HTTP %s %s" % (status, getattr(exc, "reason", "")),
                    status=status,
                    err_type=err.get("type"),
                    err_code=err.get("code"),
                    raw=raw,
                )
                raise last_error
            except urllib.error.URLError as exc:
                elapsed = (time.perf_counter() - started) * 1000.0
                reason = exc.reason
                timed_out = isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason).lower()
                retryable = True
                if attempt < attempts:
                    time.sleep(min(2.0, 0.7 * attempt))
                    continue
                last_error = RouterError(
                    "timeout" if timed_out else "connection",
                    "request timed out after %.1fs" % self.timeout
                    if timed_out
                    else "connection failed: %s" % snippet(reason, 200),
                    raw=str(reason),
                )
                raise last_error
            except (socket.timeout, TimeoutError):
                elapsed = (time.perf_counter() - started) * 1000.0
                if attempt < attempts:
                    time.sleep(min(2.0, 0.7 * attempt))
                    continue
                last_error = RouterError("timeout", "request timed out after %.1fs" % self.timeout)
                raise last_error
            except OSError as exc:  # connection reset, DNS, TLS …
                elapsed = (time.perf_counter() - started) * 1000.0
                if attempt < attempts:
                    time.sleep(min(2.0, 0.7 * attempt))
                    continue
                last_error = RouterError(
                    "connection", "connection failed: %s: %s" % (exc.__class__.__name__, snippet(exc, 200))
                )
                raise last_error

            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                raise RouterError(
                    "bad_response",
                    "HTTP %s returned non-JSON body: %s" % (status, snippet(raw, 240)),
                    status=status,
                    raw=raw,
                )

            if isinstance(body, dict) and isinstance(body.get("error"), dict) and not body.get("choices"):
                err = parse_error_body(raw)
                raise RouterError(
                    "http_error",
                    err.get("message") or "provider returned an error object",
                    status=status,
                    err_type=err.get("type"),
                    err_code=err.get("code"),
                    raw=raw,
                )

            return body, elapsed, status

        raise last_error or RouterError("connection", "request failed without an error object")


# --------------------------------------------------------------------------- #
# Response inspection
# --------------------------------------------------------------------------- #


def first_message(body):
    choices = body.get("choices") if isinstance(body, dict) else None
    if not isinstance(choices, list) or not choices:
        return None
    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
    return msg if isinstance(msg, dict) else None


def extract_tool_calls(message) -> list:
    calls = []
    for index, tc in enumerate(message.get("tool_calls") or []):
        fn = tc.get("function") or {}
        raw_args = fn.get("arguments")
        args, arg_error = None, None
        if isinstance(raw_args, dict):
            args = raw_args
        else:
            try:
                parsed = json.loads(raw_args if isinstance(raw_args, str) else "")
                if isinstance(parsed, dict):
                    args = parsed
                else:
                    arg_error = "arguments is not a JSON object: %s" % snippet(raw_args, 160)
            except (json.JSONDecodeError, TypeError) as exc:
                arg_error = "arguments is not valid JSON (%s): %s" % (
                    exc.__class__.__name__,
                    snippet(raw_args, 160),
                )
        calls.append(
            {
                "id": tc.get("id") or "call_%d" % index,
                "name": fn.get("name") or "",
                "arguments_raw": raw_args if isinstance(raw_args, str) else json.dumps(raw_args),
                "arguments": args,
                "arguments_error": arg_error,
            }
        )
    return calls


def message_text(message) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # some routers return content parts
        parts = [p.get("text", "") for p in content if isinstance(p, dict)]
        return "".join(parts)
    return ""


def tool_test(body, status, latency_ms) -> dict:
    message = first_message(body)
    if message is None:
        detail = "response has no choices[0].message: %s" % snippet(json.dumps(body)[:400], 240)
        return {"passed": False, "detail": detail, "http_status": status,
                "latency_ms": round(latency_ms, 1), "usage": body.get("usage")}
    return {
        "passed": None,
        "detail": "",
        "http_status": status,
        "latency_ms": round(latency_ms, 1),
        "content": snippet(message_text(message), 300),
        "tool_calls": extract_tool_calls(message),
        "usage": body.get("usage"),
    }


def evaluate_t1(result: dict) -> dict:
    calls = result.get("tool_calls") or []
    if not calls:
        result["passed"] = False
        result["detail"] = "no tool_calls; model answered in text: %r" % (result.get("content") or "")
        return result
    call = next((c for c in calls if c["name"] == "read_file"), None)
    if call is None:
        result["passed"] = False
        result["detail"] = "tool_calls present but none named read_file: %s" % [c["name"] for c in calls]
        return result
    if call["arguments"] is None:
        result["passed"] = False
        result["detail"] = call["arguments_error"] or "read_file arguments are not a JSON object"
        return result
    path = call["arguments"].get("path")
    if not isinstance(path, str) or not path.strip():
        result["passed"] = False
        result["detail"] = "read_file called without a usable 'path': %s" % snippet(call["arguments_raw"], 160)
        return result
    result["passed"] = True
    if path.strip() != "/etc/hostname":
        result["detail"] = "called read_file with path=%r (prompt named /etc/hostname)" % path
    else:
        result["detail"] = "read_file(path=%r)" % path
    return result


def evaluate_t2(result: dict) -> dict:
    calls = result.get("tool_calls") or []
    if not calls:
        result["passed"] = False
        result["detail"] = "no tool_calls; model answered in text instead: %r" % (result.get("content") or "")
        return result
    call = next((c for c in calls if c["name"] == "list_dir"), None)
    if call is None:
        result["passed"] = False
        result["detail"] = "called %s instead of list_dir" % [c["name"] for c in calls]
        return result
    if call["arguments"] is None:
        result["passed"] = False
        result["detail"] = call["arguments_error"] or "list_dir arguments are not a JSON object"
        return result
    path = call["arguments"].get("path")
    normalized = (path or "").rstrip("/") if isinstance(path, str) else None
    if normalized != T2_EXPECTED_PATH:
        result["passed"] = False
        result["detail"] = (
            "list_dir(path=%r) does not reuse the value from the tool result (expected %s) — result ignored"
            % (path, T2_EXPECTED_PATH)
        )
        return result
    result["passed"] = True
    result["detail"] = "list_dir(path=%r) reused the first tool result" % T2_EXPECTED_PATH
    return result


def evaluate_t3(result: dict, token: str) -> dict:
    text = result.get("content") or ""
    if token in text:
        result["passed"] = True
        result["detail"] = "echoed %s from the tool message" % token
        return result
    result["passed"] = False
    calls = result.get("tool_calls") or []
    if calls and not text:
        result["detail"] = "answered with another tool_call (%s) instead of reporting the token" % [c["name"] for c in calls]
    else:
        result["detail"] = "token %s absent from the answer — tool result ignored/hallucinated: %r" % (token, text)
    return result


def failed_result(error: RouterError) -> dict:
    payload = error.as_dict()
    return {
        "passed": False,
        "detail": "%s: %s" % (error.kind, snippet(error.message, 200)),
        "http_status": error.status,
        "latency_ms": None,
        "error": payload,
    }


# --------------------------------------------------------------------------- #
# Per-model probe
# --------------------------------------------------------------------------- #


def probe_model(client: Client, model: str, max_tokens: int = 512) -> dict:
    record = {
        "model": model,
        "proven": model in PROVEN_MODELS,
        "tests": {},
        "verdicts": {},
        "latency_ms": {"t1_samples": [], "t1_median": None},
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "available": False},
        "passed": False,
        "note": "",
    }

    t1_messages = [
        {"role": "system", "content": "You are a tool-using agent. Use the provided tools whenever a task needs file access."},
        {"role": "user", "content": "Baca berkas /etc/hostname dengan tool read_file, lalu sebutkan isinya dalam satu baris."},
    ]

    # ---- T1 ------------------------------------------------------------- #
    try:
        body, latency, status = client.chat(model, t1_messages, tools=tool_specs("read_file"), max_tokens=max_tokens)
    except RouterError as exc:
        record["tests"]["T1"] = failed_result(exc)
        record["verdicts"]["T1"] = "FAIL"
        for name in ("T2", "T3"):
            record["tests"][name] = {
                "passed": False,
                "detail": "not attempted: T1 ended with %s" % exc.kind,
                "skipped": True,
            }
            record["verdicts"][name] = "SKIP"
        record["note"] = "T1 %s — remaining tests skipped" % exc.kind
        return record

    t1 = evaluate_t1(tool_test(body, status, latency))
    record["tests"]["T1"] = t1
    record["verdicts"]["T1"] = "PASS" if t1["passed"] else "FAIL"
    record["latency_ms"]["t1_samples"].append(t1["latency_ms"])
    _accumulate_usage(record, body)

    if t1["passed"]:
        for _ in range(2):  # median of three, only for a model that answers T1
            try:
                body2, latency2, status2 = client.chat(
                    model, t1_messages, tools=tool_specs("read_file"), max_tokens=max_tokens
                )
            except RouterError as exc:
                record["note"] = "latency repeats failed: %s" % exc.kind
                break
            record["latency_ms"]["t1_samples"].append(round(latency2, 1))
        samples = record["latency_ms"]["t1_samples"]
        if len(samples) > 1:
            record["latency_ms"]["t1_median"] = round(statistics.median(samples), 1)
        else:
            record["note"] = (record["note"] + "; " if record["note"] else "") + "latency from a single attempt"

    # ---- T2: reuse the first result, not an invented path ---------------- #
    t1_call = next((c for c in (t1.get("tool_calls") or []) if c["name"] == "read_file"), None)
    if t1_call and t1_call["arguments"]:
        call_id = t1_call["id"]
        read_args = t1_call["arguments_raw"]
    else:
        call_id = "call_probe_t1"
        read_args = json.dumps({"path": "/etc/hostname"})

    t2_messages = [
        {"role": "system", "content": "You are a tool-using agent. Use the provided tools and the tool results you are given."},
        {"role": "user", "content": "Baca berkas /etc/hostname dengan tool read_file."},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": "read_file", "arguments": read_args},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": call_id,
            "name": "read_file",
            "content": "office-node-07\nROOT=%s\nstatus: mounted\n" % T2_EXPECTED_PATH,
        },
        {
            "role": "user",
            "content": (
                "Isi berkas di atas memuat baris ROOT=<path>. Panggil list_dir TEPAT pada path ROOT tersebut. "
                "Jangan mengarang path lain dan jangan menjawab tanpa memanggil tool."
            ),
        },
    ]

    try:
        body, latency, status = client.chat(model, t2_messages, tools=tool_specs("read_file", "list_dir"), max_tokens=max_tokens)
        t2 = evaluate_t2(tool_test(body, status, latency))
        _accumulate_usage(record, body)
    except RouterError as exc:
        t2 = failed_result(exc)
    record["tests"]["T2"] = t2
    record["verdicts"]["T2"] = "PASS" if t2["passed"] else "FAIL"

    # ---- T3: echo a random token that only exists in a tool message ------ #
    token = "ZZ-%04d" % random.randint(0, 9999)
    t3_messages = [
        {"role": "system", "content": "You are a tool-using agent. Report tool results exactly as given."},
        {"role": "user", "content": "Baca /etc/probe-token dengan read_file."},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_probe_t3",
                    "type": "function",
                    "function": {"name": "read_file", "arguments": json.dumps({"path": "/etc/probe-token"})},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_probe_t3",
            "name": "read_file",
            "content": "PROBE-ID=%s\n(salin nilai ini apa adanya)\n" % token,
        },
        {"role": "user", "content": "Sebutkan nilai PROBE-ID dari hasil tool di atas, persis apa adanya, tanpa penjelasan."},
    ]

    try:
        body, latency, status = client.chat(model, t3_messages, tools=tool_specs("read_file"), max_tokens=max_tokens)
        t3 = evaluate_t3(tool_test(body, status, latency), token)
        _accumulate_usage(record, body)
    except RouterError as exc:
        t3 = failed_result(exc)
    t3["token"] = token
    record["tests"]["T3"] = t3
    record["verdicts"]["T3"] = "PASS" if t3["passed"] else "FAIL"

    record["passed"] = all(record["verdicts"].get(t) == "PASS" for t in ("T1", "T2", "T3"))
    return record


def _accumulate_usage(record: dict, body) -> None:
    usage = body.get("usage") if isinstance(body, dict) else None
    if not isinstance(usage, dict):
        return
    prompt = usage.get("prompt_tokens")
    completion = usage.get("completion_tokens")
    if isinstance(prompt, int) or isinstance(completion, int):
        record["usage"]["prompt_tokens"] += prompt if isinstance(prompt, int) else 0
        record["usage"]["completion_tokens"] += completion if isinstance(completion, int) else 0
        record["usage"]["available"] = True


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #


def verdict(record: dict, name: str) -> str:
    return record["verdicts"].get(name, "-")


def _fmt_ms(value) -> str:
    if value is None:
        return "-"
    return "%.0f" % value if value >= 10 else "%.1f" % value


def render_table(records: list) -> str:
    header = ("model", "T1", "T2", "T3", "lat(ms)", "tok in/out", "note")
    rows = []
    for record in records:
        lat = record["latency_ms"]["t1_median"]
        if lat is None and record["latency_ms"]["t1_samples"]:
            lat_text = _fmt_ms(record["latency_ms"]["t1_samples"][0]) + "*"
        elif lat is None:
            lat_text = "-"
        else:
            lat_text = _fmt_ms(lat)
        usage = record["usage"]
        tok_text = "%d/%d" % (usage["prompt_tokens"], usage["completion_tokens"]) if usage["available"] else "-"
        note = record["note"]
        if not note and record["tests"].get("T1", {}).get("passed") is False:
            note = record["tests"]["T1"].get("detail", "")[:48]
        if record["passed"]:
            note = note or "ok"
        elif not note:
            failed = [t for t in ("T1", "T2", "T3") if record["verdicts"].get(t) == "FAIL"]
            note = "failed: " + ",".join(failed)
        rows.append(
            (record["model"], verdict(record, "T1"), verdict(record, "T2"), verdict(record, "T3"), lat_text, tok_text, scrub(note))
        )

    model_w = max([len(header[0])] + [len(r[0]) for r in rows])
    tok_w = max([len(header[5])] + [len(r[5]) for r in rows])
    note_w = 46
    fmt = "%-{mw}s  %-4s  %-4s  %-4s  %7s  %-{tw}s  %s".format(mw=model_w, tw=tok_w)
    lines = [fmt % header]
    lines.append("-" * len(fmt % header))
    for row in rows:
        note = row[6] if len(row[6]) <= note_w else row[6][: note_w - 1] + "…"
        lines.append(fmt % (row[0], row[1], row[2], row[3], row[4], row[5], note))
    return "\n".join(lines)


def print_details(records: list) -> None:
    failed = [r for r in records if not r["passed"]]
    if not failed:
        return
    print("\nDetails")
    print("=======")
    for record in failed:
        marker = "" if record["proven"] or record["model"].startswith("mock/") else "   [candidate id — confirm it resolves]"
        print("\n%s%s" % (record["model"], marker))
        for name in ("T1", "T2", "T3"):
            test = record["tests"].get(name)
            if not test:
                continue
            status = "SKIP" if test.get("skipped") else ("PASS" if test.get("passed") else "FAIL")
            if status == "PASS":
                continue
            if test.get("error"):
                err = test["error"]
                print("  %s %s  http=%s  kind=%s" % (name, status, err.get("http_status"), err.get("kind")))
                error = err.get("error") or {}
                print("      error.type:    %s" % (error.get("type") or "-"))
                print("      error.code:    %s" % (error.get("code") or "-"))
                print("      error.message: %s" % (error.get("message") or "-"))
                if err.get("raw") and err.get("raw") != error.get("message"):
                    print("      raw body:      %s" % snippet(err["raw"], 300))
                if err.get("kind") == "model_not_found":
                    print("      → the id does not resolve on this router; confirm its exact form before use")
                elif err.get("kind") == "timeout":
                    print("      → no answer within --timeout; raise it or probe a cheaper model")
            else:
                print("  %s %s  %s" % (name, status, scrub(test.get("detail") or "")))
                if test.get("content") and name != "T1":
                    print("      answer: %s" % snippet(test["content"], 200))
        samples = record["latency_ms"]["t1_samples"]
        if samples:
            median = record["latency_ms"]["t1_median"]
            print("  latency T1 samples: %s ms%s"
                  % (", ".join("%.0f" % s for s in samples), "  (median %d ms)" % median if median else "  (single attempt)"))


def build_report(records: list, args, base_url: str) -> dict:
    passed = sum(1 for r in records if r["passed"])
    return {
        "schema": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "base_url": scrub(base_url),
        "auth_header_sent": bool(args.api_key),
        "timeout_s": args.timeout,
        "retry": args.retry,
        "models": records,
        "summary": {
            "models": len(records),
            "passed_all_three": passed,
            "failed": len(records) - passed,
            "exit_code": 0 if passed == len(records) else 1,
        },
    }


# --------------------------------------------------------------------------- #
# Self-test: an OpenAI-compatible mock, so the probe can be proven without a router
# --------------------------------------------------------------------------- #

_MOCK_MODES = {
    "mock/ok": "ok",
    "mock/ok-no-usage": "ok_no_usage",
    "mock/plain-text": "plain",
    "mock/ignores-tool-result": "ignores",
    "mock/slow": "slow",
    "mock/server-error": "server_error",
    "mock/flaky": "flaky",  # 500 on the first request, correct afterwards
}
_MOCK_LOCK = threading.Lock()
_MOCK_HITS: dict = {}


def _mock_count(model: str) -> int:
    with _MOCK_LOCK:
        _MOCK_HITS[model] = _MOCK_HITS.get(model, 0) + 1
        return _MOCK_HITS[model]


def _mock_usage(messages) -> dict:
    return {"prompt_tokens": 90 + 11 * len(messages), "completion_tokens": 22, "total_tokens": 90 + 11 * len(messages) + 22}


def _mock_tool_response(name: str, args: dict, usage) -> dict:
    body = {
        "id": "chatcmpl-mock",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "mock",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {"id": "call_mock_1", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
    }
    if usage:
        body["usage"] = usage
    return body


def _mock_text_response(text: str, usage) -> dict:
    body = {
        "id": "chatcmpl-mock",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "mock",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
    }
    if usage:
        body["usage"] = usage
    return body


def _mock_payload(mode: str, request: dict) -> dict:
    messages = request.get("messages") or []
    usage = None if mode == "ok_no_usage" else _mock_usage(messages)
    tool_messages = [m for m in messages if isinstance(m, dict) and m.get("role") == "tool"]

    if mode == "plain":
        # a model that cannot call tools at all: text every time, never the token
        return _mock_text_response(
            "I cannot execute tools here. /etc/hostname most likely contains 'localhost'.", usage
        )

    if tool_messages:
        content = str(tool_messages[-1].get("content") or "")
        if "ROOT=" in content:
            path = "/srv/unknown" if mode == "ignores" else T2_EXPECTED_PATH
            return _mock_tool_response("list_dir", {"path": path}, usage)
        match = re.search(r"(ZZ-\d+)", content)
        if match:
            value = "ZZ-0000" if mode == "ignores" else match.group(1)
            return _mock_text_response("PROBE-ID = %s" % value, usage)

    return _mock_tool_response("read_file", {"path": "/etc/hostname"}, usage)


class _MockHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep the self-test output clean
        return

    def _send(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the probe already timed out and hung up; expected in slow mode

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace") if length else "{}"
        try:
            request = json.loads(raw)
        except json.JSONDecodeError:
            request = {}
        model = str(request.get("model") or "")
        mode = _MOCK_MODES.get(model)
        hits = _mock_count(model)

        if not self.path.rstrip("/").endswith("/chat/completions") or mode is None:
            self._send(
                404,
                {
                    "error": {
                        "message": "model '%s' not found (mock)" % model,
                        "type": "invalid_request_error",
                        "code": "model_not_found",
                    }
                },
            )
            return
        if mode == "slow":
            time.sleep(2.0)
        if mode == "server_error" or (mode == "flaky" and hits == 1):
            self._send(
                500,
                {"error": {"message": "upstream exploded (mock)", "type": "server_error", "code": "internal_error"}},
            )
            return
        self._send(200, _mock_payload(mode, request))


class _MockServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return  # client gave up on the slow mode; not a self-test failure
        super().handle_error(request, client_address)


def run_self_test() -> int:
    server = _MockServer(("127.0.0.1", 0), _MockHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    base_url = "http://127.0.0.1:%d/v1" % port

    expected = [
        ("mock/ok", ("PASS", "PASS", "PASS")),
        ("mock/ok-no-usage", ("PASS", "PASS", "PASS")),
        ("mock/plain-text", ("FAIL", "FAIL", "FAIL")),
        ("mock/ignores-tool-result", ("PASS", "FAIL", "FAIL")),
        ("mock/model-not-found", ("FAIL", "SKIP", "SKIP")),
        ("mock/slow", ("FAIL", "SKIP", "SKIP")),
        ("mock/server-error", ("FAIL", "SKIP", "SKIP")),
    ]
    print("self-test: mock OpenAI-compatible server on %s" % base_url)
    print("self-test: timeout=0.75s retry=0 (the slow mode sleeps 2s)\n")

    client = Client(base_url, "mock-key-not-a-secret", timeout=0.75, retries=0)
    records = []
    ok = True
    for model, want in expected:
        record = probe_model(client, model)
        records.append(record)
        got = tuple(verdict(record, name) for name in ("T1", "T2", "T3"))
        if got != want:
            ok = False
        print("%-26s expect %-20s got %-20s %s" % (model, "/".join(want), "/".join(got), "OK" if got == want else "MISMATCH"))

    # Retry path: first request 500s, a single retry must turn it green.
    retry_client = Client(base_url, "mock-key-not-a-secret", timeout=0.75, retries=1)
    flaky = probe_model(retry_client, "mock/flaky")
    retry_ok = flaky["passed"]
    ok = ok and retry_ok
    print("%-26s expect %-20s got %-20s %s"
          % ("mock/flaky (retry=1)", "PASS/PASS/PASS",
             "/".join(verdict(flaky, n) for n in ("T1", "T2", "T3")), "OK" if retry_ok else "MISMATCH"))

    print()
    print(render_table(records))
    print_details(records)

    # Prove the three failure signals actually carry provider detail.
    nf = next(r for r in records if r["model"] == "mock/model-not-found")["tests"]["T1"]
    checks = [
        ("model_not_found classified", nf.get("error", {}).get("kind") == "model_not_found"),
        ("model_not_found keeps error.message", "not found" in (nf.get("error", {}).get("error", {}).get("message") or "")),
        ("timeout classified", next(r for r in records if r["model"] == "mock/slow")["tests"]["T1"].get("error", {}).get("kind") == "timeout"),
        ("http 500 reported with status", next(r for r in records if r["model"] == "mock/server-error")["tests"]["T1"].get("error", {}).get("http_status") == 500),
        ("plain-text rejected at T1", not next(r for r in records if r["model"] == "mock/plain-text")["tests"]["T1"]["passed"]),
        ("ignored result rejected at T3", not next(r for r in records if r["model"] == "mock/ignores-tool-result")["tests"]["T3"]["passed"]),
        ("no key leaked", all("mock-key-not-a-secret" not in json.dumps(r) for r in records)),
    ]
    print("\nchecks")
    for label, result in checks:
        print("  %-38s %s" % (label, "OK" if result else "FAIL"))
        ok = ok and result
    print("\nself-test: %s" % ("PASS" if ok else "FAIL"))
    server.shutdown()
    return 0 if ok else 1


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Probe function calling on candidate models behind an OpenAI-compatible router.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  PROBE_BASE_URL=http://127.0.0.1:20128/v1 PROBE_API_KEY=$KEY \\\n"
            "      python3 scripts/probe-models.py\n"
            "  PROBE_BASE_URL=... PROBE_API_KEY=$KEY \\\n"
            "      python3 scripts/probe-models.py --models inferhub/kimi-k2.5 --json /tmp/probe.json\n"
            "  python3 scripts/probe-models.py --self-test    # no router needed\n\n"
            "model ids: only inferhub/deepseek-v4.1-flash and inferhub/deepseek-v4-pro are known\n"
            "to resolve. The other defaults are guesses at <router>/<prefix>/<model> and a wrong\n"
            "guess is reported as model_not_found, never retried into a fake pass.\n"
        ),
    )
    parser.add_argument("models", nargs="*", help="model ids to probe (adds to --models)")
    parser.add_argument("--models", dest="models_opt", nargs="+", default=None, metavar="ID", help="model ids to probe")
    parser.add_argument("--base-url", default=None, help="override PROBE_BASE_URL")
    parser.add_argument("--json", dest="json_path", default=None, metavar="PATH", help="write results as JSON")
    parser.add_argument("--timeout", type=float, default=60.0, help="per-request timeout in seconds (default 60)")
    parser.add_argument("--retry", type=int, default=1, help="retries on timeout/5xx/429 (default 1)")
    parser.add_argument("--max-tokens", type=int, default=512, help="max_tokens per request (default 512)")
    parser.add_argument("--self-test", action="store_true", help="run the probe against an in-process mock and exit")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    if args.self_test:
        return run_self_test()

    base_url = (args.base_url or os.environ.get("PROBE_BASE_URL") or "").strip()
    if not base_url:
        print("error: PROBE_BASE_URL is not set (e.g. http://127.0.0.1:20128/v1)", file=sys.stderr)
        return 2
    if not re.match(r"^https?://", base_url):
        print("error: PROBE_BASE_URL must be an absolute http(s) URL, got %r" % base_url, file=sys.stderr)
        return 2

    api_key = (os.environ.get("PROBE_API_KEY") or "").strip()
    args.api_key = api_key
    register_secret(api_key)

    models = list(args.models or []) + list(args.models_opt or [])
    if not models:
        models = list(DEFAULT_MODELS)

    client = Client(base_url, api_key, timeout=args.timeout, retries=args.retry)

    shown_url = re.sub(r"//[^/@]+@", "//", base_url)
    print("probe: %s" % shown_url)
    print("auth:  %s" % ("bearer (hidden)" if api_key else "no Authorization header"))
    if not api_key:
        print("warning: PROBE_API_KEY is empty — requests go out unauthenticated; a router that needs a key will answer 401", file=sys.stderr)
    print("models: %d · timeout %.0fs · retry %d\n" % (len(models), args.timeout, args.retry))

    records = []
    for model in models:
        record = probe_model(client, model, max_tokens=args.max_tokens)
        records.append(record)
        print("  probed %-38s %s" % (model, "/".join(verdict(record, n) for n in ("T1", "T2", "T3"))))

    print()
    print(render_table(records))
    if any(not r["latency_ms"]["t1_median"] and r["latency_ms"]["t1_samples"] for r in records):
        print("\n* single attempt (T1 did not pass, so latency was not repeated)")
    print_details(records)

    passed = sum(1 for r in records if r["passed"])
    print("\n%d/%d models passed T1+T2+T3" % (passed, len(records)))
    if passed != len(records):
        print("do not switch a profile to a model that did not pass all three.")
        for record in records:
            if not record["passed"]:
                print("  - %s: %s" % (record["model"], "/".join(verdict(record, n) for n in ("T1", "T2", "T3"))))

    if args.json_path:
        report = build_report(records, args, shown_url)
        try:
            with open(args.json_path, "w", encoding="utf-8") as handle:
                json.dump(json.loads(scrub(json.dumps(report))), handle, indent=2)
                handle.write("\n")
        except OSError as exc:
            print("error: cannot write %s: %s" % (args.json_path, exc), file=sys.stderr)
            return 2
        print("json: %s" % args.json_path)

    return 0 if passed == len(records) else 1


if __name__ == "__main__":
    sys.exit(main())
