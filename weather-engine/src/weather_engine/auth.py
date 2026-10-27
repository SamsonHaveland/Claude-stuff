"""Optional password protection for the web app (required when it is online).

Set WEATHER_ENGINE_PASSWORD to turn it on. Logging in sets a long-lived,
HttpOnly cookie holding an HMAC of the password (never the password itself);
changing the password signs everyone out. The app shell (HTML/CSS/JS) stays
public; every /api/ call except config and login needs the cookie.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from http.cookies import SimpleCookie

PASSWORD_ENV = "WEATHER_ENGINE_PASSWORD"
COOKIE = "we_session"
COOKIE_MAX_AGE = 365 * 24 * 3600
FAILED_LOGIN_DELAY_S = 1.0  # slows password guessing


def enabled() -> bool:
    return bool(os.environ.get(PASSWORD_ENV))


def _token() -> str:
    return hmac.new(os.environ[PASSWORD_ENV].encode(), b"weather-engine-session-v1", hashlib.sha256).hexdigest()


def check_password(candidate: str) -> bool:
    ok = enabled() and hmac.compare_digest(candidate.encode(), os.environ[PASSWORD_ENV].encode())
    if not ok:
        time.sleep(FAILED_LOGIN_DELAY_S)
    return ok


def is_authenticated(cookie_header: str | None) -> bool:
    if not enabled():
        return True
    if not cookie_header:
        return False
    try:
        jar = SimpleCookie(cookie_header)
    except Exception:
        return False
    morsel = jar.get(COOKIE)
    return morsel is not None and hmac.compare_digest(morsel.value, _token())


def session_cookie(secure: bool) -> str:
    parts = [f"{COOKIE}={_token()}", "Path=/", f"Max-Age={COOKIE_MAX_AGE}", "HttpOnly", "SameSite=Lax"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)
