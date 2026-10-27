# Data Sources

Status as of 2026-10-27. Licensing terms change, so re-check them before any
commercial use.

## Model forecasts (inputs)

| Source | What | Coverage | Update cadence | Access | Licence / cost |
|---|---|---|---|---|---|
| **Open-Meteo Forecast API** | ECMWF IFS, GFS, ICON, others, plus "best match" blend | Global | Each model run | JSON HTTP API | Free for non-commercial use (<10k calls/day); paid plan for commercial; CC BY 4.0 attribution |
| **Open-Meteo Ensemble API** | Ensemble members (ECMWF ENS, GFS ensemble, ICON-EPS) | Global | Each run | JSON HTTP API | As above |
| **Open-Meteo Previous Runs / Historical Forecast APIs** | Past forecasts as originally issued | Global | — | JSON HTTP API | As above. **This is the source for training data on day one.** |
| ECMWF Open Data (direct) | IFS + ENS, AIFS, 0.25° GRIB2 | Global | 4 runs/day | HTTPS / GRIB2 | Real-time catalogue CC BY 4.0 since 1 Oct 2025; free subset, charges for high-volume/custom delivery |
| NOAA GFS / GEFS (NOMADS, AWS Open Data) | GFS deterministic + ensemble | Global | 4 runs/day | GRIB2 | Public domain |
| NOAA NBM / HRRR | Blended US guidance / high-res short range | US only | Hourly | GRIB2 | Public domain; optional for US locations |

**Plan:** use Open-Meteo for everything at first, because it removes all GRIB
handling. Keep an ingestion interface so we can switch to direct ECMWF/NOAA
feeds if usage becomes commercial or call limits bind.

## Observations (ground truth for training + verification)

| Source | What | Coverage | Notes |
|---|---|---|---|
| **Synoptic Data (MesoWest)** | Stations from all networks: ASOS, flood-control gauges (e.g. CCRFCD), RAWS, road weather, mesonets | US-wide | **In use when a token is set.** Free account; token in `.env` as `WEATHER_ENGINE_SYNOPTIC_TOKEN`. Station quality varies, so each station is checked for data completeness before use |
| **NWS API + Iowa Environmental Mesonet** | Airport (ASOS/AWOS) stations and their hourly history | US | **In use without a Synoptic token** (and always for older logs) |
| Meteostat | Hourly/daily station data | Global | Easy Python access; aggregates national services |
| NOAA ISD / Global Hourly | Hourly synoptic/METAR obs | Global | Long history; QC flags |
| NOAA GHCN-Daily | Daily max/min temperature, precipitation | Global | Best source for daily rain totals |
| National services (e.g. NWS/ASOS, Met Office, DWD) | Station obs | Per country | Choose once locations are known |

Known observation pitfalls:
- METAR precipitation reporting is unreliable; prefer GHCN-Daily or national
  gauge networks for rain.
- Station-to-location distance and elevation difference must be checked per
  location. Temperature shifts by ~0.65 °C per 100 m of elevation.
- Gaps and outliers need QC before training.

## Attribution required

- "Weather data by Open-Meteo.com" (CC BY 4.0) wherever outputs are shown.
- ECMWF data: CC BY 4.0 attribution per ECMWF terms of use, if used directly.
