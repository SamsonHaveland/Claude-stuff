"""Weather-pattern corrections and the past-runs archive (synthetic data)."""

from datetime import date, timedelta

import numpy as np
import pandas as pd

from weather_engine import calibrate, history, regime

AS_OF = date(2026, 10, 26)


def synthetic(days=300, pattern_bias=4.0, noise=1.0, seed=0):
    """One model, lead 1, tmax: runs `pattern_bias` too warm whenever wind is from the SW."""
    rng = np.random.default_rng(seed)
    dates = [AS_OF - timedelta(days=i) for i in range(days)][::-1]
    wind_dir = rng.choice([45.0, 225.0], size=days)  # NE or SW, alternating at random
    pressure = 1013 + rng.normal(0, 6, days)
    obs = 70 + rng.normal(0, 5, days)
    err = np.where(wind_dir == 225.0, pattern_bias, 0.0) + rng.normal(0, noise, days)
    pairs = pd.DataFrame({"date": dates, "lead": 1, "model": "m", "var": "tmax", "fcst": obs + err, "obs": obs})
    feats = pd.DataFrame({"date": dates, "lead": 1, "model": "m", "wind_dir": wind_dir, "wind_speed": 10.0,
                          "pressure": pressure, "tendency": np.r_[np.nan, np.diff(pressure)],
                          "doy": [float(d.timetuple().tm_yday) for d in dates]})
    return pairs, feats


def test_pattern_bias_is_learned_and_switched_on():
    pairs, feats = synthetic()
    rm = regime.fit(pairs, feats, AS_OF)
    assert rm is not None and rm.active("tmax")
    row = rm.cv.set_index("var").loc["tmax"]
    assert row["gain"] > 0.3  # held-out error falls by well over a third

    # Tomorrow: one SW day and one NE day, same raw forecast.
    tomorrow = AS_OF + timedelta(days=1)
    raw = pd.DataFrame({"date": [tomorrow, tomorrow + timedelta(days=1)], "lead": [1, 2], "model": "m",
                        "var": "tmax", "value": [80.0, 80.0]})
    live = pd.DataFrame({"date": raw["date"], "lead": [1, 2], "model": "m", "wind_dir": [225.0, 45.0],
                         "wind_speed": 10.0, "pressure": 1013.0, "tendency": 0.0, "doy": 300.0})
    stats = calibrate.fit(pairs, AS_OF)
    out = calibrate.apply(raw, stats, rm, live).set_index("lead")
    assert out.loc[1, "value_cal"] < 77.5  # SW: ~4 F warm bias removed
    # NE row uses the lead-1 statistics too (lead 2 has none), and the NE days had no bias.
    assert out.loc[2, "value_cal"] > 79.0


def test_no_pattern_means_no_pattern_correction():
    pairs, feats = synthetic(pattern_bias=0.0, noise=2.0, seed=1)
    rm = regime.fit(pairs, feats, AS_OF)
    assert rm is not None and not rm.active("tmax")


def test_needs_enough_history():
    pairs, feats = synthetic(days=60)
    assert regime.fit(pairs, feats, AS_OF) is None


def test_features_from_hourly_runs():
    times = pd.date_range("2026-10-01", periods=48, freq="h")
    rows = []
    for hvar, values in {"wind_speed_10m": [10.0] * 48, "wind_direction_10m": [270.0] * 48,
                         "pressure_msl": [1010.0] * 24 + [1004.0] * 24}.items():
        rows.append(pd.DataFrame({"time": times, "lead": 1, "hvar": hvar, "value": values, "model": "m"}))
    f = regime.features_from_past_runs(pd.concat(rows)).set_index("date")
    assert abs(f["wind_dir"].iloc[0] - 270) < 1e-6
    assert np.isnan(f["tendency"].iloc[0]) and f["tendency"].iloc[1] == -6.0
    words = regime.describe(pd.Series({"wind_dir": 270, "wind_agree": 1, "wind_speed": 10,
                                       "pressure_anom": -6, "tendency": -6}))
    assert words == "wind from the W, low pressure, pressure falling fast (a system approaching)"


def test_missing_spans_fetch_new_then_backfill():
    start, end = date(2025, 10, 1), date(2026, 10, 26)
    first = history.missing_spans(None, start, end, backfill_chunks=1)
    assert first[0] == (end - timedelta(days=history.CHUNK_DAYS - 1), end)
    assert first[1][1] == first[0][0] - timedelta(days=1)
    have = pd.DataFrame({"x": 1.0}, index=pd.date_range("2026-06-01", "2026-10-20 23:00", freq="h"))
    spans = history.missing_spans(have, start, end, backfill_chunks=1)
    assert spans[0] == (date(2026, 10, 20) - timedelta(days=history.REFRESH_DAYS), end)
    assert spans[1] == (date(2026, 6, 1) - timedelta(days=history.CHUNK_DAYS), date(2026, 5, 31))
    full = pd.DataFrame({"x": 1.0}, index=pd.date_range(start, "2026-10-26 23:00", freq="h"))
    assert history.missing_spans(full, start, end, 1) == [(end - timedelta(days=history.REFRESH_DAYS), end)]


def test_archive_grows_and_is_reused(fake_api, monkeypatch):
    from weather_engine import store
    from weather_engine.config import Location
    from weather_engine.sources import openmeteo

    loc = Location("Denver", 39.74, -104.99)
    calls = []
    real = openmeteo.fetch_previous_runs_range
    monkeypatch.setattr(openmeteo, "fetch_previous_runs_range",
                        lambda *a: calls.append(a[2:]) or real(*a))
    end = date(2026, 10, 26)
    start = end - timedelta(days=200)
    history.update(loc, "ecmwf_ifs025", start, end)
    assert len(calls) == 2  # newest chunk + one older chunk
    first = store.read_runs(history.archive_name(loc, "ecmwf_ifs025")).index.min()
    calls.clear()
    history.update(loc, "ecmwf_ifs025", start, end)
    assert len(calls) == 1  # just updated: no refresh of the newest week, one more older chunk
    assert store.read_runs(history.archive_name(loc, "ecmwf_ifs025")).index.min() < first
    windows, feats = history.daily(loc, "ecmwf_ifs025", start, end, {24, 7})
    assert set(windows) == {24, 7} and {"tmax", "precip"} <= set(windows[24]["var"])
    assert history.daily(loc, "ecmwf_ifs025", start, end, {24, 7}) is not None  # served from memory


def test_backtest_replays_without_peeking(fake_api):
    from weather_engine import backtest, report
    from weather_engine.config import MODELS, Location
    from weather_engine.forecast import training_data

    loc = Location("Denver, Colorado", 39.74, -104.99, elevation=1609, timezone="America/Denver")
    today = date(2026, 10, 27)
    td = training_data(loc, MODELS[:4], today, [], backfill_chunks=10)
    results = backtest.run(td.pairs, td.feats, today, days=20, refit_every=5)
    assert not results.empty and results["date"].max() < today
    summary = backtest.summarize(results)
    tmax = summary[summary["var"] == "tmax"].iloc[0]
    # The fake models carry constant biases (GFS +3 F etc.): correction must beat the raw average.
    assert tmax["plain"] < tmax["mean"]
    text = report.backtest_to_text(summary)
    print(text)
    assert "Bias-corrected" in text
