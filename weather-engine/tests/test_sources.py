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


def test_pick_geocode_result_prefers_us_on_a_tie():
    results = [{"name": "Paris", "country_code": "FR"}, {"name": "Paris", "admin1": "Texas", "country_code": "US"}]
    assert openmeteo.pick_geocode_result(results, None)["country_code"] == "US"


# Trimmed from real geocoder answers (2026-11-12): the cases that used to land in the wrong place.
CARBO = [
    {"name": "Carbon", "admin1": "Indiana", "country_code": "US", "country": "United States", "population": 397, "feature_code": "PPL"},
    {"name": "Carbó", "admin1": "Sonora", "country_code": "MX", "country": "Mexico", "population": 4516, "feature_code": "PPLA2"},
    {"name": "Carbo", "admin1": "Virginia", "country_code": "US", "country": "United States", "feature_code": "PPL"},
    {"name": "Carbón", "admin1": "Jalisco", "country_code": "MX", "country": "Mexico", "population": 17, "feature_code": "PPL"},
]
PARIS = [
    {"name": "Paris", "admin1": "Île-de-France Region", "country_code": "FR", "country": "France", "population": 2138551, "feature_code": "PPLC"},
    {"name": "Paris", "admin1": "Texas", "country_code": "US", "country": "United States", "population": 25171, "feature_code": "PPLA2"},
]
TORONTO = [
    {"name": "Toronto", "admin1": "Ontario", "country_code": "CA", "country": "Canada", "population": 2600000, "feature_code": "PPLA"},
    {"name": "Toronto", "admin1": "Ohio", "country_code": "US", "country": "United States", "population": 5000, "feature_code": "PPL"},
    {"name": "Toronto State Park", "admin1": "Kansas", "country_code": "US", "feature_code": "PRK"},
]


def _best(results, query):
    return openmeteo.pick_geocode_results(results, query)[0]


def test_exact_name_beats_us_preference_and_accents_dont_matter():
    assert _best(CARBO, "Carbo")["admin1"] == "Sonora"
    assert _best(CARBO, "Carbó")["admin1"] == "Sonora"


def test_country_and_state_hints():
    assert _best(CARBO, "Carbo, Mexico")["admin1"] == "Sonora"
    assert _best(CARBO, "Carbo, MX")["admin1"] == "Sonora"
    assert _best(CARBO, "Carbo, VA")["admin1"] == "Virginia"
    assert _best(PARIS, "Paris, France")["country_code"] == "FR"
    assert _best(PARIS, "Paris, TX")["admin1"] == "Texas"
    assert _best(TORONTO, "Toronto, Canada")["admin1"] == "Ontario"
    assert _best(TORONTO, "Toronto, USA")["admin1"] == "Ohio"


def test_a_much_bigger_place_wins_without_a_hint():
    assert _best(PARIS, "Paris")["country_code"] == "FR"
    assert _best(TORONTO, "Toronto")["admin1"] == "Ontario"


def test_hint_never_matches_a_missing_field():
    # The park has no admin2/country: an unknown hint must not match its empty fields.
    assert openmeteo.pick_geocode_results(TORONTO, "Toronto, Canadaa") == []


def test_search_nicknames_alternatives_and_names(monkeypatch):
    cabo = [
        {"name": "Cabo San Lucas", "admin1": "Baja California Sur", "country_code": "MX", "country": "Mexico",
         "population": 202694, "feature_code": "PPLA2", "latitude": 22.89, "longitude": -109.91},
        {"name": "Cabo San Lucas International Airport", "admin1": "Baja California Sur", "country_code": "MX",
         "country": "Mexico", "feature_code": "AIRP", "latitude": 22.9, "longitude": -109.9},
    ]
    asked = []

    def fake(url, params):
        asked.append(params["name"])
        if params["name"] == "Cabo San Lucas":
            return {"results": cabo}
        return {"results": [dict(r, latitude=1.0, longitude=2.0) for r in TORONTO]}
    monkeypatch.setattr(openmeteo.http, "get_json", fake)

    found = openmeteo.search("cabo, Mexico")
    assert asked == ["Cabo San Lucas"]  # nickname expanded before asking the geocoder
    assert [loc.name for loc in found] == ["Cabo San Lucas, Baja California Sur, Mexico"]  # no airport offered

    found = openmeteo.search("Toronto")
    assert [loc.name for loc in found] == ["Toronto, Ontario, Canada", "Toronto, Ohio"]  # US names unchanged
    with pytest.raises(ValueError, match="Did you mean: Toronto, Ontario, Canada"):
        openmeteo.search("Toronto, Canadaa")


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
    # No gust reported -> gust equals sustained wind, not missing.
    assert df["gust"].iloc[0] == pytest.approx(df["wind"].iloc[0])


def test_daily_from_hourly_requires_enough_reports():
    text = "\n".join(iem_csv(date(2026, 10, 1), 1).splitlines()[:11])  # 10 reports
    df = observations.daily_from_hourly(observations.parse_iem_csv(text))
    assert df[["tmax", "tmin", "precip"]].isna().all().all()
