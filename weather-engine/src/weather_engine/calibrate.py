"""Per-location bias correction and skill-weighted model blending.

Phase 1 of ARCHITECTURE.md: for each (model, lead day, variable) learn the
model's recent systematic error at this location from archived past runs vs
station observations, remove it, then weight models by their corrected skill.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import regime
from .config import MAX_LEAD, MIN_TRAIN_SAMPLES, train_window

KEYS = ["model", "lead", "var"]
# Variables corrected with a scale as well as a shift (see fit); others get a shift only.
# Off until a real-data backtest shows it helps (candidates: "wind", "gust").
SLOPE_VARS: tuple[str, ...] = ()
SLOPE_SHRINK_DAYS = 30
# How hard a noisy bias is pulled toward zero: weight = b^2 / (b^2 + BIAS_SHRINK * se^2).
BIAS_SHRINK = 1.0


def obs_long(obs_daily: pd.DataFrame) -> pd.DataFrame:
    """Wide daily obs (index date, canonical columns) -> long (date, var, obs)."""
    out = obs_daily.rename_axis("date").reset_index().melt(
        id_vars="date", var_name="var", value_name="obs"
    )
    return out.dropna(subset=["obs"])


def build_pairs(past_runs: pd.DataFrame, obs_daily: pd.DataFrame) -> pd.DataFrame:
    """Join archived forecasts (date, lead, var, value, model) with observations."""
    pairs = past_runs.merge(obs_long(obs_daily), on=["date", "var"], how="inner")
    return pairs.rename(columns={"value": "fcst"})


def fit(
    pairs: pd.DataFrame,
    as_of: date,
    window_days: int | None = None,
    min_samples: int = MIN_TRAIN_SAMPLES,
) -> pd.DataFrame:
    """Correction stats per (model, lead, var) over a rolling window (config.train_window per variable,
    or `window_days` for every variable)."""
    rows = []
    for (model, lead, var), g in pairs.groupby(KEYS):
        g = g[g["date"] > as_of - timedelta(days=window_days or train_window(var))]
        if g.empty:
            continue
        n = len(g)
        bias, ratio, slope = 0.0, 1.0, 1.0
        err = g["fcst"] - g["obs"]
        if var == "precip":
            # Multiplicative so corrected rain can never go negative; shrunk toward 1
            # when there are few days, since rain totals are noisy.
            if g["fcst"].sum() > 0.1:
                ratio = float(np.clip(g["obs"].sum() / g["fcst"].sum(), 0.5, 2.0))
                ratio = 1.0 + (ratio - 1.0) * n / (n + 10)
            corrected = g["fcst"] * ratio
        else:
            if var in SLOPE_VARS and n >= MIN_TRAIN_SAMPLES and g["fcst"].var() > 0:
                # Models tend to over-forecast light winds and under-forecast strong ones:
                # scale around the mean as well as shift. The fitted slope is shrunk toward
                # 1 (no scaling) until there are enough days to trust it.
                b = float(np.cov(g["fcst"], g["obs"])[0, 1] / g["fcst"].var())
                slope = float(np.clip(1.0 + (b - 1.0) * n / (n + SLOPE_SHRINK_DAYS), 0.6, 1.4))
                err = slope * g["fcst"] - g["obs"]
            # Shrink the bias by how well it's determined: a consistent error is
            # trusted even from a few days, a noisy one is scaled down.
            raw_bias = float(err.mean())
            se2 = float(err.var(ddof=1)) / n if n > 1 else float("inf")
            denom = raw_bias**2 + BIAS_SHRINK * se2
            weight = 1.0 if denom == 0 else raw_bias**2 / denom
            bias = raw_bias * weight
            corrected = slope * g["fcst"] - bias
        rows.append({
            "model": model, "lead": lead, "var": var, "n": n,
            "bias": bias, "ratio": ratio, "slope": slope,
            "mae_raw": float((g["fcst"] - g["obs"]).abs().mean()),
            "mae_cal": float((corrected - g["obs"]).abs().mean()),
        })
    stats = pd.DataFrame(rows, columns=KEYS + ["n", "bias", "ratio", "slope", "mae_raw", "mae_cal"])
    # Too few samples: keep the stats for reporting but don't correct or weight.
    thin = stats["n"] < min_samples
    stats.loc[thin, ["bias", "ratio", "slope", "mae_cal"]] = [0.0, 1.0, 1.0, np.nan]
    return stats


def apply(raw: pd.DataFrame, stats: pd.DataFrame | None, pattern=None, feats: pd.DataFrame | None = None) -> pd.DataFrame:
    """Correct raw forecasts (date, lead, model, var, value) -> adds value_cal, mae_cal.

    With a fitted regime.RegimeModel (`pattern`) and the forecast's daily pattern
    features, each model's correction also depends on the day's weather pattern.
    """
    df = raw.copy()
    df["stats_lead"] = df["lead"].clip(1, MAX_LEAD)
    if stats is None or stats.empty:
        df["value_cal"], df["mae_cal"] = df["value"], np.nan
        return df.drop(columns="stats_lead")
    if "slope" not in stats:  # stats saved by an older version
        stats = stats.assign(slope=1.0)
    s = stats.rename(columns={"lead": "stats_lead"})[["model", "stats_lead", "var", "bias", "ratio", "slope", "mae_cal"]]
    df = df.merge(s, on=["model", "stats_lead", "var"], how="left")
    if pattern is not None and feats is not None:
        df = regime.adjust(pattern, df, feats)
        # A pattern correction is learned on unscaled errors, so it replaces the scaling too.
        df.loc[df["pattern_n"].notna(), "slope"] = 1.0
    df["value_cal"] = df["value"] * df["ratio"].fillna(1.0) * df["slope"].fillna(1.0) - df["bias"].fillna(0.0)
    df.loc[df["var"] == "precip", "value_cal"] = df["value_cal"].clip(lower=0)
    return df.drop(columns=["stats_lead", "bias", "ratio", "slope"])


def blend(corrected: pd.DataFrame) -> pd.DataFrame:
    """Skill-weighted mean across models per (date, lead, var), with model range."""
    rows = []
    for (d, lead, var), g in corrected.dropna(subset=["value_cal"]).groupby(["date", "lead", "var"]):
        if g["mae_cal"].notna().sum() >= 2:
            # Models with a local track record outvote ones without (e.g. a model whose
            # history couldn't be downloaded): an unknown bias shouldn't dilute known-good ones.
            g = g[g["mae_cal"].notna()]
        w = 1.0 / g["mae_cal"].clip(lower=0.1) ** 2
        w = w.fillna(w.mean() if w.notna().any() else 1.0)
        rows.append({
            "date": d, "lead": lead, "var": var,
            "value": float(np.average(g["value_cal"], weights=w)),
            "low": float(g["value_cal"].min()),
            "high": float(g["value_cal"].max()),
            "n_models": len(g),
            "calibrated": bool(g["mae_cal"].notna().any()),
        })
    out = pd.DataFrame(rows)
    return _gust_at_least_wind(out)


def _gust_at_least_wind(blended: pd.DataFrame) -> pd.DataFrame:
    """Wind and gusts are corrected separately; a gust can never be below the sustained wind."""
    if blended.empty or not {"wind", "gust"} <= set(blended["var"]):
        return blended
    wind = blended[blended["var"] == "wind"].set_index(["date", "lead"])
    is_gust = blended["var"] == "gust"
    keys = pd.MultiIndex.from_frame(blended.loc[is_gust, ["date", "lead"]])
    for col in ("value", "low", "high"):
        floor = wind[col].reindex(keys).to_numpy()
        current = blended.loc[is_gust, col].to_numpy()
        blended.loc[is_gust, col] = np.where(np.isnan(floor), current, np.fmax(current, floor))
    return blended
