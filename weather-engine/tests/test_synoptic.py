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


def test_daily_precip_intervals():
    payload = {"SUMMARY": {"RESPONSE_CODE": 1}, "UNITS": {"precipitation": "Millimeters"},
               "STATION": [{"OBSERVATIONS": {"precipitation": [
                   {"interval": 1, "total": 25.4, "count": 30}, {"interval": 2, "total": None, "count": 0},
                   {"interval": 3, "total": 0, "count": 30}]}}]}
    s = synoptic.parse_daily_precip(payload, date(2026, 10, 1))
    assert s.to_dict() == {date(2026, 10, 1): pytest.approx(1.0), date(2026, 10, 3): 0.0}


def test_selects_nearest_usable_station_per_variable(fake_api, token):
    sel = stations.select(DENVER, date(2026, 8, 21), date(2026, 10, 26))
    assert sel.chosen["precip"].id == "CCPRM"  # 3 km rain gauge
    assert sel.chosen["temp"].id == "NEAR2"  # BORAX is nearer but has no data
    assert sel.chosen["wind"].id == "NEAR2"
    assert any("BORAX skipped" in n for n in sel.notes)
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
