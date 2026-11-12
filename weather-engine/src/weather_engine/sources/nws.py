"""The official National Weather Service forecast, logged as a baseline to beat.

The engine never blends it in; it is recorded next to the engine's own forecast
so `weather-engine verify` can score "engine vs NWS" on the same days. NWS keeps
no public archive of past forecasts, so this comparison only builds up from
the day forecasts start being logged. US locations only.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd

from .. import http
from ..config import Location
from .observations import NWS_POINTS_URL

SOURCE = "nws"

MM_TO_IN = 1 / 25.4
KMH_TO_MPH = 1 / 1.609344
MIN_HOURS = 20  # a calendar day needs this many forecast hours for a max/min

_DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?$")

# NWS grid layer -> (engine variable, unit conversions by NWS unit code, daily aggregation)
_LAYERS = {
    "temperature": ("temp", {"wmoUnit:degC": lambda v: v * 9 / 5 + 32, "wmoUnit:degF": lambda v: v}),
    "windSpeed": ("wind", {"wmoUnit:km_h-1": lambda v: v * KMH_TO_MPH, "wmoUnit:m_s-1": lambda v: v * 2.236936}),
    "windGust": ("gust", {"wmoUnit:km_h-1": lambda v: v * KMH_TO_MPH, "wmoUnit:m_s-1": lambda v: v * 2.236936}),
    "quantitativePrecipitation": ("precip", {"wmoUnit:mm": lambda v: v * MM_TO_IN}),
}


def _hours(duration: str) -> int:
    m = _DURATION.match(duration)
    if not m:
        raise ValueError(f"unsupported duration {duration!r}")
    return int(m.group(1) or 0) * 24 + int(m.group(2) or 0)


def _hourly(layer: dict, convert, spread: bool) -> dict[datetime, float]:
    """{UTC hour start: value}. A multi-hour total (rain) is spread evenly over its hours."""
    out = {}
    for entry in layer.get("values", []):
        if entry.get("value") is None:
            continue
        start_text, duration = entry["validTime"].split("/")
        start = datetime.fromisoformat(start_text)
        n = max(1, _hours(duration))
        value = convert(entry["value"]) / (n if spread else 1)
        for h in range(n):
            out[start + timedelta(hours=h)] = value
    return out


def parse_gridpoints(payload: dict, tz: str, today: date) -> pd.DataFrame:
    """NWS gridpoint forecast -> calendar-day (date, lead, var, value) in the place's time zone."""
    props = payload.get("properties", {})
    zone = ZoneInfo(tz)
    rows = []
    for name, (var, units) in _LAYERS.items():
        layer = props.get(name)
        if not layer or layer.get("uom") not in units:
            continue
        by_day: dict[date, list[float]] = defaultdict(list)
        for t, v in _hourly(layer, units[layer["uom"]], spread=var == "precip").items():
            by_day[t.astimezone(zone).date()].append(v)
        for day, values in by_day.items():
            lead = (day - today).days
            if lead < 0:
                continue
            if var == "precip":
                if len(values) >= 24:  # a partial day would undercount the total
                    rows.append((day, lead, "precip", sum(values)))
            elif len(values) >= MIN_HOURS:
                if var == "temp":
                    rows += [(day, lead, "tmax", max(values)), (day, lead, "tmin", min(values))]
                else:
                    rows.append((day, lead, var, max(values)))
    return pd.DataFrame(rows, columns=["date", "lead", "var", "value"])


def fetch(loc: Location, today: date) -> pd.DataFrame:
    """Today's NWS forecast for the place; raises if NWS doesn't cover it (outside the US)."""
    point = http.get_json(NWS_POINTS_URL.format(lat=loc.latitude, lon=loc.longitude))
    grid = http.get_json(point["properties"]["forecastGridData"])
    return parse_gridpoints(grid, loc.timezone or "UTC", today)
