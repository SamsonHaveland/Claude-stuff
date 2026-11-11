"""End-to-end forecast: fetch models, calibrate against local observations, blend."""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd

from . import calibrate, detail, history, nowcast, regime, store, terrain
from .config import (
    BASELINE_MODEL,
    ENSEMBLE_MODELS,
    FULL_HISTORY_DAYS,
    ARCHIVE_START,
    HISTORY_DAYS,
    MAX_LEAD,
    MODELS,
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
    timings: dict[str, float] = field(default_factory=dict)  # seconds per phase (logged by the server)
    pattern: regime.RegimeModel | None = None  # weather-pattern corrections, if history supports them
    patterns: pd.DataFrame | None = None  # per date: the day's pattern and what it changed (see _patterns)
    nowcast: list[dict] = field(default_factory=list)  # latest station readings used to nudge the next hours
    terrain: pd.DataFrame | None = None  # elevation around the place (terrain.py)
    history: dict = field(default_factory=dict)  # stored vs wanted days of model history (history.coverage)


def _fetch_raw(loc: Location, models: list[str], notes: list[str]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """(daily long table, per-model hourly detail, sunrise/sunset)."""
    frames, hourly, sun = [], [], None
    # All models are requested at once; results are then processed in the configured order.
    with ThreadPoolExecutor(max_workers=len(models)) as pool:
        futures = [(m, pool.submit(openmeteo.fetch_forecast, loc, m)) for m in models]
    for model, future in futures:
        try:
            daily, meta = future.result()
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


@dataclass
class Training:
    stats: pd.DataFrame | None
    sel: stations.Selection
    pattern: regime.RegimeModel | None = None
    p_mean: float | None = None
    history: dict = field(default_factory=dict)


def history_window(today) -> tuple:
    """(first, last) local dates of model history used for training."""
    return max(today - timedelta(days=HISTORY_DAYS + MAX_LEAD), ARCHIVE_START), today - timedelta(days=1)


@dataclass
class TrainingData:
    sel: stations.Selection
    pairs: pd.DataFrame  # date, lead, model, var, fcst, obs
    feats: pd.DataFrame  # daily pattern features per (date, lead, model), see regime.py
    p_mean: float | None = None  # usual sea-level pressure here
    history: dict = field(default_factory=dict)  # how much of the wanted model history is stored


def training_data(loc: Location, models: list[str], today, notes: list[str],
                  backfill_chunks: int = 1) -> TrainingData:
    """Past model runs matched with station observations at this place (plus each day's pattern)."""
    start, end = history_window(today)
    empty = pd.DataFrame()
    # Station search/history and the models' past runs are independent: fetch them together.
    with ThreadPoolExecutor(max_workers=len(models) + 1) as pool:
        sel_future = pool.submit(stations.select, loc, start, end, loc.station)
        run_futures = [(m, pool.submit(history.update, loc, m, start, end, backfill_chunks)) for m in models]
    sel = sel_future.result()
    notes.extend(sel.notes)
    for model, future in run_futures:
        try:
            future.result()
        except Exception as e:  # older archived runs (if any) are still used below
            notes.append(f"{model}: couldn't update past runs ({e})")
    if sel.obs is None:
        return TrainingData(sel, empty, empty)
    # Daily values per model over exactly the 24 hours each station's daily reading covers.
    hours = set(sel.end_hours.values())
    with ThreadPoolExecutor(max_workers=min(len(models), 4)) as pool:
        daily_futures = [pool.submit(history.daily, loc, m, start, end, hours) for m in models]
    frames, feat_frames = [], []
    for future in daily_futures:
        windows, f = future.result()
        feat_frames.append(f)
        for group, end_hour in sel.end_hours.items():
            d = windows[end_hour]
            frames.append(d[d["var"].isin(VAR_GROUPS[group])])
    frames = [f for f in frames if not f.empty]
    if not frames:
        return TrainingData(sel, empty, empty)
    feats = pd.concat(feat_frames, ignore_index=True)
    pats = regime.past_patterns(feats) if not feats.empty else pd.DataFrame()
    p_mean = float(pats["pressure"].mean()) if not pats.empty and pats["pressure"].notna().any() else None
    pairs = calibrate.build_pairs(pd.concat(frames, ignore_index=True), sel.obs[[
        c for g in sel.end_hours for c in VAR_GROUPS[g]]])
    return TrainingData(sel, pairs, feats, p_mean, history.coverage(loc, models, start, end))


@dataclass
class Training:
    stats: pd.DataFrame | None
    sel: stations.Selection
    pattern: regime.RegimeModel | None = None
    p_mean: float | None = None
    history: dict = field(default_factory=dict)


_pattern_memo: dict[tuple, regime.RegimeModel | None] = {}
_pattern_lock = threading.Lock()


def _fit_pattern(loc: Location, td: TrainingData, end) -> regime.RegimeModel | None:
    """regime.fit, reused while the training data is unchanged (it changes about once a day)."""
    p = td.pairs
    key = (loc.slug, end, len(p), round(float(p["fcst"].sum()), 3), round(float(p["obs"].sum()), 3), len(td.feats))
    with _pattern_lock:
        if key in _pattern_memo:
            return _pattern_memo[key]
    # Saved copy: survives the server going to sleep (Cloud Run), so the fit runs about once a day.
    saved = store.read_pickle(f"pattern_{loc.slug}")
    if saved is not None and saved[0] == key:
        fitted = saved[1]
    else:
        fitted = regime.fit(p, td.feats, as_of=end)
        store.write_pickle(f"pattern_{loc.slug}", (key, fitted))
    with _pattern_lock:
        if len(_pattern_memo) > 20:
            _pattern_memo.pop(next(iter(_pattern_memo)))
        _pattern_memo[key] = fitted
    return fitted


def _train(loc: Location, models: list[str], today, notes: list[str]) -> Training:
    td = training_data(loc, models, today, notes)
    if td.sel.obs is None:
        return Training(None, td.sel)
    if td.pairs.empty:
        notes.append("no overlapping forecast/observation history; using uncalibrated blend")
        return Training(None, td.sel)
    end = today - timedelta(days=1)
    days = int(td.pairs["date"].nunique())
    if days < FULL_HISTORY_DAYS:
        notes.append(f"calibrated on only {days} days of station history so far, so corrections are "
                     f"scaled down; checking this place at least weekly builds up the history")
    pattern = _fit_pattern(loc, td, end)
    if pattern is None and days < regime.MIN_DAYS:
        notes.append(f"weather-pattern corrections start once {regime.MIN_DAYS} days of history are "
                     f"stored ({days} so far; older history is filled in a little on each forecast)")
    return Training(calibrate.fit(td.pairs, as_of=end), td.sel, pattern, td.p_mean, td.history)


def _rain_prob(loc: Location, notes: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(daily rain probability, hourly ensemble member counts summed over ensembles)."""
    frames, hourly = [], []
    with ThreadPoolExecutor(max_workers=len(ENSEMBLE_MODELS)) as pool:
        futures = [(m, pool.submit(openmeteo.fetch_ensemble_precip, loc, m)) for m in ENSEMBLE_MODELS]
    for model, future in futures:
        try:
            daily, hours = future.result()
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
    timings: dict[str, float] = {}
    t0 = time.perf_counter()
    # Ensembles (rain chance) don't depend on anything else: start them now, collect at the end.
    background = ThreadPoolExecutor(max_workers=3)
    rain_future = background.submit(_rain_prob, loc, notes)
    terrain_future = background.submit(terrain.fetch, loc)
    raw, per_model_hourly, sun = _fetch_raw(loc, models, notes)
    today = raw.loc[raw["lead"] == 0, "date"].min()
    timings["models"] = time.perf_counter() - t0

    station, stats, rejected, chosen, end_hours = None, None, False, {}, {}
    pattern, p_mean, hist = None, None, {}
    if use_calibration:
        t = time.perf_counter()
        tr = _train(loc, models, today, notes)
        stats, sel, pattern, p_mean, hist = tr.stats, tr.sel, tr.pattern, tr.p_mean, tr.history
        timings["calibration"] = time.perf_counter() - t
        chosen = sel.chosen if stats is not None else {}
        end_hours = sel.end_hours if stats is not None else {}
        station = chosen.get("temp") or next(iter(chosen.values()), None)
        if not chosen and sel.nearest is not None and not loc.station:
            station, rejected = sel.nearest, True
            notes.extend(sel.nearest.quality_warnings(loc))
            notes.append(f"no station close enough to correct against reliably, so this is the uncalibrated "
                         f"model blend (to use {sel.nearest.id} anyway: `--station {sel.nearest.id}`, "
                         f"or the button in the web app)")

    # Latest readings at the chosen stations (fetched while the blend is computed).
    live = {g: chosen[g] for g in ("temp", "wind") if g in chosen}
    latest_future = background.submit(_latest, live, loc.timezone) if live and loc.timezone else None
    if stats is not None:
        store.save_calibration(loc.name, stats)
    if pattern is not None:
        store.save_pattern_tests(loc.name, pattern.cv)
    feats = regime.features_from_forecast(per_model_hourly, today)
    plain = calibrate.blend(calibrate.apply(raw, stats))
    if pattern is not None and stats is not None:
        corrected = calibrate.apply(raw, stats, pattern, feats)
        blended = calibrate.blend(corrected)
    else:
        corrected, blended = None, plain
    try:
        ground = terrain_future.result()
    except Exception as e:
        ground = None
        log.info("terrain unavailable: %s", e)
    patterns = _patterns(feats, p_mean, plain, blended, corrected, ground)
    t = time.perf_counter()
    rain_daily, rain_hourly = rain_future.result()
    timings["ensembles_wait"] = time.perf_counter() - t
    hourly = None
    if not per_model_hourly.empty:
        daily_cal = blended.pivot_table(index="date", columns="var", values="value")
        hourly = detail.calibrate_hourly(detail.blend_hourly(per_model_hourly), daily_cal, rain_hourly)
    nowcast_used = []
    if latest_future is not None:
        latest = latest_future.result()
        if hourly is not None and latest:
            now = issued_at.astimezone(ZoneInfo(loc.timezone)).replace(tzinfo=None)
            hourly, nowcast_used = nowcast.apply(hourly, latest, now)
    background.shutdown()
    result = ForecastResult(loc, issued_at, blended, raw, rain_daily, stats, station, notes,
                            rejected, chosen, end_hours, hourly, sun, pattern=pattern, patterns=patterns,
                            nowcast=nowcast_used, terrain=ground, history=hist)
    _log(result)
    timings["total"] = time.perf_counter() - t0
    result.timings = timings
    return result


def _latest(stations_by_var: dict[str, observations.Station], tz: str) -> dict[str, nowcast.Latest]:
    """{"temp": Latest, "wind": Latest}; a station without live data is simply left out."""
    out, seen = {}, {}
    for var, st in stations_by_var.items():
        try:
            if st.key not in seen:
                seen[st.key] = nowcast.fetch_latest(st, tz)
            if seen[st.key] is not None:
                out[var] = seen[st.key]
        except Exception as e:  # live readings are a bonus; never fail the forecast over them
            log.info("latest reading for %s unavailable: %s", st.id, e)
    return out


def _patterns(feats: pd.DataFrame, p_mean: float | None, plain: pd.DataFrame, blended: pd.DataFrame,
              corrected: pd.DataFrame | None, ground: pd.DataFrame | None = None) -> pd.DataFrame:
    """Per date: the weather pattern in words, and how much the pattern correction moved each variable."""
    days = regime.day_patterns(feats, p_mean)
    if days.empty:
        return days
    days["summary"] = days.apply(regime.describe, axis=1)
    windy = (days["wind_agree"] >= 0.5) & (days["wind_speed"] >= regime.CALM_MPH)
    days["upwind"] = [terrain.describe_upwind(ground, d) if ok else "" for d, ok in zip(days["wind_dir"], windy)]
    if corrected is not None:
        shift = (blended.set_index(["date", "var"])["value"] - plain.set_index(["date", "var"])["value"]).unstack()
        for var in shift.columns:
            days[f"shift_{var}"] = shift[var].reindex(days.index)
        n = corrected.groupby("date")["pattern_n"].median()
        days["similar_days"] = n.reindex(days.index)
    return days


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
