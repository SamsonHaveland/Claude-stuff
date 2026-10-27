"""Command line: `weather-engine forecast|stations|verify|serve`."""

from __future__ import annotations

import argparse
import logging
import sys
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


def cmd_stations(args: argparse.Namespace) -> None:
    from .sources import observations

    loc = _resolve(args)
    print(f"Nearest observing stations to {loc.name}:")
    for s in observations.nearest_stations(loc):
        warn = "; ".join(s.quality_warnings(loc)) or "ok"
        elev = "?" if s.elevation is None else f"{s.elevation:.0f} m"
        print(f"  {s.id}  {s.distance_km:5.1f} km  {elev:>7}  {s.name}  [{warn}]")


def cmd_verify(args: argparse.Namespace) -> None:
    from . import report
    from .verify import run_verification

    print(report.scores_to_text(run_verification()))


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
    p.set_defaults(func=cmd_forecast)

    p = sub.add_parser("stations", help="show nearby stations and how well they match")
    place_args(p)
    p.set_defaults(func=cmd_stations)

    p = sub.add_parser("verify", help="score past forecasts against observations")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("serve", help="run the web app (forecasts run only when you search)")
    p.add_argument("--host", default="127.0.0.1",
                   help="127.0.0.1 = this Mac only; 0.0.0.0 = also phones on your Wi-Fi")
    p.add_argument("--port", type=int, default=8000)
    p.set_defaults(func=cmd_serve)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    try:
        args.func(args)
    except RuntimeError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
