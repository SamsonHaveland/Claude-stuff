"""UTC time helpers. All times in the engine are integer Unix seconds (UTC)."""

from __future__ import annotations

import re
from datetime import date, datetime, timezone

HOUR = 3600
DAY = 86400

_DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$")


def floor_hour(ts: int) -> int:
    return ts - ts % HOUR


def round_hour(ts: int) -> int:
    return floor_hour(ts + HOUR // 2)


def parse_iso(text: str) -> int:
    dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def parse_duration(text: str) -> int:
    """Parse the ISO-8601 durations NWS uses, e.g. PT1H, PT6H, P1DT17H."""
    m = _DURATION.match(text)
    if not m:
        raise ValueError(f"unsupported duration: {text!r}")
    days, hours, minutes = (int(g) if g else 0 for g in m.groups())
    return days * DAY + hours * HOUR + minutes * 60


def fmt(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def to_date(ts: int) -> date:
    return datetime.fromtimestamp(ts, timezone.utc).date()


def from_date(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())
