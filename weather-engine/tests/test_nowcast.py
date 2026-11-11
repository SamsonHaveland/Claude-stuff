"""Latest-reading correction of the next hours (synthetic data)."""

import numpy as np
import pandas as pd

from weather_engine import nowcast


def hourly():
    t = pd.date_range("2026-10-27 00:00", periods=48, freq="h")
    return pd.DataFrame({"time": t, "temp": 60.0, "feels": 58.0, "wind": 10.0, "gust": 15.0})


def test_error_now_fades_over_the_next_hours():
    now = pd.Timestamp("2026-10-27 12:10")
    latest = {"temp": nowcast.Latest("KXXX", pd.Timestamp("2026-10-27 12:00"), 64.0, 4.0),
              "wind": nowcast.Latest("KXXX", pd.Timestamp("2026-10-27 12:00"), 64.0, 4.0)}
    out, applied = nowcast.apply(hourly(), latest, now)
    by = out.set_index("time")
    assert by.loc["2026-10-27 11:00", "temp"] == 60.0  # the past is left alone
    assert by.loc["2026-10-27 12:00", "temp"] == 64.0  # the current hour matches the reading
    assert abs(by.loc["2026-10-27 13:00", "temp"] - (60 + 4 * np.exp(-1 / 4))) < 1e-9
    assert by.loc["2026-10-28 06:00", "temp"] == 60.0  # beyond 12 hours: models alone
    assert by.loc["2026-10-27 13:00", "wind"] < 10 and (out["gust"] >= out["wind"]).all()
    assert {a["var"] for a in applied} == {"temp", "wind"} and applied[0]["error"] == -4.0


def test_stale_or_implausible_readings_are_ignored():
    old = {"temp": nowcast.Latest("K", pd.Timestamp("2026-10-27 08:00"), 64.0, None)}
    out, applied = nowcast.apply(hourly(), old, pd.Timestamp("2026-10-27 12:00"))
    assert applied == [] and (out["temp"] == 60).all()
    wild = {"temp": nowcast.Latest("K", pd.Timestamp("2026-10-27 12:00"), 95.0, None)}
    assert nowcast.apply(hourly(), wild, pd.Timestamp("2026-10-27 12:00"))[1] == []


def test_parse_nws_latest_units():
    payload = {"properties": {"timestamp": "2026-10-27T18:00:00+00:00",
                              "temperature": {"value": 20.0}, "windSpeed": {"value": 16.09344}}}
    r = nowcast.parse_nws_latest(payload, "KDEN", "America/Denver")
    assert r.time == pd.Timestamp("2026-10-27 12:00") and abs(r.temp - 68) < 1e-9 and abs(r.wind - 10) < 1e-6
