"""Backtest: how much each correction step would have helped at a place, on days it never saw.

For every past day D and lead L, the forecast issued L days before D is
corrected using only what was known then (observations up to the issue day),
exactly as the live engine would have done, and compared with what the
station measured. Methods compared:

- ``ecmwf``: the raw ECMWF forecast (the usual "best single model" benchmark)
- ``mean``: plain average of all models, uncorrected
- ``plain``: per-model bias correction + skill-weighted blend (the previous engine)
- ``pattern``: plain + weather-pattern corrections (regime.py)
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import calibrate, regime
from .config import BASELINE_MODEL

METHODS = ["ecmwf", "mean", "plain", "pattern"]


def run(pairs: pd.DataFrame, feats: pd.DataFrame, today: date, days: int = 60, refit_every: int = 3) -> pd.DataFrame:
    """Per (date, lead, var): obs and each method's forecast, over the last `days` days before today."""
    first = today - timedelta(days=days)
    evaluate = pairs[(pairs["date"] >= first) & (pairs["date"] < today)].copy()
    if evaluate.empty:
        return pd.DataFrame(columns=["date", "lead", "var", "obs", *METHODS, "pattern_on"])
    evaluate["origin"] = evaluate.apply(lambda r: r["date"] - timedelta(days=int(r["lead"])), axis=1)
    rows = []
    fits: dict[date, tuple] = {}
    for origin, todo in evaluate.groupby("origin"):
        # Train on what was known the day before the forecast was issued; to save time the
        # training is redone only every few days, so it is up to `refit_every` days older.
        fit_day = origin - timedelta(days=1)
        if origin > first:
            fit_day = first - timedelta(days=1) + timedelta(days=((origin - first).days // refit_every) * refit_every)
        if fit_day not in fits:
            known = pairs[pairs["date"] <= fit_day]
            fits[fit_day] = (calibrate.fit(known, as_of=fit_day) if not known.empty else None,
                             regime.fit(known, feats, as_of=fit_day))
        stats, pattern = fits[fit_day]
        raw = todo.rename(columns={"fcst": "value"})[["date", "lead", "model", "var", "value"]]
        obs = todo.groupby(["date", "lead", "var"])["obs"].first()
        out = pd.DataFrame({"obs": obs})
        out["ecmwf"] = raw[raw["model"] == BASELINE_MODEL].set_index(["date", "lead", "var"])["value"]
        out["mean"] = raw.groupby(["date", "lead", "var"])["value"].mean()
        plain = calibrate.blend(calibrate.apply(raw, stats))
        out["plain"] = plain.set_index(["date", "lead", "var"])["value"]
        if pattern is not None:
            pat = calibrate.blend(calibrate.apply(raw, stats, pattern, feats))
            out["pattern"] = pat.set_index(["date", "lead", "var"])["value"]
        else:
            out["pattern"] = out["plain"]
        out["pattern_on"] = pattern is not None
        rows.append(out.reset_index())
    if not rows:
        return pd.DataFrame(columns=["date", "lead", "var", "obs", *METHODS])
    return pd.concat(rows, ignore_index=True)


def summarize(results: pd.DataFrame) -> pd.DataFrame:
    """Mean absolute error per variable and lead band for each method (lower is better)."""
    if results.empty:
        return pd.DataFrame()
    r = results.dropna(subset=["obs"]).copy()
    r["leads"] = pd.cut(r["lead"], [0, 2, 5, 7], labels=["1-2 days", "3-5 days", "6-7 days"])
    rows = []
    for (var, leads), g in r.groupby(["var", "leads"], observed=True):
        row = {"var": var, "leads": str(leads), "n": len(g)}
        for m in METHODS:
            ok = g[m].notna()
            row[m] = float((g.loc[ok, m] - g.loc[ok, "obs"]).abs().mean()) if ok.any() else np.nan
        row["pattern_days"] = int(g["pattern_on"].sum())
        rows.append(row)
    return pd.DataFrame(rows)
