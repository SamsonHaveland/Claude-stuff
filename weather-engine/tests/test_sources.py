from datetime import date

import pytest

from weather_engine.config import Location
from weather_engine.sources import observations, openmeteo

from conftest import NWS_STATIONS, TODAY, daily_payload, ensemble_payload, iem_csv, previous_runs_payload

DENVER = Location("Denver", 39.74, -104.99, elevation=1609)


def test_pick_geocode_result_prefers_state_match():
    results = [
        {"name": "Portland", "admin1": "Oregon", "country_code": "US"},
        {"name": "Portland", "admin1": "Maine", "country_code": "US"},
    ]
    assert openmeteo.pick_geocode_result(results, "ME")["admin1"] == "Maine"
    assert openmeteo.pick_geocode_result(results, "maine")["admin1"] == "Maine"
    assert openmeteo.pick_geocode_result(results, None)["admin1"] == "Oregon"
    assert openmeteo.pick_geocode_result([], "ME") is None


def test_pick_geocode_result_prefers_us_without_hint():
    results = [{"name": "Paris", "country_code": "FR"}, {"name": "Paris", "admin1": "Texas", "country_code": "US"}]
    assert openmeteo.pick_geocode_result(results, None)["country_code"] == "US"


def test_parse_daily():
    df = openmeteo.parse_daily(daily_payload(days=4))
    assert list(df.columns) == ["tmax", "tmin", "precip", "wind", "gust"]
    assert df.index[0] == TODAY
    assert df.loc[TODAY, "tmax"] == 70.0


def test_parse_previous_runs_aggregates_local_days():
    df = openmeteo.parse_previous_runs(previous_runs_payload(date(2026, 10, 1), 3, warm_bias=2.0))
    tmax = df[(df["var"] == "tmax") & (df["lead"] == 3)]
    assert len(tmax) == 3
    assert tmax["value"].iloc[0] == pytest.approx(67.0, abs=0.1)
    tmin = df[(df["var"] == "tmin") & (df["lead"] == 1)]
    assert tmin["value"].iloc[0] == pytest.approx(47.0, abs=0.1)
    assert set(df["lead"]) == set(range(1, 8))


def test_parse_previous_runs_drops_incomplete_days():
    payload = previous_runs_payload(date(2026, 10, 1), 2, 0.0)
    for k in payload["hourly"]:
        payload["hourly"][k] = payload["hourly"][k][:30]  # day 2 has only 6 hours
    df = openmeteo.parse_previous_runs(payload)
    assert set(df["date"]) == {date(2026, 10, 1)}


def test_parse_ensemble_precip_probability():
    df = openmeteo.parse_ensemble_precip(ensemble_payload(days=4, members=10))
    # control run is dry; on day i members 1..i are wet -> i of 11
    assert df["n_members"].iloc[0] == 11
    assert list(df["rain_prob"].round(3)) == [round(i / 11, 3) for i in range(4)]


def test_parse_nws_stations_filters_and_sorts():
    stations = observations.parse_nws_stations(NWS_STATIONS, DENVER)
    assert [s.id for s in stations] == ["KBKF", "KDEN"]
    assert stations[0].distance_km < stations[1].distance_km


def test_station_quality_warnings():
    far = observations.Station("KXYZ", "Far", 40.5, -104.99, 2000, 85.0)
    warnings = far.quality_warnings(DENVER)
    assert any("85 km" in w for w in warnings)
    assert any("elevation" in w for w in warnings)
    near = observations.Station("KABC", "Near", 39.75, -104.98, 1620, 2.0)
    assert near.quality_warnings(DENVER) == []


def test_iem_station_id():
    assert observations.iem_station_id("KDEN") == "DEN"
    assert observations.iem_station_id("PANC") == "PANC"


def test_daily_from_hourly():
    df = observations.daily_from_hourly(observations.parse_iem_csv(iem_csv(date(2026, 10, 1), 2)))
    assert len(df) == 2
    assert df["tmax"].iloc[0] == pytest.approx(65.0, abs=0.1)
    assert df["tmin"].iloc[0] == pytest.approx(45.0, abs=0.1)
    assert df["wind"].iloc[0] == pytest.approx(10.0, abs=0.05)
    assert df["precip"].iloc[0] == pytest.approx(0.10)
    assert df["gust"].isna().all()


def test_daily_from_hourly_requires_enough_reports():
    text = "\n".join(iem_csv(date(2026, 10, 1), 1).splitlines()[:11])  # 10 reports
    df = observations.daily_from_hourly(observations.parse_iem_csv(text))
    assert df[["tmax", "tmin", "precip"]].isna().all().all()
