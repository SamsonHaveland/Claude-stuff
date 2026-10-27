"""Local CSV storage: cached downloads and the forecast log used for verification."""

from __future__ import annotations

import os
import threading
import time
from collections.abc import Callable
from pathlib import Path

import pandas as pd

from .config import DATA_DIR

# Short-lived download cache; on Cloud Run this points at fast local disk (/tmp) while
# DATA_DIR (archive, logs) lives on the mounted Cloud Storage bucket.
CACHE_DIR = Path(os.environ.get("WEATHER_ENGINE_CACHE", DATA_DIR / "cache"))
PROCESSED_DIR = DATA_DIR / "processed"
FORECAST_LOG = PROCESSED_DIR / "forecast_log.csv"
ARCHIVE_DIR = PROCESSED_DIR / "obs_archive"
CALIBRATION_LOG = PROCESSED_DIR / "calibration_latest.csv"

# The web server handles requests in parallel threads; serialise file writes.
_write_lock = threading.Lock()


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
    tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
    df.to_csv(tmp, index=False)
    os.replace(tmp, path)  # atomic: readers never see a half-written file
    return df


def append_log(rows: pd.DataFrame, path: Path | None = None) -> None:
    path = path or FORECAST_LOG
    path.parent.mkdir(parents=True, exist_ok=True)
    with _write_lock:
        rows.to_csv(path, mode="a", header=not path.exists(), index=False)


def read_log(path: Path | None = None) -> pd.DataFrame:
    path = path or FORECAST_LOG
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


def merge_archive(name: str, new: pd.DataFrame) -> pd.DataFrame:
    """Merge daily observations (index = date) into a permanent per-station archive.

    New non-empty values win; days the new download lacks (e.g. older than a
    free account's history limit) keep their archived values.
    """
    path = ARCHIVE_DIR / f"{name}.csv"
    with _write_lock:
        if path.exists():
            old = pd.read_csv(path)
            old["date"] = pd.to_datetime(old["date"]).dt.date
            merged = new.combine_first(old.set_index("date"))
        else:
            merged = new.copy()
        merged = merged.sort_index()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
        merged.rename_axis("date").reset_index().to_csv(tmp, index=False)
        os.replace(tmp, path)
    return merged


def save_calibration(location: str, stats: pd.DataFrame) -> None:
    """Keep the latest calibration stats per location (for `analyze`)."""
    with _write_lock:
        old = pd.read_csv(CALIBRATION_LOG) if CALIBRATION_LOG.exists() else pd.DataFrame()
        if not old.empty:
            old = old[old["location"] != location]
        merged = pd.concat([old, stats.assign(location=location)], ignore_index=True)
        CALIBRATION_LOG.parent.mkdir(parents=True, exist_ok=True)
        merged.to_csv(CALIBRATION_LOG, index=False)


def read_calibration() -> pd.DataFrame:
    return pd.read_csv(CALIBRATION_LOG) if CALIBRATION_LOG.exists() else pd.DataFrame()


def archive_coverage() -> pd.DataFrame:
    """Per archived station: days with data per variable and the date range."""
    rows = []
    for path in sorted(ARCHIVE_DIR.glob("*.csv")):
        df = pd.read_csv(path)
        if df.empty or "date" not in df:
            continue
        row = {"station": path.stem, "first": df["date"].min(), "last": df["date"].max()}
        for col in ("tmax", "tmin", "precip", "wind", "gust"):
            row[f"days_{col}"] = int(df[col].notna().sum()) if col in df else 0
        rows.append(row)
    return pd.DataFrame(rows)
