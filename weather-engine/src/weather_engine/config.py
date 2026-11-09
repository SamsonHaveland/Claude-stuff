"""Runtime settings, read from environment variables (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    models_dir: Path
    reports_dir: Path
    database_url: str
    nws_user_agent: str
    log_level: str


def _path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value) if value else default


def load_settings() -> Settings:
    return Settings(
        data_dir=_path("WE_DATA_DIR", PROJECT_ROOT / "data"),
        models_dir=_path("WE_MODELS_DIR", PROJECT_ROOT / "models"),
        reports_dir=_path("WE_REPORTS_DIR", PROJECT_ROOT / "reports"),
        database_url=os.environ.get(
            "DATABASE_URL",
            "postgresql://weather:weather@localhost:5432/weather",
        ),
        nws_user_agent=os.environ.get("NWS_USER_AGENT", ""),
        log_level=os.environ.get("LOG_LEVEL", "INFO"),
    )
