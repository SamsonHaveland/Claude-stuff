"""Weather-pattern ("regime") corrections.

A model's error at a place depends on the weather pattern: e.g. it may run
too warm when wind comes down off a mountain, or under-forecast rain when
storms arrive from the sea. For each day the engine describes the pattern each
model forecast (wind direction, high or low pressure, rising or falling
pressure, time of year), finds past days with a similar pattern in that
model's own forecasts, and measures how wrong the model was on those days
here (an analog approach, cf. Delle Monache et al. 2013).

That pattern-specific error replaces the model's overall recent error only as
far as the evidence supports: similar past days are weighted by closeness,
their effective count is shrunk with k (pattern_bias moves toward the
overall bias when few days match), and k is chosen per variable by blocked
cross-validation on this place's own history, where k = infinity means "no
pattern correction". So the pattern correction is only switched on for a
variable when it beat the plain correction on past days held out in week-long blocks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

from .config import TRAIN_WINDOW_DAYS

# How different two days can be and still count as similar (one "standard deviation" each).
SCALES = {"wind_dir": 45.0, "pressure_anom": 6.0, "tendency": 4.0, "doy": 30.0}
CIRCULAR = {"wind_dir": 360.0, "doy": 365.25}
FEATURES = list(SCALES)
CALM_MPH = 4.0  # below this the wind direction says little
K_CANDIDATES = [np.inf, 40.0, 20.0, 10.0, 5.0]
MIN_DAYS = 90  # need this much history before pattern corrections are considered
MIN_GAIN = 0.02  # must beat the plain correction by 2% in cross-validation to be used
BLOCK_DAYS = 7  # cross-validation holds out whole weeks (errors on nearby days are correlated)
PAIR_KEYS = ["date", "lead", "model"]


# --- describing each day's pattern -------------------------------------------

def _daily(df: pd.DataFrame) -> pd.DataFrame:
    """Hourly (date, lead, model, wind, wind_dir, pressure) -> daily pattern features."""
    rad = np.deg2rad(df["wind_dir"])
    df = df.assign(u=-df["wind"] * np.sin(rad), v=-df["wind"] * np.cos(rad))
    return _finish(df.groupby(PAIR_KEYS)[["u", "v", "wind", "pressure"]].mean())


def _finish(g: pd.DataFrame) -> pd.DataFrame:
    """Daily means (index date, lead, model; columns u, v, wind, pressure) -> pattern features."""
    out = pd.DataFrame(index=g.index)
    out["wind_dir"] = (np.rad2deg(np.arctan2(-g["u"], -g["v"])) % 360).where(g["wind"] >= CALM_MPH)
    out["wind_speed"] = g["wind"]
    out["pressure"] = g["pressure"]
    out = out.reset_index().sort_values(["model", "lead", "date"])
    prev = out.groupby(["model", "lead"])[["date", "pressure"]].shift(1)
    consecutive = (pd.to_datetime(out["date"]) - pd.to_datetime(prev["date"])).dt.days == 1
    out["tendency"] = (out["pressure"] - prev["pressure"]).where(consecutive)
    out["doy"] = pd.to_datetime(out["date"]).dt.dayofyear.astype(float)
    return out.reset_index(drop=True)


def features_from_past_runs(hourly: pd.DataFrame) -> pd.DataFrame:
    """Past runs (time, lead, hvar, value, model) -> daily features per (date, lead, model)."""
    want = {"wind_speed_10m": "wind", "wind_direction_10m": "wind_dir", "pressure_msl": "pressure"}
    sub = hourly[hourly["hvar"].isin(want)]
    if sub.empty:
        return pd.DataFrame(columns=PAIR_KEYS + ["wind_dir", "wind_speed", "pressure", "tendency", "doy"])
    wide = sub.pivot_table(index=["time", "lead", "model"], columns="hvar", values="value").rename(columns=want)
    for col in want.values():
        if col not in wide:
            wide[col] = np.nan
    wide = wide.reset_index()
    wide["date"] = pd.to_datetime(wide["time"]).dt.date
    return _daily(wide)


def features_from_wide(wide: pd.DataFrame, model: str, max_lead: int = 7) -> pd.DataFrame:
    """Archived wide past runs (see openmeteo.previous_runs_wide) -> daily features, without a long table."""
    days = wide.index.normalize().date
    parts = []
    for lead in range(1, max_lead + 1):
        def col(name):
            key = f"{name}_previous_day{lead}"
            return wide[key].to_numpy(dtype=float) if key in wide else np.full(len(wide), np.nan)
        spd, wd, p = col("wind_speed_10m"), col("wind_direction_10m"), col("pressure_msl")
        if np.isnan(spd).all() and np.isnan(p).all():
            continue
        rad = np.deg2rad(wd)
        hourly = pd.DataFrame({"u": -spd * np.sin(rad), "v": -spd * np.cos(rad), "wind": spd, "pressure": p})
        g = hourly.groupby(days).mean()
        g.index = pd.MultiIndex.from_arrays([g.index, [lead] * len(g), [model] * len(g)], names=PAIR_KEYS)
        parts.append(g)
    if not parts:
        return pd.DataFrame(columns=PAIR_KEYS + ["wind_dir", "wind_speed", "pressure", "tendency", "doy"])
    return _finish(pd.concat(parts))


def features_from_forecast(per_model_hourly: pd.DataFrame, today: date) -> pd.DataFrame:
    """Live hourly detail (time, model, wind, wind_dir, pressure, ...) -> daily features."""
    if per_model_hourly is None or per_model_hourly.empty or "pressure" not in per_model_hourly:
        return pd.DataFrame(columns=PAIR_KEYS + ["wind_dir", "wind_speed", "pressure", "tendency", "doy"])
    df = per_model_hourly[["time", "model", "wind", "wind_dir", "pressure"]].copy()
    df["date"] = pd.to_datetime(df["time"]).dt.date
    df["lead"] = df["date"].map(lambda d: (d - today).days)
    out = _daily(df).sort_values(["model", "date"])
    # One run covers every day here, so the 24-hour pressure change is day to day within each model.
    prev = out.groupby("model")[["date", "pressure"]].shift(1)
    consecutive = (pd.to_datetime(out["date"]) - pd.to_datetime(prev["date"])).dt.days == 1
    out["tendency"] = (out["pressure"] - prev["pressure"]).where(consecutive)
    return out.reset_index(drop=True)


# --- similarity weights -------------------------------------------------------

def _matrix(df: pd.DataFrame, p_mean: float) -> np.ndarray:
    m = df[["wind_dir", "pressure", "tendency", "doy"]].to_numpy(dtype=float).copy()
    m[:, 1] -= p_mean  # pressure -> anomaly from this place's usual (high vs low pressure)
    return m


def similarity(targets: np.ndarray, train: np.ndarray) -> np.ndarray:
    """Gaussian similarity (len(targets) x len(train)); a feature missing on either side is ignored."""
    d2 = np.zeros((len(targets), len(train)), dtype=np.float32)
    for j, name in enumerate(FEATURES):
        diff = np.subtract.outer(targets[:, j].astype(np.float32), train[:, j].astype(np.float32))
        if name in CIRCULAR:
            period = np.float32(CIRCULAR[name])
            diff += period / 2
            np.mod(diff, period, out=diff)
            diff -= period / 2
        diff /= np.float32(SCALES[name])
        np.square(diff, out=diff)
        d2 += np.nan_to_num(diff, copy=False, nan=0.0)
    d2 *= np.float32(-0.5)
    return np.exp(d2, out=d2).astype(np.float64)


# --- fitting ------------------------------------------------------------------

def _pattern_estimate(var: str, w: np.ndarray, fcst: np.ndarray, obs: np.ndarray) -> np.ndarray:
    """Pattern-weighted bias (or rain ratio) per target row; NaN where nothing similar is known."""
    sw = w.sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        if var == "precip":
            wf = w @ fcst
            est = np.where(wf > 0.05, np.clip((w @ obs) / wf, 0.25, 4.0), np.nan)
        else:
            est = (w @ (fcst - obs)) / sw
    return est


def _n_eff(w: np.ndarray) -> np.ndarray:
    sw = w.sum(axis=1)
    sw2 = (w * w).sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(sw2 > 0, sw * sw / sw2, 0.0)


def _combine(var: str, base: np.ndarray, est: np.ndarray, n_eff: np.ndarray, k: float, fcst: np.ndarray) -> np.ndarray:
    """Corrected forecast: overall correction moved toward the pattern estimate by n_eff/(n_eff+k)."""
    frac = np.zeros(len(base)) if np.isinf(k) else np.where(np.isnan(est), 0.0, n_eff / (n_eff + k))
    est = np.where(np.isnan(est), base, est)
    corr = base + (est - base) * frac
    return fcst * corr if var == "precip" else fcst - corr


def consensus(feats: pd.DataFrame, lead: int | None = None) -> pd.DataFrame:
    """One pattern per date (index date): the models' agreed wind direction, mean pressure and tendency."""
    cols = ["wind_dir", "wind_agree", "wind_speed", "pressure", "tendency", "doy"]
    f = feats if lead is None else feats[feats["lead"] == lead]
    if f.empty:
        return pd.DataFrame(columns=cols)
    rad = np.deg2rad(f["wind_dir"].astype(float))
    g = f.assign(u=-np.sin(rad), v=-np.cos(rad)).groupby("date")
    um, vm = g["u"].mean(), g["v"].mean()
    agree = np.hypot(um, vm)  # 1 = every model gives the same direction
    return pd.DataFrame({
        "wind_dir": (np.rad2deg(np.arctan2(-um, -vm)) % 360).where(agree >= 0.5),
        "wind_agree": agree,
        "wind_speed": g["wind_speed"].mean(),
        "pressure": g["pressure"].mean(),
        "tendency": g["tendency"].mean(),
        "doy": g["doy"].first(),
    })[cols]


