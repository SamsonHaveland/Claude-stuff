"""Row types shared by sources, storage and the engine."""

from __future__ import annotations

from typing import NamedTuple

# Canonical variables and units used everywhere in the engine.
TEMPERATURE = "temperature_2m"  # degrees C
WIND = "wind_speed_10m"  # m/s
PRECIP = "precipitation"  # mm accumulated over the hour ending at valid_time
PRECIP_PROB = "precipitation_probability"  # 0-1, engine output only

VARIABLES = (TEMPERATURE, WIND, PRECIP)


class Forecast(NamedTuple):
    location: str
    source: str  # e.g. "om:gfs_seamless", "nws", "engine"
    variable: str
    issue_time: int  # when this forecast was available
    valid_time: int  # the hour it predicts
    value: float


class Observation(NamedTuple):
    location: str
    variable: str
    valid_time: int
    value: float
    station: str
