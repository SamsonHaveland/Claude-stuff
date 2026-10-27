"""All-network station search via Synoptic (synthetic responses; see conftest)."""

from datetime import date

import pandas as pd
import pytest

from weather_engine.config import Location
from weather_engine.forecast import run_forecast
from weather_engine.sources import stations, synoptic

from conftest import SYNOPTIC_STATIONS


@pytest.fixture
def token(monkeypatch):
    monkeypatch.setenv("WEATHER_ENGINE_SYNOPTIC_TOKEN", "test-token")


DENVER = Location("Denver", 39.74, -104.99, elevation=1609, timezone="America/Denver")


def test_parse_metadata_groups_and_units():
    payload = {"SUMMARY": {"RESPONSE_CODE": 1}, "STATION": SYNOPTIC_STATIONS}
    found = synoptic.parse_metadata(payload, DENVER)
    assert [s.id for s in found] == ["CCPRM", "BORAX", "NEAR2", "KHND"]
    gauge = found[0]
    assert gauge.variables == frozenset({"precip"})
    assert gauge.elevation == pytest.approx(5290 * 0.3048)
    assert gauge.network == "CCRFCD" and gauge.name == "Primm Flood Gauge"
    assert gauge.distance_km == pytest.approx(3.0, abs=0.1)


def test_no_stations_and_errors():
    assert synoptic.parse_metadata({"SUMMARY": {"RESPONSE_CODE": 2}}, DENVER) == []
    with pytest.raises(synoptic.SynopticError, match="invalid token"):
        synoptic.parse_metadata({"SUMMARY": {"RESPONSE_CODE": 200, "RESPONSE_MESSAGE": "invalid token"}}, DENVER)


def test_missing_token_is_clear(monkeypatch):
    monkeypatch.delenv("WEATHER_ENGINE_SYNOPTIC_TOKEN", raising=False)
    with pytest.raises(synoptic.SynopticError, match="token"):
        synoptic.find_stations(DENVER, 40)


def test_parse_timeseries_converts_units_and_timezone():
    payload = {
        "SUMMARY": {"RESPONSE_CODE": 1},
        "UNITS": {"air_temp": "Celsius", "wind_speed": "knots"},
        "STATION": [{"OBSERVATIONS": {
            "date_time": ["2026-10-20T07:00:00Z"], "air_temp_set_1": [10.0],
            "air_temp_set_1d": [99.0], "wind_speed_set_1": [10.0]}}],
    }
    df = synoptic.parse_timeseries(payload, "America/Denver")
    assert df["valid"][0] == pd.Timestamp("2026-10-20 01:00")
    assert df["tmpf"][0] == pytest.approx(50.0)  # measured set preferred over derived
    assert df["wind"][0] == pytest.approx(11.5078)
    assert df["gust"].isna().all()


def test_daily_precip_from_running_counter_handles_resets():
    # every 30 min for 2 days; counter rises 0.5 in on day 1, resets to 0 on day 2 then rises 0.25
    n = 96
    vals = [10 + 0.5 * min(i, 10) / 10 for i in range(48)] + [0.25 * min(i, 5) / 5 for i in range(48)]
    df = pd.DataFrame({"valid": pd.date_range("2026-10-01", periods=n, freq="30min"), "p_accum": vals})
    s = synoptic.daily_precip(df)
    assert s[date(2026, 10, 1)] == pytest.approx(0.5)
    assert s[date(2026, 10, 2)] == pytest.approx(0.25)


def test_daily_precip_since_midnight_and_hourly():
    times = pd.date_range("2026-10-01", periods=24 * 4, freq="15min")
    since = pd.DataFrame({"valid": times, "p_midnight": [0.0] * 40 + [0.3] * 56})
    assert synoptic.daily_precip(since)[date(2026, 10, 1)] == pytest.approx(0.3)
    # rolling 1-hour totals reported every 15 min: count each clock hour once
    hourly = pd.DataFrame({"valid": times, "p_1h": [0.1 if 8 <= t.hour < 10 else 0.0 for t in times]})
    assert synoptic.daily_precip(hourly)[date(2026, 10, 1)] == pytest.approx(0.2)


def test_daily_precip_needs_enough_hours():
    times = pd.date_range("2026-10-01", periods=10, freq="1h")
    s = synoptic.daily_precip(pd.DataFrame({"valid": times, "p_midnight": [0.1] * 10}))
    assert s.isna().all()


