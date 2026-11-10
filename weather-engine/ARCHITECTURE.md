# Architecture

Goal: for each configured point, issue hourly forecasts (temperature, wind,
precipitation, chance of rain) out to 7 days that are measurably more accurate
than any single model and than the official NWS forecast, and prove it with
like-for-like verification.

## Flow

```
 Open-Meteo (ECMWF, GFS, ICON, GEM) ─┐
 NOAA MOS / NBM / LAMP (via IEM) ────┼─► forecasts table ─┐
 NWS gridpoint forecast (baseline) ──┘                    │
                                                          ├─► engine ─► engine forecast ─► reports/forecast-*.md
 ASOS observations (via IEM) ───────────► observations ───┘     │
                                                                └─► verify ─► reports/backtest-*.md, scorecard-*.md
```

## Modules (`src/weather_engine/`)

| Module | Job |
|---|---|
| `sources/` | One client per data source; each returns canonical rows (UTC, °C, m/s, mm) |
| `db.py` | SQLite (WAL). Keyed on location/source/variable/valid/issue, so every ingest can be re-run safely. Hourly polling stores each model run once (`skip_unchanged`). |
| `engine.py` | Bias correction + skill-weighted blend (below) |
| `verify.py` | Walk-forward backtest and live scorecard |
| `report.py` | Markdown + CSV outputs |
| `cli.py` | `collect`, `backfill`, `predict`, `backtest`, `scorecard`, `locations` |

## How the engine forecasts

For a cutoff time T (now, or a past moment in a backtest):

1. **Members.** For each source, take its latest forecast for each hour that was issued at or before T.
2. **Learn errors.** Over the previous 30 days, compare every forecast against what was observed, separately for each source, variable and lead-time bucket (0-6h … 120h+). Only hours **before T** count, so nothing from the future leaks in.
3. **Correct.**
   - Temperature, wind: subtract the learned average error, shrunk toward zero when there is little history. Wind is kept ≥ 0.
   - Precipitation: scale by the observed/forecast ratio (bounded 0.5×–2×). Adding or subtracting would invent or erase rain.
4. **Blend.** Weight each corrected member by the inverse of its remaining error. 20% of the weight is always shared equally, so a lucky month can't silence a model and a new model still counts. Weights are renormalised over whichever members reach that hour (LAMP stops at 25h, NBS at 72h).
5. **Chance of rain.** The weighted share of members forecasting ≥ 0.1 mm.

## How "better" is measured

- **Backtest** (`weather-engine backtest`): steps through history (default daily at 00Z), runs the engine with only what was known then, scores it.
- **Live scorecard** (`weather-engine scorecard`): scores the engine forecasts actually issued by `predict`.
- Both compare the engine with **each** baseline on exactly the same cases and report MAE, RMSE, bias and *skill* (% smaller error than the baseline). Precipitation also gets wet/dry hit rate; chance of rain gets a Brier score against climatology.

## Known limits

- Open-Meteo previous-runs data is offset by whole days, so at a given cutoff its members are up to a day older than a live run would be. Backtests are therefore slightly pessimistic for those models.
- NWS has no public archive, so engine-vs-NWS evidence only accumulates once `collect` runs regularly.
- Point forecasts only; no gridded maps.
- Corrections are simple on purpose. Add anything fancier (weather-regime features, gradient-boosted correction) only once the scorecard shows the simple version has plateaued.
