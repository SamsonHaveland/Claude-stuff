"""Find the nearest usable station for each variable, across every available network.

Sources searched:
- ACIS (always; free): COOP observers, CoCoRaHS rain gauges, airports.
  Daily temperature and rain with years of history.
- Synoptic (with a token): every network, incl. railroad, utility, RAWS,
  road weather. Temperature, wind and rain; free accounts serve ~7 days,
  which accumulates in the local archive.
- NWS/Iowa Mesonet airports (without a Synoptic token).

Each variable group (temperature, wind, rain) gets its own station. Among
candidates that measure it and pass the distance/elevation checks, the nearest
one with a full history (FULL_HISTORY_DAYS) wins; if none has that, the
nearest with at least MIN_TRAIN_SAMPLES days. Each group also records the hour
its daily readings end (24 = midnight), so forecasts are compared over exactly
the same 24 hours.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, timedelta

import pandas as pd

from .. import store
from ..config import (
    FULL_HISTORY_DAYS,
    GROUP_LABELS,
    MIN_TRAIN_SAMPLES,
    STATION_SEARCH_RADIUS_KM,
    VAR_GROUPS,
    Location,
    synoptic_token,
)
from . import acis, observations, synoptic
from .observations import Station

MAX_CANDIDATES_PER_GROUP = 6
RECHECK_DAYS = 5  # recent days are re-downloaded: stations report late or correct values
PREFETCH_PER_GROUP = 2  # stations downloaded in parallel up front; more are tried one by one if needed
OBS_COLUMNS = ["tmax", "tmin", "precip", "wind", "gust", "obs_hour_temp", "obs_hour_precip"]


@dataclass
class Selection:
    obs: pd.DataFrame | None  # daily, columns per canonical variable (may mix stations)
    chosen: dict[str, Station] = field(default_factory=dict)  # group -> station
    end_hours: dict[str, int] = field(default_factory=dict)  # group -> local hour its daily window ends
    nearest: Station | None = None  # nearest candidate overall, for "use anyway"
    notes: list[str] = field(default_factory=list)


def find_candidates(loc: Location) -> tuple[list[Station], list[str]]:
    """All nearby stations from every available source, nearest first."""
    found, notes = [], []
    searches = [("ACIS", lambda: acis.find_stations(loc, STATION_SEARCH_RADIUS_KM))]
    if synoptic_token():
        searches.append(("Synoptic", lambda: synoptic.find_stations(loc, STATION_SEARCH_RADIUS_KM)))
    else:
        searches.append(("NWS", lambda: observations.nearest_stations(loc, n=10)))
    with ThreadPoolExecutor(max_workers=len(searches)) as pool:
        futures = [(name, pool.submit(search)) for name, search in searches]
    for name, future in futures:
        try:
            found += future.result()
        except Exception as e:
            notes.append(f"{name} station search failed ({e})")
    return sorted(found, key=lambda s: s.distance_km), notes


def _download(station: Station, start: date, end: date, tz: str) -> pd.DataFrame:
    if station.source == "synoptic":
        df = synoptic.fetch_daily(station.id, start, end, tz, station.variables)
    elif station.source == "acis":
        df = acis.fetch_daily(station.ref or station.id, start, end)
    else:
        df = observations.fetch_daily(station.id, start, end, tz)
    for col in OBS_COLUMNS:
        if col not in df:
            df[col] = 24.0 if col.startswith("obs_hour") else float("nan")
    return df[OBS_COLUMNS].reset_index()


def _spans(archived: pd.DataFrame | None, station: Station, start: date, end: date) -> list[tuple[date, date]]:
    """What still has to be downloaded: the last few days (late reports) plus any older days never fetched."""
    if archived is None or archived.empty:
        if station.source == "synoptic":  # same request length as before the year-long history
            return [(max(start, end - timedelta(days=66)), end)]
        return [(start, end)]
    first, last = min(archived.index), max(archived.index)
    spans = [(max(start, last - timedelta(days=RECHECK_DAYS)), end)]
    # Free Synoptic accounts only serve ~7 days, so asking for older days is pointless there.
    if first > start + timedelta(days=7) and station.source != "synoptic":
        spans.append((start, first - timedelta(days=1)))
    return [(a, b) for a, b in spans if a <= b]


def fetch_daily(station: Station, start: date, end: date, tz: str) -> pd.DataFrame:
    """Daily observations start..end, from the permanent archive plus whatever it's missing."""
    name = f"{station.source}_{station.ref or station.id}"
    archived = store.read_archive(name)
    fresh = []
    for a, b in _spans(archived, station, start, end):
        key = f"obs7_{station.source}_{station.ref or station.id}_{''.join(sorted(station.variables))}_{a}_{b}"
        fresh.append(store.cached_frame(key, 6, lambda a=a, b=b: _download(station, a, b, tz)).set_index("date"))
    # Keep every day ever downloaded, so history builds up even when the source
    # only serves recent days (Synoptic free accounts: ~7 days).
    archive = store.merge_archive(name, pd.concat(fresh)) if fresh else archived
    index = pd.Index([d for d in archive.index if start <= d <= end], name="date")
    return archive.reindex(index)


