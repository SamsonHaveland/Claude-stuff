"""Web server: API routes, static files and error handling (synthetic upstream data)."""

import json
import threading
import urllib.error
import urllib.request

import pytest

from weather_engine.server import make_server


@pytest.fixture
def server(fake_api):
    srv = make_server("127.0.0.1", 0)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.status, r.headers.get("Content-Type"), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type"), e.read()


def test_forecast_api(server):
    status, ctype, body = get(server + "/api/forecast?place=Denver,%20CO")
    assert status == 200 and ctype == "application/json"
    data = json.loads(body)
    assert data["location"]["name"] == "Denver, Colorado"
    assert data["calibrated"] is True and data["station"]["id"] == "KBKF"
    assert len(data["days"]) == 8
    day = data["days"][1]
    assert day["lead"] == 1 and set(day["tmax"]) == {"value", "low", "high"}
    assert {r["var"] for r in data["calibration"]} >= {"tmax", "tmin", "wind"}


def test_forecast_api_by_coordinates(server):
    status, _, body = get(server + "/api/forecast?lat=39.74&lon=-104.99&place=My%20location")
    assert status == 200
    assert json.loads(body)["location"]["name"] == "My location"


def test_forecast_api_errors_are_json(server):
    status, ctype, body = get(server + "/api/forecast")
    assert status == 400 and ctype == "application/json"
    assert "place" in json.loads(body)["error"].lower()
    status, _, body = get(server + "/api/forecast?lat=abc&lon=1")
    assert status == 400


def test_stations_api(server):
    status, _, body = get(server + "/api/stations?place=Denver,%20CO")
    assert status == 200
    assert [s["id"] for s in json.loads(body)["stations"]] == ["KBKF", "KDEN"]


@pytest.mark.parametrize("path,ctype", [
    ("/", "text/html"),
    ("/app.js", "text/javascript"),
    ("/style.css", "text/css"),
    ("/manifest.webmanifest", "application/manifest+json"),
    ("/icon-180.png", "image/png"),
])
def test_static_files(server, path, ctype):
    status, got, _ = get(server + path)
    assert status == 200 and got.startswith(ctype)


def test_static_blocks_path_traversal(server):
    status, _, _ = get(server + "/../server.py")
    assert status == 404
    status, _, _ = get(server + "/%2e%2e/server.py")
    assert status == 404