def test_selects_nearest_usable_station_per_variable(fake_api, token):
    sel = stations.select(DENVER, date(2026, 8, 21), date(2026, 10, 26))
    assert sel.chosen["precip"].id == "CCPRM"  # 3 km rain gauge
    assert sel.chosen["temp"].id == "NEAR2"  # BORAX is nearer but has no data
    assert sel.chosen["wind"].id == "NEAR2"
    assert any("BORAX passed over" in n for n in sel.notes)
    assert sel.obs["tmax"].notna().sum() > 50 and sel.obs["precip"].notna().sum() > 50


def test_forecast_with_synoptic_calibrates_per_variable(fake_api, token):
    result = run_forecast(Location("Denver", 39.74, -104.99))
    assert {g: s.id for g, s in result.stations.items()} == {"temp": "NEAR2", "wind": "NEAR2", "precip": "CCPRM"}
    stats = result.stats.set_index(["model", "lead", "var"])
    # Obs arrive in Celsius and m/s; converted correctly, the known model biases reappear.
    assert stats.loc[("gfs_seamless", 2, "tmax"), "bias"] == pytest.approx(3.0, abs=0.3)
    assert stats.loc[("ecmwf_ifs025", 2, "wind"), "bias"] == pytest.approx(0.0, abs=0.1)
    assert stats.loc[("ecmwf_ifs025", 2, "precip"), "ratio"] == pytest.approx(1.0, abs=0.05)


def test_verify_uses_each_variables_station(fake_api, token):
    from weather_engine import verify

    run_forecast(Location("Denver", 39.74, -104.99))
    scores = verify.run_verification(today=date(2026, 11, 4))
    assert {"tmax", "wind", "precip"} <= set(scores["var"])


def test_cli_stations_lists_all_networks(fake_api, token, capsys):
    from weather_engine.cli import main

    main(["stations", "--lat", "39.74", "--lon", "-104.99"])
    out = capsys.readouterr().out
    assert "all networks (Synoptic)" in out
    assert "CCPRM" in out and "precip" in out and "CCRFCD" in out
    assert "47 km away" in out  # KHND flagged as too far


def test_network_names_and_diagnostics(fake_api, token, capsys):
    found = synoptic.find_stations(DENVER, 40)
    assert {s.id: s.network for s in found}["BORAX"] == "Union Pacific Railroad"
    from weather_engine.cli import main

    main(["check-station", "NEAR2", "--days", "3", "--tz", "America/Denver"])
    out = capsys.readouterr().out
    assert "timeseries: code 1" in out and "air_temp_set_1" in out
    assert "test-token" not in out


def test_station_errors_are_reported(fake_api, token, monkeypatch):
    from weather_engine import http

    real = http.get_json

    def failing(url, params=None):
        if url.endswith("/timeseries") and params["stid"] == "NEAR2":
            return {"SUMMARY": {"RESPONSE_CODE": 2, "RESPONSE_MESSAGE": "No stations found for this request."}}
        return real(url, params)

    monkeypatch.setattr(http, "get_json", failing)
    sel = stations.select(DENVER, date(2026, 8, 21), date(2026, 10, 26))
    assert any("NEAR2: data unavailable" in n and "No stations found" in n for n in sel.notes)
    assert sel.chosen["precip"].id == "CCPRM"


def test_history_accumulates_under_free_tier_limit(fake_api, token, monkeypatch):
    """Free accounts get ~7 days per request; the local archive keeps older days."""
    from datetime import datetime, timedelta

    from weather_engine import http

    real = http.get_json

    def last_7_days(url, params=None):
        if url.endswith("/timeseries"):
            end = datetime.strptime(params["end"], "%Y%m%d%H%M")
            params = {**params, "start": max(params["start"], (end - timedelta(days=7)).strftime("%Y%m%d%H%M"))}
        return real(url, params)

    monkeypatch.setattr(http, "get_json", last_7_days)
    first = stations.select(DENVER, date(2026, 8, 5), date(2026, 10, 10))
    assert 5 <= first.obs["tmax"].notna().sum() <= 7  # usable right away, with few days
    later = stations.select(DENVER, date(2026, 8, 21), date(2026, 10, 26))
    assert later.obs["tmax"].notna().sum() >= 12  # earlier download kept


def test_short_noisy_history_shrinks_bias():
    from weather_engine import calibrate

    pairs = pd.DataFrame({
        "date": [date(2026, 10, d) for d in range(20, 27)], "lead": 1, "var": "tmax", "model": "a",
        "obs": [60.0] * 7, "fcst": [61, 55, 66, 58, 63, 57, 64],  # mean error +payload noise
    })
    stats = calibrate.fit(pairs, date(2026, 10, 26)).iloc[0]
    raw_bias = (pairs["fcst"] - pairs["obs"]).mean()
    assert 0 < stats["bias"] < raw_bias  # noisy -> scaled down, same sign
