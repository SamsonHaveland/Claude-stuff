"""Ground truth: ASOS station observations from the Iowa Environmental Mesonet."""

from __future__ import annotations

import csv
import io
import time
from datetime import date, timedelta

from ..locations import Location
from ..net import get
from ..records import PRECIP, TEMPERATURE, WIND, Observation
from ..timeutil import parse_iso, round_hour

URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"

PAUSE_SECONDS = 2
KNOT_TO_MS = 0.514444
INCH_TO_MM = 25.4


def _number(text: str) -> float | None:
    text = text.strip()
    if text in ("", "M"):
        return None
    if text == "T":  # trace precipitation, below 0.01 in
        return 0.0
    return float(text)


def parse_csv(text: str, location_id: str, station: str) -> list[Observation]:
    """Parse IEM ``format=onlycomma`` output with tmpf, sknt and p01i columns.

    Routine METARs are taken around :51-:53 past the hour; each is assigned to the
    nearest whole hour. Its p01i is the precipitation since the previous routine
    report, which lines up with model precipitation for the hour ending then.
    """
    rows = []
    for rec in csv.DictReader(io.StringIO(text)):
        valid = round_hour(parse_iso(rec["valid"].replace(" ", "T") + "+00:00"))
        temp_f = _number(rec.get("tmpf", ""))
        wind_kt = _number(rec.get("sknt", ""))
        precip_in = _number(rec.get("p01i", ""))
        if temp_f is not None:
            rows.append(Observation(location_id, TEMPERATURE, valid, (temp_f - 32) * 5 / 9, station))
        if wind_kt is not None:
            rows.append(Observation(location_id, WIND, valid, wind_kt * KNOT_TO_MS, station))
        if precip_in is not None:
            rows.append(Observation(location_id, PRECIP, valid, precip_in * INCH_TO_MM, station))
    return rows


def fetch(loc: Location, start: date, end: date, *, user_agent: str) -> list[Observation]:
    """Hourly observations from start (inclusive) to end (exclusive)."""
    rows: list[Observation] = []
    chunk_start = start
    while chunk_start < end:
        chunk_end = min(chunk_start + timedelta(days=31), end)
        params = [
            ("station", loc.station),
            ("data", "tmpf"),
            ("data", "sknt"),
            ("data", "p01i"),
            ("year1", chunk_start.year), ("month1", chunk_start.month), ("day1", chunk_start.day),
            ("year2", chunk_end.year), ("month2", chunk_end.month), ("day2", chunk_end.day),
            ("tz", "Etc/UTC"),
            ("format", "onlycomma"),
            ("missing", "M"),
            ("trace", "T"),
            ("report_type", "3"),  # routine hourly METARs only
        ]
        text = get(URL, params, user_agent=user_agent).decode("utf-8")
        rows.extend(parse_csv(text, loc.id, loc.station))
        chunk_start = chunk_end
        time.sleep(PAUSE_SECONDS)  # IEM asks for gentle, sequential use
    return rows
