"""Synthetic API payloads shaped like the documented Open-Meteo / NWS / IEM responses.

These exercise parsing and pipeline logic offline; they are not real weather data.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import numpy as np
import pytest

TODAY = date(2026, 10, 27)


def hourly_times(start: date, days: int) -> list[str]:
    t0 = datetime(start.year, start.month, start.day)
    return [(t0 + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(24 * days)]


def daily_payload(start: date = TODAY, days: int = 8, warm_bias: float = 0.0) -> dict:
    times = [(start + timedelta(days=i)).isoformat() for i in range(days)]
    return {
        "latitude": 39.74, "longitude": -104.99, "elevation": 1609.0, "timezone": "America/Denver",
        "daily": {
            "time": times,
            "temperature_2m_max": [70.0 + warm_bias + i for i in range(days)],
            "temperature_2m_min": [45.0 + warm_bias for _ in range(days)],
            "precipitation_sum": [0.0, 0.2] * (days // 2),
            "wind_speed_10m_max": [12.0] * days,
            "wind_gusts_10m_max": [20.0] * days,
        },
    }


def previous_runs_payload(start: date, days: int, warm_bias: float) -> dict:
    """Hourly *_previous_dayN series: a daily temperature cycle offset by `warm_bias`."""
    times = hourly_times(start, days)
    hours = np.arange(len(times))
    temp = 55 + 10 * np.sin((hours % 24 - 9) / 24 * 2 * np.pi)  # max 65, min 45
    hourly = {"time": times}
    for lead in range(1, 8):
        hourly[f"temperature_2m_previous_day{lead}"] = list(temp + warm_bias)
        hourly[f"precipitation_previous_day{lead}"] = [0.01 if h % 48 < 10 else 0.0 for h in hours]
        hourly[f"wind_speed_10m_previous_day{lead}"] = [10.0] * len(times)
        hourly[f"wind_gusts_10m_previous_day{lead}"] = [18.0] * len(times)
    return {"timezone": "America/Denver", "hourly": hourly}


def iem_csv(start: date, days: int) -> str:
    """Routine hourly obs matching the 'truth' of previous_runs_payload with zero bias."""
    lines = ["station,valid,tmpf,sknt,gust,p01i"]
    for h, t in enumerate(hourly_times(start, days)):
        temp = 55 + 10 * np.sin((h % 24 - 9) / 24 * 2 * np.pi)
        rain = 0.01 if h % 48 < 10 else 0.0
        lines.append(f"DEN,{t.replace('T', ' ')},{temp:.1f},{10 / 1.15078:.2f},M,{rain}")
    return "\n".join(lines)


def ensemble_payload(start: date = TODAY, days: int = 8, members: int = 10) -> dict:
    times = hourly_times(start, days)
    hourly = {"time": times, "precipitation": [0.0] * len(times)}
    for m in range(1, members + 1):
        # day i: members 1..i get rain, so rain_prob = i / (members + 1)
        hourly[f"precipitation_member{m:02d}"] = [
            0.05 if (idx // 24) >= m else 0.0 for idx in range(len(times))
        ]
    return {"hourly": hourly}


NWS_STATIONS = {
    "features": [
        {"properties": {"stationIdentifier": "KDEN", "name": "Denver Intl", "elevation": {"value": 1656}},
         "geometry": {"coordinates": [-104.65, 39.85]}},
        {"properties": {"stationIdentifier": "KBKF", "name": "Buckley SFB", "elevation": {"value": 1726}},
         "geometry": {"coordinates": [-104.75, 39.70]}},
        {"properties": {"stationIdentifier": "CO123", "name": "Coop", "elevation": {"value": 1600}},
         "geometry": {"coordinates": [-104.99, 39.74]}},
    ]
}


@pytest.fixture
def fake_api(monkeypatch, tmp_path):
    """Route all HTTP calls to synthetic payloads; isolate data dirs."""
    from weather_engine import http, store

    monkeypatch.setattr(store, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(store, "FORECAST_LOG", tmp_path / "processed" / "forecast_log.csv")
    biases = {"ecmwf_ifs025": 0.0, "gfs_seamless": 3.0, "icon_seamless": -2.0, "gem_seamless": 1.0}

    def get_json(url, params=None):
        params = params or {}
        if "previous-runs" in url:
            past = params["past_days"]
            return previous_runs_payload(TODAY - timedelta(days=past), past, biases[params["models"]])
        if "ensemble" in url:
            return ensemble_payload()
        if "geocoding" in url:
            return {"results": [{"name": "Denver", "admin1": "Colorado", "country_code": "US",
                                 "latitude": 39.74, "longitude": -104.99, "elevation": 1609,
                                 "timezone": "America/Denver"}]}
        if "weather.gov/points" in url:
            assert params == {}, "NWS rejects unknown query parameters"
            return {"properties": {"observationStations": "https://api.weather.gov/gridpoints/BOU/62,60/stations"}}
        if "weather.gov/gridpoints" in url:
            assert params == {}
            return NWS_STATIONS
        if "api.open-meteo.com" in url:
            return daily_payload(warm_bias=biases[params["models"]])
        raise AssertionError(f"unexpected URL {url}")

    def get_text(url, params=None):
        p = dict(params)
        start = date(p["year1"], p["month1"], p["day1"])
        stop = date(p["year2"], p["month2"], p["day2"])
        return iem_csv(start, (stop - start).days)

    monkeypatch.setattr(http, "get_json", get_json)
    monkeypatch.setattr(http, "get_text", get_text)
    return tmp_path
