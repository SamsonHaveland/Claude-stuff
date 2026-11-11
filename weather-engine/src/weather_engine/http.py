"""Small HTTP helper with retries."""

from __future__ import annotations

import contextlib
import random
import threading
import time

import requests

from .config import USER_AGENT

_session = requests.Session()
_session.headers["User-Agent"] = USER_AGENT


# Open-Meteo limits requests per address; on shared networks (Cloud Run, cloud sandboxes) other
# users count too. Few requests at a time, and patient retries on "429 Too Many Requests".
_per_host = threading.BoundedSemaphore(4)
RATE_LIMIT_RETRIES = 6


def _limited(url: str):
    return _per_host if "open-meteo.com" in url else contextlib.nullcontext()


def get(url: str, params: dict | None = None, retries: int = 3, timeout: int = 30) -> requests.Response:
    last_error: Exception | None = None
    attempt = limited = 0
    while attempt < retries:
        try:
            with _limited(url):
                resp = _session.get(url, params=params, timeout=timeout)
            if resp.status_code == 429 and limited < RATE_LIMIT_RETRIES:
                # Rate limited: wait and retry without using up an ordinary attempt.
                limited += 1
                last_error = requests.HTTPError(f"429 from {url}: {resp.text[:200]}")
                wait = resp.headers.get("Retry-After")
                time.sleep(float(wait) if wait and wait.isdigit() and int(wait) <= 30
                           else min(2 ** limited, 20) + random.random())
                continue
            if resp.status_code < 500 and resp.status_code != 429:
                if resp.status_code >= 400:
                    # Include the server's explanation; APIs say why they rejected a request.
                    raise requests.HTTPError(f"{resp.status_code} from {resp.url}: {resp.text[:300]}")
                return resp
            last_error = requests.HTTPError(f"{resp.status_code} from {url}: {resp.text[:200]}")
        except requests.RequestException as e:
            if isinstance(e, requests.HTTPError):
                raise
            last_error = e
        time.sleep(2**attempt)
        attempt += 1
    raise RuntimeError(f"GET {url} failed after {attempt + limited} attempts: {last_error}")


def post_json(url: str, payload: dict, retries: int = 3, timeout: int = 60) -> dict:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            resp = _session.post(url, json=payload, timeout=timeout)
            if resp.status_code < 500 and resp.status_code != 429:
                if resp.status_code >= 400:
                    raise requests.HTTPError(f"{resp.status_code} from {resp.url}: {resp.text[:300]}")
                return resp.json()
            last_error = requests.HTTPError(f"{resp.status_code} from {url}")
        except requests.RequestException as e:
            if isinstance(e, requests.HTTPError):
                raise
            last_error = e
        time.sleep(2**attempt)
    raise RuntimeError(f"POST {url} failed after {retries} attempts: {last_error}")


def get_json(url: str, params: dict | None = None) -> dict:
    return get(url, params).json()


def get_text(url: str, params: dict | None = None) -> str:
    return get(url, params).text
