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
