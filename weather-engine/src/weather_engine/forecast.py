"""End-to-end forecast: fetch models, calibrate against local observations, blend."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import pandas as pd

from . import calibrate, store
from .config import (
    BASELINE_MODEL,
    ENSEMBLE_MODELS,
    MAX_LEAD,
    MODELS,
    TRAIN_WINDOW_DAYS,
    Location,
)
from .sources import observations, openmeteo

log = logging.getLogger(__name__)


@dataclass
class ForecastResult:
    location: Location
    issued_at: datetime
    blend: pd.DataFrame  # date, lead, var, value, low, high, n_models, calibrated
    raw: pd.DataFrame  # date, lead, model, var, value
    rain_prob: pd.DataFrame  # index date: rain_prob, n_members
    stats: pd.DataFrame | None = None
    station: observations.Station | None = None
    notes: list[str] = field(default_factory=list)


def _fetch_raw(loc: Location, models: list[str], notes: list[str]) -> pd.DataFrame:
    frames = []
    for model in models:
        try:
            daily, meta = openmeteo.fetch_forecast(loc, model)
        except Exception as e:  # one model failing shouldn't sink the forecast
            notes.append(f"{model}: unavailable ({e})")
            continue
        loc.timezone = loc.timezone or meta.get("timezone")
        if loc.elevation is None:
            loc.elevation = meta.get("elevation")
        day0 = daily.index.min()
        long = daily.rename_axis("date").reset_index().melt(id_vars="date", var_name="var")
        long["lead"] = long["date"].map(lambda d: (d - day0).days)
        long["model"] = model
        frames.append(long.dropna(subset=["value"]))
    if not frames:
        raise RuntimeError("No model forecasts could be fetched:\n  " + "\n  ".join(notes))
    return pd.concat(frames, ignore_index=True)


def _pick_station(loc: Location, notes: list[str]) -> observations.Station | None:
    try:
        stations = observations.nearest_stations(loc)
    except Exception as e:
        notes.append(f"station lookup failed ({e}); using uncalibrated blend")
        return None
    if loc.station:
        chosen = next((s for s in stations if s.id == loc.station), None)
        return chosen or observations.Station(loc.station, loc.station, loc.latitude, loc.longitude, None, 0.0)
    if not stations:
        notes.append("no nearby observing station; using uncalibrated blend")
        return None
    return stations[0]


def _train(loc: Location, station: observations.Station, models: list[str], today, notes: list[str]) -> pd.DataFrame | None:
    past_days = TRAIN_WINDOW_DAYS + MAX_LEAD
    start, end = today - timedelta(days=past_days), today - timedelta(days=1)
    try:
        obs = store.cached_frame(
            f"obs2_{station.id}_{start}_{end}", 6,
            lambda: observations.fetch_daily(station.id, start, end, loc.timezone).reset_index(),
        ).set_index("date")
    except Exception as e:
        notes.append(f"observations for {station.id} unavailable ({e}); using uncalibrated blend")
        return None
    runs = []
    for model in models:
        try:
            runs.append(store.cached_frame(
                f"pastruns_{loc.slug}_{model}_{today}", 6,
                lambda m=model: openmeteo.fetch_previous_runs(loc, m, past_days),
            ))
        except Exception as e:
            notes.append(f"{model}: no past runs for calibration ({e})")
    if not runs:
        return None
    pairs = calibrate.build_pairs(pd.concat(runs, ignore_index=True), obs)
    if pairs.empty:
        notes.append("no overlapping forecast/observation history; using uncalibrated blend")
        return None
    return calibrate.fit(pairs, as_of=end)


def _rain_prob(loc: Location, notes: list[str]) -> pd.DataFrame:
    frames = []
    for model in ENSEMBLE_MODELS:
        try:
            frames.append(openmeteo.fetch_ensemble_precip(loc, model))
        except Exception as e:
            notes.append(f"{model} ensemble unavailable ({e})")
    if not frames:
        return pd.DataFrame(columns=["rain_prob", "n_members"])
    allp = pd.concat(frames)
    # Weight each ensemble by its member count.
    allp["wet_members"] = allp["rain_prob"] * allp["n_members"]
    g = allp.groupby(level=0)[["wet_members", "n_members"]].sum()
    return pd.DataFrame({"rain_prob": g["wet_members"] / g["n_members"], "n_members": g["n_members"]})


def run_forecast(loc: Location, models: list[str] = MODELS, use_calibration: bool = True) -> ForecastResult:
    notes: list[str] = []
    issued_at = datetime.now(timezone.utc)
    raw = _fetch_raw(loc, models, notes)
    today = raw.loc[raw["lead"] == 0, "date"].min()

    station, stats = None, None
    if use_calibration:
        station = _pick_station(loc, notes)
        if station is not None:
            warnings = station.quality_warnings(loc)
            if warnings and not loc.station:
                notes.extend(warnings)
                notes.append("station is a poor match for this location; using uncalibrated blend "
                             "(set `station:` in locations.yaml to override)")
            else:
                stats = _train(loc, station, models, today, notes)

    blended = calibrate.blend(calibrate.apply(raw, stats))
    result = ForecastResult(loc, issued_at, blended, raw, _rain_prob(loc, notes), stats, station, notes)
    _log(result)
    return result


def _log(result: ForecastResult) -> None:
    blend = result.blend[["date", "lead", "var", "value"]].assign(source="blend")
    raw = result.raw[["date", "lead", "var", "value", "model"]].rename(columns={"model": "source"})
    rows = pd.concat([blend, raw], ignore_index=True)
    rows.insert(0, "issued_at", result.issued_at.isoformat(timespec="seconds"))
    rows.insert(1, "location", result.location.name)
    rows.insert(2, "station", result.station.id if result.station else "")
    rows.insert(3, "timezone", result.location.timezone or "")
    store.append_log(rows)


def baseline(result: ForecastResult) -> pd.DataFrame:
    """Raw baseline-model forecast in wide form, for side-by-side display."""
    b = result.raw[result.raw["model"] == BASELINE_MODEL]
    return b.pivot_table(index="date", columns="var", values="value")
