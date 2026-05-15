#!/usr/bin/env python3
"""Healthcheck: verify the permission endpoint is responding (200 or 403 are both live)."""
import sys
import urllib.request
import urllib.error

try:
    urllib.request.urlopen("http://127.0.0.1:8080/?domain=__hc__", timeout=2)
    sys.exit(0)
except urllib.error.HTTPError as e:
    # 403 = service is up but domain not allowed — that's healthy
    sys.exit(0 if e.code in (200, 403) else 1)
except Exception:
    sys.exit(1)
