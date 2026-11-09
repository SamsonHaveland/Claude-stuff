# Data sources

Candidate sources. **Verify current terms, rate limits and licensing before
building a client** — these change, and none are integrated yet.

| Source | Type | Access | Notes |
|---|---|---|---|
| NWS API (`api.weather.gov`) | US forecasts, observations, alerts | Free, no key | Requires an identifying `User-Agent` header (`NWS_USER_AGENT`). |
| NOAA NCEI (e.g. GHCN-Daily) | Historical station observations | Free | Good for training labels / backtests. |
| Open-Meteo | Global forecast + historical reanalysis | Free tier, no key | Free tier is for non-commercial use; commercial use needs a paid plan. |
| ECMWF Open Data | Global NWP model output (GRIB2) | Free | Subset of ECMWF products; check licence (CC-BY-4.0 at time of writing). |

## Per-source checklist (fill in when integrating)

- [ ] Endpoint(s) and auth
- [ ] Rate limits / fair-use policy
- [ ] Licence and attribution requirements
- [ ] Update cadence and latency
- [ ] Spatial/temporal resolution
- [ ] Units and timestamp conventions