def past_patterns(feats: pd.DataFrame) -> pd.DataFrame:
    """Each past day's pattern from its shortest-lead forecasts (closest to what actually happened)."""
    return consensus(feats, lead=1).combine_first(consensus(feats))


@dataclass
class RegimeModel:
    train: pd.DataFrame  # pairs: date, lead, model, var, fcst, obs
    patterns: pd.DataFrame  # index date: wind_dir, pressure, tendency, doy (see past_patterns)
    p_mean: float  # usual sea-level pressure here (pressure anomaly = high vs low pressure)
    k: dict[str, float]  # var -> shrinkage (inf = pattern correction off)
    cv: pd.DataFrame  # var, days, mae_plain, mae_pattern, gain, k
    mae: pd.DataFrame = field(default_factory=pd.DataFrame)  # model, lead, var, mae_cal (held-out, pattern-corrected)
    groups: dict = field(default_factory=dict)  # (model, lead, var) -> (pattern row positions, fcst, obs)

    def __post_init__(self):
        pos = pd.Series(np.arange(len(self.patterns)), index=self.patterns.index)
        for key, g in self.train.groupby(["model", "lead", "var"]):
            self.groups[key] = (pos.loc[g["date"]].to_numpy(), g["fcst"].to_numpy(dtype=float),
                                g["obs"].to_numpy(dtype=float))

    def active(self, var: str) -> bool:
        return not np.isinf(self.k.get(var, np.inf))


