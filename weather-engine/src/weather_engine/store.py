"""Local CSV storage: cached downloads and the forecast log used for verification."""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

import pandas as pd

from .config import DATA_DIR

CACHE_DIR = DATA_DIR / "cache"
PROCESSED_DIR = DATA_DIR / "processed"
FORECAST_LOG = PROCESSED_DIR / "forecast_log.csv"


def cached_frame(name: str, max_age_hours: float, fetch: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    """Return a cached CSV if fresh, otherwise fetch and cache it."""
    path = CACHE_DIR / f"{name}.csv"
    if path.exists() and time.time() - path.stat().st_mtime < max_age_hours * 3600:
        df = pd.read_csv(path)
        if "date" in df:
            df["date"] = pd.to_datetime(df["date"]).dt.date
        return df
    df = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    return df


def append_log(rows: pd.DataFrame, path: Path | None = None) -> None:
    path = path or FORECAST_LOG
    path.parent.mkdir(parents=True, exist_ok=True)
    rows.to_csv(path, mode="a", header=not path.exists(), index=False)


def read_log(path: Path | None = None) -> pd.DataFrame:
    path = path or FORECAST_LOG
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df
