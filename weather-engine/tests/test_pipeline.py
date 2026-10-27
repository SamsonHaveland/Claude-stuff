"""End-to-end run against synthetic API responses (see conftest.fake_api)."""

from datetime import date

import pandas as pd
import pytest

from weather_engine import report, store, verify
from weather_engine.cli import main
from weather_engine.config import Location
from weather_engine.forecast import run_forecast

from conftest import TODAY


def test_forecast_calibrates_out_model_biases(fake_api):
    loc = Location("Denver, Colorado", 39.74, -104.99)
    result = run_forecast(loc)
    assert result.station.id == "KBKF"
    stats = result.stats.set_index(["model", "lead", "var"])
    # Synthetic past runs carry the per-model warm biases set in conftest.
    assert stats.loc[("gfs_seamless", 3, "tmax"), "bias"] == pytest.approx(3.0, abs=0.2)
    assert stats.loc[("icon_seamless", 3, "tmin"), "bias"] == pytest.approx(-2.0, abs=0.2)
    # Live forecasts carry the same biases, so corrected models should all agree.
    tmax = result.blend[result.blend["var"] == "tmax"].set_index("lead")
    assert tmax.loc[1, "value"] == pytest.approx(71.0, abs=0.3)
    assert tmax.loc[1, "high"] - tmax.loc[1, "low"] < 0.5
    assert tmax["calibrated"].all()
    assert len(result.rain_prob) == 8
    assert loc.timezone == "America/Denver"


def test_forecast_logs_blend_and_raw(fake_api):
    run_forecast(Location("Denver", 39.74, -104.99))
    log = store.read_log()
    assert {"blend", "ecmwf_ifs025", "gfs_seamless"} <= set(log["source"])
    assert (log["station"] == "KBKF").all()


def test_poor_station_match_falls_back_to_raw_blend(fake_api):
    loc = Location("Far away", 41.5, -104.99)  # ~200 km from the synthetic stations
    result = run_forecast(loc)
    assert result.stats is None
    assert not result.blend["calibrated"].any()
    assert any("poor match" in n for n in result.notes)


def test_failed_model_is_skipped(fake_api, monkeypatch):
    from weather_engine import http

    real = http.get_json

    def flaky(url, params=None):
        if params and params.get("models") == "gem_seamless" and "api.open-meteo.com" in url:
            raise RuntimeError("boom")
        return real(url, params)

    monkeypatch.setattr(http, "get_json", flaky)
    result = run_forecast(Location("Denver", 39.74, -104.99))
    assert "gem_seamless" not in set(result.raw["model"])
    assert any("gem_seamless" in n for n in result.notes)


def test_reports_render(fake_api):
    result = run_forecast(Location("Denver", 39.74, -104.99))
    text = report.to_text(result)
    assert "Calibrated against station KBKF" in text
    assert "Open-Meteo.com" in text
    assert "Calibration (last" in text and "High" in text
    path = report.to_html(result, fake_api / "r.html")
    assert "<table>" in path.read_text()


def test_cli_forecast_geocodes(fake_api, capsys):
    main(["forecast", "Denver, CO", "--locations", str(fake_api / "none.yaml")])
    out = capsys.readouterr().out
    assert "Denver, Colorado" in out and "High" in out


def test_verify_scores_logged_forecasts(fake_api):
    run_forecast(Location("Denver", 39.74, -104.99))
    scores = verify.run_verification(today=date(2026, 11, 4))
    assert not scores.empty
    tmax = scores[(scores["var"] == "tmax") & (scores["source"] == "blend")]
    assert set(tmax["lead"]) == set(range(8))
    assert (scores["n"] > 0).all()


def test_score_keeps_latest_issue():
    log = pd.DataFrame([
        {"issued_at": "2026-10-27T00:00", "location": "x", "date": TODAY, "lead": 0, "var": "tmax", "source": "blend", "value": 50.0},
        {"issued_at": "2026-10-27T06:00", "location": "x", "date": TODAY, "lead": 0, "var": "tmax", "source": "blend", "value": 60.0},
    ])
    obs = pd.DataFrame([{"location": "x", "date": TODAY, "var": "tmax", "obs": 61.0}])
    s = verify.score(log, obs)
    assert s["mae"].iloc[0] == 1.0 and s["n"].iloc[0] == 1