def _window_base(var: str, day: np.ndarray, fcst: np.ndarray, obs: np.ndarray, block_start: np.ndarray) -> np.ndarray:
    """For each row, the plain correction from the TRAIN_WINDOW_DAYS before its held-out week (rows sorted by day).

    Same formulas as calibrate.fit (shrunk bias; shrunk, clipped rain ratio), computed for every
    week at once with running sums. NaN where fewer than 5 days are available.
    """
    lo = np.searchsorted(day, block_start - TRAIN_WINDOW_DAYS, side="left")
    hi = np.searchsorted(day, block_start, side="left")
    n = (hi - lo).astype(float)

    def window_sum(x):
        c = np.concatenate([[0.0], np.cumsum(x)])
        return c[hi] - c[lo]

    with np.errstate(invalid="ignore", divide="ignore"):
        if var == "precip":
            sf, so = window_sum(fcst), window_sum(obs)
            r = np.clip(so / sf, 0.5, 2.0)
            base = np.where(sf > 0.1, 1.0 + (r - 1.0) * n / (n + 10), 1.0)
        else:
            err = fcst - obs
            mean = window_sum(err) / n
            var_ = (window_sum(err * err) - n * mean * mean) / (n - 1)
            denom = mean * mean + var_ / n
            base = np.where(denom > 0, mean * mean * mean / denom, 0.0)
    return np.where(n >= 5, base, np.nan)


