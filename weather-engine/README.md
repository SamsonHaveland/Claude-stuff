# weather-engine

Pipeline for ingesting weather data, building models, and producing reports.

> Status: scaffold only. Package structure, config, and tooling are in place;
> ingestion, modelling and reporting code is not yet written.

## Layout

| Path | Purpose |
|---|---|
| `src/weather_engine/` | Python package (`config.py` reads settings from env) |
| `tests/` | pytest suite |
| `data/raw/`, `data/processed/` | Downloaded and cleaned data (git-ignored) |
| `models/` | Trained model artefacts (git-ignored) |
| `reports/` | Generated outputs (git-ignored) |
| `notebooks/` | Exploratory analysis |
| `ARCHITECTURE.md` | Intended component design |
| `DATA_SOURCES.md` | Candidate data sources and their terms |

## Quick start

```bash
cp .env.example .env            # then edit values
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest
docker compose up -d db         # optional: local Postgres
```
