"""Per-location bias correction and skill-weighted model blending.

Phase 1 of ARCHITECTURE.md: for each (model, lead day, variable) learn the
model's recent systematic error at this location from archived past runs vs
station observations, remove it, then weight models by their corrected skill.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

from .config import MAX_LEAD, MIN_TRAIN_SAMPLES, TRAIN_WINDOW_DAYS

KEYS = ["model", "lead", "var"]


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
    window_days: int = TRAIN_WINDOW_DAYS,
    min_samples: int = MIN_TRAIN_SAMPLES,
) -> pd.DataFrame:
    """Correction stats per (model, lead, var) over a rolling window."""
    recent = pairs[pairs["date"] > as_of - timedelta(days=window_days)]
    rows = []
    for (model, lead, var), g in recent.groupby(KEYS):
        n = len(g)
        bias, ratio = 0.0, 1.0
        err = g["fcst"] - g["obs"]
        if var == "precip":
            # Multiplicative so corrected rain can never go negative; shrunk toward 1
            # when there are few days, since rain totals are noisy.
            if g["fcst"].sum() > 0.1:
                ratio = float(np.clip(g["obs"].sum() / g["fcst"].sum(), 0.5, 2.0))
                ratio = 1.0 + (ratio - 1.0) * n / (n + 10)
            corrected = g["fcst"] * ratio
        else:
            # Shrink the bias by how well it's determined: a consistent error is
            # trusted even from a few days, a noisy one is scaled down.
            raw_bias = float(err.mean())
            se2 = float(err.var(ddof=1)) / n if n > 1 else float("inf")
            denom = raw_bias**2 + se2
            weight = 1.0 if denom == 0 else raw_bias**2 / denom
            bias = raw_bias * weight
            corrected = g["fcst"] - bias
        rows.append({
            "model": model, "lead": lead, "var": var, "n": n,
            "bias": bias, "ratio": ratio,
            "mae_raw": float((g["fcst"] - g["obs"]).abs().mean()),
            "mae_cal": float((corrected - g["obs"]).abs().mean()),
        })
    stats = pd.DataFrame(rows, columns=KEYS + ["n", "bias", "ratio", "mae_raw", "mae_cal"])
    # Too few samples: keep the stats for reporting but don't correct or weight.
    thin = stats["n"] < min_samples
    stats.loc[thin, ["bias", "ratio", "mae_cal"]] = [0.0, 1.0, np.nan]
    return stats


def apply(raw: pd.DataFrame, stats: pd.DataFrame | None) -> pd.DataFrame:
    """Correct raw forecasts (date, lead, model, var, value) -> adds value_cal, mae_cal."""
    df = raw.copy()
    df["stats_lead"] = df["lead"].clip(1, MAX_LEAD)
    if stats is None or stats.empty:
        df["value_cal"], df["mae_cal"] = df["value"], np.nan
        return df.drop(columns="stats_lead")
    s = stats.rename(columns={"lead": "stats_lead"})[["model", "stats_lead", "var", "bias", "ratio", "mae_cal"]]
    df = df.merge(s, on=["model", "stats_lead", "var"], how="left")
    df["value_cal"] = df["value"] * df["ratio"].fillna(1.0) - df["bias"].fillna(0.0)
    df.loc[df["var"] == "precip", "value_cal"] = df["value_cal"].clip(lower=0)
    return df.drop(columns=["stats_lead", "bias", "ratio"])


def blend(corrected: pd.DataFrame) -> pd.DataFrame:
    """Skill-weighted mean across models per (date, lead, var), with model range."""
    rows = []
    for (d, lead, var), g in corrected.dropna(subset=["value_cal"]).groupby(["date", "lead", "var"]):
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
    return pd.DataFrame(rows)
