"""Command line: `weather-engine forecast|stations|verify`."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .config import PROJECT_ROOT, Location, load_locations

DEFAULT_LOCATIONS = PROJECT_ROOT / "config" / "locations.yaml"


def _resolve(args: argparse.Namespace) -> Location:
    from .sources import openmeteo

    if args.lat is not None and args.lon is not None:
        return Location(name=args.place or f"{args.lat:.3f},{args.lon:.3f}", latitude=args.lat, longitude=args.lon)
    if not args.place:
        sys.exit("Give a place (\"Denver, CO\"), a saved location name, or --lat/--lon.")
    path = Path(args.locations)
    if path.exists():
        saved = load_locations(path)
        if args.place in saved:
            return saved[args.place]
    return openmeteo.geocode(args.place)


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
    p.set_defaults(func=cmd_forecast)

    p = sub.add_parser("stations", help="show nearby stations and how well they match")
    place_args(p)
    p.set_defaults(func=cmd_stations)

    p = sub.add_parser("verify", help="score past forecasts against observations")
    p.set_defaults(func=cmd_verify)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    try:
        args.func(args)
    except RuntimeError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
