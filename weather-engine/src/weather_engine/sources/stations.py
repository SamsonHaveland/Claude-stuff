"""Find the nearest usable station for each variable, across every available network.

With a Synoptic token, every network within STATION_SEARCH_RADIUS_KM is searched
(airports, flood-control gauges, RAWS, road-weather and local mesonets).
Without one, only NWS-listed airport stations are available.

Each variable group (temperature, wind, rain) gets its own station: the
nearest candidate that measures it, passes the distance/elevation checks, and
actually has enough recent data. A rain gauge 3 km away can supply rain while
an airport 15 km away supplies wind.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

import pandas as pd

from .. import store
from ..config import GROUP_LABELS, MIN_TRAIN_SAMPLES, STATION_SEARCH_RADIUS_KM, VAR_GROUPS, Location, synoptic_token
from . import observations, synoptic
from .observations import Station

MAX_TRIES_PER_GROUP = 4


@dataclass
class Selection:
    obs: pd.DataFrame | None  # daily, columns per canonical variable (may mix stations)
    chosen: dict[str, Station] = field(default_factory=dict)  # group -> station
    nearest: Station | None = None  # nearest candidate overall, for "use anyway"
    notes: list[str] = field(default_factory=list)


def find_candidates(loc: Location) -> list[Station]:
    """All nearby stations, nearest first."""
    if synoptic_token():
        return synoptic.find_stations(loc, STATION_SEARCH_RADIUS_KM)
    return observations.nearest_stations(loc, n=10)


def fetch_daily(station: Station, start: date, end: date, tz: str) -> pd.DataFrame:
    def fetch() -> pd.DataFrame:
        if station.source == "synoptic":
            df = synoptic.fetch_daily(station.id, start, end, tz, station.variables)
        else:
            df = observations.fetch_daily(station.id, start, end, tz)
        return df.reset_index()

    fresh = store.cached_frame(
        f"obs5_{station.source}_{station.id}_{''.join(sorted(station.variables))}_{start}_{end}", 6, fetch
    ).set_index("date")
    # Keep every day ever downloaded, so history builds up even when the source
    # only serves recent days (Synoptic free accounts: ~7 days).
    archive = store.merge_archive(f"{station.source}_{station.id}", fresh)
    index = pd.Index([d for d in archive.index if start <= d <= end], name="date")
    return archive.reindex(index)


def _usable_days(df: pd.DataFrame, group: str) -> int:
    return int(df[VAR_GROUPS[group][0]].notna().sum()) if not df.empty else 0


def select(loc: Location, start: date, end: date, forced: str | None = None) -> Selection:
    """Pick a station per variable group and assemble their daily observations."""
    sel = Selection(obs=None)
    try:
        candidates = find_candidates(loc)
    except Exception as e:
        sel.notes.append(f"station search failed ({e})")
        return sel

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
    obs = pd.DataFrame()
    for group, cols in VAR_GROUPS.items():
        usable = [s for s in candidates if group in s.variables and (forced or not s.quality_warnings(loc))]
        if not usable:
            sel.notes.append(f"no {GROUP_LABELS[group]} station within "
                             f"{observations.MAX_STATION_DISTANCE_KM:.0f} km and "
                             f"{observations.MAX_STATION_ELEVATION_DIFF_M:.0f} m elevation")
            continue
        for station in usable[:MAX_TRIES_PER_GROUP]:
            if station.key not in frames:
                try:
                    frames[station.key] = fetch_daily(station, start, end, loc.timezone)
                except Exception as e:
                    sel.notes.append(f"{station.id}: data unavailable ({e})")
                    errors.add(station.key)
                    frames[station.key] = pd.DataFrame(columns=["tmax", "tmin", "precip", "wind", "gust"])
            df = frames[station.key]
            days = _usable_days(df, group)
            if days >= MIN_TRAIN_SAMPLES:
                obs = obs.join(df[cols], how="outer") if not obs.empty else df[cols].copy()
                sel.chosen[group] = station
                break
            if not df.empty or station.key not in errors:
                sel.notes.append(f"{station.id} skipped for {GROUP_LABELS[group]}: only {days} "
                                 f"days with complete data "
                                 f"(need {MIN_TRAIN_SAMPLES}); history builds up each time you check this place")
    sel.obs = obs if sel.chosen else None
    return sel
