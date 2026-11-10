from weather_engine import db
from weather_engine.locations import load_locations
from weather_engine.records import TEMPERATURE, Forecast, Observation


def test_round_trip_and_idempotent(tmp_path):
    conn = db.connect(tmp_path / "w.db")
    rows = [Forecast("x", "m", TEMPERATURE, 0, 3600, 1.5)]
    db.save_forecasts(conn, rows)
    db.save_forecasts(conn, rows)  # re-running an ingest is safe
    assert db.load_forecasts(conn, "x", 0, 7200) == rows
    db.save_observations(conn, [Observation("x", TEMPERATURE, 3600, 1.0, "KXYZ")])
    assert db.load_observations(conn, "x", 0, 7200) == {(TEMPERATURE, 3600): 1.0}
    assert db.time_range(conn, "x") == (3600, 3600)


def test_skip_unchanged_stores_each_run_once(tmp_path):
    conn = db.connect(tmp_path / "w.db")
    first = [Forecast("x", "m", TEMPERATURE, 0, 36000, 5.0)]
    assert db.save_forecasts(conn, first, skip_unchanged=True) == 1
    same_run_polled_later = [Forecast("x", "m", TEMPERATURE, 3600, 36000, 5.0)]
    assert db.save_forecasts(conn, same_run_polled_later, skip_unchanged=True) == 0
    new_run = [Forecast("x", "m", TEMPERATURE, 7200, 36000, 6.0)]
    assert db.save_forecasts(conn, new_run, skip_unchanged=True) == 1


def test_example_locations_file_loads():
    from weather_engine.config import PROJECT_ROOT
    locs = load_locations(PROJECT_ROOT / "locations.toml")
    assert locs and locs[0].station
