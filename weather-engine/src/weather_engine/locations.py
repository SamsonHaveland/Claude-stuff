"""Forecast points, loaded from a TOML file (see locations.toml)."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Location:
    id: str
    name: str
    latitude: float
    longitude: float
    station: str  # ASOS station used as ground truth, e.g. "KNYC"


def load_locations(path: Path) -> list[Location]:
    with open(path, "rb") as f:
        data = tomllib.load(f)
    locations = [Location(**entry) for entry in data.get("location", [])]
    ids = [loc.id for loc in locations]
    if len(ids) != len(set(ids)):
        raise ValueError(f"duplicate location ids in {path}")
    return locations
