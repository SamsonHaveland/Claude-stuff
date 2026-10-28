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
    g = df.groupby(PAIR_KEYS)[["u", "v", "wind", "pressure"]].mean()
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


def features_from_forecast(per_model_hourly: pd.DataFrame, today: date) -> pd.DataFrame:
    """Live hourly detail (time, model, wind, wind_dir, pressure, ...) -> daily features."""
    if per_model_hourly is None or per_model_hourly.empty or "pressure" not in per_model_hourly:
        return pd.DataFrame(columns=PAIR_KEYS + ["wind_dir", "wind_speed", "pressure", "tendency", "doy"])
    df = per_model_hourly[["time", "model", "wind", "wind_dir", "pressure"]].copy()
    df["date"] = pd.to_datetime(df["time"]).dt.date
    df["lead"] = df["date"].map(lambda d: (d - today).days)
    return _daily(df)


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

def _shrunk_bias(err: np.ndarray) -> float:
    """Same shrinkage as calibrate.fit: a noisy mean error is scaled toward zero."""
    n = len(err)
    if n < 2:
        return 0.0
    b = float(err.mean())
    denom = b * b + float(err.var(ddof=1)) / n
    return 0.0 if denom == 0 else b * b * b / denom


def _shrunk_ratio(fcst: np.ndarray, obs: np.ndarray) -> float:
    n = len(fcst)
    if n == 0 or fcst.sum() <= 0.1:
        return 1.0
    r = float(np.clip(obs.sum() / fcst.sum(), 0.5, 2.0))
    return 1.0 + (r - 1.0) * n / (n + 10)


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


@dataclass
class RegimeModel:
    train: pd.DataFrame  # pairs + features: date, lead, model, var, fcst, obs, wind_dir, pressure, tendency, doy
    p_mean: dict[str, float]  # model -> usual sea-level pressure here
    k: dict[str, float]  # var -> shrinkage (inf = pattern correction off)
    cv: pd.DataFrame  # var, days, mae_plain, mae_pattern, gain, k
    mae: pd.DataFrame = field(default_factory=pd.DataFrame)  # model, lead, var, mae_cal (held-out, pattern-corrected)

    def active(self, var: str) -> bool:
        return not np.isinf(self.k.get(var, np.inf))


def fit(pairs: pd.DataFrame, feats: pd.DataFrame, as_of: date) -> RegimeModel | None:
    """Learn pattern-dependent errors from (date, lead, model, var, fcst, obs) pairs and daily features."""
    if pairs.empty or feats.empty:
        return None
    data = pairs.merge(feats[PAIR_KEYS + ["wind_dir", "pressure", "tendency", "doy"]], on=PAIR_KEYS, how="inner")
    data = data[data["date"] <= as_of]
    if data.empty or data["date"].nunique() < MIN_DAYS:
        return None
    p_mean = data.groupby("model")["pressure"].mean().to_dict()
    data = data.assign(ordinal=data["date"].map(date.toordinal))

    scores: dict[str, dict[float, list[np.ndarray]]] = {}
    recent_err: dict[tuple[str, int, str], dict[float, np.ndarray]] = {}
    recent_cut = (as_of - timedelta(days=TRAIN_WINDOW_DAYS)).toordinal()
    for (model, lead), ml in data.groupby(["model", "lead"]):
        # One similarity matrix per model and lead, shared by all variables (same days, same patterns).
        days_ml = ml.drop_duplicates("ordinal").sort_values("ordinal")
        pos = pd.Series(np.arange(len(days_ml)), index=days_ml["ordinal"].to_numpy())
        p = p_mean.get(model, 0.0)
        w_all = similarity(_matrix(days_ml, p), _matrix(days_ml, p))
        for var, g in ml.groupby("var"):
            g = g.dropna(subset=["fcst", "obs"]).sort_values("ordinal")
            if len(g) < 30:
                continue
            fcst, obs, day = g["fcst"].to_numpy(), g["obs"].to_numpy(), g["ordinal"].to_numpy()
            block = day // BLOCK_DAYS
            ix = pos.loc[day].to_numpy()
            w = w_all[np.ix_(ix, ix)] * (block[:, None] != block[None, :])  # never learn from the held-out week
            est, n_eff = _pattern_estimate(var, w, fcst, obs), _n_eff(w)
            # The plain correction each held-out week would have had: the recent window before it.
            base = np.full(len(g), np.nan)
            for b in np.unique(block):
                start = b * BLOCK_DAYS
                prior = (day < start) & (day >= start - TRAIN_WINDOW_DAYS)
                if prior.sum() >= 5:
                    base[block == b] = (_shrunk_ratio(fcst[prior], obs[prior]) if var == "precip"
                                        else _shrunk_bias(fcst[prior] - obs[prior]))
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
    train = data.drop(columns="ordinal")
    return RegimeModel(train, p_mean, chosen, pd.DataFrame(cv_rows), pd.DataFrame(mae_rows))


