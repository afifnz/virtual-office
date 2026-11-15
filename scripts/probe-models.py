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

WHOLE CATALOGUE — two phases, not one sweep of everything
  The public catalogue carries hundreds of ids, and the three-stage probe costs
  ~7 requests per model. Probing all of them in one go is thousands of requests
  and hours of wall clock, most of it spent on models that cannot call a tool at
  all. So the probe runs in two phases, and both are resumable:

    phase 1  --from-catalog --stage 1   one cheap T1 request per model
             writes --jsonl; kill it whenever, rerun with --resume
    phase 2  --stage all on the ids that passed phase 1 (--from-jsonl PATH)

  --stage 1 is a smoke test: it asks only "can this model emit a function call at
  all?" and sends exactly one request per model (no latency repeats, no T2/T3).
  --stage 2 / all is the full behaviour above and stays the default.

  --from-catalog    GET {PROBE_BASE_URL}/models (OpenAI shape: {"data":[{"id":…}]})
                    and probe every id as-is; --filter / --exclude are regexes
                    (re.search) applied in that order.
  --concurrency N   N models in flight (default 4, max 16). The table is still
                    printed in catalogue order — only the network work overlaps.
  --jsonl PATH      one JSON line per finished model, appended and flushed
                    immediately, so a killed run keeps everything it finished.
  --resume          skip ids already present in --jsonl (unless --retry-failed).
  --summary-json    status counts (pass/fail/skipped/model_not_found/timeout/
                    http_error) as JSON.

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
      PROBE_BASE_URL=… PROBE_API_KEY=$KEY \\
          python3 scripts/probe-models.py --from-catalog --stage 1 \\
              --concurrency 4 --jsonl /tmp/probe-all.jsonl

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
from concurrent.futures import ThreadPoolExecutor
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


