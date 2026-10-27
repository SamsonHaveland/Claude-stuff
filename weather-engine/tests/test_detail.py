"""Hour-by-hour detail stays consistent with the calibrated daily forecast (synthetic data)."""

from datetime import datetime, timezone

import pandas as pd
import pytest

from weather_engine import detail, report
from weather_engine.config import Location
from weather_engine.forecast import run_forecast

from conftest import TODAY


@pytest.fixture
def result(fake_api):
    return run_forecast(Location("Denver", 39.74, -104.99))


def test_hourly_matches_calibrated_daily(result):
    daily = result.blend.pivot_table(index="date", columns="var", values="value")
    h = result.hourly
    for d, day in h.groupby("date"):
        if d not in daily.index or day["temp"].nunique() < 2:
            continue
        assert day["temp"].max() == pytest.approx(daily.loc[d, "tmax"])
        assert day["temp"].min() == pytest.approx(daily.loc[d, "tmin"])
        assert day["wind"].max() == pytest.approx(daily.loc[d, "wind"])
        assert day["gust"].max() == pytest.approx(daily.loc[d, "gust"])
        if day["precip"].sum() > 0:  # synthetic daily totals on some days have no hourly rain to scale
            assert day["precip"].sum() == pytest.approx(daily.loc[d, "precip"], abs=1e-9)
    assert (h["gust"] >= h["wind"]).all()


def test_day_details(result):
    details, _ = report._detail(result)
    day1 = details[sorted(details)[1]]
    # models put rain 2-6 pm but the ensembles give only ~9%: "possible", not "likely"
    assert day1["rain_windows"] == [] and day1["rain_possible"] == ["2 pm–6 pm"]
    assert day1["precip_type"] == "thunderstorms" and day1["thunder"]
    hours = result.hourly[result.hourly["date"] == sorted(details)[1]]
    peak = hours.loc[hours["gust"].idxmax(), "time"]
    assert day1["wind_from"] == "NW" and day1["gust_peak_time"] == detail._fmt_hour(peak)
    assert day1["sunrise"] == "6:12 am" and day1["sunset"] == "5:45 pm"
    assert day1["humidity_min"] == 30 and day1["humidity_max"] == 50


def test_timeline_resolution_and_past_hours(result):
    now = pd.Timestamp(datetime.combine(TODAY, datetime.min.time())) + pd.Timedelta(hours=13, minutes=20)
    tl = detail.timeline(result.hourly, now)
    days = sorted(tl)
    assert tl[days[0]]["step_hours"] == 1 and tl[days[0]]["rows"][0]["label"] == "1 pm"
    assert len(tl[days[1]]["rows"]) == 24
    assert tl[days[2]]["step_hours"] == 3 and len(tl[days[2]]["rows"]) == 8


def test_three_hour_blocks_aggregate_correctly():
    times = pd.date_range("2026-10-30 00:00", periods=24, freq="1h")
    h = pd.DataFrame({"time": times, "date": times.date, "temp": range(24), "feels": range(24),
                      "precip": [0.1 if t.hour in (3, 4) else 0.0 for t in times], "rain_prob": 0.2,
                      "kind": None, "wind": 5.0, "gust": [9.0 if t.hour == 4 else 7.0 for t in times],
                      "wind_dir": 270.0, "cloud": 50.0, "humidity": 40.0})
    rows = detail.timeline(h, None, hourly_days=0)[times[0].date()]["rows"]
    block = rows[1]  # 3 am - 6 am
    assert block["label"] == "3 am" and block["precip"] == 0.2 and block["gust"] == 9 and block["wind_from"] == "W"


def test_outputs_include_detail(result):
    text = report.to_text(result)
    assert "Details:" in text and "thunderstorms possible 2 pm–6 pm" in text and "wind from NW" in text
    data = report.to_dict(result)
    day = next(d for d in data["days"] if d["hours"])
    assert {"label", "temp", "feels", "rain_prob", "precip", "wind", "gust", "wind_from", "sky"} <= set(day["hours"]["rows"][0])
    import json
    json.dumps(data, allow_nan=False, default=lambda o: o.item())  # serialisable for the web app


def test_compass():
    assert detail.compass(0) == "N" and detail.compass(350) == "N" and detail.compass(225) == "SW"
    assert detail.compass(float("nan")) is None


def test_rain_wording_follows_probability():
    times = pd.date_range("2026-10-30 12:00", periods=6, freq="1h")
    day = pd.DataFrame({"time": times, "rain_prob": [0.1, 0.5, 0.6, 0.2, 0.05, float("nan")],
                        "precip": [0, 0.02, 0.03, 0, 0, 0.02]})
    likely, possible = detail.rain_windows(day)
    assert likely == ["1 pm–3 pm", "5 pm–6 pm"]  # last hour: no ensemble data, amount decides
    assert possible == ["3 pm–4 pm"]
