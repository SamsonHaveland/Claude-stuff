"""NWS gridpoint forecasts (api.weather.gov): the official baseline to beat.

NWS keeps no public forecast archive here, so this baseline only exists from the
day collection starts.
"""

from __future__ import annotations

from ..locations import Location
from ..net import get_json
from ..records import PRECIP, TEMPERATURE, WIND, Forecast
from ..timeutil import HOUR, floor_hour, parse_duration, parse_iso

POINTS_URL = "https://api.weather.gov/points/{lat:.4f},{lon:.4f}"
SOURCE = "nws"

_TO_CANONICAL = {
    ("temperature", "wmoUnit:degC"): (TEMPERATURE, lambda v: v),
    ("temperature", "wmoUnit:degF"): (TEMPERATURE, lambda v: (v - 32) * 5 / 9),
    ("windSpeed", "wmoUnit:km_h-1"): (WIND, lambda v: v / 3.6),
    ("windSpeed", "wmoUnit:m_s-1"): (WIND, lambda v: v),
    ("quantitativePrecipitation", "wmoUnit:mm"): (PRECIP, lambda v: v),
}


def parse_gridpoints(payload: dict, location_id: str) -> list[Forecast]:
    props = payload["properties"]
    issue = floor_hour(parse_iso(props["updateTime"]))
    rows = []
    for (field, uom), (variable, convert) in _TO_CANONICAL.items():
        layer = props.get(field)
        if not layer or layer.get("uom") != uom:
            continue
        for entry in layer["values"]:
            if entry["value"] is None:
                continue
            start_text, duration_text = entry["validTime"].split("/")
            start = parse_iso(start_text)
            hours = max(1, parse_duration(duration_text) // HOUR)
            value = convert(entry["value"])
            if variable == PRECIP:
                value /= hours  # NWS QPF is a multi-hour total; spread it evenly
            for h in range(hours):
                # Precip accumulates over the hour *ending* at valid_time.
                valid = start + (h + 1) * HOUR if variable == PRECIP else start + h * HOUR
                if valid < issue:
                    continue  # the grid also carries hours already past
                rows.append(Forecast(location_id, SOURCE, variable, issue, valid, value))
    return rows


def fetch(loc: Location, *, user_agent: str) -> list[Forecast]:
    points = get_json(POINTS_URL.format(lat=loc.latitude, lon=loc.longitude), user_agent=user_agent)
    grid = get_json(points["properties"]["forecastGridData"], user_agent=user_agent)
    return parse_gridpoints(grid, loc.id)
