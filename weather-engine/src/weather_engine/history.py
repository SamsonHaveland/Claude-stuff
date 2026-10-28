"""Permanent archive of each model's past runs at a place.

The models' old forecasts are the training data for calibration. Instead of
re-downloading them on every forecast, they're kept (Cloud Storage on Cloud
Run) and only the newest days are fetched. Older history (back to
config.ARCHIVE_START, up to HISTORY_DAYS) is filled in one chunk per forecast,
and by `fill` in paced steps: the web app calls it while it's open, and
`weather-engine backfill` runs it from the command line. Pacing keeps every
request inside Open-Meteo's free rate limits.
"""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

import threading
import time

from . import regime, store
from .config import HISTORY_DAYS, MAX_LEAD, Location
from .sources import openmeteo

CHUNK_DAYS = 60  # per download: keeps each request light on the free API
REFRESH_DAYS = MAX_LEAD + 1  # recent days are re-fetched: their longer-lead runs only just arrived
FRESH_HOURS = 3  # an archive updated this recently isn't checked again for new runs
MEMO_SIZE = 40

# Daily training tables derived from an archive, reused until the archive file changes.
_memo: dict[tuple, tuple[dict[int, pd.DataFrame], pd.DataFrame]] = {}
_memo_lock = threading.Lock()


def archive_name(loc: Location, model: str) -> str:
    return f"{loc.latitude:.2f}_{loc.longitude:.2f}_{model}"


def missing_spans(have: pd.DataFrame | None, start: date, end: date, backfill_chunks: int) -> list[tuple[date, date]]:
    """Date spans (inclusive) to download so the archive covers start..end."""
    spans = []
    if have is None or have.empty:
        recent_start = max(start, end - timedelta(days=CHUNK_DAYS - 1))
        spans.append((recent_start, end))
        oldest = recent_start
    else:
        first, last = have.index.min().date(), have.index.max().date()
        lo = max(start, last - timedelta(days=REFRESH_DAYS))
        while lo <= end:  # newest days (several chunks if the archive went stale)
            hi = min(end, lo + timedelta(days=CHUNK_DAYS - 1))
            spans.append((lo, hi))
            lo = hi + timedelta(days=1)
        oldest = min(first, spans[0][0]) if spans else first
    for _ in range(backfill_chunks):  # then reach further back
        if oldest <= start:
            break
        hi = oldest - timedelta(days=1)
        lo = max(start, hi - timedelta(days=CHUNK_DAYS - 1))
        spans.append((lo, hi))
        oldest = lo
    return spans


def update(loc: Location, model: str, start: date, end: date, backfill_chunks: int = 1) -> None:
    """Download whatever the archive is missing for local dates start..end (plus some older history)."""
    name = archive_name(loc, model)
    have = store.read_runs(name)
    spans = missing_spans(have, start, end, backfill_chunks)
    mtime = store.runs_mtime(name)
    if have is not None and mtime and time.time() - mtime < FRESH_HOURS * 3600 and have.index.max().date() >= end:
        first = have.index.min().date()
        spans = [s for s in spans if s[1] < first]  # newest runs were just fetched: only reach further back
    fresh, error = [], None
    for a, b in spans:
        try:
            fresh.append(openmeteo.fetch_previous_runs_range(loc, model, a, b))
        except Exception as e:  # keep what did arrive; the rest is retried next time
            error = e
            break
    if fresh:
        store.merge_runs(name, pd.concat(fresh), keep_days=HISTORY_DAYS + 30, old=have)
    if error is not None:
        raise error


def daily(loc: Location, model: str, start: date, end: date, end_hours: set[int]) -> tuple[dict[int, pd.DataFrame], pd.DataFrame]:
    """From the archive: {end_hour: daily (date, lead, var, value, model)} and daily pattern features.

    Each daily value covers the 24 hours ending at end_hour local time (see
    openmeteo.aggregate_windows). One model at a time keeps memory low on
    small servers; results are reused until the archive changes.
    """
    name = archive_name(loc, model)
    key = (name, store.runs_mtime(name), start, end, tuple(sorted(end_hours)))
    with _memo_lock:
        if key in _memo:
            return _memo[key]
    have = store.read_runs(name)
    if have is None or have.empty:
        empty = pd.DataFrame(columns=["date", "lead", "var", "value", "model"])
        return {h: empty for h in end_hours}, regime.features_from_past_runs(pd.DataFrame(columns=["time", "lead", "hvar", "value", "model"]))
    window = have[(have.index >= pd.Timestamp(start)) & (have.index < pd.Timestamp(end + timedelta(days=1)))]
    out = ({h: openmeteo.daily_from_wide(window, h).assign(model=model) for h in end_hours},
           regime.features_from_wide(window, model))
    with _memo_lock:
        _memo[key] = out
        while len(_memo) > MEMO_SIZE:
            _memo.pop(next(iter(_memo)))
    return out


def coverage(loc: Location, models: list[str], start: date, end: date) -> dict:
    """How much of start..end is stored: {"target_days", "stored_days" (least-covered model), "complete"}."""
    target = (end - start).days + 1
    stored = []
    for model in models:
        have = store.read_runs(archive_name(loc, model))
        if have is not None and not have.empty:
            stored.append((end - max(have.index.min().date(), start)).days + 1)
    least = min(stored) if stored else 0
    return {"target_days": target, "stored_days": least, "complete": bool(stored) and least >= target}


def fill(loc: Location, models: list[str], start: date, end: date, budget_s: float = 50, pause_s: float = 3.5) -> dict:
    """Download older history one chunk at a time, round-robin over models, for up to `budget_s` seconds.

    The pause between downloads keeps this, plus forecasts running alongside it,
    inside Open-Meteo's free limits (600 calls/minute; a 60-day chunk counts as ~18).
    Models without an archive yet are left to the next forecast (it creates them).
    """
    deadline = time.time() + budget_s
    progress = True
    while progress and time.time() < deadline:
        progress = False
        for model in models:
            if time.time() >= deadline:
                break
            name = archive_name(loc, model)
            have = store.read_runs(name)
            if have is None or have.empty:
                continue
            first = have.index.min().date()
            older = [s for s in missing_spans(have, start, end, backfill_chunks=1) if s[1] < first]
            if not older:
                continue
            a, b = older[0]
            try:
                chunk = openmeteo.fetch_previous_runs_range(loc, model, a, b)
            except Exception as e:  # e.g. the free daily limit: keep what's stored, try again later
                return {**coverage(loc, models, start, end), "error": str(e)[:300]}
            store.merge_runs(name, chunk, keep_days=HISTORY_DAYS + 30, old=have)
            progress = True
            time.sleep(pause_s)
    return coverage(loc, models, start, end)
