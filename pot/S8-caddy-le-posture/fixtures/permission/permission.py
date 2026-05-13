#!/usr/bin/env python3
"""
S8 permission endpoint — models ADR-0019's `permission http` decision API.

Caddy 2's `on_demand_tls.ask` calls this endpoint with `?domain=<sni>` before
attempting to issue a cert. We return 200 for the tenant-confirmed allow-list
and 403 for everything else. Caddy LRU-caches each domain's decision (declined
domains are not re-asked on the hot path) — that is the property the spike
must measure.

Each query is appended to /var/log/permission/queries.jsonl so the test
runner can compute per-decision RPS and confirm Caddy actually short-circuits
repeated declined-SNI requests via its LRU rather than re-asking us.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import json
import os
import sys
import time
from threading import Lock

ALLOW = {"tenant-known.spike-s8.test"}
LOG_PATH = "/var/log/permission/queries.jsonl"
_lock = Lock()


def _log(entry: dict) -> None:
    with _lock, open(LOG_PATH, "a", buffering=1) as f:
        f.write(json.dumps(entry) + "\n")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        domain = (qs.get("domain") or [""])[0].lower()
        decision = 200 if domain in ALLOW else 403
        _log({
            "ts_ns": time.time_ns(),
            "domain": domain,
            "decision": decision,
        })
        self.send_response(decision)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        # Suppress per-request stderr noise; the JSONL log is the source of truth.
        return


def main():
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    open(LOG_PATH, "a").close()
    port = int(os.environ.get("PORT", "8080"))
    srv = ThreadingHTTPServer(("", port), Handler)
    print(f"permission endpoint listening on :{port}; allow={sorted(ALLOW)}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
