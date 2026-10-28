# Weather Engine

Gives calibrated 7-day forecasts of **temperature, rain and wind** for any US
location. It combines several global weather models (ECMWF, GFS, ICON, GEM),
corrects each model's typical errors at your location against a nearby
weather station's actual readings, and blends the corrected models. Each
model's weight depends on how accurate it has been there recently. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the design and
[DATA_SOURCES.md](DATA_SOURCES.md) for the data feeds and their licences.

## Install

Requires Python 3.9 or newer; 3.12+ is recommended, since 3.9 no longer gets security fixes.

```bash
cd weather-engine
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip      # older pips cannot do editable installs
pip install -e ".[dev]"
```

## Web app

```bash
weather-engine serve
```

Then open http://localhost:8000. Forecasts run only when you search; nothing runs
in the background. Stop it with Ctrl+C.

**Online (works with your laptop off):** see [deploy/CLOUD_RUN.md](deploy/CLOUD_RUN.md)
for putting it on Google Cloud Run. Expected to stay within the free tier, and
protected by a password (`WEATHER_ENGINE_PASSWORD`).

To use it on your phone at home, run `weather-engine serve --host 0.0.0.0`
and open the address it prints on the phone (same Wi-Fi). In Safari, use
Share → Add to Home Screen to get an app icon. "Use my location" needs a
secure (https) connection, so on home Wi-Fi type the place instead.

## Claude features (optional)

Claude writes about numbers the engine has already computed; it never
produces the forecast numbers itself. Both features run only when you ask,
and each run costs a few cents.

1. `pip install -e ".[ai]"`
2. Add `ANTHROPIC_API_KEY=...` to `weather-engine/.env` (git-ignored).

- **Plain-English summary:** the "Plain-English summary" button in the web
  app, or `weather-engine forecast "Primm, NV" --summary`.
- **`weather-engine analyze`:** Claude reviews verification scores, the latest
  calibration and station-archive coverage, then writes a ranked list of
  recommendations with the evidence and sample sizes behind each. The report is
  saved in `reports/`. `weather-engine analyze --show-data` prints exactly what
  would be sent, without calling Claude. Run it after `verify` has a week or
  two of scored forecasts.

What gets sent to Anthropic: the forecast table, or the verification and
calibration tables, plus place and station names. No API keys or tokens.

## Command line

```bash
# Forecast any place (US results preferred)
weather-engine forecast "Denver, CO"
weather-engine forecast --lat 39.74 --lon -104.99
weather-engine forecast "Asheville, NC" --html      # also writes reports/<place>_<time>.html

# See which weather station will be used to check the forecast, and whether it's a good match
weather-engine stations "Denver, CO"

# Measure how much each correction helps at a place, on past days it never saw
weather-engine backtest "Denver, CO"

# Score past forecasts against what actually happened (run after a few days of forecasts)
weather-engine verify
```

### Station search

For each place, the engine picks a station **separately for temperature, wind
and rain**. A rain gauge 3 km away can supply rain while an airport 15 km away
supplies wind. Candidates must be within 25 km and 150 m of elevation. The
nearest one with 20+ days of history wins; if none has that, the nearest with
5+ days is used, with scaled-down corrections.

- **Always:** NOAA's ACIS (volunteer COOP observers, CoCoRaHS rain gauges,
  airports). It has years of daily high/low/rain history but no wind.
  Volunteers often read at 7 am, so the engine compares the forecast for exactly
  that 7 am to 7 am window.
- **Without a Synoptic token:** plus airport stations (ASOS/AWOS).
- **With a token:** plus every network within 40 km, including
  flood-control gauges, wildfire (RAWS) stations, road-weather sensors and
  local networks. Create a free account at https://synopticdata.com, make an
  API token, and add `WEATHER_ENGINE_SYNOPTIC_TOKEN=...` to `weather-engine/.env`
  (that file is git-ignored).

`weather-engine stations "Primm, NV"` lists what's nearby and which checks each station passes.

To save places for reuse, copy `config/locations.example.yaml` to
`config/locations.yaml` (that file is git-ignored) and forecast them by name.

### Hour by hour

Tap a day in the web app to see:
- **The day at a glance:** when rain is likely or possible and what kind
  (rain, snow, freezing rain, thunderstorms), wind direction and when gusts
  peak, sky, humidity, "feels like", sunrise and sunset.
- **A table:** hourly for today and tomorrow, every 3 hours after that. It
  shows temperature, feels like, rain chance and amount, sky, wind (direction
  and speed), gusts and humidity.

The command line prints the same day summaries under "Details:".

Hourly temperatures are adjusted so each day's low and high match the
calibrated low and high. Hourly wind, gusts and rain are scaled to the
calibrated daily peak and total. "Likely" means a 40%+ chance from the
ensembles; "possible" means 15–40%. Cloud, humidity, wind direction and
precipitation type are model averages and aren't calibrated against stations.

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

### What makes it more accurate than one model

1. **Many models, weighted by local skill:** five global physics models, NOAA's
   NBM and HRRR (US), and two AI models (ECMWF AIFS, NOAA AIGFS). Each model's
   weight comes from how well it has done *at this place*.
2. **Local bias correction:** each model's typical error against the nearest
   good station is removed, per variable and per day ahead.
3. **Weather-pattern corrections:** once ~90 days of history is stored, errors
   are also learned per pattern (wind direction, high/low pressure, rising or
   falling pressure, season), but only for variables where this proved better
   on held-out weeks. Tap a day in the app to see its pattern and what lies upwind.
4. **Live reading:** the latest reading at the station nudges the next ~12 hours.

### Backfill and backtest

```
weather-engine backfill "Primm, NV"     # download a year of past model runs (a few minutes, once)
weather-engine backtest "Primm, NV"     # replay the last 60 days: error of raw ECMWF vs each correction step
```

The backtest corrects each past forecast using only what was known when it
was issued, so its numbers are an honest estimate of real accuracy at that place.

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
