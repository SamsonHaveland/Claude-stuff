# weather-engine

Blends several weather models into one forecast per location, corrects each
model's local errors using its track record, and scores itself against every
model and the official NWS forecast.

## Quick start

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest

# 1. Edit locations.toml (lat/lon + nearest ASOS station)
weather-engine locations

# 2. Load history: observations + archived model runs (one-off)
weather-engine backfill --days 120

# 3. Check the engine on that history
weather-engine backtest --days 60          # -> reports/backtest-<id>.md

# 4. Go live (run hourly: cron, or `docker compose up -d`)
weather-engine collect                      # latest forecasts + observations
weather-engine predict                      # -> reports/forecast-<id>.md
weather-engine scorecard --days 30          # -> reports/scorecard-<id>.md
```

No runtime dependencies beyond the Python 3.11+ standard library. Data is
stored in `data/weather.db` (SQLite).

## Layout

| Path | Purpose |
|---|---|
| `src/weather_engine/` | Package (see `ARCHITECTURE.md`) |
| `tests/` | pytest suite, incl. leakage and synthetic walk-forward tests |
| `locations.toml` | Forecast points |
| `data/` | SQLite database and raw files (git-ignored) |
| `reports/` | Forecasts, backtests, scorecards (git-ignored) |
| `models/`, `notebooks/` | Reserved for later model artefacts / exploration |

Settings: `.env.example`. Data sources and their terms: `DATA_SOURCES.md`.
