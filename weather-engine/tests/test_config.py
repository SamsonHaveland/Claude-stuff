from pathlib import Path

from weather_engine import __version__
from weather_engine.config import PROJECT_ROOT, load_settings


def test_version():
    assert __version__ == "0.1.0"


def test_defaults_point_at_project_dirs(monkeypatch):
    for var in ("WE_DATA_DIR", "WE_MODELS_DIR", "WE_REPORTS_DIR"):
        monkeypatch.delenv(var, raising=False)
    s = load_settings()
    assert s.data_dir == PROJECT_ROOT / "data"
    assert s.models_dir == PROJECT_ROOT / "models"
    assert s.reports_dir == PROJECT_ROOT / "reports"


def test_env_overrides(monkeypatch, tmp_path):
    monkeypatch.setenv("WE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    s = load_settings()
    assert s.data_dir == Path(tmp_path)
    assert s.log_level == "DEBUG"


def test_models_and_db_path(monkeypatch, tmp_path):
    monkeypatch.setenv("WE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("WE_MODELS", "gfs_seamless, icon_seamless")
    monkeypatch.delenv("WE_DB_PATH", raising=False)
    s = load_settings()
    assert s.models == ("gfs_seamless", "icon_seamless")
    assert s.db_path == tmp_path / "weather.db"
