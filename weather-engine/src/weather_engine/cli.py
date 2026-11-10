"""Command line entry point: ``weather-engine <command>``."""

from __future__ import annotations

import argparse
import logging
import time
from datetime import timedelta

from . import db
from .config import Settings, load_settings
from .engine import ForecastIndex, Params, predict
from .locations import Location, load_locations
from .net import HttpError
from .report import overall, write_forecast, write_verification
from .sources import iem, iem_mos, nws, open_meteo
from .timeutil import DAY, HOUR, floor_hour, fmt, to_date
from .verify import backtest, compare

log = logging.getLogger("weather_engine")


def _model_sources(settings: Settings) -> list[str]:
    """Sources the engine blends."""
    return [open_meteo.source_name(m) for m in settings.models] + [
        iem_mos.source_name(m) for m in settings.mos_models
    ]


def _baselines(index: ForecastIndex, settings: Settings) -> list[str]:
    return _model_sources(settings) + ([nws.SOURCE] if nws.SOURCE in index.sources else [])


def _per_model(fetch, models: list[str]):
    """Fetch all models in one call; if the batch is rejected, retry one by one so
    a single unsupported model doesn't block the rest."""
    try:
        return fetch(models)
    except HttpError as e:
        if e.status != 400 or len(models) == 1:
            raise
        rows = []
        for m in models:
            try:
                rows.extend(fetch([m]))
            except HttpError as err:
                log.warning("skipping model %s: %s", m, err)
        return rows


def _try(label: str, func):
    try:
        return func()
    except HttpError as e:
        log.error("%s failed: %s", label, e)
        return None


def cmd_collect(settings: Settings, locations: list[Location], args) -> None:
    now = int(time.time())
    with db.connect(settings.db_path) as conn:
        for loc in locations:
            models = list(settings.models)
            om = _try("open-meteo forecast", lambda: _per_model(
                lambda ms: open_meteo.fetch_forecast(loc, ms, now=now, user_agent=settings.user_agent), models))
            if om is not None:
                log.info("%s: open-meteo %d new rows", loc.id, db.save_forecasts(conn, om, skip_unchanged=True))
            base = _try("nws forecast", lambda: nws.fetch(loc, user_agent=settings.user_agent))
            if base is not None:
                log.info("%s: nws %d new rows", loc.id, db.save_forecasts(conn, base, skip_unchanged=True))
            start = to_date(now - args.obs_days * DAY)
            mos = _try("station forecasts", lambda: iem_mos.fetch(
                loc, list(settings.mos_models), to_date(now - 2 * DAY), to_date(now + DAY), user_agent=settings.user_agent))
            if mos is not None:
                log.info("%s: %d station forecast rows", loc.id, db.save_forecasts(conn, mos))
            obs = _try("observations", lambda: iem.fetch(loc, start, to_date(now + DAY), user_agent=settings.user_agent))
            if obs is not None:
                log.info("%s: %d observations", loc.id, db.save_observations(conn, obs))


def cmd_backfill(settings: Settings, locations: list[Location], args) -> None:
    end = to_date(int(time.time()) - DAY)
    start = end - timedelta(days=args.days)
    with db.connect(settings.db_path) as conn:
        for loc in locations:
            obs = _try("observations", lambda: iem.fetch(loc, start, end + timedelta(days=1), user_agent=settings.user_agent))
            if obs is not None:
                log.info("%s: %d observations", loc.id, db.save_observations(conn, obs))
            mos = _try("station forecasts", lambda: iem_mos.fetch(
                loc, list(settings.mos_models), start - timedelta(days=8), end + timedelta(days=1),
                user_agent=settings.user_agent))
            if mos is not None:
                log.info("%s: %d archived station forecasts", loc.id, db.save_forecasts(conn, mos))
            runs = _try("open-meteo previous runs", lambda: _per_model(
                lambda ms: open_meteo.fetch_previous_runs(loc, ms, start, end, user_agent=settings.user_agent),
                list(settings.models)))
            if runs is not None:
                log.info("%s: %d archived forecasts", loc.id, db.save_forecasts(conn, runs))


def _load(conn, loc: Location, start: int, end: int, params: Params):
    # Training needs window_days of history before start, and runs up to 7 days old.
    rows = db.load_forecasts(conn, loc.id, start - (params.window_days + 8) * DAY, end + params.horizon_hours * HOUR + HOUR)
    obs = db.load_observations(conn, loc.id, start - (params.window_days + 1) * DAY, end + params.horizon_hours * HOUR + HOUR)
    return ForecastIndex(r for r in rows if r.source != "engine"), obs, rows


