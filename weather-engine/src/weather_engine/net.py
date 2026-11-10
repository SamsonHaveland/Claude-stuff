"""Minimal HTTP GET with timeouts and retries (stdlib only)."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class HttpError(RuntimeError):
    def __init__(self, url: str, status: int | None, body: str):
        super().__init__(f"{status} from {url}: {body[:300]}")
        self.status = status
        self.body = body


def get(
    url: str,
    params: dict[str, Any] | list[tuple[str, Any]] | None = None,
    *,
    user_agent: str,
    timeout: float = 60,
    retries: int = 3,
) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"
    request = urllib.request.Request(url, headers={"User-Agent": user_agent})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            # Retry server errors and short-term rate limits; a daily quota or any
            # other 4xx won't clear by waiting.
            throttled = e.code == 429 and "daily" not in body.lower()
            if (e.code < 500 and not throttled) or attempt == retries:
                raise HttpError(url, e.code, body) from e
            if throttled:
                time.sleep(float(e.headers.get("Retry-After") or 15 * (attempt + 1)))
                continue
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == retries:
                raise HttpError(url, None, str(e)) from e
        time.sleep(2 ** (attempt + 1))
    raise AssertionError("unreachable")


def get_json(url: str, params=None, **kwargs) -> Any:
    return json.loads(get(url, params, **kwargs))
