"""Command line: `weather-engine forecast|stations|check-station|verify|analyze|backfill|backtest|serve`."""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from .config import DEFAULT_LOCATIONS, Location, resolve_location


def _resolve(args: argparse.Namespace) -> Location:
    try:
        loc = resolve_location(args.place, args.lat, args.lon, Path(args.locations))
    except ValueError as e:
        sys.exit(str(e))
    if getattr(args, "station", None):
        loc.station = args.station.upper()
    return loc


def cmd_forecast(args: argparse.Namespace) -> None:
    from . import report
    from .forecast import run_forecast

    result = run_forecast(_resolve(args), use_calibration=not args.raw)
    print(report.to_text(result))
    if args.html:
        print(f"\nHTML report: {report.to_html(result)}")
    if args.summary:
        from . import ai

        try:
            print("\nSummary (written by Claude from the numbers above):\n" + ai.summarize(report.to_dict(result)))
        except ai.AIError as e:
            print(f"\nSummary unavailable: {e}")


def cmd_stations(args: argparse.Namespace) -> None:
    from .config import STATION_SEARCH_RADIUS_KM, synoptic_token
    from .sources import stations

    loc = _resolve(args)
    if loc.elevation is None:  # needed for the elevation check
        from .sources import openmeteo
        loc.elevation = openmeteo.fetch_forecast(loc, "gfs_seamless", days=1)[1].get("elevation")
    source = ("ACIS + all networks (Synoptic)" if synoptic_token()
              else "ACIS + airports (add a Synoptic token for all networks)")
    print(f"Stations near {loc.name}, {source}:")
    found, notes = stations.find_candidates(loc)
    for n in notes:
        print(f"  ! {n}")
    if not found:
        print(f"  none within {STATION_SEARCH_RADIUS_KM:.0f} km")
    for s in found:
        warn = "; ".join(w.replace(f"station {s.id} ", "") for w in s.quality_warnings(loc)) or "ok"
        elev = "?" if s.elevation is None else f"{s.elevation:.0f} m"
        groups = "/".join(g for g in ("temp", "wind", "precip") if g in s.variables)
        print(f"  {s.id:<12} {s.distance_km:5.1f} km  {elev:>7}  {groups:<16} {s.name} [{s.network}]  [{warn}]")


def cmd_check_station(args: argparse.Namespace) -> None:
    from .sources import synoptic

    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=args.days - 1)
    print(f"What Synoptic returns for {args.station}, {start} to {end} ({args.tz}):")
    for line in synoptic.diagnose(args.station, start, end, args.tz):
        print(" ", line)


def cmd_verify(args: argparse.Namespace) -> None:
    from . import report
    from .verify import run_verification

    print(report.scores_to_text(run_verification()))


def cmd_analyze(args: argparse.Namespace) -> None:
    from . import ai
    from .verify import run_verification

    scores = run_verification()
    if args.show_data:
        print(ai.build_context(scores))
        return
    print("Asking Claude to review verification scores, calibration and station data (about a minute)...")
    try:
        text, path = ai.analyze(scores)
    except ai.AIError as e:
        sys.exit(str(e))
    print(text)
    print(f"\nSaved to {path}")


def _prepare(loc: Location) -> None:
    """Fill in timezone/elevation (needed for station matching) from one quick model call."""
    from .sources import openmeteo

    meta = openmeteo.fetch_forecast(loc, "gfs_seamless", days=1)[1]
    loc.timezone = loc.timezone or meta.get("timezone")
    loc.elevation = loc.elevation if loc.elevation is not None else meta.get("elevation")


def _backfill(loc: Location) -> None:
    import time

    from . import history, store
    from .config import HISTORY_DAYS, MAX_LEAD, MODELS

    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=HISTORY_DAYS + MAX_LEAD)
    print(f"Filling in {HISTORY_DAYS} days of past model runs for {loc.name} "
          f"(paced to stay inside Open-Meteo's free limits; a few minutes the first time)...")
    for i, model in enumerate(MODELS):
        try:
            history.update(loc, model, start, end, backfill_chunks=10)
            have = store.read_runs(history.archive_name(loc, model))
            days = 0 if have is None else have.index.normalize().nunique()
            print(f"  {model:<22} {days} days")
        except Exception as e:
            print(f"  {model:<22} unavailable ({e})")
        if i < len(MODELS) - 1:
            time.sleep(12)


