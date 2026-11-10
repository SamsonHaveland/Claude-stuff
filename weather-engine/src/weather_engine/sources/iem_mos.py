"""Archived NOAA station forecasts (MOS, LAMP, National Blend of Models) via IEM.

These are real point forecasts for the ASOS station itself, archived per run,
so they can be backtested honestly. Temperature and wind only: their precip
fields are categorical or probability codes, not amounts.
"""

from __future__ import annotations

import csv
import io
import time
from datetime import date, timedelta

from ..locations import Location
from ..net import get
from ..records import TEMPERATURE, WIND, Forecast
from collections import defaultdict

from ..timeutil import HOUR, parse_iso

URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/mos.py"

# IEM model code -> hours after the nominal run time before the product is
# public. Using the run time itself would let a backtest use forecasts before
# they existed. Values are deliberately conservative.
AVAILABILITY_HOURS = {
    "GFS": 5,  # GFS MOS (MAV), 4x daily, 3-hourly to 72h
    "NAM": 5,  # NAM MOS (MET), 3-hourly to 72h
    "NBS": 2,  # National Blend of Models short range, to 72h
    "NBE": 3,  # National Blend of Models extended, 12-hourly to ~10 days
    "LAV": 1,  # GFS LAMP, hourly to 25h
}

PAUSE_SECONDS = 2
KNOT_TO_MS = 0.514444
MAX_INTERPOLATION_GAP = 6 * HOUR  # 3-hourly steps are filled; NBE's 12h are not


def source_name(model: str) -> str:
    return f"mos:{model}"


def _value(text: str | None) -> float | None:
    text = (text or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _hourly(points: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """Linearly fill whole hours between consecutive forecast steps of one run."""
    points.sort()
    out = []
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        out.append((t0, v0))
        if t1 - t0 <= MAX_INTERPOLATION_GAP:
            for t in range(t0 + HOUR, t1, HOUR):
                out.append((t, v0 + (v1 - v0) * (t - t0) / (t1 - t0)))
    if points:
        out.append(points[-1])
    return out


def parse_csv(text: str, location_id: str) -> list[Forecast]:
    runs: dict[tuple[str, str, int], list[tuple[int, float]]] = defaultdict(list)
    for rec in csv.DictReader(io.StringIO(text)):
        model = rec["model"].strip()
        lag = AVAILABILITY_HOURS.get(model)
        if lag is None:
            continue
        issue = parse_iso(rec["runtime"].replace(" ", "T") + "+00:00") + lag * HOUR
        valid = parse_iso(rec["ftime"].replace(" ", "T") + "+00:00")
        source = source_name(model)
        tmp, wsp = _value(rec.get("tmp")), _value(rec.get("wsp"))
        if tmp is not None:
            runs[(source, TEMPERATURE, issue)].append((valid, (tmp - 32) * 5 / 9))
        if wsp is not None:
            runs[(source, WIND, issue)].append((valid, wsp * KNOT_TO_MS))
    rows = []
    for (source, variable, issue), points in runs.items():
        for valid, value in _hourly(points):
            if valid > issue:  # steps before the product was public aren't forecasts
                rows.append(Forecast(location_id, source, variable, issue, valid, value))
    return rows


def fetch(loc: Location, models: list[str], start: date, end: date, *, user_agent: str) -> list[Forecast]:
    """Runs from start (inclusive) to end (exclusive) for each model."""
    rows: list[Forecast] = []
    for model in models:
        chunk_start = start
        while chunk_start < end:
            chunk_end = min(chunk_start + timedelta(days=31), end)
            params = {
                "station": loc.station,
                "model": model,
                "sts": f"{chunk_start.isoformat()}T00:00Z",
                "ets": f"{chunk_end.isoformat()}T00:00Z",
                "format": "csv",
            }
            text = get(URL, params, user_agent=user_agent).decode("utf-8")
            rows.extend(parse_csv(text, loc.id))
            chunk_start = chunk_end
            time.sleep(PAUSE_SECONDS)  # IEM asks for gentle, sequential use
    return rows
