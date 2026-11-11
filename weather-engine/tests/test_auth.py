"""Password protection for the online web app."""

import json
import threading
import urllib.error
import urllib.request

import pytest

from weather_engine import auth
from weather_engine.server import make_server


@pytest.fixture
def server(fake_api, monkeypatch):
    monkeypatch.setenv("WEATHER_ENGINE_PASSWORD", "correct horse")
    monkeypatch.setattr(auth, "FAILED_LOGIN_DELAY_S", 0)
    srv = make_server("127.0.0.1", 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def call(url, data=None, cookie=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.headers, json.loads(e.read() or b"{}")


def test_api_requires_login_but_shell_and_config_are_public(server):
    status, _, body = call(server + "/api/forecast?place=Denver,%20CO")
    assert status == 401 and body["login_required"]
    assert call(server + "/api/config")[2]["auth_required"] is True
    with urllib.request.urlopen(server + "/") as r:
        assert r.status == 200
    status, _, _ = call(server + "/api/summary", {"days": []})
    assert status == 401


def test_wrong_password_rejected(server):
    status, headers, body = call(server + "/api/login", {"password": "nope"})
    assert status == 401 and "Set-Cookie" not in headers


def test_login_sets_cookie_that_unlocks_api(server):
    status, headers, _ = call(server + "/api/login", {"password": "correct horse"},
                              headers={"X-Forwarded-Proto": "https"})
    cookie_header = headers["Set-Cookie"]
    assert status == 200 and "HttpOnly" in cookie_header and "Secure" in cookie_header
    assert "correct horse" not in cookie_header
    cookie = cookie_header.split(";")[0]
    status, _, body = call(server + "/api/forecast?place=Denver,%20CO", cookie=cookie)
    assert status == 200 and body["location"]["name"] == "Denver, Colorado"


def test_forged_or_stale_cookie_rejected(server, monkeypatch):
    status, _, _ = call(server + "/api/forecast?place=Denver", cookie=f"{auth.COOKIE}=deadbeef")
    assert status == 401
    _, headers, _ = call(server + "/api/login", {"password": "correct horse"})
    cookie = headers["Set-Cookie"].split(";")[0]
    monkeypatch.setenv("WEATHER_ENGINE_PASSWORD", "new password")  # changing it signs everyone out
    assert call(server + "/api/stations?place=Denver", cookie=cookie)[0] == 401


def test_no_password_means_open_locally(fake_api):
    assert auth.is_authenticated(None)
