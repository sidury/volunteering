#!/usr/bin/env python3
"""vol_api - local HTTP API for Volunteer Planner.

Listens on 127.0.0.1 inside the container, behind nginx at /api/. There is no login, because the
app is for one student on one device, so these checks stop other websites from reaching it:
  - Host must be a local name (blocks DNS rebinding)
  - Origin and Sec-Fetch-Site, when sent, must be same-origin
  - writes need the X-VOL-Request header, which a cross-site page can't send without a preflight
    that this server never approves. There are no CORS headers.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vol_store as store  # noqa: E402
from vol_store import StoreError  # noqa: E402

BIND_ADDRESS = "127.0.0.1"
MAX_JSON_BYTES = 64 * 1024
MAX_CSV_BYTES = 1024 * 1024
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
LOCK = threading.RLock()


def hostname_of(host: str) -> str:
    host = host.strip().lower()
    return host.split("]")[0] + "]" if host.startswith("[") else host.split(":")[0]


class Request:
    def __init__(self, handler: "Handler", params: dict[str, str], query: dict[str, list[str]]) -> None:
        self.handler = handler
        self.query = query
        self.id = int(params["id"]) if "id" in params else 0

    def q(self, key: str) -> str | None:
        values = self.query.get(key)
        return values[0] if values else None

    def body_bytes(self, limit: int) -> bytes:
        raw = self.handler.headers.get("Content-Length")
        if raw is None or not raw.isdigit():
            raise StoreError(411, "a request size is required")
        if int(raw) > limit:
            raise StoreError(413, "that is larger than the limit")
        return self.handler.rfile.read(int(raw))

    def json(self) -> dict:
        data = self.body_bytes(MAX_JSON_BYTES)
        kind = (self.handler.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if kind != "application/json":
            raise StoreError(415, "expected JSON")
        try:
            value = json.loads(data or b"{}")
        except (ValueError, UnicodeDecodeError) as e:
            raise StoreError(400, "that is not valid JSON") from e
        if not isinstance(value, dict):
            raise StoreError(400, "expected a JSON object")
        return value

    def confirmed(self) -> None:
        if self.json().get("confirmed") is not True:
            raise StoreError(409, "this needs confirmation")


def overview(r: Request) -> dict:
    today = r.q("today") or date.today().isoformat()
    return store.overview(store.iso_date(today, "today"))


def remove_entry(r: Request) -> dict:
    r.confirmed()
    return store.delete_entry(r.id)


def remove_opportunity(r: Request) -> dict:
    r.confirmed()
    return store.delete_opportunity(r.id)


def import_list(r: Request) -> dict:
    return store.import_csv(r.body_bytes(MAX_CSV_BYTES), r.q("confirm") == "1")


ID = r"(?P<id>\d{1,9})"
ROUTES: list[tuple[str, re.Pattern, Callable[[Request], Any]]] = [
    (m, re.compile(f"^{p}$"), f) for m, p, f in [
        ("GET", "/health", lambda r: {"ok": True}),
        ("GET", "/overview", overview),
        ("GET", "/entries", lambda r: store.list_entries()),
        ("POST", "/entries", lambda r: store.add_entry(r.json())),
        ("PATCH", f"/entries/{ID}", lambda r: store.update_entry(r.id, r.json())),
        ("POST", f"/entries/{ID}/status", lambda r: store.set_status(r.id, r.json())),
        ("DELETE", f"/entries/{ID}", remove_entry),
        ("GET", "/opportunities", lambda r: store.list_opportunities()),
        ("POST", "/opportunities", lambda r: store.add_opportunity(r.json())),
        ("POST", "/opportunities/import", import_list),
        ("PATCH", f"/opportunities/{ID}", lambda r: store.update_opportunity(r.id, r.json())),
        ("POST", f"/opportunities/{ID}/going", lambda r: store.set_going(r.id, r.json())),
        ("DELETE", f"/opportunities/{ID}", remove_opportunity),
        ("GET", "/goal", lambda r: {"goal": store.get_goal()}),
        ("PUT", "/goal", lambda r: store.set_goal(r.json())),
    ]
]


class Handler(BaseHTTPRequestHandler):
    server_version = "vol-api"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    timeout = 60

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"[vol-api] {self.command} {urlsplit(self.path).path} {args[1] if len(args) > 1 else ''}\n")

    def guard(self, writing: bool) -> None:
        host = self.headers.get("Host", "")
        if hostname_of(host) not in LOCAL_HOSTS:
            raise StoreError(403, "host not allowed")
        site = self.headers.get("Sec-Fetch-Site")
        if site is not None and site not in ("same-origin", "none"):
            raise StoreError(403, "cross-site requests are not allowed")
        origin = self.headers.get("Origin")
        if origin is not None and urlsplit(origin).netloc.lower() != host.strip().lower():
            raise StoreError(403, "cross-origin requests are not allowed")
        if writing and self.headers.get("X-VOL-Request") != "1":
            raise StoreError(403, "missing request header")

    def send_json(self, status: int, payload: Any) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def dispatch(self) -> None:
        parts = urlsplit(self.path)
        try:
            self.guard(writing=self.command != "GET")
            for method, pattern, fn in ROUTES:
                match = pattern.match(parts.path)
                if match and method == self.command:
                    request = Request(self, match.groupdict(), parse_qs(parts.query))
                    with LOCK:
                        result = fn(request)
                    self.send_json(200, result)
                    return
            raise StoreError(404, "not found")
        except StoreError as e:
            self.close_connection = True  # the body may not have been read
            self.send_json(e.status, {"error": e.message})
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as e:  # never send internals to the browser
            self.close_connection = True
            sys.stderr.write(f"[vol-api] error: {type(e).__name__}\n")
            self.send_json(500, {"error": "something went wrong"})

    do_GET = do_POST = do_PATCH = do_PUT = do_DELETE = dispatch

    def do_OPTIONS(self) -> None:
        self.close_connection = True
        self.send_json(405, {"error": "not allowed"})


def make_server(port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((BIND_ADDRESS, port), Handler)
    server.daemon_threads = True
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="Volunteer Planner local API")
    parser.add_argument("--port", type=int, default=8770)
    server = make_server(parser.parse_args().port)
    sys.stderr.write(f"[vol-api] listening on {BIND_ADDRESS}:{server.server_address[1]}\n")
    server.serve_forever()


if __name__ == "__main__":
    main()
