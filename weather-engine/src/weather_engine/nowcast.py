"""Nudge the next few hours toward what the station is measuring right now.

Model runs are hours old by the time they're used; the latest reading at the
station shows how far off they are at this moment. That error is carried
into the coming hours and faded out, as NWS LAMP does with MOS: observations
add skill for the first hours, and by about 12 hours the models are as good
on their own (Rudack 2008, NWS MDL). The fade times are starting values, not
fitted ones: about 4 hours for temperature, 2 for wind (wind errors change faster).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np
import pandas as pd

from . import http
from .sources import synoptic
from .sources.observations import Station

NWS_LATEST_URL = "https://api.weather.gov/stations/{id}/observations/latest"
FADE_HOURS = {"temp": 4.0, "wind": 2.0}
HORIZON_HOURS = 12
MAX_AGE_HOURS = 1.5  # older readings aren't "now"
MAX_ERROR = {"temp": 12.0, "wind": 15.0}  # bigger gaps are more likely a bad sensor than a bad model


@dataclass
class Latest:
    station: str
    time: pd.Timestamp  # local, naive (same clock as the hourly forecast)
    temp: float | None  # °F
    wind: float | None  # mph


def _c_to_f(v):
    return None if v is None else v * 9 / 5 + 32


def parse_nws_latest(payload: dict, station: str, tz: str) -> Latest | None:
    p = payload.get("properties") or {}
    if not p.get("timestamp"):
        return None
    t = pd.Timestamp(p["timestamp"]).tz_convert(tz).tz_localize(None)
    temp = (p.get("temperature") or {}).get("value")
    wind = (p.get("windSpeed") or {}).get("value")  # km/h
    return Latest(station, t, _c_to_f(temp), None if wind is None else wind / 1.609344)


def fetch_latest(station: Station, tz: str) -> Latest | None:
    """Most recent temperature/wind reading at the station (None if the source has no live data)."""
    if station.source == "synoptic":
        payload = http.get_json(synoptic.TIMESERIES_URL, synoptic._params(
            stid=station.id, recent=120, vars="air_temp,wind_speed,wind_gust", units=synoptic.UNITS_PARAM))
        df = synoptic.parse_timeseries(payload, tz).dropna(subset=["tmpf"], how="all")
        if df.empty:
            return None
        last = df.iloc[-1]
        return Latest(station.id, last["valid"],
                      None if pd.isna(last["tmpf"]) else float(last["tmpf"]),
                      None if pd.isna(last["wind"]) else float(last["wind"]))
    if station.source == "iem":  # airport (ASOS/AWOS) stations: NWS publishes the latest report
        return parse_nws_latest(http.get_json(NWS_LATEST_URL.format(id=station.id)), station.id, tz)
    return None  # daily-only networks (COOP/CoCoRaHS) have no live readings


def _at(hourly: pd.DataFrame, col: str, t: pd.Timestamp) -> float | None:
    """Forecast value at time t, interpolated between hours."""
    s = hourly.set_index("time")[col].dropna()
    if s.empty or t < s.index.min() or t > s.index.max():
        return None
    return float(np.interp(t.value, s.index.asi8, s.to_numpy()))


def apply(hourly: pd.DataFrame, latest: dict[str, Latest], now: datetime | pd.Timestamp) -> tuple[pd.DataFrame, list[dict]]:
    """Shift the coming hours by the current error, fading out. `latest`: {"temp": Latest, "wind": Latest}.

    Returns the adjusted hourly table and what was applied (for the report).
    """
    h = hourly.copy()
    now = pd.Timestamp(now)
    applied = []
    for var, reading in latest.items():
        value = getattr(reading, var, None) if reading else None
        if value is None or pd.isna(value) or now - reading.time > pd.Timedelta(hours=MAX_AGE_HOURS):
            continue
        model = _at(h, var, reading.time)
        if model is None:
            continue
        error = model - value
        if abs(error) > MAX_ERROR[var]:
            continue
        dt = (h["time"] - reading.time).dt.total_seconds() / 3600
        mask = (dt > -1) & (dt <= HORIZON_HOURS)  # from the hour the reading falls in
        shift = error * np.exp(-dt[mask].clip(lower=0) / FADE_HOURS[var])
        if var == "temp":
            h.loc[mask, "temp"] -= shift
            h.loc[mask, "feels"] -= shift
        else:
            h.loc[mask, "wind"] = (h.loc[mask, "wind"] - shift).clip(lower=0)
            h.loc[mask, "gust"] = np.fmax(h.loc[mask, "gust"], h.loc[mask, "wind"])
        applied.append({"var": var, "station": reading.station, "time": reading.time.isoformat(timespec="minutes"),
                        "observed": round(float(value), 1), "model": round(model, 1), "error": round(error, 1)})
    return h, applied
