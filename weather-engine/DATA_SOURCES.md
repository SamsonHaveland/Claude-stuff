# Data sources

All free. Terms change; recheck before commercial use.

| Source | Used for | Client | History available | Terms / limits |
|---|---|---|---|---|
| Open-Meteo forecast API | Live runs of ECMWF IFS, GFS, ICON, GEM (configurable) | `sources/open_meteo.py` | Forward only | Free tier is **non-commercial**; ~10k calls/day per IP. Commercial use needs a paid plan. |
| Open-Meteo previous-runs API | Archived forecasts made 1–7 days before each hour, per model (backfill) | `sources/open_meteo.py` | Varies by model (roughly 2024 onward) | Same as above |
| Iowa Environmental Mesonet (IEM): ASOS | **Ground truth**: hourly station temp, wind, precip | `sources/iem.py` | Decades | Free; asks for gentle, sequential requests (client pauses 2s between calls and backs off on 429) |
| IEM: MOS / NBM / LAMP archive | Real archived NOAA station forecasts: GFS MOS, NAM MOS, National Blend of Models (NBS, NBE), GFS LAMP | `sources/iem_mos.py` | Years | Same as above |
| NWS API (`api.weather.gov`) | The official NWS gridpoint forecast, used as the main **baseline to beat** | `sources/nws.py` | **Forward only**: no public archive, so the baseline builds up from the day `collect` starts | Free; asks for an identifying User-Agent (`WE_USER_AGENT`) |

## Conventions after ingest

- Times: UTC, Unix seconds, hourly.
- Units: temperature °C, wind speed m/s at 10 m, precipitation mm over the hour ending at the valid time.
- ASOS routine reports (~:51 past the hour) are assigned to the nearest whole hour; their 1-hour precip (`p01i`) is the hour ending then. Trace = 0 mm.
- NWS multi-hour precip totals are spread evenly over their hours (an approximation).
- MOS/NBM/LAMP precip fields are categorical or probabilistic, so only temperature and wind are taken from them.

## Issue time (when a forecast counts as "known")

This is what stops the backtest from cheating.

| Source | Issue time used |
|---|---|
| Open-Meteo live | The hour it was fetched |
| Open-Meteo previous runs | Valid time minus N days for the `previous_dayN` series |
| MOS / NBM / LAMP | Nominal run time **plus** a conservative publication lag (GFS/NAM 5h, NBS 2h, NBE 3h, LAMP 1h) |
| NWS | The grid's `updateTime` |

## Checked from this environment (2026-11-10)

- IEM ASOS and MOS/NBM/LAMP: working; formats match the parsers.
- NWS gridpoints: working; format matches the parser.
- Open-Meteo: reachable, but returned "daily API request limit exceeded" because the cloud
  sandbox shares an IP. Parsers are tested against the documented response layout, **not yet
  against a live response.** First run on your own machine should confirm it.
