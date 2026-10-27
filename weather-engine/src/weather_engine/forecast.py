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
    FULL_HISTORY_DAYS,
    MAX_LEAD,
    MODELS,
    TRAIN_WINDOW_DAYS,
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
                f"pastruns_{loc.slug}_{model}_{today}", 6,
                lambda m=model: openmeteo.fetch_previous_runs(loc, m, past_days),
            ))
        except Exception as e:
            notes.append(f"{model}: no past runs for calibration ({e})")
    if not runs:
        return None, sel
    pairs = calibrate.build_pairs(pd.concat(runs, ignore_index=True), sel.obs)
    if pairs.empty:
        notes.append("no overlapping forecast/observation history; using uncalibrated blend")
        return None, sel
    days = int(pairs["date"].nunique())
    if days < FULL_HISTORY_DAYS:
        notes.append(f"calibrated on only {days} days of station history so far, so corrections are "
                     f"scaled down; checking this place at least weekly builds up the history")
    return calibrate.fit(pairs, as_of=end), sel


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

    station, stats, rejected, chosen = None, None, False, {}
    if use_calibration:
        stats, sel = _train(loc, models, today, notes)
        chosen = sel.chosen if stats is not None else {}
        station = chosen.get("temp") or next(iter(chosen.values()), None)
        if not chosen and sel.nearest is not None and not loc.station:
            station, rejected = sel.nearest, True
            notes.extend(sel.nearest.quality_warnings(loc))
            notes.append(f"no station close enough to correct against reliably, so this is the uncalibrated "
                         f"model blend (to use {sel.nearest.id} anyway: `--station {sel.nearest.id}`, "
                         f"or the button in the web app)")

    blended = calibrate.blend(calibrate.apply(raw, stats))
    result = ForecastResult(loc, issued_at, blended, raw, _rain_prob(loc, notes), stats, station, notes,
                            rejected, chosen)
    _log(result)
    return result


def _log(result: ForecastResult) -> None:
    blend = result.blend[["date", "lead", "var", "value"]].assign(source="blend")
    raw = result.raw[["date", "lead", "var", "value", "model"]].rename(columns={"model": "source"})
    rows = pd.concat([blend, raw], ignore_index=True)
    rows.insert(0, "issued_at", result.issued_at.isoformat(timespec="seconds"))
    rows.insert(1, "location", result.location.name)
    rows.insert(2, "station", encode_stations(result.stations))
    rows.insert(3, "timezone", result.location.timezone or "")
    store.append_log(rows)


def encode_stations(chosen: dict[str, observations.Station]) -> str:
    """{'temp': Station} -> 'temp=synoptic:KLAS;...' (stored in the forecast log for verify)."""
    return ";".join(f"{g}={s.source}:{s.id}" for g, s in chosen.items())


def decode_stations(text: str) -> dict[str, tuple[str, str]]:
    """Inverse of encode_stations -> {group: (source, id)}; plain ids are old airport-only logs."""
    if not isinstance(text, str) or not text:
        return {}
    if "=" not in text:
        return {g: ("iem", text) for g in ("temp", "wind", "precip")}
    out = {}
    for part in text.split(";"):
        group, _, ref = part.partition("=")
        source, _, sid = ref.partition(":")
        out[group] = (source, sid)
    return out


def baseline(result: ForecastResult) -> pd.DataFrame:
    """Raw baseline-model forecast in wide form, for side-by-side display."""
    b = result.raw[result.raw["model"] == BASELINE_MODEL]
    return b.pivot_table(index="date", columns="var", values="value")
