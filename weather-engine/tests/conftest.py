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


# Synoptic stations around Denver (39.74, -104.99): ~3 km flood gauge (rain only),
# ~3.5 km station with no recent data, ~10 km full station, ~47 km airport.
SYNOPTIC_STATIONS = [
    {"STID": "CCPRM", "NAME": "PRIMM FLOOD GAUGE", "LATITUDE": "39.767", "LONGITUDE": "-104.99",
     "ELEVATION": "5290", "MNET_ID": "141", "SHORTNAME": "CCRFCD",
     "SENSOR_VARIABLES": {"precip_accum": {"precip_accum_1": {}}}},
    {"STID": "BORAX", "NAME": "Borax", "LATITUDE": "39.77", "LONGITUDE": "-104.99",
     "ELEVATION": "5300", "MNET_ID": "2", "SENSOR_VARIABLES": {"air_temp": {}, "wind_speed": {}}},
    {"STID": "NEAR2", "NAME": "Near Two", "LATITUDE": "39.83", "LONGITUDE": "-104.99",
     "ELEVATION": "5350", "MNET_ID": "1", "SENSOR_VARIABLES": {"air_temp": {}, "wind_speed": {}, "wind_gust": {}}},
    {"STID": "KHND", "NAME": "Henderson", "LATITUDE": "40.16", "LONGITUDE": "-104.99",
     "ELEVATION": "5400", "MNET_ID": "1", "SENSOR_VARIABLES": {"air_temp": {}, "wind_speed": {}, "precip_accum_one_hour": {}}},
]


def synoptic_timeseries(stid: str, start: str, end: str) -> dict:
    """10-minute obs in Celsius and m/s (to exercise unit conversion), UTC timestamps."""
    if stid == "CCPRM":
        return synoptic_gauge(start, end)
    if stid == "BORAX":  # station listed but with no recent data
        return {"SUMMARY": {"RESPONSE_CODE": 1}, "UNITS": {}, "STATION": [{"STID": stid, "OBSERVATIONS": {"date_time": []}}]}
    t0 = datetime.strptime(start, "%Y%m%d%H%M")
    t1 = datetime.strptime(end, "%Y%m%d%H%M")
    # Local (America/Denver) midnight is 06:00/07:00 UTC; generate the same daily cycle
    # as previous_runs_payload in local time so zero-bias models match exactly.
    from zoneinfo import ZoneInfo
    times, temps, winds = [], [], []
    t = t0
    while t < t1:
        local = t.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo("America/Denver"))
        h = local.hour + local.minute / 60
        temp_f = 55 + 10 * np.sin((h - 9) / 24 * 2 * np.pi) if local.minute == 0 else None
        times.append(t.strftime("%Y-%m-%dT%H:%M:%SZ"))
        temps.append(None if temp_f is None else (temp_f - 32) * 5 / 9)
        winds.append(10 / 2.23694)
        t += timedelta(minutes=10)
    return {
        "SUMMARY": {"RESPONSE_CODE": 1},
        "UNITS": {"air_temp": "Celsius", "wind_speed": "m/s", "wind_gust": "m/s"},
        "STATION": [{"STID": stid, "OBSERVATIONS": {
            "date_time": times, "air_temp_set_1": temps, "wind_speed_set_1": winds,
            "wind_gust_set_1": [None] * len(times)}}],
    }


def synoptic_gauge(start: str, end: str) -> dict:
    """Flood gauge: running precip_accum counter in mm every 10 minutes, rain matching
    previous_runs_payload (0.01 in/hour for local hours 0-9 of every other day)."""
    from zoneinfo import ZoneInfo
    t0 = datetime.strptime(start, "%Y%m%d%H%M")
    t1 = datetime.strptime(end, "%Y%m%d%H%M")
    first_local = t0.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo("America/Denver")).date()
    times, accum, total = [], [], 1000.0  # counter does not start at zero
    t = t0
    while t < t1:
        local = t.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo("America/Denver"))
        day_idx = (local.date() - first_local).days
        if day_idx % 2 == 0 and local.hour < 10 and not (local.hour == 0 and local.minute == 0):
            total += 0.254 / 6  # 0.01 in per hour
        if local.hour == 0 and local.minute == 0 and day_idx % 2 == 0:
            total += 0.254 / 6  # first step of the rainy window
        times.append(t.strftime("%Y-%m-%dT%H:%M:%SZ"))
        accum.append(round(total, 4))
        t += timedelta(minutes=10)
    return {
        "SUMMARY": {"RESPONSE_CODE": 1},
        "UNITS": {"precip_accum": "Millimeters"},
        "STATION": [{"STID": "CCPRM", "OBSERVATIONS": {"date_time": times, "precip_accum_set_1": accum}}],
    }


