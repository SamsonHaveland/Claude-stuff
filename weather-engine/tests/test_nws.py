from datetime import date

import pandas as pd
import pytest

from weather_engine import store, verify
from weather_engine.config import Location
from weather_engine.forecast import run_forecast
from weather_engine.sources import nws

from conftest import TODAY, nws_gridpoints


def test_parse_gridpoints_calendar_days_in_local_time():
    df = nws.parse_gridpoints(nws_gridpoints(), "America/Denver", TODAY)
    v = df.set_index(["lead", "var"])["value"]
    assert v[(1, "tmax")] == pytest.approx(50.0)
    assert v[(1, "tmin")] == pytest.approx(50.0)
    assert v[(1, "wind")] == pytest.approx(10.0)
    # 4 x 1.5 mm over UTC hours 30-54 = 6 mm; the Denver day (UTC-6) holds all of it.
    assert v[(1, "precip")] == pytest.approx(6 / 25.4, abs=1e-6)
    # Today starts at 06:00 UTC in Denver, so it's complete; the last UTC day is not.
    assert set(df["lead"]) <= set(range(0, 8))
    assert (df["lead"] >= 0).all()


def test_partial_days_skipped():
    payload = {"properties": {"temperature": {"uom": "wmoUnit:degF", "values": [
        {"validTime": "2026-10-27T12:00:00+00:00/PT6H", "value": 60}]}}}
    assert nws.parse_gridpoints(payload, "UTC", TODAY).empty


def test_multi_hour_values_expand():
    payload = {"properties": {
        "temperature": {"uom": "wmoUnit:degF", "values": [
            {"validTime": "2026-10-28T00:00:00+00:00/P1D", "value": 70}]},
        "windGust": {"uom": "wmoUnit:m_s-1", "values": [
            {"validTime": "2026-10-28T00:00:00+00:00/PT24H", "value": 10}]},
    }}
    df = nws.parse_gridpoints(payload, "UTC", TODAY).set_index("var")["value"]
    assert df["tmax"] == 70 and df["tmin"] == 70
    assert df["gust"] == pytest.approx(22.36936)


def test_forecast_logs_nws_baseline_and_verify_scores_it(fake_api):
    run_forecast(Location("Denver", 39.74, -104.99))
    log = store.read_log()
    assert "nws" in set(log["source"])
    scores = verify.run_verification(today=date(2026, 11, 4))
    assert "nws" in set(scores["source"]) and "blend" in set(scores["source"])


def test_forecast_still_works_without_nws(fake_api, monkeypatch):
    def unavailable(*args, **kwargs):
        raise RuntimeError("404: outside the US")
    monkeypatch.setattr(nws, "fetch", unavailable)
    result = run_forecast(Location("Denver", 39.74, -104.99))
    assert result.nws is None and not result.blend.empty