def _retry_after_seconds(value):
    """Retry-After is seconds or an HTTP date; only the numeric form is used."""
    if value is None:
        return None
    try:
        return max(0.0, float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def parse_catalog_ids(raw: str, status: int = 200) -> list:
    """`{"data":[{"id":…}]}` (the [OI] shape) — also tolerates a bare list."""
    try:
        body = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        raise RouterError(
            "bad_response",
            "GET /models returned non-JSON body: %s" % snippet(raw, 240),
            status=status,
            raw=raw,
        )
    entries = body.get("data") if isinstance(body, dict) else body
    if not isinstance(entries, list):
        raise RouterError(
            "bad_response",
            "GET /models has no 'data' list: %s" % snippet(raw, 240),
            status=status,
            raw=raw,
        )
    ids, seen = [], set()
    for entry in entries:
        model_id = entry.get("id") if isinstance(entry, dict) else entry
        if not isinstance(model_id, str) or not model_id.strip():
            continue
        model_id = model_id.strip()
        if model_id not in seen:
            seen.add(model_id)
            ids.append(model_id)
    if not ids:
        raise RouterError(
            "bad_response",
            "GET /models listed no usable ids: %s" % snippet(raw, 240),
            status=status,
            raw=raw,
        )
    return ids


def select_models(ids: list, include=None, exclude=None) -> list:
    """--filter / --exclude are regexes (re.search), applied in that order."""
    selected = list(ids)
    if include:
        selected = [m for m in selected if re.search(include, m)]
    if exclude:
        selected = [m for m in selected if not re.search(exclude, m)]
    return selected


class Client:
    def __init__(self, base_url: str, api_key: str, timeout: float, retries: int, retry_delay: float = 1.0):
        self.base_url = base_url.rstrip("/")
        self.endpoint = self.base_url + "/chat/completions"
        self.catalog_endpoint = self.base_url + "/models"
        self.api_key = api_key
        self.timeout = timeout
        self.retries = max(0, retries)
        self.retry_delay = max(0.0, retry_delay)

    # -- headers ---------------------------------------------------------- #
    def _headers(self) -> dict:
        headers = {
            "Accept": "application/json",
            "User-Agent": "probe-models/1.1",
        }
        if self.api_key:  # never logged, never put in a URL
            headers["Authorization"] = "Bearer " + self.api_key
        return headers

    # -- 429 / 5xx backoff ------------------------------------------------ #
    def _backoff(self, attempt: int, retry_after=None) -> float:
        """Exponential backoff with jitter, and never shorter than Retry-After.

        Hundreds of sequential requests will hit a rate limit; hammering the
        router on a fixed 0.7s sleep just burns the retry budget, so the wait
        doubles per attempt (capped) and honours the provider's own Retry-After.
        """
        delay = self.retry_delay * (2 ** (attempt - 1))
        delay = min(delay, 60.0) + random.uniform(0.0, 0.1) * delay
        header_delay = _retry_after_seconds(retry_after)
        if header_delay is not None:
            delay = max(delay, min(header_delay, 120.0))
        return delay

    def catalog(self) -> list:
        """GET /models and return the ids as the router spells them."""
        req = urllib.request.Request(self.catalog_endpoint, headers=self._headers(), method="GET")
        attempts = self.retries + 1
        for attempt in range(1, attempts + 1):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read().decode("utf-8", "replace")
                    status = resp.status
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", "replace")
                status = exc.code
                if (status in (408, 409, 429) or status >= 500) and attempt < attempts:
                    time.sleep(self._backoff(attempt, exc.headers.get("Retry-After") if exc.headers else None))
                    continue
                err = parse_error_body(raw)
                raise RouterError(
                    "http_error",
                    "GET /models failed: %s" % (err.get("message") or "HTTP %s" % status),
                    status=status,
                    err_type=err.get("type"),
                    err_code=err.get("code"),
                    raw=raw,
                )
            except (urllib.error.URLError, socket.timeout, TimeoutError, OSError) as exc:
                if attempt < attempts:
                    time.sleep(self._backoff(attempt))
                    continue
                reason = getattr(exc, "reason", exc)
                timed_out = isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason).lower()
                raise RouterError(
                    "timeout" if timed_out else "connection",
                    "GET /models %s: %s" % ("timed out" if timed_out else "failed", snippet(reason, 200)),
                    raw=str(reason),
                )
            return parse_catalog_ids(raw, status)

    def chat(self, model: str, messages: list, tools: list | None = None, max_tokens: int = 512):
        payload = {"model": model, "messages": messages, "max_tokens": max_tokens}
        if tools:
            payload["tools"] = tools
        return self._post(payload)

    def _post(self, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        headers = self._headers()
        headers["Content-Type"] = "application/json"
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
                    time.sleep(self._backoff(attempt, exc.headers.get("Retry-After") if exc.headers else None))
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
                if attempt < attempts:
                    time.sleep(self._backoff(attempt))
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
                    time.sleep(self._backoff(attempt))
                    continue
                last_error = RouterError("timeout", "request timed out after %.1fs" % self.timeout)
                raise last_error
            except OSError as exc:  # connection reset, DNS, TLS …
                elapsed = (time.perf_counter() - started) * 1000.0
                if attempt < attempts:
                    time.sleep(self._backoff(attempt))
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


def probe_model(client: Client, model: str, max_tokens: int = 512, stage: int = 2) -> dict:
    record = {
        "model": model,
        "stage": stage,
        "proven": model in PROVEN_MODELS,
        "tests": {},
        "verdicts": {},
        "latency_ms": {"t1_samples": [], "t1_median": None},
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "available": False},
        "passed": False,
        "note": "",
    }

    t1_messages = [
        {"role": "system", "content": "Use tools when the task needs a file."},
        {"role": "user", "content": "Read /etc/hostname with read_file."},
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

    # ---- stage 1: smoke only, one request per model ---------------------- #
    if stage == 1:
        for name in ("T2", "T3"):
            record["tests"][name] = {
                "passed": False,
                "detail": "not attempted: --stage 1 (smoke = T1 only)",
                "skipped": True,
            }
            record["verdicts"][name] = "SKIP"
        record["passed"] = bool(t1["passed"])
        if not record["passed"]:
            record["note"] = t1.get("detail", "")[:80] or "T1 failed"
        return record

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
# Catalogue sweep: status counts, crash-safe JSONL, bounded concurrency
# --------------------------------------------------------------------------- #

# Fixed order so the summary is diffable between runs.
STATUS_ORDER = ["pass", "fail", "skipped", "model_not_found", "timeout", "http_error"]
_EXTRA_STATUSES = ["bad_response", "connection"]


def record_status(record: dict) -> str:
    """One word per model: pass / fail / skipped / model_not_found / timeout / http_error."""
    if record.get("skipped_this_run"):
        return "skipped"
    if record.get("passed"):
        return "pass"
    for name in ("T1", "T2", "T3"):
        test = record.get("tests", {}).get(name) or {}
        if test.get("skipped"):
            continue
        if test.get("passed") is False:
            kind = (test.get("error") or {}).get("kind")
            if kind in ("model_not_found", "timeout", "http_error", "connection", "bad_response"):
                return kind
            return "fail"
    return "fail"


def summarize(records: list) -> dict:
    counts = {name: 0 for name in STATUS_ORDER}
    for record in records:
        status = record_status(record)
        counts[status] = counts.get(status, 0) + 1
    for name in _EXTRA_STATUSES:  # only shown when non-zero, but always ordered
        if not counts.get(name):
            counts.pop(name, None)
    return {"total": len(records), "by_status": counts}


def should_skip(prior_record, wanted_stage: int, retry_failed: bool) -> bool:
    """Resume rule: a prior line only counts if it already covers the wanted stage."""
    if not prior_record:
        return False
    if int(prior_record.get("stage") or 2) < wanted_stage:
        return False
    if retry_failed and not prior_record.get("passed"):
        return False
    return True


class JsonlSink:
    """Append-only JSONL: one flushed line per finished model, guarded by a lock.

    The flush is what makes the file useful after Ctrl-C or a killed container;
    the lock is what keeps 16 worker threads from interleaving half a line.
    """

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.handle = None
        if path:
            self.handle = open(path, "a", encoding="utf-8")

    def write(self, record: dict) -> None:
        if self.handle is None:
            return
        line = scrub(json.dumps(record, ensure_ascii=False))
        with self.lock:
            self.handle.write(line + "\n")
            self.handle.flush()
            try:
                os.fsync(self.handle.fileno())
            except OSError:
                pass

    def close(self) -> None:
        if self.handle is not None:
            try:
                self.handle.close()
            except OSError:
                pass
            self.handle = None


def load_jsonl(path: str):
    """Read a previous --jsonl file into {model: last record}. Tolerates a torn tail."""
    records, bad = {}, 0
    if not path or not os.path.exists(path):
        return records, bad
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    bad += 1  # a half-written last line after a kill
                    continue
                if isinstance(record, dict) and record.get("model"):
                    records[record["model"]] = record  # later line wins
                else:
                    bad += 1
    except OSError:
        return {}, 0
    return records, bad


def run_sweep(client, models, args, sink, prior, out=None) -> list:
    """Probe `models` with bounded concurrency; results keep catalogue order."""
    out = out or sys.stdout  # resolved at call time, so redirect_stdout works
    records = [None] * len(models)
    todo = []
    for index, model in enumerate(models):
        previous = prior.get(model)
        if should_skip(previous, args.stage_effective, args.retry_failed):
            record = dict(previous)
            record["skipped_this_run"] = True
            record["note"] = "skipped: already in --jsonl"
            records[index] = record
        else:
            todo.append((index, model))

    def work(model: str) -> dict:
        try:
            record = probe_model(client, model, max_tokens=args.max_tokens, stage=args.stage_effective)
        except Exception as exc:  # one broken model must not kill a 300-model sweep
            record = {
                "model": model,
                "stage": args.stage_effective,
                "proven": model in PROVEN_MODELS,
                "tests": {},
                "verdicts": {},
                "latency_ms": {"t1_samples": [], "t1_median": None},
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "available": False},
                "passed": False,
                "note": "probe crashed: %s: %s" % (exc.__class__.__name__, snippet(exc, 160)),
            }
        sink.write(record)
        return record

    def show(record: dict) -> None:
        print("  probed %-52s %s  [%s]" % (
            record["model"],
            "/".join(verdict(record, name) for name in ("T1", "T2", "T3")),
            record_status(record),
        ), file=out)

    if args.concurrency <= 1 or len(todo) <= 1:
        for index, model in todo:
            records[index] = work(model)
            show(records[index])
    else:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = [(index, pool.submit(work, model)) for index, model in todo]
            # Iterate in submission order, not as_completed: the network work
            # overlaps, but every printed line and every table row stays in
            # catalogue order, so two runs are diffable.
            for index, future in futures:
                records[index] = future.result()
                show(records[index])
    return [record for record in records if record is not None]


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
    counts = summarize(records)
    # "passed" counts models that passed in THIS run; a resumed model is
    # "skipped", not a fresh pass, so the counts never inflate a report.
    passed = counts["by_status"].get("pass", 0)
    passed_all = sum(
        1 for r in records if all(r["verdicts"].get(t) == "PASS" for t in ("T1", "T2", "T3"))
    )
    return {
        "schema": 2,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "base_url": scrub(base_url),
        "auth_header_sent": bool(args.api_key),
        "stage": args.stage_effective,
        "from_catalog": bool(getattr(args, "from_catalog", False)),
        "concurrency": getattr(args, "concurrency", 1),
        "timeout_s": args.timeout,
        "retry": args.retry,
        "models": records,
        "summary": {
            "models": len(records),
            "passed": passed,
            "passed_all_three": passed_all,
            "failed": counts["by_status"].get("fail", 0)
            + counts["by_status"].get("model_not_found", 0)
            + counts["by_status"].get("timeout", 0)
            + counts["by_status"].get("http_error", 0)
            + counts["by_status"].get("connection", 0)
            + counts["by_status"].get("bad_response", 0),
            "skipped": counts["by_status"].get("skipped", 0),
            "by_status": counts["by_status"],
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

# A 20-model catalogue behind /models, mixed on purpose: the sweep has to keep
# working when most of a real catalogue is unusable.
_MOCK_CATALOG = [
    ("mock/cat-01", "ok"),
    ("mock/cat-02", "ok"),
    ("mock/cat-03", "ok"),
    ("mock/cat-04", "ok"),
    ("mock/cat-05", "ok"),
    ("mock/cat-06", "ok"),
    ("mock/cat-07", "ok_no_usage"),
    ("mock/cat-08", "plain"),          # no tool calls at all
    ("mock/cat-09", "plain"),
    ("mock/cat-10", "ignores"),        # calls tools, then ignores the result
    ("mock/cat-11", "ignores"),
    ("mock/cat-12", "slow"),           # sleeps past --timeout
    ("mock/cat-13", "server_error"),   # 500 every time
    ("mock/cat-14", "flaky"),          # 500 once, then fine
    ("mock/cat-15", "rate_limited"),   # 429 twice, then fine
    ("mock/cat-16", "not_found"),      # absent from the router
    ("mock/cat-17", "not_found"),
    ("mock/cat-18", "not_found"),
    ("mock/cat-19", "ok"),
    ("mock/cat-20", "ok"),
]
_CATALOG_MODES = {model: mode for model, mode in _MOCK_CATALOG}
_MOCK_LOCK = threading.Lock()
_MOCK_HITS: dict = {}
_MOCK_CATALOG_HITS = [0]


def _mock_reset_hits() -> None:
    with _MOCK_LOCK:
        _MOCK_HITS.clear()
        _MOCK_CATALOG_HITS[0] = 0


def _mock_total_hits() -> int:
    with _MOCK_LOCK:
        return sum(_MOCK_HITS.values())


def _mock_hits_for(model: str) -> int:
    with _MOCK_LOCK:
        return _MOCK_HITS.get(model, 0)


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

    def _send(self, status: int, payload: dict, headers=None) -> None:
        raw = json.dumps(payload).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            for name, value in (headers or {}).items():
                self.send_header(name, str(value))
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the probe already timed out and hung up; expected in slow mode

    def do_GET(self):
        route = self.path.split("?")[0].rstrip("/")
        if route.endswith("/stats"):  # self-test only: lets the harness count real requests
            with _MOCK_LOCK:
                payload = {"catalog_gets": _MOCK_CATALOG_HITS[0], "chat_posts": sum(_MOCK_HITS.values()),
                           "per_model": dict(_MOCK_HITS)}
            self._send(200, payload)
            return
        if not route.endswith("/models"):
            self._send(404, {"error": {"message": "no such route (mock)", "type": "invalid_request_error"}})
            return
        with _MOCK_LOCK:
            _MOCK_CATALOG_HITS[0] += 1
        if getattr(self.server, "catalog_error", None):
            self._send(500, {"error": {"message": "catalogue unavailable (mock)", "type": "server_error"}})
            return
        self._send(
            200,
            {
                "object": "list",
                "data": [{"id": model, "object": "model", "owned_by": "mock"} for model, _ in _MOCK_CATALOG],
            },
        )

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace") if length else "{}"
        try:
            request = json.loads(raw)
        except json.JSONDecodeError:
            request = {}
        model = str(request.get("model") or "")
        mode = _MOCK_MODES.get(model) or _CATALOG_MODES.get(model)
        hits = _mock_count(model)

        if not self.path.rstrip("/").endswith("/chat/completions") or mode in (None, "not_found"):
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
        if mode == "rate_limited" and hits <= 2:
            self._send(
                429,
                {"error": {"message": "rate limit exceeded (mock)", "type": "rate_limit_error", "code": "rate_limited"}},
                headers={"Retry-After": "0"},
            )
            return
        if mode == "slow":
            time.sleep(2.0)
        elif mode == "ok" and model.startswith("mock/cat-"):
            time.sleep(0.15)  # enough delay that concurrency visibly wins
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


def _table_rows(output: str) -> list:
    """(model, T1, T2, T3) rows in printed order — latency/token columns vary per run."""
    rows, in_table = [], False
    for line in output.splitlines():
        if line.startswith("model ") and " T1 " in line:
            in_table = True
            continue
        if in_table:
            if not line.strip() or set(line.strip()) <= {"-"}:
                continue
            fields = line.split()
            if len(fields) < 4 or any(f not in ("PASS", "FAIL", "SKIP") for f in fields[1:4]):
                break  # end of the table: the "* single attempt" note or Details
            rows.append(tuple(fields[:4]))
    return rows


def _probed_order(output: str) -> list:
    return [line.split()[1] for line in output.splitlines() if line.startswith("  probed ")]


def run_catalog_self_test(base_url: str, server=None) -> bool:
    """Prove --from-catalog, --filter/--exclude, --stage, --concurrency, --jsonl/--resume.

    Counters on the mock are the evidence: an exact request count before/after a
    resume is the only way to show that models were really skipped, not just
    printed as skipped.
    """
    import contextlib
    import io
    import tempfile

    key = "mock-key-not-a-secret"
    os.environ["PROBE_API_KEY"] = key
    register_secret(key)
    checks = []

    def check(label, condition, detail=""):
        checks.append((label, bool(condition), detail))

    def run(argv):
        buffer, err_buffer = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(err_buffer):
            code = main(["--base-url", base_url, "--timeout", "0.75"] + argv)
        return code, buffer.getvalue() + err_buffer.getvalue()

    tmpdir = tempfile.mkdtemp(prefix="probe-selftest-")
    catalog_ids = [model for model, _ in _MOCK_CATALOG]

    print("\ncatalog checks (mock /models: %d ids)" % len(catalog_ids))
    print("=" * 62)

    # ---- 1. --from-catalog + --filter, stage 1 = exactly one request/model -- #
    _mock_reset_hits()
    path_a = os.path.join(tmpdir, "a.jsonl")
    code, out = run(["--from-catalog", "--filter", r"cat-0[1-4]$", "--stage", "1",
                     "--concurrency", "1", "--retry", "0", "--jsonl", path_a])
    hits_a = _mock_total_hits()
    lines_a = [json.loads(line) for line in open(path_a, encoding="utf-8") if line.strip()]
    check("--from-catalog read /models once", _MOCK_CATALOG_HITS[0] == 1, "GET count %d" % _MOCK_CATALOG_HITS[0])
    check("--filter kept 4 of 20 ids", len(lines_a) == 4, "%d rows" % len(lines_a))
    check("stage 1 = 1 request per model", hits_a == 4, "%d POST for 4 models" % hits_a)
    check("stage 1 marks T2/T3 SKIP", all(r["verdicts"]["T2"] == "SKIP" and r["verdicts"]["T3"] == "SKIP" for r in lines_a))
    check("jsonl records carry stage=1", all(r.get("stage") == 1 for r in lines_a))
    check("stage 1 exit 0 when T1 passes", code == 0, "exit %d" % code)
    check("no key in jsonl", key not in open(path_a, encoding="utf-8").read())

    # ---- 2. --exclude ---------------------------------------------------- #
    _mock_reset_hits()
    path_b = os.path.join(tmpdir, "b.jsonl")
    run(["--from-catalog", "--filter", "^mock/", "--exclude", r"cat-(0[5-9]|1[0-9]|20)$",
         "--stage", "1", "--concurrency", "1", "--retry", "0", "--jsonl", path_b])
    models_b = [json.loads(line)["model"] for line in open(path_b, encoding="utf-8") if line.strip()]
    check("--exclude dropped 16 of 20", models_b == ["mock/cat-01", "mock/cat-02", "mock/cat-03", "mock/cat-04"],
          ",".join(models_b))
    check("--exclude sent 4 requests", _mock_total_hits() == 4, "%d POST" % _mock_total_hits())

    # ---- 3. stage 1 vs stage 2 cost -------------------------------------- #
    _mock_reset_hits()
    run(["--models", "mock/cat-01", "--stage", "1", "--concurrency", "1", "--retry", "0"])
    stage1_hits = _mock_total_hits()
    _mock_reset_hits()
    code2, out2 = run(["--models", "mock/cat-01", "--stage", "2", "--concurrency", "1", "--retry", "0"])
    stage2_hits = _mock_total_hits()
    check("stage 1 costs 1 request", stage1_hits == 1, "%d POST" % stage1_hits)
    check("stage 2/all costs 5 requests", stage2_hits == 5 and code2 == 0, "%d POST, exit %d" % (stage2_hits, code2))
    check("stage 2 row shows PASS/PASS/PASS", _table_rows(out2) == [("mock/cat-01", "PASS", "PASS", "PASS")])

    # ---- 4. a T1 failure never reaches T2/T3 ----------------------------- #
    _mock_reset_hits()
    run(["--models", "mock/cat-08", "--stage", "1", "--concurrency", "1", "--retry", "0"])
    check("plain-text model: 1 request, T2/T3 skipped", _mock_total_hits() == 1, "%d POST" % _mock_total_hits())

    # ---- 5. determinism: concurrency 1 vs 4, same table order ------------ #
    _mock_reset_hits()
    started = time.perf_counter()
    code1, out_c1 = run(["--from-catalog", "--stage", "1", "--concurrency", "1", "--retry", "0"])
    elapsed_c1 = time.perf_counter() - started
    _mock_reset_hits()
    started = time.perf_counter()
    code4, out_c4 = run(["--from-catalog", "--stage", "1", "--concurrency", "4", "--retry", "0"])
    elapsed_c4 = time.perf_counter() - started
    rows_c1, rows_c4 = _table_rows(out_c1), _table_rows(out_c4)
    check("same table order c=1 vs c=4", rows_c1 == rows_c4 and len(rows_c4) == 20,
          "%d vs %d rows" % (len(rows_c1), len(rows_c4)))
    check("table order = catalogue order", [r[0] for r in rows_c4] == catalog_ids)
    check("same exit code c=1 vs c=4", code1 == code4 == 1, "%d vs %d" % (code1, code4))
    check("no interleaved progress lines", _probed_order(out_c4) == catalog_ids)
    check("concurrency 4 is faster than 1", elapsed_c4 < elapsed_c1,
          "%.2fs vs %.2fs" % (elapsed_c4, elapsed_c1))

    # ---- 6. 20 models at concurrency 16: one valid line per model -------- #
    _mock_reset_hits()
    path_c = os.path.join(tmpdir, "c.jsonl")
    run(["--from-catalog", "--stage", "1", "--concurrency", "16", "--retry", "0", "--jsonl", path_c])
    raw_lines = [line for line in open(path_c, encoding="utf-8") if line.strip()]
    parsed, torn = [], 0
    for line in raw_lines:
        try:
            parsed.append(json.loads(line))
        except json.JSONDecodeError:
            torn += 1
    check("20 parallel models -> 20 parsable lines", len(parsed) == 20 and torn == 0,
          "%d lines, %d torn" % (len(parsed), torn))
    check("no duplicate/missing model in jsonl", sorted(r["model"] for r in parsed) == sorted(catalog_ids))

    # ---- 7. --jsonl + --resume: skipped models send no request ----------- #
    _mock_reset_hits()
    path_r = os.path.join(tmpdir, "r.jsonl")
    run(["--from-catalog", "--filter", r"cat-0[1-6]$", "--stage", "1", "--concurrency", "4",
         "--retry", "0", "--jsonl", path_r])
    hits_before = _mock_total_hits()
    code_r, out_r = run(["--from-catalog", "--stage", "1", "--concurrency", "4", "--retry", "0",
                         "--jsonl", path_r, "--resume"])
    hits_after = _mock_total_hits()
    resumed = [json.loads(line) for line in open(path_r, encoding="utf-8") if line.strip()]
    check("resume prefilled 6 models", hits_before == 6, "%d POST" % hits_before)
    check("resume probed only the other 14", hits_after - hits_before == 14, "%d POST" % (hits_after - hits_before))
    check("resume leaves 20 lines in jsonl", len(resumed) == 20, "%d lines" % len(resumed))
    check("resume marks 6 as skipped", re.search(r"^\s+skipped\s+6$", out_r, re.M) is not None,
          "summary block")

    # ---- 8. --resume --retry-failed re-probes exactly the failures ------- #
    _mock_reset_hits()
    _, out_rf = run(["--from-catalog", "--stage", "1", "--concurrency", "4", "--retry", "0",
                     "--jsonl", path_r, "--resume", "--retry-failed"])
    failed_hits = _mock_total_hits()
    appended = [line for line in open(path_r, encoding="utf-8") if line.strip()]
    check("--retry-failed re-probed only failures", failed_hits == 9, "%d POST" % failed_hits)
    check("--retry-failed appended only those 9 lines", len(appended) == 29, "%d lines total" % len(appended))

    # ---- 9. 429 backoff with --retry ------------------------------------- #
    _mock_reset_hits()
    code_429, _ = run(["--models", "mock/cat-15", "--stage", "1", "--concurrency", "1",
                       "--retry", "2", "--retry-delay", "0.01"])
    check("429 retried until success", code_429 == 0 and _mock_hits_for("mock/cat-15") == 3,
          "exit %d, %d POST" % (code_429, _mock_hits_for("mock/cat-15")))
    _mock_reset_hits()
    code_nr, out_nr = run(["--models", "mock/cat-15", "--stage", "1", "--concurrency", "1", "--retry", "0"])
    check("429 without retry reported as http_error", code_nr == 1 and "[http_error]" in out_nr, "exit %d" % code_nr)

    # ---- 10. --summary-json counts --------------------------------------- #
    path_s = os.path.join(tmpdir, "summary.json")
    run(["--from-catalog", "--stage", "1", "--concurrency", "4", "--retry", "0", "--summary-json", path_s])
    summary = json.load(open(path_s, encoding="utf-8"))
    by_status = summary["summary"]["by_status"]
    check("summary-json has the six required statuses",
          all(name in by_status for name in ("pass", "fail", "skipped", "model_not_found", "timeout", "http_error")),
          json.dumps(by_status))
    check("summary-json counts add up", sum(by_status.values()) == 20, json.dumps(by_status))
    check("summary-json classifies every failure kind",
          by_status.get("pass") == 11 and by_status.get("fail") == 2 and by_status.get("timeout") == 1
          and by_status.get("http_error") == 3 and by_status.get("model_not_found") == 3,
          json.dumps(by_status))

    # ---- 11. torn tail + catalogue failure -------------------------------- #
    torn_path = os.path.join(tmpdir, "torn.jsonl")
    with open(torn_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps({"model": "mock/x", "stage": 1, "passed": True}) + "\n")
        handle.write('{"model": "mock/y", "stage": 1, "pa')
    loaded, bad = load_jsonl(torn_path)
    check("torn tail ignored, good line kept", bad == 1 and list(loaded) == ["mock/x"], "%d bad" % bad)

    # ---- 12. a broken catalogue fails loudly, it does not probe nothing --- #
    if server is not None:
        server.catalog_error = True
        try:
            code_bad, out_bad = run(["--from-catalog", "--stage", "1"])
        finally:
            server.catalog_error = False
        check("broken /models -> exit 2, no silent empty run",
              code_bad == 2 and "cannot read the catalog" in out_bad, "exit %d" % code_bad)

    # ---- 13. argument guards --------------------------------------------- #
    for argv, label in (
        (["--concurrency", "17"], "concurrency > 16 rejected"),
        (["--resume"], "--resume without --jsonl rejected"),
        (["--filter", "("], "invalid regex rejected"),
    ):
        try:
            with contextlib.redirect_stderr(io.StringIO()):
                parse_args(argv)
            check(label, False, "accepted")
        except SystemExit:
            check(label, True)

    print()
    ok = True
    for label, passed, detail in checks:
        ok = ok and passed
        print("  %-46s %s%s" % (label, "OK" if passed else "FAIL", "  (%s)" % detail if detail and not passed else ""))
    print("  %-46s %s" % ("catalog checks", "PASS" if ok else "FAIL"))
    return ok


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
    catalog_ok = run_catalog_self_test(base_url, server)
    ok = ok and catalog_ok

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
        description="Probe function calling on candidate models behind an [OI]-compatible router.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  PROBE_BASE_URL=http://127.0.0.1:20128/v1 PROBE_API_KEY=$KEY \\\n"
            "      python3 scripts/probe-models.py\n"
            "  PROBE_BASE_URL=... PROBE_API_KEY=$KEY \\\n"
            "      python3 scripts/probe-models.py --models inferhub/kimi-k2.5 --json /tmp/probe.json\n"
            "  # phase 1 — smoke the whole catalogue, resumable:\n"
            "  PROBE_BASE_URL=... PROBE_API_KEY=$KEY \\\n"
            "      python3 scripts/probe-models.py --from-catalog --stage 1 \\\n"
            "          --concurrency 4 --jsonl /tmp/probe-all.jsonl\n"
            "  # phase 2 — full T1+T2+T3 on the ids that passed phase 1:\n"
            "  PROBE_BASE_URL=... PROBE_API_KEY=$KEY \\\n"
            "      python3 scripts/probe-models.py --from-jsonl /tmp/probe-all.jsonl \\\n"
            "          --stage all --concurrency 4 --jsonl /tmp/probe-full.jsonl --resume\n"
            "  python3 scripts/probe-models.py --self-test    # no router needed\n\n"
            "model ids: only inferhub/deepseek-v4.1-flash and inferhub/deepseek-v4-pro are known\n"
            "to resolve. The other defaults are guesses at <router>/<prefix>/<model> and a wrong\n"
            "guess is reported as model_not_found, never retried into a fake pass.\n"
        ),
    )
    parser.add_argument("models", nargs="*", help="model ids to probe (adds to --models)")
    parser.add_argument("--models", dest="models_opt", nargs="+", default=None, metavar="ID", help="model ids to probe")
    parser.add_argument("--from-catalog", dest="from_catalog", action="store_true",
                        help="probe every id in GET {PROBE_BASE_URL}/models")
    parser.add_argument("--from-jsonl", dest="from_jsonl", default=None, metavar="PATH",
                        help="probe only the models that PASSED in a previous --jsonl file (phase 2)")
    parser.add_argument("--filter", default=None, metavar="REGEX",
                        help="keep only ids matching REGEX (re.search), applied to --from-catalog/--from-jsonl/--models")
    parser.add_argument("--exclude", default=None, metavar="REGEX", help="drop ids matching REGEX (applied after --filter)")
    parser.add_argument("--stage", choices=("1", "2", "all"), default="all",
                        help="1 = T1 smoke only, one request per model; 2/all = full T1+T2+T3 (default)")
    parser.add_argument("--concurrency", type=int, default=4, metavar="N",
                        help="models in flight at once, 1..16 (default 4); the table stays in catalogue order")
    parser.add_argument("--jsonl", dest="jsonl_path", default=None, metavar="PATH",
                        help="append one JSON line per finished model (flushed immediately)")
    parser.add_argument("--resume", action="store_true",
                        help="with --jsonl: skip models already recorded there (needs --jsonl)")
    parser.add_argument("--retry-failed", action="store_true",
                        help="with --resume: re-probe models whose recorded run did not pass")
    parser.add_argument("--summary-json", dest="summary_json", default=None, metavar="PATH",
                        help="write status counts (pass/fail/skipped/model_not_found/timeout/http_error) as JSON")
    parser.add_argument("--base-url", default=None, help="override PROBE_BASE_URL")
    parser.add_argument("--json", dest="json_path", default=None, metavar="PATH", help="write results as JSON")
    parser.add_argument("--timeout", type=float, default=60.0, help="per-request timeout in seconds (default 60)")
    parser.add_argument("--retry", type=int, default=1, help="retries on timeout/5xx/429 (default 1)")
    parser.add_argument("--retry-delay", dest="retry_delay", type=float, default=1.0,
                        help="base seconds for exponential backoff on 429/5xx (default 1.0, doubles per attempt)")
    parser.add_argument("--max-tokens", type=int, default=256,
                        help="max_tokens per request (default 256: the probe only needs a tool call, not prose)")
    parser.add_argument("--self-test", action="store_true", help="run the probe against an in-process mock and exit")
    args = parser.parse_args(argv)
    if not 1 <= args.concurrency <= 16:
        parser.error("--concurrency must be between 1 and 16")
    if not args.retry_delay >= 0:
        parser.error("--retry-delay must be >= 0")
    if args.resume and not args.jsonl_path:
        parser.error("--resume needs --jsonl PATH to know what has already been done")
    if args.retry_failed and not args.jsonl_path:
        parser.error("--retry-failed needs --jsonl PATH")
    for label, pattern in (("--filter", args.filter), ("--exclude", args.exclude)):
        if pattern is not None:
            try:
                re.compile(pattern)
            except re.error as exc:
                parser.error("%s is not a valid regex: %s" % (label, exc))
    args.stage_effective = 1 if args.stage == "1" else 2
    return args


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

    client = Client(base_url, api_key, timeout=args.timeout, retries=args.retry, retry_delay=args.retry_delay)
    shown_url = re.sub(r"//[^/@]+@", "//", base_url)

    # ---- where do the ids come from? ------------------------------------- #
    explicit = list(args.models or []) + list(args.models_opt or [])
    if args.from_catalog or args.from_jsonl:
        try:
            if args.from_catalog:
                ids = client.catalog()
                print("catalog: %d ids from %s/models" % (len(ids), shown_url))
            else:
                prior_records, bad_lines = load_jsonl(args.from_jsonl)
                if not prior_records:
                    print("error: %s holds no usable records" % args.from_jsonl, file=sys.stderr)
                    return 2
                ids = [m for m, r in prior_records.items() if r.get("passed")]
                print("catalog: %d/%d ids passed in %s%s"
                      % (len(ids), len(prior_records), args.from_jsonl,
                         "  (%d unreadable line(s) ignored)" % bad_lines if bad_lines else ""))
                if not ids:
                    print("error: no model passed in %s — nothing to probe" % args.from_jsonl, file=sys.stderr)
                    return 2
        except RouterError as exc:
            err = exc.as_dict()
            print("error: cannot read the catalog: %s (%s)" % (err["error"]["message"], err["kind"]), file=sys.stderr)
            if err.get("raw"):
                print("       raw: %s" % err["raw"], file=sys.stderr)
            return 2
        models = select_models(ids, args.filter, args.exclude)
        models += [m for m in explicit if m not in models]
    else:
        models = select_models(explicit or list(DEFAULT_MODELS), args.filter, args.exclude)

    if not models:
        print("error: the selection is empty (check --filter / --exclude)", file=sys.stderr)
        return 2

    # ---- resume state ---------------------------------------------------- #
    prior, bad_lines = load_jsonl(args.jsonl_path) if args.jsonl_path else ({}, 0)
    if prior and not (args.resume or args.retry_failed):
        print("note: %s already holds %d model(s); pass --resume to skip them" % (args.jsonl_path, len(prior)))

    print("probe: %s" % shown_url)
    print("auth:  %s" % ("bearer (hidden)" if api_key else "no Authorization header"))
    if not api_key:
        print("warning: PROBE_API_KEY is empty — requests go out unauthenticated; a router that needs a key will answer 401", file=sys.stderr)
    print("models: %d · stage %s · concurrency %d · timeout %.0fs · retry %d × %.1fs\n"
          % (len(models), args.stage_effective, args.concurrency, args.timeout, args.retry, args.retry_delay))

    try:
        sink = JsonlSink(args.jsonl_path)
    except OSError as exc:
        print("error: cannot open %s: %s" % (args.jsonl_path, exc), file=sys.stderr)
        return 2

    started = time.perf_counter()
    try:
        records = run_sweep(client, models, args, sink, prior)
    finally:
        sink.close()
    elapsed = time.perf_counter() - started

    print()
    print(render_table(records))
    if any(not r["latency_ms"]["t1_median"] and r["latency_ms"]["t1_samples"] for r in records):
        print("\n* single attempt (latency not repeated at --stage 1, or T1 did not pass)")
    print_details(records)

    counts = summarize(records)
    passed = counts["by_status"].get("pass", 0)
    skipped = counts["by_status"].get("skipped", 0)
    print("\nsummary (%.1fs)" % elapsed)
    print("=======")
    print("  %-16s %d" % ("total", counts["total"]))
    for status in STATUS_ORDER + _EXTRA_STATUSES:
        value = counts["by_status"].get(status)
        if value:
            print("  %-16s %d" % (status, value))

    print("\n%d/%d probed models passed %s%s"
          % (passed, len(records) - skipped, "T1" if args.stage_effective == 1 else "T1+T2+T3",
             "  (%d skipped from --jsonl)" % skipped if skipped else ""))
    if passed != len(records) - skipped:
        print("do not switch a profile to a model that did not pass every stage it was given.")
        for record in records:
            if record_status(record) not in ("pass", "skipped"):
                print("  - %s: %s [%s]" % (
                    record["model"],
                    "/".join(verdict(record, n) for n in ("T1", "T2", "T3")),
                    record_status(record),
                ))

    report = build_report(records, args, shown_url)
    if args.summary_json:
        try:
            summary = {
                "schema": 1,
                "generated_at": report["generated_at"],
                "base_url": report["base_url"],
                "stage": args.stage_effective,
                "from_catalog": bool(args.from_catalog),
                "concurrency": args.concurrency,
                "elapsed_s": round(elapsed, 1),
                "jsonl": args.jsonl_path,
                "resumed_from_jsonl": bool(prior) and (args.resume or args.retry_failed),
                "summary": report["summary"],
            }
            with open(args.summary_json, "w", encoding="utf-8") as handle:
                json.dump(json.loads(scrub(json.dumps(summary))), handle, indent=2)
                handle.write("\n")
        except OSError as exc:
            print("error: cannot write %s: %s" % (args.summary_json, exc), file=sys.stderr)
            return 2
        print("summary-json: %s" % args.summary_json)

    if args.json_path:
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
