# AI Weather Models, Free US Data Sources, and What Makes Commercial "Most Accurate" Providers Win (as of 2026-10-28)

> Method note: open-meteo.com, forecastwatch.com, ecmwf.int, zenodo.org and hpcwire.com could not be fetched from this session (DNS blocked by the session's network allowlist). Open-Meteo facts were instead verified directly from Open-Meteo's own source code: the documentation website repo (`open-meteo/open-meteo-website`, last commit 2026-10-27) and the API server repo (`open-meteo/open-meteo`, last commit 2026-10-26, release 1.7.0 dated 2026-10-16). These are the files that generate open-meteo.com/en/docs, so they reflect the live docs within a day or two. Other facts come from web search result snippets of primary pages; where only a snippet was seen, that is stated.

## 1. AI models: how do they compare with ECMWF IFS at 1–7 days for surface variables, and what are their weaknesses?

### Takeaway
By late 2026 several AI models are operational and freely available: ECMWF AIFS Single and AIFS ENS, NOAA AIGFS/AIGEFS/HGEFS (GraphCast-derived), and Google WeatherNext 2. On 2 m temperature they match or beat IFS. On precipitation, especially short-range extratropical (US-relevant) precipitation and heavy-rain extremes, they are mixed or worse. All of them are coarse (0.25° and 6-hourly on Open-Meteo), so they cannot replace high-resolution or convection-allowing models for local, wind and convective detail.

### Cited Findings
**ECMWF AIFS (Single and ENS)**
- ECMWF's operational announcement says both AIFS Single and AIFS ENS "show superior skill for most upper-air and surface parameters compared to the IFS control and ensemble forecasts." — [ECMWF: AIFS ENS becomes operational (PDF)](https://www.ecmwf.int/sites/default/files/elibrary/102025/81687-aifs-ens-becomes-operational.pdf) (snippet via search)
- Early AIFS ENS evaluation: improved 2 m temperature scores at all lead times against SYNOP observations. It also improved 24 h precipitation in the first half of the forecast, but AIFS ENS underpredicts precipitation more than IFS ENS does. — [ECMWF Newsletter #185](https://www.ecmwf.int/node/29518) (snippet)
- AIFS paper: in the extratropics, AIFS is less skilful than IFS at shorter ranges for precipitation (SEEPS) and more skilful at longer ranges. Tropical precipitation is generally improved. — [Lang et al., AIFS, arXiv 2406.01465](https://arxiv.org/pdf/2406.01465)
- The 2025 AIFS update reports "significantly improved" skill for 24 h accumulated precipitation. — [An update to ECMWF's machine-learned weather forecast model AIFS, arXiv 2509.18994](https://arxiv.org/pdf/2509.18994)
- ECMWF's 2025 forecast-performance review compared the 2 m temperature CRPS of IFS ENS and AIFS ENS in the extratropics for Aug 2025 to Feb 2026. AIFS does better with 2 m temperature in stable wintertime situations. The IFS Cycle 49r1 upgrade narrowed the gap. — [ECMWF Newsletter #187, forecast performance 2025](https://www.ecmwf.int/en/newsletter/187/news/forecast-performance-2025); [ECMWF 2025 forecast evaluation news](https://www.ecmwf.int/en/about/media-centre/news/2026/2025-forecast-evaluation) (snippets)
- AIFS-CRPS (the ENS training approach): against SYNOP observations it beats IFS ENS for 2 m temperature in the northern hemisphere and tropics, but is less skilful for total precipitation. — [AIFS-CRPS, npj AI / Nature portfolio 2026](https://www.nature.com/articles/s44387-026-00073-7); [arXiv 2412.15832](https://arxiv.org/pdf/2412.15832)
- AIFS ENS runs at about 31 km and IFS at 9 km. ECMWF says physics-based IFS "remains indispensable for high-resolution fields." — (search snippet of ECMWF AIFS ENS operational material, link above)

**Google GraphCast / GenCast / WeatherNext 2**
- GraphCast beat ECMWF HRES on 90.0% of 2,760 variable and lead-time targets (DeepMind's summary gives 89.3%). — [DeepMind GraphCast publication page](https://deepmind.google/research/publications/graphcast-learned-global-weather-forecasting/)
- GenCast beat ECMWF ENS on 97.2% of 1,320 targets in the Nature version (97.4% in the arXiv preprint). — [GenCast arXiv 2312.15796](https://arxiv.org/html/2312.15796v2)
- A secondary summary of a 2025 evaluation (Gupta et al.) says GenCast under-represents heavy precipitation above 50 mm/day, its regional 3-day precipitation skill degrades fastest of the three models compared, and raw 12 h precipitation ensembles are miscalibrated. — [Emergent Mind GenCast topic summary](https://www.emergentmind.com/topics/gencast) (secondary; not verified against the primary paper)
- WeatherNext 2 (FGN architecture, Nov 2025): Google claims it beats the previous GenCast-based WeatherNext on 99.9% of variable, level and lead combinations from 0 to 15 days. It is about 8x faster, with members generated in under a minute on one TPU. — [aiwiki WeatherNext 2](https://aiwiki.ai/wiki/weathernext_2); [MarkTechPost](https://www.marktechpost.com/2025/11/17/google-deepminds-weathernext-2-uses-functional-generative-networks-for-8x-faster-probabilistic-weather-forecasts/)
- FGN reportedly matched GenCast on extreme 2 m temperature, exceeded it on extreme 10 m wind, and tracked cyclones about 24 h earlier. — [Decrypt](https://decrypt.co/348969/google-new-ai-weather-model-faster-accurate-forecasts); [ITmedia](https://www.itmedia.co.jp/aiplus/articles/2511/18/news064.html). ITmedia also notes possible honeycomb artifacts in high-frequency fields such as low-level humidity.
- Independent station verification at 117 stations in Inner Mongolia (JJA 2026, 6–84 h): AIFS and the WeatherNext 2 ensemble mean both had lower 2 m temperature MAE and RMSE than IFS-Control at every lead time, with AIFS slightly ahead. — [MDPI Atmosphere 17(11):1053](https://www.mdpi.com/2073-4433/17/11/1053)

**NOAA AI models (AIGFS, AIGEFS, HGEFS)**
- NOAA made AIGFS, AIGEFS and HGEFS operational in December 2025. — [WeatherNation](https://www.weathernationtv.com/news/noaa-deploys-new-generation-of-ai-driven-global-weather-models); [Fox Weather](https://foxweather.com/weather-news/noaa-3-new-ai-driven-global-forecasting-models); [insideHPC](https://insidehpc.com/2025/12/noaa-deploys-ai-driven-global-weather-models/)
- AIGFS shows improved skill over GFS for many large-scale features and a significant reduction in tropical-cyclone track error at longer leads. AIGEFS is roughly on par with GEFS and adds about one day of skill (Fox Weather says 18–24 h). HGEFS, a 62-member hybrid grand ensemble of GEFS and AIGEFS, "consistently outperforms both GEFS and AIGEFS across most major verification metrics." HGEFS has degraded hurricane intensity forecasts. — [NOAA VLab webinar abstract, Oct 2025](https://vlab.noaa.gov/documents/10157/138440/Abstract_VLabWebinar_Oct2025_AIGFSGEFS.pdf); [EMC AIGEFS/HGEFS operational verification](https://emc.ncep.noaa.gov/users/verification/global/aigefs/prod/main.php) (snippets)
- Open-Meteo's code describes the AIGFS family as part of its "GfsGraphCast" ingest (same module as the older experimental GraphCastGFS). AIGFS data arrives about 3 h 40 min after initialisation. GraphCast-GFS arrived 9–10 h after. — [open-meteo GfsGraphCastDomain.swift](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/GfsGraphCast/GfsGraphCastDomain.swift)

**Microsoft Aurora, Pangu, FourCastNet**
- Aurora (Nature 2025, DOI 10.1038/s41586-025-09005-y) runs at 0.1° (~11 km), outperforms IFS on about 92% of targets for 10-day forecasts, and is about 5,000x faster than IFS. — [Microsoft Research Aurora](https://www.microsoft.com/en-us/research/?p=1080705); [Nature Asia press release](https://www.natureasia.com/ja-jp/nature/pr-highlights/15241)
- No free operational point-forecast feed of Aurora, Pangu-Weather or FourCastNet exists in Open-Meteo. None appears in Open-Meteo's model lists. — [open-meteo-website docs/options.ts](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/options.ts)

**Resolution caveat on Open-Meteo**
- AIFS Single on Open-Meteo is 0.25° (~28 km), 6-hourly, 15 days, updated every 6 h. — [open-meteo-website ecmwf-api page](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/ecmwf-api/+page.svelte)
- AIGFS is 0.25°, 6-hourly, 16 days, every 6 h. HGEFS ensemble mean is 0.25°, 6-hourly, 10 days. — [open-meteo-website gfs-api page](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/gfs-api/+page.svelte)
- WeatherNext 2 is 0.25°, 6-hourly, 15 days, 64 members, with no hour-0. Open-Meteo processes only the 00 and 12 UTC runs, so it updates every 12 h. — [open-meteo-website google-weathernext-api page](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/google-weathernext-api/+page.svelte)

### Inferences
- For a US point app, AI models are most valuable for 2 m temperature and large-scale patterns at days 2–7+. Weight them lower for precipitation amounts at days 0–2 and for convective events.
- Their 6-hourly output means hourly curves must be interpolated. Daily max/min temperature from 6-hourly data will be smoothed or clipped, so the app should de-bias AI members per lead and per variable rather than trust them raw for Tmax/Tmin.
- The same 0.25° grid as `ecmwf_ifs025` means AIFS and AIGFS add no terrain or coastal detail. Station-level bias correction matters more for them.

### Gaps
- I found no independent US-specific station verification giving MAE numbers for AIFS vs IFS vs AIGFS for 10 m wind. CastCheck (23 US airport stations, IFS/GFS/AIFS/AI models; [Zenodo 22237426](https://zenodo.org/records/22237426)) looks directly relevant, but the page could not be fetched.
- I could not retrieve ECMWF scorecard percentages (e.g. % CRPS improvement for T2m or 10 m wind) because ecmwf.int was blocked.
- WeatherBench 2 headline tables were not retrieved.
- Quantitative AIGFS surface-variable skill vs GFS (e.g. T2m RMSE) was not found, only qualitative NOAA statements.

## 2. Does blending AI and physics models improve skill?

### Takeaway
Yes. The strongest operational evidence is NOAA's HGEFS: a combined physics (GEFS) and AI (AIGEFS) grand ensemble beats both of its parts on most metrics. ECMWF research nudging IFS toward AIFS also gives "predominantly blue" scorecards. Direct studies of simple output averaging at stations are fewer but point the same way, particularly when ML post-processing is used.

### Cited Findings
- HGEFS (GEFS + AIGEFS, 62 members) consistently outperforms both GEFS and AIGEFS across most major verification metrics. — [NOAA VLab webinar abstract](https://vlab.noaa.gov/documents/10157/138440/Abstract_VLabWebinar_Oct2025_AIGFSGEFS.pdf); [EMC verification](https://emc.ncep.noaa.gov/users/verification/global/aigefs/prod/main.php)
- ECMWF preprint (Polichtchouk et al. 2026): nudging each IFS-ENS member toward an AIFS-ENS member gives a predominantly blue (improved) scorecard, extending tropical skill by up to about 2 days while keeping IFS-level spatial detail. For 2 m temperature the hybrid is only slightly better than IFS-ENS, and AIFS-ENS alone remains substantially better. — [arXiv 2603.05570](https://arxiv.org/html/2603.05570v1)
- ECCC nudged GEM toward GraphCast large scales (wavelengths >~2,250 km), gaining up to 34 h of predictive skill and improving precipitation and TC tracks. — summarised in search results citing Husain et al. 2024; deterministic hybrid IFS preprint also at [arXiv 2604.22522](https://arxiv.org/pdf/2604.22522)
- Beijing study (2026): an ML post-processing ensemble of GraphCast and Pangu (initialised from IFS or GFS) plus NWP models for short-term station temperature. The AI models outperformed their driving NWP models, especially with IFS initial conditions. — [He et al. 2026, Meteorological Applications](https://rmets.onlinelibrary.wiley.com/doi/10.1002/met.70238)
- NOAA's National Blend of Models is itself an operational, statistically post-processed multi-model blend at 2.5 km. It is available on Open-Meteo as `ncep_nbm_conus` (hourly updates, 11 days). — [open-meteo-website gfs-api page](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/gfs-api/+page.svelte)

### Inferences
- AI models make good blend members because their errors are partly independent of the physics models. Adding AIFS Single, AIGFS and WeatherNext 2 to the current IFS/GFS/ICON/GEM set should help, provided weights are learned per variable and lead (from Previous Runs data) rather than set equal. Equal weights would let AI precipitation underprediction drag down rain totals.
- Because AI 2 m temperature is strong, AI members will likely earn high weights for temperature and lower ones for precipitation and gusts.

### Gaps
- I found no published US station study that tests an equal or learned weighted average of AIFS + IFS + GFS outputs for 1–7 day point forecasts with quantified gains.

## 3. Which models are free through Open-Meteo, and does the Previous Runs API cover them?

### Takeaway
Open-Meteo now offers, free for non-commercial use: AIFS Single (`ecmwf_aifs025_single`), AIFS ENS, NOAA AIGFS (`ncep_aigfs025`), AIGEFS, the HGEFS mean, Google WeatherNext 2 (64-member ensemble plus mean), NBM, HRRR, NAM, UKMO, Météo-France, JMA, KNMI and more. The model identifiers have been renamed with provider prefixes (e.g. `ncep_gfs_seamless`, `dwd_icon_seamless`, `cmc_gem_seamless`). The old names (`gfs_seamless`, `icon_seamless`, `gem_seamless`) are still accepted by the server. The Previous Runs API (`_previous_day1`…`_previous_day7`, archive mostly from January 2024) uses the same model list. The server stores previous-run data for key surface variables of most of these models, but per-variable coverage varies.

### Cited Findings
**Forecast API model identifiers (from the docs source, forecast `models` list):**
- ECMWF: `ecmwf_ifs` (IFS HRES 9 km), `ecmwf_ifs025`, `ecmwf_aifs025_single`. — [docs/options.ts](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/options.ts)
- NCEP: `ncep_gfs_seamless`, `ncep_gfs_global` (0.11°/0.25°), `ncep_hrrr_conus`, `ncep_nbm_conus`, `ncep_nam_conus`, `ncep_aigfs025`, `ncep_hgefs025_ensemble_mean`. — same source
- Others: `jma_seamless`/`jma_msm`/`jma_gsm`, `kma_seamless`, `dwd_icon_seamless` (plus `dwd_aicon_global_native`, DWD's AI ICON), `cmc_gem_seamless`/`cmc_gem_hrdps`, `meteofrance_seamless`, `knmi_seamless`, `dmi_seamless`, `ukmo_seamless`, `ukmo_global_deterministic_10km`, `metno_seamless`, `meteoswiss_icon_seamless`, `cma_grapes_global`. `bom_access_global` is labelled "until Jun 2025" because BOM open data stopped after the 2025-06-26 18Z run. — same source
- The identifiers listed in the brief, `ecmwf_aifs025` and `gfs_graphcast025`, are not in the current docs list. `ncep_gfs_graphcast025`/`gfs_graphcast025` still exist in the server enum, but GraphCast has been dropped from the docs model selector (AIGFS has taken its place). `ecmwf_aifs025` is an internal ECMWF domain. Use `ecmwf_aifs025_single` for the deterministic run. — [ForecastapiController.swift MultiDomains enum](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Controllers/ForecastapiController.swift); [EcmwfDomain.swift](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Ecmwf/EcmwfDomain.swift)
- Legacy names `gfs_seamless`, `icon_seamless`, `gem_seamless` remain valid server enum cases. A website comment says "revert to 'cmc_gem_geps' once backend prefix aliases are deployed", so the migration to prefixed names is still in progress. — [ForecastapiController.swift](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Controllers/ForecastapiController.swift); [ensemble-api/options.ts](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/ensemble-api/options.ts)
- RRFS: the server already has `ncep_rrfs_seamless`, `ncep_rrfs_conus` (3 km, hourly, 84 h, 4 cycles/day), `ncep_rrfs_conus_15min` (hourly cycles, 18 h), `ncep_rrfs_conus_ensemble` (5 members, 60 h) and `ncep_rrfs_north_america` (13 km). These are not yet in the public docs model list. — [open-meteo docs/ncep-rrfs/README.md](https://github.com/open-meteo/open-meteo/blob/main/docs/ncep-rrfs/README.md)

**US-relevant model specs on Open-Meteo:**
- HRRR CONUS: 3 km, hourly, 18 h (48 h for 00/06/12/18Z), updated hourly. There is also a 15-minutely variant. NBM CONUS: 2.5 km, hourly (3-hourly after 36 h, 6-hourly after 8 days), 11 days, updated hourly. NAM CONUS: 3 km, hourly, 60 h, every 6 h. GFS: 0.11°, 16 days. — [gfs-api page](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/gfs-api/+page.svelte)

**Ensemble API identifiers:**
- `ncep_gefs_seamless`, `ncep_gefs025`, `ncep_gefs05`, `ncep_aigefs025`; `ecmwf_ifs025_ensemble`, `ecmwf_aifs025_ensemble`, `ecmwf_aifs_europe_ensemble`; `dwd_icon_seamless_eps` etc.; `ukmo_global_ensemble_20km`; `gem_global_ensemble`; `meteoswiss_icon_ch1/ch2_ensemble`; `google_weathernext2_ensemble`. Ensemble means include `ncep_aigefs025_ensemble_mean` and `google_weathernext2_ensemble_mean`. — [ensemble-api/options.ts](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/ensemble-api/options.ts); [ensemble-mean-api/options.ts](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/ensemble-mean-api/options.ts); [google-weathernext-api/options.ts](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/google-weathernext-api/options.ts)

**Previous Runs API:**
- The docs say data is aligned to fixed lead offsets of 1–7 days. `temperature_2m_previous_day1` is the value predicted 24 h before the valid time, and so on to day 7. "Most models are archived from January 2024. GFS 2 m temperature extends back to March 2021." The page uses the same `models` list as the Forecast API. — [previous-runs-api/+page.svelte](https://github.com/open-meteo/open-meteo-website/blob/main/src/routes/en/docs/previous-runs-api/+page.svelte)
- Server flags (`storePreviousForecast`) decide which variables keep previous-run data:
  - ECMWF IFS/AIFS: T2m, RH2m, precipitation, MSLP, cloud cover, shortwave radiation, 10 m and 100 m wind. — [EcmwfVariable.swift](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Ecmwf/EcmwfVariable.swift)
  - GFS family: T2m, RH, MSLP, cloud, precipitation, wind, CAPE, radiation and more. — [GfsVariable.swift](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Gfs/GfsVariable.swift)
  - GraphCast/AIGFS module: only T2m, precipitation, MSLP, cloud cover and 10 m wind. — [GfsGraphCastVariable.swift](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/GfsGraphCast/GfsGraphCastVariable.swift)
  - NBM: T2m, RH, precipitation/snow, cloud, radiation, 10 m wind and gusts, CAPE, and the precipitation, thunder and precip-type probabilities. — [NbmVariable.swift](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Nbm/NbmVariable.swift)
  - WeatherNext 2: T2m, MSLP, precipitation and cloud layers only, with no 10 m wind. — [WeatherNextVariable.swift](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/WeatherNext/WeatherNextVariable.swift)
  - RRFS: many surface variables flagged. — [NcepRrfsVariable.swift](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/NcepRrfs/NcepRrfsVariable.swift)
  - UKMO, GEM, ICON, JMA, KNMI, Météo-France, KMA, CMA and others also implement `storePreviousForecast`.

### Inferences
- Priority adds for the blend:
  1. `ncep_nbm_conus`, a strong post-processed US baseline with hourly updates.
  2. `ncep_hrrr_conus`, for 0–18/48 h.
  3. `ecmwf_aifs025_single`.
  4. `ncep_aigfs025`.
  5. `ecmwf_ifs` (9 km HRES), which may replace `ecmwf_ifs025` because it is higher resolution and hourly to 90 h.
  6. `ukmo_seamless`, an independent global physics model with a strong record.
  7. Optionally `google_weathernext2_ensemble_mean`, 12-hourly and with no wind history.
- AIFS and AIGFS 10 m wind can be bias-trained from Previous Runs. WeatherNext 2 cannot be trained for wind from Previous Runs, so use it for temperature and precipitation only.
- Plan for the identifier migration. Keep the legacy names working, but test the prefixed names (`ncep_gfs_seamless`, `dwd_icon_seamless`, `cmc_gem_seamless`).
- Previous Runs history starts around January 2024 for most models. AI models added later (AIGFS from Dec 2025, WeatherNext 2 from about Nov 2025 onward) have less training history, so the app should handle short histories by shrinking weights toward a prior.

### Gaps
- I could not confirm live (HTTP) that each AI model returns `_previous_dayN` values, or the archive start date per AI model. This needs a test call once open-meteo.com is reachable.
- Whether RRFS will be publicly enabled on Open-Meteo after NOAA's operational switch is not stated in the docs.

## 4. Open-Meteo free-tier limits and speed implications

### Takeaway
The free non-commercial API allows 600 calls/minute, 5,000/hour and 10,000/day, all enforced together and usually shared per public IP. "Calls" are weighted by variables × models × days, and ensemble members count individually. Multi-model and ensemble requests therefore use up the quota fast.

### Cited Findings
- Free quotas: 600 per minute, 5,000 per hour, 10,000 per day, all applying together and generally shared by requests from the same public IP. The free API is for non-commercial use only. — [open-meteo docs/api-rate-limiting.md](https://github.com/open-meteo/open-meteo/blob/main/docs/api-rate-limiting.md); website terms/pricing text "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute" ([open-meteo-website routes](https://github.com/open-meteo/open-meteo-website/tree/main/src/routes/en))
- Weight per location = max(1, (V/10) × max(1, D/14)). V is the number of variables multiplied by the number of models, and D is the number of days. Examples: 10 variables × 2 models × 7 days = 2 calls; 15 variables, 1 model, 14 days = 1.5 calls. — [api-rate-limiting.md](https://github.com/open-meteo/open-meteo/blob/main/docs/api-rate-limiting.md)
- Ensemble data: hourly and daily variables count once per member per model. — same source
- Response headers `X-RateLimit-Cost`, `X-RateLimit-Remaining` and `Retry-After` report usage. A 429 is returned when a limit is hit. — same source
- The paid "API Standard" plan excludes historical-forecast, Previous Runs, ensemble and similar APIs. These require "API Professional". — same source

### Inferences
- Worked example, deterministic: 8 variables × 10 models × 16 days ≈ (80/10) × (16/14) ≈ 9.1 calls per location per refresh.
- Worked example, ensembles: ECMWF IFS ENS has 51 members. 5 variables × 51 members ≈ 25.5 calls per location for ≤14 days. AIFS ENS (51), GEFS (31) and WeatherNext 2 (64) each cost a similar amount. Ensemble means (`*_ensemble_mean` models) are far cheaper, and so is the Ensemble Mean API.
- For a hobby app with a few locations, refreshing hourly is fine (10,000/day ≈ 416/hour). Previous Runs backfills should be chunked: fetch fewer variables per request and space requests out to respect the 600/min and 5,000/h caps. Cache responses and align refreshes to model update times (HRRR/NBM hourly, globals 6-hourly, WeatherNext 12-hourly).

### Gaps
- Typical latency per request was not measured (site unreachable).

## 5. Commercial accuracy: what ForecastWatch reports say, and what the winners do

### Takeaway
ForecastWatch results depend on who commissioned the study and on the metric and horizon. Microsoft was ForecastWatch's overall global 1–5 day winner in its own 2022, 2023 and 2024 analyses, and won US consumer days 1–7 in the inaugural 2026 awards (Foreca won US days 8–14). The Weather Company (IBM-heritage) cites a 2021–2024 report it commissioned naming it most accurate overall. AccuWeather also promotes reports naming it a leader. The common thread among winners is many-model blending plus ML post-processing tuned against dense observations, updated often.

### Cited Findings
- ForecastWatch's own analysis of 2024 1–5 day forecasts (published 2025-07-31): Microsoft was the overall most accurate global provider, with 79.51% accuracy. This was its third consecutive year. — [ForecastWatch, Analysis of 2024 One-to-Five Day Out Forecasts](https://forecastwatch.com/2025/07/31/new-report-analysis-of-2024-one-to-five-day-out-forecasts/) (snippet)
- ForecastWatch Most Accurate Forecast Awards 2026 (launched 2026-08-03): for US consumer weather, Microsoft won days 1–7 (all metrics) and Foreca won days 8–14. Scores are on a 0–100 scale, and providers needed 12 continuous months of data. — [ForecastWatch awards: US consumer 8–14](https://forecastwatch.com/awards/2026/consumer-weather-north-america-united-states-all-metrics-8-14/); [ForecastWatch awards index](https://forecastwatch.com/?p=4181) (snippets). Separate enterprise categories exist for US wind, high and low temperature (e.g. [US 24 h wind](https://forecastwatch.com/awards/2026/enterprise-weather-intelligence-north-america-united-states-wind-24-hr-wind-1-14/)); their winners were not visible in the snippets.
- The Weather Company: a 2025 ForecastWatch report covering 2021–2024 (commissioned by TWC) named it most accurate overall globally, "nearly 4 times more likely" to be the most accurate. It covered over 20 providers including Microsoft, AccuWeather and Wettermanufaktur, with about 1,424 locations and 84 metrics. — [ForecastWatch, Global and Regional Weather Forecast Accuracy Overview 2021–2024](https://forecastwatch.com/news/new-report-global-and-regional-weather-forecast-accuracy-overview-2021-2024/); [TWC proven accuracy](https://www.weathercompany.com/proven-accuracy/); [ICT Business](https://www.ictbusiness.biz/business/weather-company-continues-to-be-the-world-s-most-accurate-forecaster) (company marketing; note sponsorship)
- AccuWeather promotes a ForecastWatch global report recognising its "accuracy leadership." — [AccuWeather](https://accuweather.com/en/weather-news/forecastwatch-releases-new-global-report-recognizing-accuweather-for-its-accuracy-leadership/83510)
- ForecastWatch uses MAE for temperature, Brier score for PoP, and bias analysis. — [ForecastWatch FAQ](https://forecastwatch.com/faqs/)
- Microsoft says its weather combines massive weather datasets, large-scale computation models, mapping and topography, and real-time user reports. A secondary source says it uses five AI models and three deep-learning architectures. — [Windows blog, May 2024](https://blogs.windows.com/windowsexperience/2024/05/28/weather-from-microsoft-start-ai-powered-precision-in-forecasting/); [html.it](https://www.html.it/magazine/microsoft-start-previsioni-meteo-piu-accurate-grazie-allai/)
- Microsoft's 2023 ForecastWatch study (Microsoft-commissioned) compared it with 24 providers. It ranked highest on high temperature, low temperature and wind speed. — [Windows blog, Mar 2023](https://blogs.windows.com/windowsexperience/2023/03/24/weather-from-microsoft-start-named-the-most-accurate-global-forecast-provider/)
- Microsoft Research's Aurora foundation model (0.1°, beats IFS on about 92% of targets). — [Microsoft Research](https://www.microsoft.com/en-us/research/?p=1080705)

### Inferences
- The winners share several practices: (a) blending many NWP and AI models; (b) ML post-processing (MOS-like) trained on dense station, and at TWC and Microsoft crowd and IoT, observations; (c) frequent updates using rapid-refresh models and nowcasting; (d) per-location bias correction including topography. A hobby app can copy (a), (b) for its own stations, and (c) cheaply with Open-Meteo plus NBM and HRRR. NBM is effectively NOAA's free version of (a) and (b).
- Tomorrow.io and Apple Weather were not identified as overall winners in any ForecastWatch result found.

### Gaps
- I could not read the full ForecastWatch reports (blocked), so per-metric US rankings and the placements of Tomorrow.io, Apple, Foreca and AccuWeather in 2023–2026 are unverified.
- There is no official technical description of Microsoft's blend weights or of TWC's "GRAF and 100+ models" pipeline in the sources retrieved.

## 6. High-resolution US models: HRRR, NAM 3 km, RRFS status, and the value of CAMs at 0–48 h

### Takeaway
HRRR (3 km, hourly) and NAM 3 km are free on Open-Meteo now. The RRFS/REFS operational implementation is scheduled by NWS for 2026-11-03 (after repeated delays). It will replace NAM, HREF, SREF and HiresW, while HRRR remains operational for now. Evidence on CAM benefits for point forecasts is mixed: HRRR does well on light-to-moderate precipitation thresholds, but all models over-forecast surface wind. Bias correction is essential.

### Cited Findings
- NWS SCN 26-48 (latest revision): RRFS and REFS go operational on 2026-11-03. Earlier revisions said Aug 31 and then Oct 14, 2026. NAM, HREF, SREF and HiresW retire the same day. A parallel feed has run since 2026-08-12. — [NWS SCN26-048 updated (aaf)](https://www.weather.gov/media/notification/pdf_2026/scn26-048_Updated_RRFS_and_REFS_Implementation.aaf.pdf); [AWS open data, RRFS operational](https://registry.opendata.aws/noaa-rrfs-ops/)
- HRRR remains operational, and RRFSv1 complements it. HRRR retirement waits for a later RRFS dynamical-core upgrade, timing to be determined. — [NOAA GSL RRFS](https://gsl.noaa.gov/rrfs); [NWS RRFS/REFS webinar Q&A](https://www.weather.gov/media/wrn/calendar/RRFS_REF-Webinar%26RegistrationFormQANotes.pdf)
- Open-Meteo has already built RRFS ingestion: `ncep_rrfs_conus` (3 km, 84 h), `ncep_rrfs_conus_15min`, `ncep_rrfs_conus_ensemble` (5 members) and `ncep_rrfs_seamless` (RRFS, then GFS 0.25°, then GEFS 0.5°). — [open-meteo docs/ncep-rrfs/README.md](https://github.com/open-meteo/open-meteo/blob/main/docs/ncep-rrfs/README.md)
- A New York State Mesonet verification of GFS, NAM and HRRR (12 UTC runs): 10 m wind is over-forecast at all ranges and in all seasons. The GFS has a slight cold bias below 25 °C, the HRRR goes from cool to warm bias as temperature rises, and all models are warm-biased above 30 °C. — [Weather and Forecasting 39(2):369–386, via NSF PAR](https://par.nsf.gov/biblio/10488235-verification-global-forecast-system-north-american-mesoscale-forecast-system-high-resolution-rapid-refresh-model-near-surface-forecasts-use-new-york-state-mesonet)
- HRRR surface wind and gust evaluation (first 18 h, compared with GFS and NAM): good precipitation performance at 0.1–1.5 mm thresholds, while GFS and NAM had a high frequency bias. — [NSF PAR: Evaluation of surface wind gust forecasts from HRRR](https://par.nsf.gov/biblio/10389149-evaluation-surface-wind-gust-forecasts-from-high-resolution-rapid-refresh-model) (snippet; attribution of individual statements uncertain)
- HRRR v3 wind biases were negatively correlated with observed wind speed (over-forecast at light winds, under-forecast at strong winds). — [Fovell & Gallagher 2022](https://www.atmos.albany.edu/facstaff/rfovell/papers/2022-fovell-gallagher.pdf) (snippet)
- LSTM-based prediction of HRRR forecast error using NY and Oklahoma mesonets shows ML post-processing can learn HRRR errors. — [arXiv 2512.14898](https://arxiv.org/pdf/2512.14898)

### Inferences
- Add `ncep_hrrr_conus` with high weight at 0–18 h (0–48 h for synoptic runs) for timing of precipitation onset and convective events. Down-weight it beyond that. Correct its wind speed bias by lead and by speed bin.
- NAM will be retired on 2026-11-03. Do not add `ncep_nam_conus` now. If Open-Meteo enables `ncep_rrfs_conus`, swap it in once it has a few months of Previous Runs history.
- NBM already blends HRRR, NAM/RRFS and global models with post-processing. Adding NBM may capture much of the CAM benefit with little effort.

### Gaps
- I found no quantified CAM vs global-model skill gain (e.g. % RMSE reduction for 10 m wind, or ETS for convective QPF) at 0–48 h from a citable source. The EMC regional verification pages ([EMC](https://www.emc.ncep.noaa.gov/users/verification/headlines/regional/base.php)) hold the numbers but were not retrieved.
- RRFS skill relative to HRRR at implementation was not found.