# --- applying -----------------------------------------------------------------

def adjust(rm: RegimeModel, df: pd.DataFrame, feats: pd.DataFrame) -> pd.DataFrame:
    """Rows (model, stats_lead, var, value, bias, ratio, mae_cal) + live features -> pattern-aware bias/ratio.

    Adds `pattern_n` (how many similar past days, effectively) where a pattern correction was applied.
    """
    out = df.copy()
    out["pattern_n"] = np.nan
    if rm is None or feats.empty:
        return out
    live = out.merge(feats[PAIR_KEYS + ["wind_dir", "pressure", "tendency", "doy"]],
                     on=PAIR_KEYS, how="left")
    live.index = out.index
    for (model, lead, var), idx in live.groupby(["model", "stats_lead", "var"]).groups.items():
        if not rm.active(var):
            continue
        g = rm.train[(rm.train["model"] == model) & (rm.train["lead"] == lead) & (rm.train["var"] == var)]
        g = g.dropna(subset=["fcst", "obs"])
        if len(g) < 30:
            continue
        rows = live.loc[idx]
        p = rm.p_mean.get(model, 0.0)
        w = similarity(_matrix(rows, p), _matrix(g, p))
        est = _pattern_estimate(var, w, g["fcst"].to_numpy(), g["obs"].to_numpy())
        n_eff = _n_eff(w)
        k = rm.k[var]
        # Without wind direction or pressure there's no pattern to match, only the season.
        described = rows[["wind_dir", "pressure"]].notna().any(axis=1).to_numpy()
        frac = np.where(np.isnan(est) | ~described, 0.0, n_eff / (n_eff + k))
        if var == "precip":
            base = rows["ratio"].fillna(1.0).to_numpy()
            out.loc[idx, "ratio"] = base + (np.where(np.isnan(est), base, est) - base) * frac
        else:
            base = rows["bias"].fillna(0.0).to_numpy()
            out.loc[idx, "bias"] = base + (np.where(np.isnan(est), base, est) - base) * frac
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


def day_patterns(feats: pd.DataFrame, p_means: dict[str, float]) -> pd.DataFrame:
    """Consensus pattern per forecast date across models: wind from, pressure anomaly, tendency."""
    if feats.empty:
        return pd.DataFrame()
    f = feats.copy()
    f["pressure_anom"] = f["pressure"] - f["model"].map(p_means).fillna(f["pressure"].mean())
    rad = np.deg2rad(f["wind_dir"])
    f["u"], f["v"] = -np.sin(rad), -np.cos(rad)
    g = f.groupby("date")
    out = pd.DataFrame({
        "wind_dir": (np.rad2deg(np.arctan2(-g["u"].mean(), -g["v"].mean())) % 360),
        "wind_agree": np.hypot(g["u"].mean(), g["v"].mean()),  # 1 = all models same direction
        "wind_speed": g["wind_speed"].mean(),
        "pressure": g["pressure"].mean(),
        "pressure_anom": g["pressure_anom"].mean(),
        "tendency": g["tendency"].mean(),
    })
    return out


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
