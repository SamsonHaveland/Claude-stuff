"""ACIS (COOP / CoCoRaHS) stations and exact 24-hour window alignment (synthetic responses)."""

from datetime import date

import pandas as pd
import pytest

import conftest
from weather_engine.config import Location
from weather_engine.forecast import decode_stations, run_forecast
from weather_engine.sources import acis, openmeteo

DENVER = Location("Denver", 39.74, -104.99, elevation=1609, timezone="America/Denver")


@pytest.fixture
def acis_on(monkeypatch):
    monkeypatch.setattr(conftest, "ACIS_STATIONS", [conftest.ACIS_COOP])


def test_parse_meta_networks_and_activity():
    stale = {**conftest.ACIS_COOP, "uid": 1, "valid_daterange": [["1990-01-01", "2001-01-01"]] * 3}
    rain_only = {"uid": 2, "name": "DENVER 1.2 N", "sids": ["CO-DV-12 10"], "ll": [-104.99, 39.75], "elev": 5280,
                 "valid_daterange": [[], [], ["2010-01-01", "2026-10-25"]]}
    found = acis.parse_meta({"meta": [conftest.ACIS_COOP, stale, rain_only]}, DENVER, date(2026, 10, 27))
    assert [(s.id, s.network, sorted(s.variables)) for s in found] == [
        ("CO-DV-12", "CoCoRaHS", ["precip"]), ("264950", "NWS COOP", ["precip", "temp"])]
    assert found[1].ref == "4242" and found[1].elevation == pytest.approx(5300 * 0.3048)


def test_value_flags():
    assert acis._value(["T", 7]) == (0.0, 7)
    assert acis._value(["M", 7]) == (None, 7)
    assert acis._value(["S", 7]) == (None, 7)
    assert acis._value(["1.20A", 7]) == (None, 7)  # multi-day accumulation: not a daily total
    assert acis._value(["0.35", -1]) == (0.35, None)


def test_days_read_at_other_times_are_dropped():
    data = {"data": [
        ["2026-10-01", ["70", 7], ["40", 7], ["0.00", 7]],
        ["2026-10-02", ["72", 17], ["41", 17], ["0.10", 17]],  # read in the evening: different window
        ["2026-10-03", ["71", 7], ["42", 7], ["0.05", 7]],
    ]}
    df = acis.parse_data(data)
    assert df["tmax"].notna().tolist() == [True, False, True]
    assert (df["obs_hour_temp"] == 7).all()


def test_aggregate_windows_7am():
    times = pd.date_range("2026-10-01 01:00", "2026-10-03 00:00", freq="1h")
    hourly = pd.DataFrame({"time": times, "lead": 1, "hvar": "precipitation",
                           "value": [1.0 if t.day == 2 and t.hour <= 7 and t.hour >= 1 else 0.0 for t in times]})
    hourly.loc[hourly["time"] == pd.Timestamp("2026-10-02 08:00"), "value"] = 5.0
    daily = openmeteo.aggregate_windows(hourly, end_hour=7, min_hours=1).set_index("date")["value"]
    # window ending 7am Oct 2 = (Oct 1 07:00, Oct 2 07:00]: 7 hours of 1.0; the 08:00 value belongs to Oct 3
    assert daily[date(2026, 10, 2)] == 7.0
    assert daily[date(2026, 10, 3)] == 5.0


def test_forecast_uses_coop_with_exact_7am_window(fake_api, acis_on):
    result = run_forecast(Location("Denver", 39.74, -104.99))
    assert result.stations["temp"].id == "264950" and result.stations["precip"].id == "264950"
    assert result.stations["wind"].id == "KBKF"  # ACIS has no wind
    assert result.end_hours == {"temp": 7, "wind": 24, "precip": 7}
    stats = result.stats.set_index(["model", "lead", "var"])
    assert stats.loc[("gfs_seamless", 3, "tmax"), "bias"] == pytest.approx(3.0, abs=0.2)
    # Observer totals equal the model's 7am-7am totals, so no rain correction is learned;
    # a calendar-day comparison would have produced a spurious one.
    assert stats.loc[("ecmwf_ifs025", 3, "precip"), "ratio"] == pytest.approx(1.0, abs=0.02)
    assert "daily readings at 7 am" in __import__("weather_engine.report", fromlist=["x"]).to_text(result)


def test_log_records_window_and_verify_skips_it(fake_api, acis_on):
    from weather_engine import store, verify

    run_forecast(Location("Denver", 39.74, -104.99))
    encoded = store.read_log()["station"].iloc[0]
    assert decode_stations(encoded)["temp"] == ("acis", "4242", 7)
    scores = verify.run_verification(today=date(2026, 11, 4))
    assert set(scores["var"]) == {"wind", "gust"}  # 7 am windows are not scored against calendar days
