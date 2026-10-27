# Architecture

## Goal

Forecast **temperature, precipitation and wind** for a configurable set of
locations, **1–7 days ahead**, more accurately for those locations than any
single raw weather model.

## Core strategy

We do **not** run a physics weather model (NWP). At a 1–7 day range, national
centres' global models (ECMWF, NOAA GFS, DWD ICON) are far better than anything
that can be built from scratch. Instead the engine is a **post-processing
layer** on top of them:

1. **Ingest** the latest forecast from several global models and their
   ensembles as each new run is published.
2. **Correct** each model's systematic errors at each location (e.g. "GFS runs
   1.5 °C warm here in summer afternoons") by learning from past forecasts vs.
   what was actually observed. This is the standard MOS / EMOS approach used by
   national weather services.
3. **Blend** the corrected models, weighting each by its recent skill at that
   location and lead time.
4. **Express uncertainty**: temperature and wind as a central value plus a
   range; rain as a probability (from the ensembles) plus an expected amount.
5. **Verify** every forecast against observations and against the raw models,
   so we know whether the engine is actually adding value.

## How "real-time" works

Forecasts are refreshed **when new model data is published**, not on a fixed
fast clock. Global models run every 6 hours (00/06/12/18 UTC) and become
available a few hours after each run. A scheduler checks for new runs roughly
hourly, ingests anything new, and regenerates forecasts. Updating more often
than the inputs change adds cost, not accuracy.

## Pipeline

```
 config/locations.yaml
          │
          ▼
 ┌──────────────┐   ┌──────────────────┐
 │ ingest_models│   │ ingest_obs       │   (scheduled, ~hourly)
 │ NWP + ensem. │   │ station obs      │
 └──────┬───────┘   └────────┬─────────┘
        ▼                    ▼
 ┌─────────────────────────────────────┐
 │ archive: every model run + obs,     │   data/cache, data/processed (CSV)
 │ keyed by location, run time, lead   │
 └──────┬──────────────────────────────┘
        ▼
 ┌──────────────┐   train on rolling 30–60 day windows
 │ calibrate    │   bias correction + EMOS per variable
 └──────┬───────┘
        ▼
 ┌──────────────┐
 │ blend        │   skill-weighted combination of models
 └──────┬───────┘
        ▼
 ┌──────────────┐   ┌──────────────────┐
 │ forecast out │──▶│ verify / score   │──▶ reports/
 │ (logged)     │   │ vs obs & raw NWP │
 └──────────────┘   └──────────────────┘
```

## Package layout

| Module | Responsibility |
|---|---|
| `weather_engine/config.py` | Load locations and settings |
| `weather_engine/sources/openmeteo.py` | Geocoding, model, past-run and ensemble forecasts |
| `weather_engine/sources/observations.py` | Nearest station + observation history |
| `weather_engine/store.py` | CSV cache and forecast log |
| `weather_engine/calibrate.py` | Bias correction and skill-weighted blending |
| `weather_engine/verify.py` | Scoring and baseline comparisons |
| `weather_engine/forecast.py` | End-to-end pipeline |
| `weather_engine/report.py` | Terminal and HTML output |
| `weather_engine/cli.py` | `forecast`, `stations`, `verify`, `serve` commands |
| `weather_engine/server.py` | JSON API + static web app |
| `weather_engine/web/` | Web app (HTML/CSS/JS, PWA manifest, service worker) |

## Locations

Each location is defined in `config/locations.yaml` with a name, latitude,
longitude, elevation and the observation station(s) used to verify it. Every
location records its **distance and elevation difference to its station**,
because a poorly matched station makes corrections worse, not better.

## Modelling approach (phased)

| Phase | Method | Why |
|---|---|---|
| 0 | Raw models + Open-Meteo "best match" | Baseline to beat |
| 1 | Per-model bias correction, equal-weight blend | Simple, robust |
| 2 | EMOS (calibrated mean + spread), skill weights; censored/logistic model for rain | Proper probabilities |
| 3 | Gradient boosting, pooled across locations/lead times | Only once there is enough data; per-location ML overfits |

Models are pooled across lead times and seasons where possible. Rolling
training windows let the engine adapt when an upstream model is upgraded.

## Verification (how we know it's accurate)

Every issued forecast is stored and later scored against observations:

- **Temperature, wind:** MAE, bias, CRPS (for the range).
- **Rain:** Brier score for "rain yes/no", reliability ("when we say 30%, does
  it rain ~30% of the time?"), MAE on amounts.
- **Baselines:** raw ECMWF, raw GFS, Open-Meteo best match, climatology,
  persistence. The engine only earns its keep if it beats raw ECMWF and the
  best-match blend.

Scores are broken down by location, variable and lead day (day 1 … day 7).

## Known risks

1. **Observation quality** is the biggest one. Sparse or distant stations,
   precipitation-gauge gaps and unreliable METAR rain totals can make the
   engine "correct" toward noise. Mitigation: station-distance checks,
   completeness thresholds, QC filters, and refusing to calibrate a location
   whose observations fail QC (fall back to the raw blend).
2. **Not enough training history.** Mitigation: backfill from archived past
   forecasts (Open-Meteo Previous Runs / Historical Forecast APIs) on day one,
   and archive every run going forward.
3. **Silent upstream model upgrades** break learned biases. Mitigation: rolling
   windows plus alerting on sudden skill changes.
4. **Day 6–7 skill is inherently limited**, especially for rain. Forecasts at
   that range are presented as probabilities and ranges, not single values.

## Decisions

- **Locations:** mostly US and chosen per forecast, so any place name or
  lat/lon works ad hoc; saved locations are optional. Verification stations
  come from the NWS API and history from the Iowa Environmental Mesonet (both
  US only).
- **Use:** personal, so the Open-Meteo free tier (non-commercial) is fine.
- **Output:** a command-line tool plus a web app. `weather-engine serve` runs a
  standard-library HTTP server (`server.py`) with a JSON API (`/api/forecast`,
  `/api/stations`) and a no-build-step web page (`web/`) that can be added to a
  phone home screen as an app (PWA). Forecasts are computed only on request;
  nothing is scheduled. No web framework yet, because a framework's compiled
  dependencies may lag new Python releases; revisit when deploying.
- **Roadmap:** local web app → hosted site (needs persistent disk for the
  cache, an access token, and a cost decision) → app-store app only if the
  home-screen app proves insufficient.
- **Training data:** fetched on demand (Open-Meteo Previous Runs, last 67
  days) and cached, so a new location is calibrated on its first run instead
  of after weeks of archiving.