def cmd_backfill(args: argparse.Namespace) -> None:
    loc = _resolve(args)
    _prepare(loc)
    _backfill(loc)


def cmd_backtest(args: argparse.Namespace) -> None:
    from . import backtest, report
    from .config import MODELS
    from .forecast import training_data

    loc = _resolve(args)
    _prepare(loc)
    if not args.no_backfill:
        _backfill(loc)
    notes: list[str] = []
    print("Matching past forecasts with station observations...")
    td = training_data(loc, MODELS, date.today(), notes, backfill_chunks=0)
    if td.pairs.empty:
        sys.exit("No forecast/observation history to test with:\n  " + "\n  ".join(notes))
    stations = ", ".join(f"{g}: {s.id}" for g, s in td.sel.chosen.items())
    print(f"Stations: {stations}. History: {td.pairs['date'].nunique()} days.")
    print(f"Replaying the last {args.days} days as if forecasting live (about a minute)...")
    results = backtest.run(td.pairs, td.feats, date.today(), days=args.days)
    print(report.backtest_to_text(backtest.summarize(results)))


def cmd_serve(args: argparse.Namespace) -> None:
    from .server import serve

    serve(args.host, args.port)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="weather-engine", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    def place_args(p: argparse.ArgumentParser) -> None:
        p.add_argument("place", nargs="?", help='e.g. "Denver, CO" or a name from locations.yaml')
        p.add_argument("--lat", type=float)
        p.add_argument("--lon", type=float)
        p.add_argument("--locations", default=str(DEFAULT_LOCATIONS))

    p = sub.add_parser("forecast", help="7-day calibrated forecast")
    place_args(p)
    p.add_argument("--html", action="store_true", help="also write an HTML report to reports/")
    p.add_argument("--raw", action="store_true", help="skip calibration (plain model blend)")
    p.add_argument("--station", help="calibrate against this station (ICAO id, e.g. KDEN) even if it is far away")
    p.add_argument("--summary", action="store_true", help="add a plain-English summary written by Claude (needs API key)")
    p.set_defaults(func=cmd_forecast)

    p = sub.add_parser("stations", help="show nearby stations and how well they match")
    place_args(p)
    p.set_defaults(func=cmd_stations)

    p = sub.add_parser("check-station", help="show what Synoptic returns for one station (diagnostics)")
    p.add_argument("station", help="station id from `weather-engine stations`, e.g. UP183")
    p.add_argument("--days", type=int, default=7)
    p.add_argument("--tz", default="America/Los_Angeles")
    p.set_defaults(func=cmd_check_station)

    p = sub.add_parser("verify", help="score past forecasts against observations")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("analyze", help="Claude reviews verification, calibration and station data and recommends changes")
    p.add_argument("--show-data", action="store_true", help="print exactly what would be sent, without calling Claude")
    p.set_defaults(func=cmd_analyze)

    p = sub.add_parser("backfill", help="download a year of past model runs for a place (speeds up and improves its forecasts)")
    place_args(p)
    p.set_defaults(func=cmd_backfill)

    p = sub.add_parser("backtest", help="replay recent days to measure how much each correction helps at a place")
    place_args(p)
    p.add_argument("--station", help="test against this station")
    p.add_argument("--days", type=int, default=60, help="how many recent days to replay (default 60)")
    p.add_argument("--no-backfill", action="store_true", help="skip downloading older model runs first")
    p.set_defaults(func=cmd_backtest)

    p = sub.add_parser("serve", help="run the web app (forecasts run only when you search)")
    p.add_argument("--host", default="127.0.0.1",
                   help="127.0.0.1 = this Mac only; 0.0.0.0 = also phones on your Wi-Fi")
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)),
                   help="defaults to $PORT when set (Cloud Run), else 8000")
    p.set_defaults(func=cmd_serve)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    try:
        args.func(args)
    except RuntimeError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
