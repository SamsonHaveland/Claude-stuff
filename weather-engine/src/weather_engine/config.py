"""Runtime settings, read from environment variables (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_MODELS = ("ecmwf_ifs025", "gfs_seamless", "icon_seamless", "gem_seamless")
DEFAULT_MOS_MODELS = ("GFS", "NAM", "NBS", "NBE", "LAV")


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    models_dir: Path
    reports_dir: Path
    db_path: Path
    locations_file: Path
    models: tuple[str, ...]  # Open-Meteo model ids
    mos_models: tuple[str, ...]  # IEM MOS/NBM/LAMP codes
    user_agent: str
    log_level: str


def _list(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    value = os.environ.get(name)
    if value is None:
        return default
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value) if value else default


def load_settings() -> Settings:
    data_dir = _path("WE_DATA_DIR", PROJECT_ROOT / "data")
    return Settings(
        data_dir=data_dir,
        models_dir=_path("WE_MODELS_DIR", PROJECT_ROOT / "models"),
        reports_dir=_path("WE_REPORTS_DIR", PROJECT_ROOT / "reports"),
        db_path=_path("WE_DB_PATH", data_dir / "weather.db"),
        locations_file=_path("WE_LOCATIONS_FILE", PROJECT_ROOT / "locations.toml"),
        models=_list("WE_MODELS", DEFAULT_MODELS),
        mos_models=_list("WE_MOS_MODELS", DEFAULT_MOS_MODELS),
        user_agent=os.environ.get("WE_USER_AGENT") or "weather-engine/0.1",
        log_level=os.environ.get("LOG_LEVEL", "INFO"),
    )
