"""End-to-end forecast: fetch models, calibrate against local observations, blend."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import pandas as pd

from . import calibrate, detail, store
from .config import (
    BASELINE_MODEL,
    ENSEMBLE_MODELS,
    FULL_HISTORY_DAYS,
    MAX_LEAD,
    MODELS,
    TRAIN_WINDOW_DAYS,
    VAR_GROUPS,
    Location,
)
from .sources import observations, openmeteo, stations

log = logging.getLogger(__name__)


@dataclass
class ForecastResult:
    location: Location
    issued_at: datetime
    blend: pd.DataFrame  # date, lead, var, value, low, high, n_models, calibrated
    raw: pd.DataFrame  # date, lead, model, var, value
    rain_prob: pd.DataFrame  # index date: rain_prob, n_members
    stats: pd.DataFrame | None = None
    station: observations.Station | None = None  # main station (temperature), or the rejected nearest one
    notes: list[str] = field(default_factory=list)
    station_rejected: bool = False  # nearest station too far/different to calibrate against
    stations: dict[str, observations.Station] = field(default_factory=dict)  # group -> station used
    end_hours: dict[str, int] = field(default_factory=dict)  # group -> hour its daily readings end
    hourly: pd.DataFrame | None = None  # calibrated hour-by-hour detail (see detail.py)
    sun: pd.DataFrame | None = None  # index date: sunrise, sunset


def _fetch_raw(loc: Location, models: list[str], notes: list[str]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """(daily long table, per-model hourly detail, sunrise/sunset)."""
    frames, hourly, sun = [], [], None
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
        if not meta["hourly"].empty:
            hourly.append(meta["hourly"].assign(model=model))
        if sun is None and not meta["sun"].empty:
            sun = meta["sun"]
    if not frames:
        raise RuntimeError("No model forecasts could be fetched:\n  " + "\n  ".join(notes))
    return pd.concat(frames, ignore_index=True), (pd.concat(hourly, ignore_index=True) if hourly else pd.DataFrame()), sun


def _train(loc: Location, models: list[str], today, notes: list[str]) -> tuple[pd.DataFrame | None, stations.Selection]:
    past_days = TRAIN_WINDOW_DAYS + MAX_LEAD
    start, end = today - timedelta(days=past_days), today - timedelta(days=1)
    sel = stations.select(loc, start, end, forced=loc.station)
    notes.extend(sel.notes)
    if sel.obs is None:
        return None, sel
    runs = []
    for model in models:
        try:
            runs.append(store.cached_frame(
                f"pastruns2_{loc.slug}_{model}_{today}", 6,
                lambda m=model: openmeteo.fetch_previous_runs(loc, m, past_days),
            ))
        except Exception as e:
            notes.append(f"{model}: no past runs for calibration ({e})")
    if not runs:
        return None, sel
    hourly = pd.concat(runs, ignore_index=True)
    # Compare each variable over exactly the 24 hours its station's daily reading covers.
    frames = []
    windows = {h: openmeteo.aggregate_windows(hourly, h) for h in set(sel.end_hours.values())}
    for group, end_hour in sel.end_hours.items():
        daily = windows[end_hour]
        frames.append(daily[daily["var"].isin(VAR_GROUPS[group])])
    pairs = calibrate.build_pairs(pd.concat(frames, ignore_index=True), sel.obs[[
        c for g in sel.end_hours for c in VAR_GROUPS[g]]])
    if pairs.empty:
        notes.append("no overlapping forecast/observation history; using uncalibrated blend")
        return None, sel
    days = int(pairs["date"].nunique())
    if days < FULL_HISTORY_DAYS:
        notes.append(f"calibrated on only {days} days of station history so far, so corrections are "
                     f"scaled down; checking this place at least weekly builds up the history")
    return calibrate.fit(pairs, as_of=end), sel


def _rain_prob(loc: Location, notes: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(daily rain probability, hourly ensemble member counts summed over ensembles)."""
    frames, hourly = [], []
    for model in ENSEMBLE_MODELS:
        try:
            daily, hours = openmeteo.fetch_ensemble_precip(loc, model)
            frames.append(daily)
            hourly.append(hours)
        except Exception as e:
            notes.append(f"{model} ensemble unavailable ({e})")
    if not frames:
        return pd.DataFrame(columns=["rain_prob", "n_members"]), pd.DataFrame(columns=["n_members", "wet_members"])
    hourly_sum = pd.concat(hourly).groupby(level=0)[["n_members", "wet_members"]].sum()
    allp = pd.concat(frames)
    # Weight each ensemble by its member count.
    allp["wet_members"] = allp["rain_prob"] * allp["n_members"]
    g = allp.groupby(level=0)[["wet_members", "n_members"]].sum()
    daily = pd.DataFrame({"rain_prob": g["wet_members"] / g["n_members"], "n_members": g["n_members"]})
    return daily, hourly_sum


