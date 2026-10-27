from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from weather_engine import calibrate

AS_OF = date(2026, 10, 26)


def make_pairs(model: str, bias: float, noise: float, n: int = 40, var: str = "tmax", lead: int = 1, seed: int = 0):
    rng = np.random.default_rng(seed)
    obs = 60 + rng.normal(0, 5, n)
    return pd.DataFrame({
        "date": [AS_OF - timedelta(days=i) for i in range(n)],
        "lead": lead, "var": var, "model": model,
        "obs": obs, "fcst": obs + bias + rng.normal(0, noise, n),
    })


def test_fit_learns_bias_and_skill():
    pairs = pd.concat([make_pairs("a", 3.0, 0.5), make_pairs("b", -1.0, 3.0, seed=1)])
    stats = calibrate.fit(pairs, AS_OF, window_days=60).set_index("model")
    assert stats.loc["a", "bias"] == pytest.approx(3.0, abs=0.3)
    assert stats.loc["b", "bias"] == pytest.approx(-1.0, abs=1.0)
    assert stats.loc["a", "mae_cal"] < stats.loc["a", "mae_raw"]
    assert stats.loc["a", "mae_cal"] < stats.loc["b", "mae_cal"]


def test_fit_respects_window_and_min_samples():
    pairs = make_pairs("a", 3.0, 0.5, n=40)
    stats = calibrate.fit(pairs, AS_OF, window_days=10, min_samples=20)
    row = stats.iloc[0]
    assert row["n"] == 10
    assert row["bias"] == 0.0 and np.isnan(row["mae_cal"])


def test_precip_correction_is_multiplicative_and_clipped():
    pairs = make_pairs("a", 0.0, 0.0, var="precip")
    pairs["obs"], pairs["fcst"] = 0.1, 0.5  # model 5x too wet -> clipped to 0.5
    stats = calibrate.fit(pairs, AS_OF)
    assert stats.iloc[0]["ratio"] == 0.5
    assert stats.iloc[0]["bias"] == 0.0


def test_apply_and_blend_weights_better_model():
    stats = pd.DataFrame([
        {"model": "a", "lead": 1, "var": "tmax", "n": 40, "bias": 2.0, "ratio": 1.0, "mae_raw": 2.5, "mae_cal": 1.0},
        {"model": "b", "lead": 1, "var": "tmax", "n": 40, "bias": 0.0, "ratio": 1.0, "mae_raw": 3.0, "mae_cal": 3.0},
    ])
    raw = pd.DataFrame([
        {"date": AS_OF, "lead": 1, "model": "a", "var": "tmax", "value": 72.0},
        {"date": AS_OF, "lead": 1, "model": "b", "var": "tmax", "value": 60.0},
    ])
    out = calibrate.blend(calibrate.apply(raw, stats)).iloc[0]
    # a corrected to 70 with weight 1, b stays 60 with weight 1/9
    assert out["value"] == pytest.approx((70 * 1 + 60 / 9) / (1 + 1 / 9))
    assert (out["low"], out["high"]) == (60.0, 70.0)
    assert out["calibrated"]


def test_apply_without_stats_is_equal_weight_raw_blend():
    raw = pd.DataFrame([
        {"date": AS_OF, "lead": 0, "model": m, "var": "tmax", "value": v} for m, v in (("a", 70.0), ("b", 74.0))
    ])
    out = calibrate.blend(calibrate.apply(raw, None)).iloc[0]
    assert out["value"] == 72.0 and not out["calibrated"]


def test_apply_lead_zero_uses_lead_one_stats_and_never_negative_rain():
    stats = pd.DataFrame([{"model": "a", "lead": 1, "var": "precip", "n": 40, "bias": 0.0,
                           "ratio": 0.5, "mae_raw": 0.1, "mae_cal": 0.05}])
    raw = pd.DataFrame([{"date": AS_OF, "lead": 0, "model": "a", "var": "precip", "value": 0.4}])
    assert calibrate.apply(raw, stats)["value_cal"].iloc[0] == pytest.approx(0.2)
