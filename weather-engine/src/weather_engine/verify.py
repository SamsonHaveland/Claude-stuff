"""Score logged forecasts against what was actually observed."""

from __future__ import annotations

from datetime import date

import pandas as pd

from . import store
from .calibrate import obs_long
from .config import RAIN_THRESHOLD_IN, VAR_GROUPS
from .forecast import decode_stations
from .sources import stations
from .sources.observations import Station


def score(log: pd.DataFrame, obs: pd.DataFrame) -> pd.DataFrame:
    """MAE (and rain hit rate) per source, variable and lead day.

    `log` rows: location, date, lead, var, source, value, issued_at.
    `obs` rows: location, date, var, obs.
    """
    # Several runs per day may log the same target; keep the latest issue per lead.
    latest = log.sort_values("issued_at").drop_duplicates(
        ["location", "date", "lead", "var", "source"], keep="last"
    )
    m = latest.merge(obs, on=["location", "date", "var"], how="inner")
    if m.empty:
        return pd.DataFrame()
    m["abs_err"] = (m["value"] - m["obs"]).abs()
    rain = m["var"] == "precip"
    m.loc[rain, "rain_hit"] = (
        (m.loc[rain, "value"] >= RAIN_THRESHOLD_IN) == (m.loc[rain, "obs"] >= RAIN_THRESHOLD_IN)
    ).astype(float)
    return (
        m.groupby(["var", "lead", "source"])
        .agg(n=("abs_err", "size"), mae=("abs_err", "mean"), rain_hit_rate=("rain_hit", "mean"))
        .reset_index()
    )


def run_verification(today: date | None = None) -> pd.DataFrame:
    log = store.read_log()
    if log.empty:
        return pd.DataFrame()
    today = today or date.today()
    log = log[(log["date"] < today) & log["station"].notna() & (log["station"] != "")]
    frames = []
    for (loc, encoded, tz), g in log.groupby(["location", "station", "timezone"]):
        start, end = g["date"].min(), g["date"].max()
        for group, (source, sid) in decode_stations(encoded).items():
            st = Station(sid, sid, 0.0, 0.0, None, 0.0, source=source, variables=frozenset({group}))
            daily = stations.fetch_daily(st, start, end, tz)
            long = obs_long(daily[[c for c in VAR_GROUPS[group] if c in daily]])
            frames.append(long.assign(location=loc))
    if not frames:
        return pd.DataFrame()
    return score(log, pd.concat(frames, ignore_index=True))