def fit(pairs: pd.DataFrame, feats: pd.DataFrame, as_of: date) -> RegimeModel | None:
    """Learn pattern-dependent errors from (date, lead, model, var, fcst, obs) pairs and daily features."""
    if pairs.empty or feats.empty:
        return None
    pats = past_patterns(feats)
    pats = pats[pats.index <= as_of]
    data = pairs[(pairs["date"] <= as_of) & pairs["date"].isin(pats.index)].dropna(subset=["fcst", "obs"])
    if data.empty or data["date"].nunique() < MIN_DAYS:
        return None
    p_mean = float(pats["pressure"].mean()) if pats["pressure"].notna().any() else 0.0
    dates = sorted(data["date"].unique())
    pats = pats.loc[dates]
    pos = pd.Series(np.arange(len(dates)), index=dates)
    ordinal = np.array([d.toordinal() for d in dates])
    w_all = similarity(_matrix(pats, p_mean), _matrix(pats, p_mean))  # one day-to-day similarity for everything

    scores: dict[str, dict[float, list[np.ndarray]]] = {}
    recent_err: dict[tuple[str, int, str], dict[float, np.ndarray]] = {}
    recent_cut = (as_of - timedelta(days=TRAIN_WINDOW_DAYS)).toordinal()
    for (model, lead, var), g in data.groupby(["model", "lead", "var"]):
        if len(g) < 30:
            continue
        g = g.sort_values("date")
        ix = pos.loc[g["date"]].to_numpy()
        day, fcst, obs = ordinal[ix], g["fcst"].to_numpy(dtype=float), g["obs"].to_numpy(dtype=float)
        block_start = (day // BLOCK_DAYS) * BLOCK_DAYS
        # Like the live engine, a held-out week may only learn from days before it (never from
        # later weeks: with the season feature they would act as a peek at the future).
        w = w_all[np.ix_(ix, ix)] * (day[None, :] < block_start[:, None])
        est, n_eff = _pattern_estimate(var, w, fcst, obs), _n_eff(w)
        base = _window_base(var, day, fcst, obs, block_start)
        ok = ~np.isnan(base)
        if ok.sum() < 20:
            continue
        per_k = {}
        for k in K_CANDIDATES:
            err = np.abs(_combine(var, base[ok], est[ok], n_eff[ok], k, fcst[ok]) - obs[ok])
            scores.setdefault(var, {}).setdefault(k, []).append(err)
            per_k[k] = np.where(day[ok] >= recent_cut, err, np.nan)
        recent_err[(model, lead, var)] = per_k

    chosen, cv_rows = {}, []
    for var, by_k in scores.items():
        mae = {k: float(np.concatenate(v).mean()) for k, v in by_k.items()}
        best = min(mae, key=mae.get)
        plain = mae[np.inf]
        gain = (plain - mae[best]) / plain if plain > 0 else 0.0
        k = best if gain >= MIN_GAIN else np.inf
        chosen[var] = k
        cv_rows.append({"var": var, "days": int(data.loc[data["var"] == var, "date"].nunique()),
                        "mae_plain": plain, "mae_pattern": mae[k], "gain": (plain - mae[k]) / plain if plain else 0.0,
                        "k": k})
    mae_rows = []
    for (model, lead, var), per_k in recent_err.items():
        k = chosen.get(var, np.inf)
        if not np.isinf(k) and np.isfinite(per_k[k]).any():
            mae_rows.append({"model": model, "lead": lead, "var": var, "mae_cal": float(np.nanmean(per_k[k]))})
    return RegimeModel(data[["date", "lead", "model", "var", "fcst", "obs"]], pats, p_mean, chosen,
                       pd.DataFrame(cv_rows), pd.DataFrame(mae_rows))


# --- applying -----------------------------------------------------------------

def adjust(rm: RegimeModel, df: pd.DataFrame, feats: pd.DataFrame) -> pd.DataFrame:
    """Rows (date, model, stats_lead, var, value, bias, ratio, mae_cal) + live features -> pattern-aware bias/ratio.

    Each forecast day's pattern is the models' consensus for that day. Adds `pattern_n`
    (how many similar past days, effectively) where a pattern correction was applied.
    """
    out = df.copy()
    out["pattern_n"] = np.nan
    if rm is None or feats.empty or not any(rm.active(v) for v in set(out["var"])):
        return out
    live = consensus(feats)
    live_dates = [d for d in live.index if d in set(out["date"])]
    if not live_dates:
        return out
    live = live.loc[live_dates]
    w_live = similarity(_matrix(live, rm.p_mean), _matrix(rm.patterns, rm.p_mean))  # live days x past days
    live_pos = pd.Series(np.arange(len(live_dates)), index=live_dates)
    described = live[["wind_dir", "pressure"]].notna().any(axis=1)  # no wind or pressure: nothing to match
    for (model, lead, var), idx in out.groupby(["model", "stats_lead", "var"]).groups.items():
        if not rm.active(var) or (model, lead, var) not in rm.groups:
            continue
        past, fcst, obs = rm.groups[(model, lead, var)]
        if len(past) < 30:
            continue
        rows = out.loc[idx]
        known = rows["date"].isin(live_pos.index).to_numpy()
        if not known.any():
            continue
        rows, idx = rows[known], rows.index[known]
        w = w_live[np.ix_(live_pos.loc[rows["date"]].to_numpy(), past)]
        est = _pattern_estimate(var, w, fcst, obs)
        n_eff = _n_eff(w)
        ok = described.loc[rows["date"]].to_numpy()
        frac = np.where(np.isnan(est) | ~ok, 0.0, n_eff / (n_eff + rm.k[var]))
        col, default = ("ratio", 1.0) if var == "precip" else ("bias", 0.0)
        base = rows[col].fillna(default).to_numpy()
        out.loc[idx, col] = base + (np.where(np.isnan(est), base, est) - base) * frac
        out.loc[idx, "pattern_n"] = np.where(frac > 0, n_eff, np.nan)
    if not rm.mae.empty:  # weight models by how well they did once pattern-corrected
        m = rm.mae.rename(columns={"lead": "stats_lead", "mae_cal": "mae_pattern"})
        merged = out.merge(m, on=["model", "stats_lead", "var"], how="left")
        merged.index = out.index
        out["mae_cal"] = merged["mae_pattern"].combine_first(out["mae_cal"])
    return out


# --- describing the pattern in words -----------------------------------------

COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def compass(deg: float) -> str:
    return COMPASS[int((deg % 360) / 22.5 + 0.5) % 16]


def day_patterns(feats: pd.DataFrame, p_mean: float | None) -> pd.DataFrame:
    """Consensus pattern per forecast date across models: wind from, pressure anomaly, tendency."""
    days = consensus(feats)
    if days.empty:
        return days
    days["pressure_anom"] = days["pressure"] - (p_mean if p_mean is not None else days["pressure"].mean())
    return days


def describe(row: pd.Series) -> str:
    """'SW wind, low pressure, falling fast' style summary of one day's pattern."""
    parts = []
    if pd.notna(row.get("wind_dir")) and row.get("wind_agree", 0) >= 0.5 and row.get("wind_speed", 0) >= CALM_MPH:
        parts.append(f"wind from the {compass(row['wind_dir'])}")
    elif pd.notna(row.get("wind_speed")):
        parts.append("light or variable wind")
    a = row.get("pressure_anom")
    if pd.notna(a):
        parts.append("high pressure" if a >= 4 else "low pressure" if a <= -4 else "near-normal pressure")
    t = row.get("tendency")
    if pd.notna(t):
        if t <= -4:
            parts.append("pressure falling fast (a system approaching)")
        elif t <= -1.5:
            parts.append("pressure falling")
        elif t >= 4:
            parts.append("pressure rising fast (clearing behind a system)")
        elif t >= 1.5:
            parts.append("pressure rising")
    return ", ".join(parts)
