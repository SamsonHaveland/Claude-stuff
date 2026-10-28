"""Local web server: JSON API plus the web app. Standard library only.

Nothing runs in the background: a forecast is computed only when the app
asks for one.
"""

from __future__ import annotations

import json
import os
import re
import logging
import mimetypes
import socket
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import ai, auth, report
from .config import resolve_location
from .forecast import run_forecast
from .sources import observations

log = logging.getLogger(__name__)

WEB_DIR = Path(__file__).parent / "web"
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("text/javascript", ".js")


def _location_from_query(q: dict[str, list[str]]):
    def one(key: str) -> str | None:
        v = q.get(key, [""])[0].strip()
        return v or None

    lat, lon = one("lat"), one("lon")
    try:
        lat_f = float(lat) if lat else None
        lon_f = float(lon) if lon else None
    except ValueError:
        raise ValueError("lat and lon must be numbers") from None
    loc = resolve_location(one("place"), lat_f, lon_f)
    station = one("station")
    if station:
        if not re.fullmatch(r"[A-Za-z0-9]{3,5}", station):
            raise ValueError("station must be an ICAO id like KDEN")
        loc.station = station.upper()
    return loc


# Recent forecasts are reused for a while: the models only update every few hours,
# so recomputing on every view just adds waiting. "refresh=1" forces a new one.
FORECAST_TTL_S = 20 * 60
_recent: dict[tuple, tuple[float, dict]] = {}
_recent_lock = threading.Lock()


def _cache_key(q: dict[str, list[str]]) -> tuple:
    get = lambda k: q.get(k, [""])[0].strip().lower()  # noqa: E731
    lat, lon = get("lat"), get("lon")
    if lat and lon:
        lat, lon = f"{float(lat):.3f}", f"{float(lon):.3f}"
    return (get("place"), lat, lon, get("station"), get("raw"))


def api_forecast(q: dict[str, list[str]]) -> dict:
    key = _cache_key(q)
    if q.get("refresh", ["0"])[0] != "1":
        with _recent_lock:
            hit = _recent.get(key)
        if hit and time.time() - hit[0] < FORECAST_TTL_S:
            return hit[1]
    loc = _location_from_query(q)
    result = run_forecast(loc, use_calibration=q.get("raw", ["0"])[0] != "1")
    t = result.timings
    print(f"forecast {loc.name!r}: {t.get('total', 0):.1f}s (" +
          ", ".join(f"{k} {v:.1f}" for k, v in t.items() if k != "total") + ")", flush=True)
    payload = report.to_dict(result)
    with _recent_lock:
        _recent[key] = (time.time(), payload)
        for old in [k for k, (ts, _) in _recent.items() if time.time() - ts > FORECAST_TTL_S]:
            del _recent[old]
    return payload


def api_stations(q: dict[str, list[str]]) -> dict:
    loc = _location_from_query(q)
    return {
        "location": loc.name,
        "stations": [
            {"id": s.id, "name": s.name, "distance_km": round(s.distance_km, 1),
             "elevation_m": s.elevation, "warnings": s.quality_warnings(loc)}
            for s in observations.nearest_stations(loc)
        ],
    }


def _json_default(obj):
    # numpy scalars (np.bool_, np.int64, ...) -> plain Python values
    if hasattr(obj, "item"):
        return obj.item()
    raise TypeError(f"not JSON serialisable: {type(obj).__name__}")


def api_config(q: dict[str, list[str]]) -> dict:
    return {"ai": ai.configured(), "auth_required": auth.enabled()}


def api_summary(body: dict) -> dict:
    return {"summary": ai.summarize(body)}


ROUTES = {"/api/forecast": api_forecast, "/api/stations": api_stations, "/api/config": api_config}
POST_ROUTES = {"/api/summary": api_summary}
MAX_POST_BYTES = 256_000
PUBLIC_API = {"/api/config", "/api/login"}  # reachable without logging in


class Handler(BaseHTTPRequestHandler):
    server_version = "weather-engine"

    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        url = urlparse(self.path)
        route = ROUTES.get(url.path)
        if route is None:
            self._static(url.path)
            return
        if not self._authorized(url.path):
            return
        try:
            self._json(route(parse_qs(url.query)))
        except ValueError as e:
            self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        except Exception as e:  # upstream service failures etc.
            log.exception("request failed: %s", self.path)
            self._json({"error": f"Forecast failed: {e}"}, HTTPStatus.BAD_GATEWAY)

    def _authorized(self, path: str) -> bool:
        if path in PUBLIC_API or auth.is_authenticated(self.headers.get("Cookie")):
            return True
        self._json({"error": "Please log in.", "login_required": True}, HTTPStatus.UNAUTHORIZED)
        return False

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_POST_BYTES:
            raise ValueError("request body missing or too large")
        body = json.loads(self.rfile.read(length))
        if not isinstance(body, dict):
            raise ValueError("expected a JSON object")
        return body

    def _login(self) -> None:
        try:
            body = self._read_json()
        except (ValueError, json.JSONDecodeError) as e:
            self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        if not auth.enabled():
            self._json({"ok": True})
            return
        if not auth.check_password(str(body.get("password", ""))):
            self._json({"error": "Wrong password."}, HTTPStatus.UNAUTHORIZED)
            return
        # Behind Cloud Run's HTTPS front end the request arrives as plain HTTP with this header.
        secure = self.headers.get("X-Forwarded-Proto", "") == "https"
        self._json({"ok": True}, headers={"Set-Cookie": auth.session_cookie(secure)})

    def do_POST(self) -> None:  # noqa: N802 (stdlib naming)
        path = urlparse(self.path).path
        if path == "/api/login":
            self._login()
            return
        route = POST_ROUTES.get(path)
        if route is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not self._authorized(path):
            return
        try:
            self._json(route(self._read_json()))
        except ai.AIError as e:
            self._json({"error": str(e)}, HTTPStatus.SERVICE_UNAVAILABLE)
        except (ValueError, json.JSONDecodeError) as e:
            self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        except Exception as e:
            log.exception("request failed: %s", self.path)
            self._json({"error": f"Summary failed: {e}"}, HTTPStatus.BAD_GATEWAY)

    def _json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK, headers: dict | None = None) -> None:
        body = json.dumps(payload, allow_nan=False, default=_json_default).encode()
        self.send_response(status)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static(self, path: str) -> None:
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        file = (WEB_DIR / rel).resolve()
        if not file.is_relative_to(WEB_DIR.resolve()) or not file.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = file.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        log.info("%s %s", self.address_string(), fmt % args)


def make_server(host: str, port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def lan_ip() -> str | None:
    """This computer's address on the local network (no traffic is sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("192.168.0.1", 80))  # any private address; UDP connect just picks a route
            ip = s.getsockname()[0]
        except OSError:
            return None
    return None if ip.startswith("127.") else ip


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = make_server(host, port)
    if os.environ.get("K_SERVICE"):  # running on Cloud Run
        print(f"Weather Engine listening on port {port}; password protection "
              f"{'on' if auth.enabled() else 'OFF'}")
        server.serve_forever()
        return
    print(f"Weather Engine running at http://localhost:{port}")
    if host == "0.0.0.0":
        ip = lan_ip()
        if ip:
            print(f"On your phone (same Wi-Fi), open: http://{ip}:{port}")
        else:
            print("Couldn't find this computer's Wi-Fi address; check System Settings > Wi-Fi > Details.")
        print("If your Mac asks whether to allow incoming connections for Python, click Allow.")
    else:
        print("This Mac only. To use it from your phone, restart with: weather-engine serve --host 0.0.0.0")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
