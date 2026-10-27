"""Hour-by-hour detail, kept consistent with the calibrated daily forecast.

The calibrated daily values (high, low, peak wind, peak gust, rain total) are
the engine's best estimates. Hourly values come from the model blend's hourly
curves, then:
- temperature is rescaled within each day so its low/high equal the calibrated
  low/high ("feels like" moves by the same amount at each hour);
- wind and gusts are scaled so each day's peak equals the calibrated peak;
- rain amounts are scaled so each day's total equals the calibrated total.
Rain chance per hour comes from ensemble members. Cloud, humidity, wind
direction and precipitation type are model averages/votes and are not
station-calibrated.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .config import RAIN_THRESHOLD_IN

COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
RAIN_LIKELY_PCT = 40
RAIN_POSSIBLE_PCT = 15


def compass(deg: float | None) -> str | None:
    if deg is None or (isinstance(deg, float) and math.isnan(deg)):
        return None
    return COMPASS[int((deg % 360) / 22.5 + 0.5) % 16]


def _vector_mean_dir(speed: pd.Series, direction: pd.Series) -> float:
    """Speed-weighted mean of meteorological wind directions (degrees the wind comes FROM)."""
    ok = speed.notna() & direction.notna()
    if not ok.any():
        return float("nan")
    rad = np.radians(direction[ok])
    u, v = (speed[ok] * np.sin(rad)).sum(), (speed[ok] * np.cos(rad)).sum()
    if u == 0 and v == 0:
        return float("nan")
    return float(np.degrees(np.arctan2(u, v)) % 360)


def precip_kind(code: float) -> str | None:
    """WMO weather code -> precipitation category (None if no precipitation)."""
    if code is None or math.isnan(code):
        return None
    c = int(code)
    if c >= 95:
        return "thunderstorms"
    if c in (71, 73, 75, 77, 85, 86):
        return "snow"
    if c in (56, 57, 66, 67):
        return "freezing rain"
    if 51 <= c <= 55:
        return "drizzle"
    if 61 <= c <= 65 or 80 <= c <= 82:
        return "rain"
    return None


def sky(cloud: float) -> str | None:
    if cloud is None or math.isnan(cloud):
        return None
    for limit, label in ((20, "Clear"), (45, "Mostly clear"), (70, "Partly cloudy"), (90, "Mostly cloudy")):
        if cloud < limit:
            return label
    return "Overcast"


def _vote(kinds: pd.Series) -> str | None:
    """Majority precipitation type across models for one hour; thunder wins if half the models show it."""
    k = kinds.dropna()
    if k.empty:
        return None
    if (k == "thunderstorms").sum() * 2 >= len(kinds):
        return "thunderstorms"
    return k.mode().iloc[0]


def blend_hourly(per_model: pd.DataFrame) -> pd.DataFrame:
    """Per-model hourly rows (time, model, detail columns) -> one row per hour."""
    g = per_model.groupby("time")
    numeric = ["temp", "feels", "humidity", "cloud", "precip", "snow", "cape", "wind", "gust"]
    out = g[numeric].mean()
    out["wind_dir"] = g.apply(lambda h: _vector_mean_dir(h["wind"], h["wind_dir"]), include_groups=False)
    kinds = per_model.assign(kind=per_model["code"].map(precip_kind))
    out["kind"] = kinds.groupby("time")["kind"].apply(_vote)
    return out.reset_index()


def calibrate_hourly(hourly: pd.DataFrame, daily: pd.DataFrame, ensemble: pd.DataFrame | None) -> pd.DataFrame:
    """Make the blended hourly curves agree with the calibrated daily values.

    `daily`: index date, columns tmax, tmin, wind, gust, precip (calibrated blend).
    `ensemble`: index time, columns n_members, wet_members (summed over ensembles).
    """
    h = hourly.copy()
    h["date"] = h["time"].dt.date
    for d, idx in h.groupby("date").groups.items():
        if d not in daily.index:
            continue
        row, day = daily.loc[d], h.loc[idx]
        lo, hi = day["temp"].min(), day["temp"].max()
        if pd.notna(row.get("tmax")) and pd.notna(row.get("tmin")) and pd.notna(lo) and hi > lo:
            new = row["tmin"] + (day["temp"] - lo) * (row["tmax"] - row["tmin"]) / (hi - lo)
            h.loc[idx, "feels"] = day["feels"] + (new - day["temp"])
            h.loc[idx, "temp"] = new
        for col in ("wind", "gust"):
            peak = day[col].max()
            if pd.notna(row.get(col)) and pd.notna(peak) and peak > 0:
                h.loc[idx, col] = day[col] * float(np.clip(row[col] / peak, 0.3, 3.0))
        total = day["precip"].sum()
        if pd.notna(row.get("precip")):
            if row["precip"] <= 0:
                h.loc[idx, "precip"] = 0.0
            elif total > 0.005:
                h.loc[idx, "precip"] = day["precip"] * row["precip"] / total
    h["gust"] = np.fmax(h["gust"], h["wind"])
    if ensemble is not None and not ensemble.empty:
        prob = (ensemble["wet_members"] / ensemble["n_members"]).rename("rain_prob")
        h = h.merge(prob, left_on="time", right_index=True, how="left")
    else:
        h["rain_prob"] = np.nan
    h["sky"] = h["cloud"].map(sky)
    return h


def _fmt_hour(t: pd.Timestamp) -> str:
    return f"{t.hour % 12 or 12} {'am' if t.hour < 12 else 'pm'}"


def _windows(times: list, wet: list[bool]) -> list[str]:
    out, start = [], None
    for i, flag in enumerate(wet):
        if flag and start is None:
            start = times[i]
        if start is not None and (not flag or i == len(times) - 1):
            end = times[i] if not flag else times[i] + pd.Timedelta(hours=1)
            out.append(f"{_fmt_hour(start)}–{_fmt_hour(end)}")
            start = None
    return out


def rain_windows(day: pd.DataFrame) -> tuple[list[str], list[str]]:
    """(likely, possible) rain periods, e.g. ['2 pm–8 pm'].

    "Likely" needs an ensemble chance >= 40% (or, without ensemble data, >= 0.01 in
    expected). "Possible" is a 15-40% chance, or rain in the blended models that
    the ensembles give under 40%: the wording follows the probability, not the
    deterministic amount.
    """
    prob = day["rain_prob"] * 100
    amount = day["precip"].fillna(0) >= RAIN_THRESHOLD_IN
    has_prob = prob.notna()
    likely = (has_prob & (prob >= RAIN_LIKELY_PCT)) | (~has_prob & amount)
    possible = ~likely & ((has_prob & (prob >= RAIN_POSSIBLE_PCT)) | amount)
    times = list(day["time"])
    return _windows(times, list(likely)), _windows(times, list(possible))


def day_details(h: pd.DataFrame, sun: pd.DataFrame | None) -> dict:
    """Per date: rain timing/type, wind direction, gust peak time, sky, humidity, feels-like, sun times."""
    out = {}
    for d, day in h.groupby("date"):
        day = day.sort_values("time")
        kinds = day.loc[day["precip"].fillna(0) >= 0.005, "kind"].dropna()
        peak = day.loc[day["gust"].idxmax()] if day["gust"].notna().any() else None
        likely, possible = rain_windows(day)
        entry = {
            "rain_windows": likely,
            "rain_possible": possible,
            "precip_type": kinds.mode().iloc[0] if not kinds.empty else None,
            "thunder": bool((day["kind"] == "thunderstorms").any()),
            "wind_from": compass(_vector_mean_dir(day["wind"], day["wind_dir"])),
            "gust_peak_time": None if peak is None else _fmt_hour(peak["time"]),
            "sky": sky(day["cloud"].mean()),
            "humidity_min": None if day["humidity"].isna().all() else round(float(day["humidity"].min())),
            "humidity_max": None if day["humidity"].isna().all() else round(float(day["humidity"].max())),
            "feels_min": None if day["feels"].isna().all() else round(float(day["feels"].min())),
            "feels_max": None if day["feels"].isna().all() else round(float(day["feels"].max())),
            "sunrise": None, "sunset": None,
        }
        if sun is not None and d in sun.index:
            for k in ("sunrise", "sunset"):
                t = sun.loc[d, k]
                entry[k] = None if pd.isna(t) else f"{t.hour % 12 or 12}:{t.minute:02d} {'am' if t.hour < 12 else 'pm'}"
        out[d] = entry
    return out


def _row(t: pd.Timestamp, block: pd.DataFrame) -> dict:
    def num(col: str, how: str, digits: int = 0):
        s = block[col].dropna()
        if s.empty:
            return None
        v = getattr(s, how)()
        return round(float(v), digits) if digits else int(round(float(v)))

    kinds = block["kind"].dropna()
    return {
        "time": t.strftime("%Y-%m-%dT%H:%M"),
        "label": _fmt_hour(t),
        "temp": num("temp", "mean"),
        "feels": num("feels", "mean"),
        "rain_prob": None if block["rain_prob"].isna().all() else int(round(100 * block["rain_prob"].max())),
        "precip": num("precip", "sum", 2),
        "kind": ("thunderstorms" if (kinds == "thunderstorms").any() else kinds.mode().iloc[0]) if not kinds.empty else None,
        "wind": num("wind", "max"),
        "gust": num("gust", "max"),
        "wind_from": compass(_vector_mean_dir(block["wind"], block["wind_dir"])),
        "cloud": num("cloud", "mean"),
        "sky": sky(block["cloud"].mean()),
        "humidity": num("humidity", "mean"),
    }


def timeline(h: pd.DataFrame, now: pd.Timestamp | None, hourly_days: int = 2) -> dict:
    """Per date: list of rows, hourly for the first `hourly_days` days, 3-hourly after; past hours dropped."""
    out = {}
    dates = sorted(h["date"].unique())
    for i, d in enumerate(dates):
        day = h[h["date"] == d].sort_values("time")
        if now is not None:
            day = day[day["time"] >= now.floor("h")]
        if day.empty:
            continue
        step = 1 if i < hourly_days else 3
        rows = []
        for t, block in day.groupby(day["time"].dt.floor(f"{step}h")):
            rows.append(_row(t, block))
        out[d] = {"step_hours": step, "rows": rows}
    return out