def synoptic_precip(start: str, end: str) -> dict:
    days = round((datetime.strptime(end, "%Y%m%d%H%M") - datetime.strptime(start, "%Y%m%d%H%M")).total_seconds() / 86400)
    return {
        "SUMMARY": {"RESPONSE_CODE": 1},
        "UNITS": {"precipitation": "Millimeters"},
        "STATION": [{"STID": "CCPRM", "OBSERVATIONS": {"precipitation": [
            {"interval": i + 1, "total": 2.54 if i % 2 == 0 else 0.0, "count": 24} for i in range(days)
        ]}}],
    }


# ACIS stations returned by the fake StnMeta; empty unless a test turns ACIS on.
ACIS_STATIONS: list = []
ACIS_COOP = {
    "uid": 4242, "name": "DENVER 2 SE", "sids": ["264950 2", "USC00264950 6"],
    "ll": [-104.99, 39.758], "elev": 5300,
    "valid_daterange": [["1990-01-01", "2026-10-26"], ["1990-01-01", "2026-10-26"], ["1990-01-01", "2026-10-26"]],
}


def acis_stndata(sdate: str, edate: str, past_days: int) -> dict:
    """A 7 am observer whose readings match previous_runs_payload over 7am-7am windows."""
    d0, d1 = date.fromisoformat(sdate), date.fromisoformat(edate)
    start = TODAY - timedelta(days=past_days)  # previous_runs_payload's first day
    rows = []
    d = d0
    while d <= d1:
        k = (d - start).days
        # window (7am D-1, 7am D]: rain falls local hours 0-9 on even days -> 8 h on D or 2 h from D-1
        pcpn = "0.08" if k % 2 == 0 else "0.02"
        rows.append([d.isoformat(), ["65", 7], ["45", 7], [pcpn, 7]])
        d += timedelta(days=1)
    return {"meta": {"uid": 4242}, "data": rows}


@pytest.fixture
def fake_api(monkeypatch, tmp_path):
    """Route all HTTP calls to synthetic payloads; isolate data dirs."""
    from weather_engine import http, store

    monkeypatch.setattr(store, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(store, "ARCHIVE_DIR", tmp_path / "archive")
    monkeypatch.delenv("WEATHER_ENGINE_SYNOPTIC_TOKEN", raising=False)
    monkeypatch.setattr(store, "FORECAST_LOG", tmp_path / "processed" / "forecast_log.csv")
    biases = {"ecmwf_ifs025": 0.0, "gfs_seamless": 3.0, "icon_seamless": -2.0, "gem_seamless": 1.0}

    def get_json(url, params=None):
        params = params or {}
        if "synopticdata" in url:
            assert params["token"] == "test-token"
            if url.endswith("/networks"):
                return {"MNET": [{"ID": "141", "SHORTNAME": "CCRFCD"}, {"ID": "1", "SHORTNAME": "ASOS/AWOS"},
                                 {"ID": "2", "LONGNAME": "Union Pacific Railroad"}]}
            if url.endswith("/metadata"):
                assert "vars" not in params, "a variable filter hides rain gauges"
                return {"SUMMARY": {"RESPONSE_CODE": 1}, "STATION": SYNOPTIC_STATIONS}
            if url.endswith("/timeseries"):
                return synoptic_timeseries(params["stid"], params["start"], params["end"])
            if url.endswith("/precipitation"):
                return synoptic_precip(params["start"], params["end"])
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

    def post_json(url, payload):
        if url.endswith("/StnMeta"):
            return {"meta": list(ACIS_STATIONS)}
        if url.endswith("/StnData"):
            return acis_stndata(payload["sdate"], payload["edate"], 67)
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(http, "get_json", get_json)
    monkeypatch.setattr(http, "post_json", post_json)
    monkeypatch.setattr(http, "get_text", get_text)
    return tmp_path
