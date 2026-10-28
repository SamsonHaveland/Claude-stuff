# Value of Real-Time / Upstream Observations, Radar and Nowcasting for US Point Forecasts (0 h to 7 days)

Research note, 2026-10-28. Network limits: direct fetches of weather.gov, arxiv.org and similar hosts failed in this session (DNS blocked), so several figures come from search-result summaries of primary documents, not full-text reads. Those are flagged "(snippet)". Statements under "Inferences" come from domain knowledge or reasoning, with no source fetched here.

## Q1. Does adding upstream or real-time station data help NWP after about 6–12 h? How fast does the value of observations and persistence decay?

### Takeaway
The best operational evidence is NWS LAMP, which is MOS updated hourly with the latest observations. It beats MOS clearly over 1–12 h, then converges to MOS skill by about 12 h because the observations lose predictive value. Beyond about 12–24 h, global NWP (which already assimilates the same stations) beats persistence and any observation-based method. No source found shows that "upwind station" predictors add skill over a modern NWP+MOS system after about 12 h.

### Cited Findings
- LAMP "outperforms persistence for all projections and handily outperforms MOS in the 1–12 hour projections." Then "the decreased predictive value of the observations at the later projections causes the LAMP skill level to diminish and converge to the skill level of MOS forecasts" (snippet) — [Rudack 2008, NWS MDL](https://www.weather.gov/media/mdl/Rudack2008.pdf)
- LAMP and persistence are "essentially of equal skill at the 1-h projection, and persistence deteriorates rather rapidly" after that (Heidke skill, ceiling/visibility-type elements) (snippet) — [Glahn 2004, NWS MDL](https://weather.gov/media/mdl/Glahn2004NewandImproved.pdf)
- The 2019 GFS-based LAMP upgrade was "not a major skill upgrade" over the previous LAMP/GLMP. Its main benefit was extending forecasts to 38 h, with the largest gains after 16 h for cool-season ceiling/visibility (snippet) — [Ghirardelli, SAWS8 2019](https://www.weather.gov/media/psr/Ghiradelli%20SAWS8_201906_LAMP_Ghirardelli_final.pdf)
- A comparison of LAMP with NWP models (RUC/NAM/GFS) exists, but could not be read in this session — [Ghirardelli & Rudack 2010, LAMP vs NWP](https://www.weather.gov/media/mdl/pub/Ghirardelli_Rudack_LAMPvNWP_2010.pdf)
- ECMWF HRES beat persistence for 2 m temperature and 10 m wind speed at every lead from 24 to 120 h. Persistence scores stayed roughly flat while ECMWF scores were "considerably higher … for all lead times and variables considered" (snippet) — [EGU2019-17155](https://meetingorganizer.copernicus.org/EGU2019/EGU2019-17155.pdf?EGUsphere)
- Station persistence has some skill only in certain regions and seasons (Croatia: coastal, summer, inland mid-winter) (snippet) — [EGU2013-2489](https://meetingorganizer.copernicus.org/EGU2013/EGU2013-2489.pdf)
- ECMWF FSOI for 2019: satellites gave about 74% of the 24 h forecast-error reduction and surface-based observations (including aircraft, radiosondes, land and marine stations) about 26%. "The largest impact is generally found close to, or just downwind of, observing stations." So the global models already exploit the upstream-station signal — [ECMWF, importance of surface-based obs](https://www.ecmwf.int/node/23158)
- FSOI has run operationally at ECMWF since June 2012 and is a statistical diagnostic that "cannot be applied to individual cases or individual stations" — [ECMWF newsletter 2017](https://www.ecmwf.int/sites/default/files/elibrary/2017/18195-assessing-impact-observations-using-observation-minus-forecast-residuals.pdf); [Cardinali FSO](https://www.ecmwf.int/node/8574)
- An HRRR forecast-error study uses New York and Oklahoma Mesonet data with LSTMs to predict HRRR error. This is an example of station data being used to correct a rapid-update model (details not read) — [arXiv 2512.14898](https://arxiv.org/pdf/2512.14898)

### Inferences
- Approximate horizon of useful added value from real-time observations over NWP+MOS: 2 m temperature and dewpoint 0 to about 6 h strong, 6–12 h small, above 12 h negligible. Wind is similar or shorter because it is gustier and more local. Precipitation occurrence: radar extrapolation at 0–2 h (see Q3). This lines up with the LAMP convergence point (about 12 h) and the nowcast crossover (about 2–6 h).
- The "read the upwind stations" idea is physically sound, but at 6 h a 10 m/s wind advects air about 200 km. The NWP data assimilation (HRRR hourly, ECMWF/GFS 6-hourly cycles) has already ingested those same stations. A hobbyist's manual advection adds little after the next model cycle. Its main value is in the gap between a model's cutoff time and its availability (HRRR has about 1–2 h latency), and for local biases (site exposure, valley inversions).
- The quantitative per-hour MAE decay for LAMP temperature versus MOS was not obtained. See Gaps.

### Gaps
- I could not obtain a peer-reviewed, lead-by-lead MAE table for LAMP temperature, dewpoint and wind versus GFS MOS. weather.gov was blocked. The MDL LAMP verification pages and Ghirardelli & Rudack (2010) are the places to get these numbers.
- I found no study isolating "upstream/advected station" predictors in MOS beyond 12 h.
- I found no published crossover hour for hourly station persistence versus NWP for 2 m temperature or wind. Evidence only bounds it below 24 h.

## Q2. Spatial and neighbour-station predictors, LAMP, observation-informed and nudged forecasts

### Takeaway
Neighbour information helps chiefly by (a) providing training data and calibration parameters for sites that have no observations, (b) pooling stations through standardized anomalies, and (c) station embeddings in neural-network post-processing. I found no clean quantified gain attributable to "neighbour-station observations as real-time predictors" specifically. The best quantified real-time-observation correction (a Kalman filter on ECMWF 2 m temperature) reports RMSE reductions of 10% to over 70%, mainly from removing bias.

### Cited Findings
- SAMOS (standardized anomaly MOS, South Tyrol): post-processing many stations jointly gives skill "comparable to forecasts post-processed individually at every station, and even better on average" (snippet) — [Univ. Innsbruck working paper 2016-08](https://www2.uibk.ac.at/downloads/c4041030/wpaper/2016-08.pdf)
- Post-processing parameters for sites without observations must be interpolated from neighbouring stations. The proposed method is a Gaussian random field with altitude and other covariates — [Scheuerer, NOAA PSL seminar 2013](https://psl.noaa.gov/seminars/Abstracts/2013/scheuerer2013.html)
- Local BMA "succeeds in the dense training network due to the availability of nearby stations that share similar characteristics" — [Kleiber, NCAR seminar 2010](https://www.image.ucar.edu/Seminars/2010/Kleiber_Feb10.shtml)
- Neural-network post-processing of German stations "significantly outperforms benchmark postprocessing methods." Key ingredients are auxiliary predictors and station embeddings — [Rasp & Lerch, AMS 2019](https://ams.confex.com/ams/2019Annual/webprogram/Paper353005.html)
- A 2026 preprint compares statistical and ML spatial interpolation of post-processed ensemble forecasts for 2 m temperature (41 predictors) and wind speed (46 predictors). Results not read — [arXiv 2609.07512](https://arxiv.org/pdf/2609.07512)
- An Austrian seamless-postprocessing study used persistence alongside NWP as a predictor out to 132 h, adding persistence where models drop out — [arXiv 2410.11916](https://arxiv.org/html/2410.11916v1)
- A Kalman filter on ECMWF 2 m temperature at Portuguese stations reduced bias to near zero and improved RMSE by "10% up to over 70%" against raw ECMWF. A related abstract corrects 3-hourly forecasts to produce nowcasts valid 6 h ahead "with improved accuracy" (snippet) — [IDL Lisbon](https://idlcc.fc.ul.pt/publications.php?id=220); [EGU06-J-03556](https://www.meetings.copernicus.org/www.cosis.net/abstracts/EGU06/03556/EGU06-J-03556.pdf)
- NCEP's "decaying average" bias correction is "perhaps the simplest of correction methods and very easy to implement." There would optimally be a different weight per case (snippet) — [Glahn, NOAA report](https://repository.library.noaa.gov/view/noaa/6913/noaa_6913_DS1.pdf)
- NOAA PSL's GEFSv12/NBM code treats the decaying average as a special case of a Kalman filter, with an e-folding bias-covariance parameter (`efold_bias`). Values not confirmed — [PSL code](https://downloads.psl.noaa.gov/Projects/GEFSv12/NBM/code/python_backup/control_KF_biascorr.py)
- MetNet-3 (Google): when test-station values are given as inputs at evaluation time, "the results improve further especially in the early lead times" (snippet). This is a direct ML analogue of "observation-informed" forecasts, with gains concentrated at short leads — [MetNet-3, arXiv 2306.06079](https://arxiv.org/abs/2306.06079); [HF papers page](https://huggingface.co/papers/2306.06079)

### Inferences
- There are two separable effects. (1) Systematic bias removal (Kalman filter, decaying average) works at all leads and accounts for most of the large RMSE gains. (2) Real-time error persistence from the latest observation is short-lived (hours). A hobby app should implement both: a rolling-bias correction per site and lead time, plus a short-decay last-observation nudge.

### Gaps
- I found no quantified number for "upstream observation predictors in MOS" specifically.
- I found no US study quantifying the skill of a nudged point forecast as a function of lead time.

## Q3. Radar nowcasting: extrapolation, the crossover with NWP, blending, and deep learning

### Takeaway
Extrapolation nowcasts (pySTEPS, Rainymotion) lose skill fast. They are better than NWP for about the first 1–2.5 h (shorter for convection or small domains). Scale-dependent STEPS blending tracks the nowcast for 1–2 h, then transitions to NWP. It performs better than or on par with the best single component, extending useful skill to 6 h or more. Deep-learning nowcasters: DGMR (to 90 min, strongly preferred by forecasters); NowcastNet (to 3 h, realistic detail but placement errors by 3 h); MetNet-3 (claims to beat HRRR and ENS to 24 h for precipitation, wind, temperature and dewpoint over CONUS, but operationally used for precipitation to 12 h). None of these are freely runnable as a US real-time product for a hobbyist, except by running open models yourself.

### Cited Findings
- pySTEPS "quickly loses skill after 2 hours, or even less for convective rainfall events or small radar domains." Blending with NWP is necessary "to extend the skillful lead time to … 6 hours or more" (snippet) — [EGU22-7026](https://meetingorganizer.copernicus.org/EGU22/EGU22-7026.html)
- Imhoff et al. (2023, QJRMS), Netherlands with Harmonie-AROME: the nowcast had lower errors than NWP for the first 2–2.5 h. The blend tracks the nowcast for 1–2 h and then transitions to NWP. Blending is "better or on par with the best-performing individual product" depending on score (RMSE, CSI). Scale-dependent weights come from recent skill and relax to climatology (1-month rolling window) — [Imhoff et al. 2023 QJRMS](https://pure.tudelft.nl/ws/portalfiles/portal/151585350/Quart_J_Royal_Meteoro_Soc_2023_Imhoff_Scale_dependent_blending_of_ensemble_rainfall_nowcasts_and_numerical_weather.pdf)
- pySTEPS blending module documentation — [pysteps blending reference](https://pysteps.readthedocs.io/en/latest/pysteps_reference/blending.html). Its linear-blend example starts the ramp at 60 min, an arbitrary choice — [pysteps linear blending](https://pysteps.readthedocs.io/en/v1.6.1/auto_examples/plot_linear_blending.html)
- Belgium operational STEPS-BE: 48-member ensemble every 5 min to 2 h, blended with ALARO NWP — [RMI](https://www.meteo.be/en/research/topic-2)
- DGMR (Ravuri et al. 2021, Nature): ranked first by meteorologists in about 89–93% of cases (56 forecasters; sources conflict on the exact %). Horizon is 90 min — [PMC8481123](https://pmc.ncbi.nlm.nih.gov/articles/PMC8481123); [TechXplore](https://techxplore.com/news/2021-09-deep-radar-rainfall-minutes.html)
- An independent Italian evaluation: DGMR was the least accurate over the first 25 min, but its error grows only marginally with lead time. The pretrained model stops at 90 min — [IRENE, arXiv 2609.17175](https://arxiv.org/pdf/2609.17175)
- NowcastNet (Zhang et al. 2023, Nature): forecasters substantially preferred it (n=62, P<10⁻⁴) for US and China events. Lead time up to 3 h — [Nature via RePEc](https://ideas.repec.org/a/nat/nature/v619y2023i7970d10.1038_s41586-023-06184-4.html); [PMC10356617](https://pmc.ncbi.nlm.nih.gov/articles/PMC10356617/figure/Fig4)
- Against MRMS, NowcastNet at 3 h gives "a realistic amount of detail, but not in the correct spatial placement" — [arXiv 2407.11317](https://arxiv.org/pdf/2407.11317)
- MetNet-3 "outperforms the best single- and multi-member NWPs such as HRRR and ENS over the CONUS region for up to 24 hours ahead" for precipitation, wind, temperature and dewpoint. It uses station observations as inputs and targets, and densifies from sparse station targets — [arXiv 2306.06079](https://arxiv.org/abs/2306.06079)
- The MetNet-3 real-time system produces precipitation forecasts every few minutes for CONUS and 27 European countries to 12 h. It is deployed in Google products — [Google Research blog](https://research.google/blog/metnet-3-a-state-of-the-art-neural-weather-model-available-in-google-products/?authuser=5); [The Decoder](https://the-decoder.com/googles-metnet-3-ai-weather-forecasting-model-delivers-accurate-24-hour-forecasts/)
- MetNet-3 precipitation CRPS beats ENS over the full 24 h (secondary report). No per-variable HRRR breakdown was obtained — [The Decoder](https://the-decoder.com/googles-metnet-3-ai-weather-forecasting-model-delivers-accurate-24-hour-forecasts/)

### Inferences
- For a US point app, a practical crossover is: radar extrapolation for 0–1 h (up to about 2 h for stratiform rain), then a ramp to HRRR by about 2–3 h, with HRRR or NBM after that. A more convective regime warrants a faster ramp. HRRR assimilates radar reflectivity every hour, so its own 0–2 h forecast is already fairly good, which narrows extrapolation's window compared with European studies where the NWP lacks rapid-update radar data assimilation.
- MetNet-3's 24 h claim shows that observation-heavy ML can extend the useful observation horizon well past the classical 6–12 h. Google has not released it, though, and the claim is not independently verified.

### Gaps
- No US-specific (MRMS + HRRR) published crossover hour was found. Imhoff (Netherlands) is the best reference.
- Rainymotion-specific skill numbers were not retrieved (Ayzel et al. 2019 reports similar skill horizons; not verified here).
- MetNet-3 per-variable, per-lead numbers versus HRRR could not be read (arXiv blocked).

## Q4. Free real-time US data for a hobby app (as of late 2026)

### Takeaway
All the key inputs are free. HRRR is 3 km, hourly, runs to 18 h (48 h at 00/06/12/18 UTC) with 15-min output, and assimilates radar by EnKF. RTMA and URMA are on AWS (noaa-rtma-pds, noaa-urma-pds, no account needed). Open-Meteo serves HRRR including 15-minutely data. MRMS is commonly accessed on AWS, but its bucket was not confirmed in this session.

### Cited Findings
- HRRR runs hourly over CONUS at 3 km with 50 levels. It runs to 48 h for 00/06/12/18 UTC and 18 h for other cycles, with 15-min output for the first 18 h. HRRRv4 (Dec 2020) uses 36-member 3 km EnKF with direct radar-reflectivity assimilation — [NOAA EMC HRRR](https://emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/hrrr.php); [VLab EMC HRRR](https://vlab.noaa.gov/web/emc/hrrr); [Wikipedia RAP/HRRR](https://en.wikipedia.org/wiki/Rapid_Refresh_(weather_prediction)); [SCN 20-46](https://www.weather.gov/media/notification/pdf2/scn20-46rap_v5_hrrr_v4_aab.pdf)
- HRRR sub-hourly (15-min) parameters are output across the forecast — [NWS TIN 14-32](https://www.weather.gov/media/notification/tins/tin14-32hrrr_aaa.pdf)
- RTMA and URMA on AWS: buckets `noaa-rtma-pds` and `noaa-urma-pds` (us-east-1), no AWS account needed, SNS notifications for new RTMA objects. RTMA archive from 2019, URMA from March 2023. The NODD archive is not an official NOAA archive, but there are no deletion plans — [AWS Registry: NOAA RTMA](https://registry.opendata.aws/noaa-rtma)
- The Herbie Python package downloads RTMA/URMA (and HRRR) from these sources — [Herbie RTMA/URMA](https://herbie.readthedocs.io/en/latest/gallery/noaa_models/rtma-urma.html)
- Open-Meteo provides 15-minutely forecasts from HRRR over North America (up to 3 days, interpolated where native 15-min is missing), with HRRR updated hourly. The blog states 1 km resolution, which conflicts with the official 3 km — [Open-Meteo blog, 15-minutely](https://openmeteo.substack.com/p/sub-hourly-15-minutely-weather-forecasts)
- Open-Meteo's GFS API blends global GFS with HRRR over North America — [Open-Meteo blog, HRRR](https://openmeteo.substack.com/p/high-resolution-models-and-hourly)
- MRMS is available as a third-party Icechunk/Zarr dataset from dynamical.org (Open Data Sponsorship). It is distinct from the raw NOAA bucket — (per search summary of AWS registry results; [AWS Registry](https://registry.opendata.aws/noaa-rtma))
- NCEP verifies HRRR reflectivity against MRMS — [NOAA EMC HRRR](https://emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/hrrr.php)

### Inferences (unverified in this session; check before relying)
- MRMS raw GRIB2 is widely reported to be on AWS as `noaa-mrms-pds`, with a roughly 2-minute radar-mosaic cadence and hourly QPE products. Not confirmed here.
- Open-Meteo model identifiers: `gfs_hrrr` (blended) and `ncep_hrrr_conus` (pure HRRR) are believed to be the API names. Confirm at open-meteo.com/en/docs.
- Iowa Environmental Mesonet (mesonet.agron.iastate.edu) provides free ASOS/AWOS one-minute and hourly METAR archives, real-time JSON, and MOS/LAMP text archives. These are standard hobbyist sources for "latest observation" inputs, but were not fetched here. The api.weather.gov `/stations/{id}/observations/latest` endpoint is another free option.
- NOMADS (nomads.ncep.noaa.gov) supports grib-filter subsetting of HRRR and LAMP but has rate limits. AWS (`noaa-hrrr-bdp-pds`) is the bulk alternative. Not confirmed here.

### Gaps
- I could not verify 2026 status changes for MRMS on AWS, the Open-Meteo model names, or any NOMADS deprecations. I found no 2026-dated notices.

## Q5. A simple, robust "last observation correction" and the evidence for it

### Takeaway
Operational practice (FMI/MetCoop) computes the error at the latest observed hour, then applies it to the next 1–5 h with decaying weights derived from about one year of error statistics. Kalman-filter and decaying-average bias corrections give the bulk of the measurable gain (RMSE −10% to −70% in one ECMWF 2 m temperature study). No source gave a canonical e-folding time. It should be fitted from local error autocorrelation.

### Cited Findings
- FMI `nowcasting_biascorrection`: corrects 2 m temperature, 2 m relative humidity and wind speed. The error is computed at stations for the +1 h forecast (the latest hour with observations), kriged to the grid using land-sea mask and altitude, subtracted at +1 h, and applied to +2…+5 h with weights "loosely based on 1 year of model forecast error information." Netatmo citizen observations are optional for temperature. No verification numbers are given — [GitHub fmidev/nowcasting_biascorrection](https://github.com/fmidev/nowcasting_biascorrection)
- Kalman filter on ECMWF 2 m temperature: bias near zero, RMSE improvement 10% to over 70% — [IDL Lisbon](https://idlcc.fc.ul.pt/publications.php?id=220)
- Decaying-average bias correction (NCEP) is the simplest method. Its weight is a tuning choice — [Glahn, NOAA](https://repository.library.noaa.gov/view/noaa/6913/noaa_6913_DS1.pdf); [PSL decaying-average code](https://downloads.psl.noaa.gov/Projects/GEFSv12/NBM/code/python_backup/control_decayavg_bias_corr.py)
- LAMP's design (MOS updated hourly with observations) is the US operational form of this idea. Its benefit converges to zero by about 12 h — [Rudack 2008](https://www.weather.gov/media/mdl/Rudack2008.pdf)

### Inferences (a recommended recipe; parameters are judgement, not sourced)
- Corrected forecast: F'(t+h) = F(t+h) + w(h)·[O(t) − F(t)], where O is the latest observation, F(t) is the model value valid at the observation time (interpolated in time), and w(h) = exp(−h/τ).
- Suggested starting τ: 2 m temperature and dewpoint about 3–6 h (longer under persistent regimes such as inversions or snow cover, shorter around sunrise and fronts). Wind speed about 1–3 h. Do not apply to precipitation amount; use radar extrapolation instead. Cap |O−F| (for example at 5 °C) and skip the correction when a front or rain onset is evident, since the error then is not persistent.
- Fit τ per site by regressing past errors at lead h on the error at h=0 (the lag autocorrelation of forecast error) over about 30–90 days. This is the core of the FMI "1 year of error information" approach.
- Layer this on top of a slow rolling-bias correction (decaying average, about 7–30 days, per lead hour and hour-of-day), which keeps helping out to day 7.
- Expected benefit: largest at 0–3 h (often a large reduction in MAE where the model has a local bias or misplaced a boundary), small by 6–12 h, and effectively nothing at 1–7 days, where only the systematic bias correction matters. This matches the LAMP convergence result.
- "Upwind station" advection: use it at most as a qualitative 0–3 h check (for example, a front or outflow passing a station 50–100 km upwind). HRRR's hourly cycle has already absorbed that information within about 1–2 h of latency.

### Gaps
- I found no peer-reviewed US study quantifying MAE reduction from an exponentially decayed last-observation nudge by lead hour. No canonical τ values were found. They must be derived locally.
