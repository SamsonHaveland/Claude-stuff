import json
from pathlib import Path

from weather_engine.records import PRECIP, TEMPERATURE, WIND
from weather_engine.sources import iem, nws, open_meteo
from weather_engine.timeutil import DAY, HOUR, parse_iso

FIXTURES = Path(__file__).parent / "fixtures"


def test_iem_parse_units_and_hour_alignment():
    rows = iem.parse_csv((FIXTURES / "iem_knyc.csv").read_text(), "nyc", "KNYC")
    by = {(r.variable, r.valid_time): r.value for r in rows}
    # 2026-11-08 00:51 report -> 01:00 hour; 51F, 5 kt, 0.00 in
    t = parse_iso("2026-11-08T01:00:00Z")
    assert abs(by[(TEMPERATURE, t)] - (51 - 32) * 5 / 9) < 1e-9
    assert abs(by[(WIND, t)] - 5 * 0.514444) < 1e-9
    assert by[(PRECIP, t)] == 0.0
    # 03:51 report has p01i "T" (trace) -> 0 mm
    assert by[(PRECIP, parse_iso("2026-11-08T04:00:00Z"))] == 0.0


def test_iem_missing_values_skipped():
    text = "station,valid,tmpf,sknt,p01i\nNYC,2026-11-08 00:51,M,M,0.10\n"
    rows = iem.parse_csv(text, "nyc", "KNYC")
    assert [(r.variable, round(r.value, 3)) for r in rows] == [(PRECIP, 2.54)]


def test_nws_gridpoints_expand_and_convert():
    payload = json.loads((FIXTURES / "nws_gridpoints.json").read_text())
    rows = nws.parse_gridpoints(payload, "nyc")
    issue = parse_iso("2026-11-10T19:00:00Z")
    assert {r.issue_time for r in rows} == {issue}
    assert all(r.valid_time >= issue for r in rows)  # past hours dropped
    assert rows and all(r.source == "nws" for r in rows)


def test_nws_precip_spread_over_interval():
    payload = {"properties": {
        "updateTime": "2026-11-10T00:10:00+00:00",
        "quantitativePrecipitation": {"uom": "wmoUnit:mm", "values": [
            {"validTime": "2026-11-10T00:00:00+00:00/PT6H", "value": 6.0}]},
        "windSpeed": {"uom": "wmoUnit:km_h-1", "values": [
            {"validTime": "2026-11-10T00:00:00+00:00/PT2H", "value": 36.0}]},
    }}
    rows = nws.parse_gridpoints(payload, "x")
    precip = sorted((r.valid_time, r.value) for r in rows if r.variable == PRECIP)
    start = parse_iso("2026-11-10T00:00:00Z")
    assert precip == [(start + h * HOUR, 1.0) for h in range(1, 7)]
    assert sorted(r.value for r in rows if r.variable == WIND) == [10.0, 10.0]


def test_open_meteo_multi_model_forecast():
    payload = {"hourly": {
        "time": [1000 * HOUR, 1001 * HOUR],
        "temperature_2m_gfs_seamless": [1.0, None],
        "temperature_2m_ecmwf_ifs025": [2.0, 3.0],
        "cloud_cover_gfs_seamless": [50, 60],
    }}
    rows = open_meteo.parse_hourly(payload, "x", ["gfs_seamless", "ecmwf_ifs025"], issue_time=999 * HOUR)
    assert sorted((r.source, r.valid_time, r.value) for r in rows) == [
        ("om:ecmwf_ifs025", 1000 * HOUR, 2.0),
        ("om:ecmwf_ifs025", 1001 * HOUR, 3.0),
        ("om:gfs_seamless", 1000 * HOUR, 1.0),
    ]
    assert {r.issue_time for r in rows} == {999 * HOUR}


def test_open_meteo_previous_runs_issue_time():
    t = 2000 * HOUR
    payload = {"hourly": {
        "time": [t],
        "precipitation_previous_day3": [0.4],
        "wind_speed_10m_previous_day1": [5.0],
    }}
    rows = open_meteo.parse_hourly(payload, "x", ["icon_seamless"])
    got = {(r.variable, r.issue_time) for r in rows}
    assert got == {(PRECIP, t - 3 * DAY), (WIND, t - DAY)}
    assert {r.source for r in rows} == {"om:icon_seamless"}


def test_mos_issue_time_includes_availability_lag():
    from weather_engine.sources import iem_mos
    text = (
        "runtime,ftime,model,tmp,wsp,station\n"
        "2026-11-01 00:00:00,2026-11-01 03:00:00,GFS,50,10,KNYC\n"
        "2026-11-01 00:00:00,2026-11-01 06:00:00,GFS,32,,KNYC\n"
        "2026-11-01 00:00:00,2026-11-01 06:00:00,XYZ,32,1,KNYC\n"
    )
    rows = iem_mos.parse_csv(text, "nyc")
    run = parse_iso("2026-11-01T00:00:00Z")
    # 03Z is before the 05Z availability time, so it is not a forecast at all.
    assert [(r.variable, r.issue_time, r.valid_time, r.value) for r in rows] == [
        (TEMPERATURE, run + 5 * HOUR, run + 6 * HOUR, 0.0)
    ]
    assert rows[0].source == "mos:GFS"


def test_mos_interpolates_three_hourly_steps():
    from weather_engine.sources import iem_mos
    text = (
        "runtime,ftime,model,tmp,wsp,station\n"
        "2026-11-01 00:00:00,2026-11-01 06:00:00,GFS,32,,KNYC\n"
        "2026-11-01 00:00:00,2026-11-01 09:00:00,GFS,41,,KNYC\n"
        "2026-11-01 00:00:00,2026-11-02 09:00:00,GFS,50,,KNYC\n"
    )
    rows = iem_mos.parse_csv(text, "nyc")
    run = parse_iso("2026-11-01T00:00:00Z")
    got = sorted((r.valid_time - run) // HOUR for r in rows)
    assert got == [6, 7, 8, 9, 33]  # 24h gap is not filled
    assert abs(next(r.value for r in rows if r.valid_time == run + 7 * HOUR) - 1.6667) < 1e-3
