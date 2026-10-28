"""Settings, variable definitions and location handling."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> None:
    """Minimal .env support (KEY=VALUE lines); real environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_dotenv(PROJECT_ROOT / ".env")
DEFAULT_LOCATIONS = PROJECT_ROOT / "config" / "locations.yaml"
DATA_DIR = Path(os.environ.get("WEATHER_ENGINE_DATA", PROJECT_ROOT / "data"))
REPORTS_DIR = Path(os.environ.get("WEATHER_ENGINE_REPORTS", PROJECT_ROOT / "reports"))

USER_AGENT = os.environ.get(
    "WEATHER_ENGINE_USER_AGENT", "weather-engine/0.1 (personal forecasting project)"
)

# Deterministic models blended by the engine (Open-Meteo model ids).
# Global physics models, NOAA's US-only ones (NBM: NOAA's own calibrated blend, 2.5 km;
# HRRR: 3 km, first ~2 days only), and two AI models (ECMWF AIFS, NOAA AIGFS).
# Models a place isn't covered by are skipped with a note; each model's weight
# in the blend is learned from how well it has done at that place.
MODELS = [
    "ecmwf_ifs025", "gfs_seamless", "icon_seamless", "gem_seamless", "ukmo_seamless",
    "ncep_nbm_conus", "ncep_hrrr_conus", "ecmwf_aifs025_single", "ncep_aigfs025",
]
# Ensembles used for rain probability.
ENSEMBLE_MODELS = ["ecmwf_ifs025", "gfs025"]
# Model reported alongside the blend as the baseline to beat.
BASELINE_MODEL = "ecmwf_ifs025"

# Station search: every network within this radius is considered (Synoptic token needed
# for non-airport networks; see DATA_SOURCES.md).
STATION_SEARCH_RADIUS_KM = 40.0
# Stations are chosen per group, so rain can come from a rain gauge and wind from an anemometer.
VAR_GROUPS = {"temp": ["tmax", "tmin"], "wind": ["wind", "gust"], "precip": ["precip"]}
GROUP_LABELS = {"temp": "temperature", "wind": "wind", "precip": "rain"}

FORECAST_DAYS = 8  # today + 7
MAX_LEAD = 7
TRAIN_WINDOW_DAYS = 60  # recent window for the overall bias of each model
# How far back the models' past runs are kept, for bias and weather-pattern corrections:
# up to 10 years. Open-Meteo has kept past runs of most models only since January 2024
# (GFS temperature since 2021), so the history grows toward 10 years from there.
HISTORY_DAYS = 3650
ARCHIVE_START = date(2024, 1, 1)
MIN_TRAIN_SAMPLES = 5  # fewer days -> corrections are shrunk, see calibrate.fit
FULL_HISTORY_DAYS = 20  # below this, the forecast notes that history is still building
RAIN_THRESHOLD_IN = 0.01

# canonical name -> (Open-Meteo daily var, Open-Meteo hourly var, daily aggregation)
VARIABLES = {
    "tmax": ("temperature_2m_max", "temperature_2m", "max"),
    "tmin": ("temperature_2m_min", "temperature_2m", "min"),
    "precip": ("precipitation_sum", "precipitation", "sum"),
    "wind": ("wind_speed_10m_max", "wind_speed_10m", "max"),
    "gust": ("wind_gusts_10m_max", "wind_gusts_10m", "max"),
}
UNITS = {"tmax": "°F", "tmin": "°F", "precip": "in", "wind": "mph", "gust": "mph"}
LABELS = {
    "tmax": "High",
    "tmin": "Low",
    "precip": "Rain",
    "wind": "Wind",
    "gust": "Gusts",
}


def synoptic_token() -> str | None:
    return os.environ.get("WEATHER_ENGINE_SYNOPTIC_TOKEN") or None


@dataclass
class Location:
    name: str
    latitude: float
    longitude: float
    elevation: float | None = None  # metres
    timezone: str | None = None
    station: str | None = None  # ICAO id, e.g. KDEN; found automatically if None

    @property
    def slug(self) -> str:
        return re.sub(r"[^a-z0-9]+", "-", self.name.lower()).strip("-") or "location"


def load_locations(path: Path) -> dict[str, Location]:
    with open(path) as f:
        raw = yaml.safe_load(f) or {}
    return {
        entry["name"]: Location(**entry) for entry in raw.get("locations", [])
    }


def resolve_location(
    place: str | None,
    lat: float | None = None,
    lon: float | None = None,
    locations_path: Path = DEFAULT_LOCATIONS,
) -> Location:
    """Coordinates, a saved location name, or a place to geocode ("Denver, CO")."""
    if lat is not None and lon is not None:
        return Location(name=place or f"{lat:.3f},{lon:.3f}", latitude=lat, longitude=lon)
    if not place or not place.strip():
        raise ValueError('Give a place ("Denver, CO"), a saved location name, or coordinates.')
    place = place.strip()
    if Path(locations_path).exists():
        saved = load_locations(Path(locations_path))
        if place in saved:
            return saved[place]
    from .sources import openmeteo

    return openmeteo.geocode(place)