def _end_hour(df: pd.DataFrame, group: str) -> int | None:
    col = "obs_hour_precip" if group == "precip" else "obs_hour_temp"
    if col not in df or group == "wind":
        return 24
    hours = df[col].dropna()
    return int(hours.mode().iloc[0]) if not hours.empty else None


def _usable_days(df: pd.DataFrame, group: str) -> int:
    return int(df[VAR_GROUPS[group][0]].notna().sum()) if not df.empty else 0


def select(loc: Location, start: date, end: date, forced: str | None = None) -> Selection:
    """Pick a station per variable group and assemble their daily observations."""
    sel = Selection(obs=None)
    candidates, notes = find_candidates(loc)
    sel.notes += notes

    if forced:
        match = [s for s in candidates if s.id.upper() == forced.upper()]
        if match:
            candidates = match
        else:
            source = "synoptic" if synoptic_token() else "iem"
            candidates = [Station(forced, forced, loc.latitude, loc.longitude, None, 0.0, source=source)]
    if not candidates:
        sel.notes.append("no observing stations found nearby")
        return sel
    sel.nearest = candidates[0]

    frames: dict[str, pd.DataFrame] = {}  # station key -> daily obs (fetched once per station)
    errors: set[str] = set()

    # Download the most likely stations for every variable at once.
    def usable_for(group: str) -> list[Station]:
        return [s for s in candidates if group in s.variables and (forced or not s.quality_warnings(loc))]

    first_picks = {s.key: s for g in VAR_GROUPS for s in usable_for(g)[:PREFETCH_PER_GROUP]}
    if first_picks:
        with ThreadPoolExecutor(max_workers=min(len(first_picks), 6)) as pool:
            futures = {k: pool.submit(fetch_daily, s, start, end, loc.timezone) for k, s in first_picks.items()}
        for key, future in futures.items():
            try:
                frames[key] = future.result()
            except Exception as e:
                sel.notes.append(f"{first_picks[key].id}: data unavailable ({e})")
                errors.add(key)
                frames[key] = pd.DataFrame(columns=OBS_COLUMNS)
    obs = pd.DataFrame()
    for group, cols in VAR_GROUPS.items():
        usable = usable_for(group)
        if not usable:
            sel.notes.append(f"no {GROUP_LABELS[group]} station within "
                             f"{observations.MAX_STATION_DISTANCE_KM:.0f} km and "
                             f"{observations.MAX_STATION_ELEVATION_DIFF_M:.0f} m elevation")
            continue
        tried = []  # (station, days)
        for station in usable[:MAX_CANDIDATES_PER_GROUP]:
            if station.key not in frames:
                try:
                    frames[station.key] = fetch_daily(station, start, end, loc.timezone)
                except Exception as e:
                    sel.notes.append(f"{station.id}: data unavailable ({e})")
                    errors.add(station.key)
                    frames[station.key] = pd.DataFrame(columns=OBS_COLUMNS)
            days = _usable_days(frames[station.key], group)
            tried.append((station, days))
            if days >= FULL_HISTORY_DAYS:
                break  # nearest with a full history; no need to look further
        best = next((s for s, d in tried if d >= FULL_HISTORY_DAYS), None) \
            or next((s for s, d in tried if d >= MIN_TRAIN_SAMPLES), None)
        for station, days in tried:
            if station is best:
                break
            if station.key not in errors:
                sel.notes.append(f"{station.id} passed over for {GROUP_LABELS[group]}: {days} days of "
                                 f"complete data" + (" (a station with more history was found)" if best else
                                                     f" (need {MIN_TRAIN_SAMPLES}); history builds up each "
                                                     f"time you check this place"))
        if best is None:
            continue
        df = frames[best.key]
        hour = _end_hour(df, group)
        if hour is None:
            sel.notes.append(f"{best.id}: reading time unknown, not used for {GROUP_LABELS[group]}")
            continue
        obs = obs.join(df[cols], how="outer") if not obs.empty else df[cols].copy()
        sel.chosen[group] = best
        sel.end_hours[group] = hour
    sel.obs = obs if sel.chosen else None
    return sel