def run_forecast(loc: Location, models: list[str] = MODELS, use_calibration: bool = True) -> ForecastResult:
    notes: list[str] = []
    issued_at = datetime.now(timezone.utc)
    raw, per_model_hourly, sun = _fetch_raw(loc, models, notes)
    today = raw.loc[raw["lead"] == 0, "date"].min()

    station, stats, rejected, chosen, end_hours = None, None, False, {}, {}
    if use_calibration:
        stats, sel = _train(loc, models, today, notes)
        chosen = sel.chosen if stats is not None else {}
        end_hours = sel.end_hours if stats is not None else {}
        station = chosen.get("temp") or next(iter(chosen.values()), None)
        if not chosen and sel.nearest is not None and not loc.station:
            station, rejected = sel.nearest, True
            notes.extend(sel.nearest.quality_warnings(loc))
            notes.append(f"no station close enough to correct against reliably, so this is the uncalibrated "
                         f"model blend (to use {sel.nearest.id} anyway: `--station {sel.nearest.id}`, "
                         f"or the button in the web app)")

    if stats is not None:
        store.save_calibration(loc.name, stats)
    blended = calibrate.blend(calibrate.apply(raw, stats))
    rain_daily, rain_hourly = _rain_prob(loc, notes)
    hourly = None
    if not per_model_hourly.empty:
        daily_cal = blended.pivot_table(index="date", columns="var", values="value")
        hourly = detail.calibrate_hourly(detail.blend_hourly(per_model_hourly), daily_cal, rain_hourly)
    result = ForecastResult(loc, issued_at, blended, raw, rain_daily, stats, station, notes,
                            rejected, chosen, end_hours, hourly, sun)
    _log(result)
    return result


def _log(result: ForecastResult) -> None:
    blend = result.blend[["date", "lead", "var", "value"]].assign(source="blend")
    raw = result.raw[["date", "lead", "var", "value", "model"]].rename(columns={"model": "source"})
    rows = pd.concat([blend, raw], ignore_index=True)
    rows.insert(0, "issued_at", result.issued_at.isoformat(timespec="seconds"))
    rows.insert(1, "location", result.location.name)
    rows.insert(2, "station", encode_stations(result.stations, result.end_hours))
    rows.insert(3, "timezone", result.location.timezone or "")
    store.append_log(rows)


def encode_stations(chosen: dict[str, observations.Station], end_hours: dict[str, int] | None = None) -> str:
    """{'temp': Station} -> 'temp=acis:12345@7;...' (stored in the forecast log for verify)."""
    end_hours = end_hours or {}
    parts = []
    for g, s in chosen.items():
        hour = end_hours.get(g, 24)
        parts.append(f"{g}={s.source}:{s.ref or s.id}" + ("" if hour == 24 else f"@{hour}"))
    return ";".join(parts)


def decode_stations(text: str) -> dict[str, tuple[str, str, int]]:
    """Inverse of encode_stations -> {group: (source, id, end_hour)}; plain ids are old airport-only logs."""
    if not isinstance(text, str) or not text:
        return {}
    if "=" not in text:
        return {g: ("iem", text, 24) for g in ("temp", "wind", "precip")}
    out = {}
    for part in text.split(";"):
        group, _, ref = part.partition("=")
        source, _, sid = ref.partition(":")
        sid, _, hour = sid.partition("@")
        out[group] = (source, sid, int(hour) if hour else 24)
    return out


def baseline(result: ForecastResult) -> pd.DataFrame:
    """Raw baseline-model forecast in wide form, for side-by-side display."""
    b = result.raw[result.raw["model"] == BASELINE_MODEL]
    return b.pivot_table(index="date", columns="var", values="value")
