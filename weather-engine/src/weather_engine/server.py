"""Local web server: JSON API plus the web app. Standard library only.

Nothing runs in the background: a forecast is computed only when the app
asks for one.
"""

from __future__ import annotations

import json
import re
import logging
import mimetypes
import socket
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import ai, report
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


def api_forecast(q: dict[str, list[str]]) -> dict:
    loc = _location_from_query(q)
    return report.to_dict(run_forecast(loc, use_calibration=q.get("raw", ["0"])[0] != "1"))


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
    return {"ai": ai.configured()}


def api_summary(body: dict) -> dict:
    return {"summary": ai.summarize(body)}


ROUTES = {"/api/forecast": api_forecast, "/api/stations": api_stations, "/api/config": api_config}
POST_ROUTES = {"/api/summary": api_summary}
MAX_POST_BYTES = 256_000


class Handler(BaseHTTPRequestHandler):
    server_version = "weather-engine"

    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        url = urlparse(self.path)
        route = ROUTES.get(url.path)
        if route is None:
            self._static(url.path)
            return
        try:
            self._json(route(parse_qs(url.query)))
        except ValueError as e:
            self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        except Exception as e:  # upstream service failures etc.
            log.exception("request failed: %s", self.path)
            self._json({"error": f"Forecast failed: {e}"}, HTTPStatus.BAD_GATEWAY)

    def do_POST(self) -> None:  # noqa: N802 (stdlib naming)
        route = POST_ROUTES.get(urlparse(self.path).path)
        if route is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 < length <= MAX_POST_BYTES:
                raise ValueError("request body missing or too large")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("expected a JSON object")
            self._json(route(body))
        except ai.AIError as e:
            self._json({"error": str(e)}, HTTPStatus.SERVICE_UNAVAILABLE)
        except (ValueError, json.JSONDecodeError) as e:
            self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        except Exception as e:
            log.exception("request failed: %s", self.path)
            self._json({"error": f"Summary failed: {e}"}, HTTPStatus.BAD_GATEWAY)

    def _json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, allow_nan=False, default=_json_default).encode()
        self.send_response(status)
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


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = make_server(host, port)
    print(f"Weather Engine running at http://localhost:{port}")
    if host == "0.0.0.0":
        print(f"On your phone (same Wi-Fi): http://{socket.gethostname()}:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
