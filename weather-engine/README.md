# Weather Engine

Gives calibrated 7-day forecasts of **temperature, rain and wind** for any US
location. It combines several global weather models (ECMWF, GFS, ICON, GEM),
corrects each model's typical errors at your location against a nearby
weather station's actual readings, and blends the corrected models. Each
model's weight depends on how accurate it has been there recently. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the design and
[DATA_SOURCES.md](DATA_SOURCES.md) for the data feeds and their licences.

## Install

```bash
cd weather-engine
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## Use

```bash
# Forecast any place (US results preferred)
weather-engine forecast "Denver, CO"
weather-engine forecast --lat 39.74 --lon -104.99
weather-engine forecast "Asheville, NC" --html      # also writes reports/<place>_<time>.html

# See which weather station will be used to check the forecast, and whether it's a good match
weather-engine stations "Denver, CO"

# Score past forecasts against what actually happened (run after a few days of forecasts)
weather-engine verify
```

To save places for reuse, copy `config/locations.example.yaml` to
`config/locations.yaml` (that file is git-ignored) and forecast them by name.

### Reading the output

- **High / Low / Rain:** the blended value. The range in brackets is the
  spread between the corrected models; a wider range means less certainty.
- **Chance:** the share of ensemble runs (ECMWF and GFS) that produce at least
  0.01″ of rain that day.
- **Calibrated vs. UNCALIBRATED:** calibration needs a weather station within
  25 km and 150 m of elevation of your location. Without one, the engine
  shows the plain blend of the models and says so. You can choose a station
  yourself with `station:` in `locations.yaml`.

### Freshness

Each run fetches the latest published forecasts, so run it whenever you want
an update. The models refresh every 6 hours, so running it more often than
that won't change much. Calibration data is cached for 6 hours under
`data/cache/`.

### Accuracy check

Every forecast is logged to `data/processed/forecast_log.csv`. `weather-engine
verify` compares the logged forecasts with what the station actually
recorded, broken down by how many days ahead they were made, for both the
blend and each raw model. That's how you can tell whether the engine beats
plain ECMWF.

## Tests

```bash
pytest
```

The tests use made-up API responses that follow the documented formats and
run offline.

## Attribution

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).
Observations via NWS and the Iowa Environmental Mesonet.