def cmd_predict(settings: Settings, locations: list[Location], args) -> None:
    params = Params()
    cutoff = floor_hour(int(time.time()))
    with db.connect(settings.db_path) as conn:
        for loc in locations:
            index, obs, _ = _load(conn, loc, cutoff, cutoff, params)
            rows = predict(index, obs, cutoff, location=loc.id, sources=_model_sources(settings), params=params)
            if not rows:
                log.error("%s: no model forecasts available; run `collect` first", loc.id)
                continue
            db.save_forecasts(conn, rows)
            path = write_forecast(rows, settings.reports_dir, f"forecast-{loc.id}",
                                  f"{loc.name}: engine forecast issued {fmt(cutoff)}")
            print(f"{loc.id}: {len(rows)} engine values -> {path}")


def _print_overall(loc: Location, results) -> None:
    for (source, variable), (n, skill) in sorted(overall(results).items(), key=lambda kv: (kv[0][1], kv[0][0])):
        print(f"  {variable:16} vs {source:22} {n:7d} cases  skill {100 * skill:+6.1f}%")


def cmd_backtest(settings: Settings, locations: list[Location], args) -> None:
    params = Params()
    with db.connect(settings.db_path) as conn:
        for loc in locations:
            span = db.time_range(conn, loc.id)
            if span is None:
                log.error("%s: no observations; run `backfill` first", loc.id)
                continue
            end = floor_hour(span[1]) - params.horizon_hours * HOUR
            start = max(floor_hour(span[0]) + params.window_days * DAY, end - args.days * DAY)
            start -= start % DAY  # issue at 00Z
            if start >= end:
                log.error("%s: not enough history (need > %d days)", loc.id, params.window_days + 7)
                continue
            index, obs, _ = _load(conn, loc, start, end, params)
            results = backtest(index, obs, location=loc.id, start=start, end=end, step_hours=args.step,
                               sources=_model_sources(settings), baselines=_baselines(index, settings), params=params)
            path = write_verification(results, settings.reports_dir, f"backtest-{loc.id}",
                                      f"{loc.name}: walk-forward backtest {fmt(start)} to {fmt(end)}")
            print(f"{loc.id}: {results.cases} scored cases -> {path}")
            _print_overall(loc, results)


def cmd_scorecard(settings: Settings, locations: list[Location], args) -> None:
    now = int(time.time())
    params = Params()
    with db.connect(settings.db_path) as conn:
        for loc in locations:
            index, obs, rows = _load(conn, loc, now - args.days * DAY, now, params)
            engine_rows = [r for r in rows if r.source == "engine" and r.issue_time >= now - args.days * DAY]
            results = compare(engine_rows, index, obs, _baselines(index, settings), params.wet_mm)
            path = write_verification(results, settings.reports_dir, f"scorecard-{loc.id}",
                                      f"{loc.name}: live scorecard, last {args.days} days")
            print(f"{loc.id}: {results.cases} scored cases -> {path}")
            _print_overall(loc, results)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="weather-engine", description=__doc__)
    parser.add_argument("--location", help="only this location id (default: all)")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("collect", help="fetch latest forecasts (models + NWS) and observations")
    p.add_argument("--obs-days", type=int, default=3)
    p.set_defaults(func=cmd_collect)
    p = sub.add_parser("backfill", help="load archived model runs and observations")
    p.add_argument("--days", type=int, default=90)
    p.set_defaults(func=cmd_backfill)
    sub.add_parser("predict", help="issue an engine forecast now").set_defaults(func=cmd_predict)
    p = sub.add_parser("backtest", help="walk-forward test on stored history")
    p.add_argument("--days", type=int, default=60)
    p.add_argument("--step", type=int, default=24, help="hours between simulated issues")
    p.set_defaults(func=cmd_backtest)
    p = sub.add_parser("scorecard", help="score issued engine forecasts against NWS and models")
    p.add_argument("--days", type=int, default=30)
    p.set_defaults(func=cmd_scorecard)
    p = sub.add_parser("locations", help="list configured locations")
    p.set_defaults(func=lambda s, locs, a: [print(f"{l.id}: {l.name} ({l.latitude}, {l.longitude}) truth={l.station}") for l in locs])

    args = parser.parse_args(argv)
    settings = load_settings()
    logging.basicConfig(level=settings.log_level, format="%(levelname)s %(message)s")
    locations = load_locations(settings.locations_file)
    if args.location:
        locations = [l for l in locations if l.id == args.location]
    args.func(settings, locations, args)


if __name__ == "__main__":
    main()
