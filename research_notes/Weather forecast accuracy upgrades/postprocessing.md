# Statistical and ML post-processing of NWP output for station forecasts (T2m, precipitation, 10 m wind and gusts, days 1–7)

Research note, 2026-10-28. **Method caveat:** in this session the network blocked page fetches from arxiv.org, ar5iv, essd.copernicus.org, nomads.ncep.noaa.gov and nwafiles.nwas.org. All findings below come from search-result abstracts and snippets, not full-text reads. Where a figure is only in my background knowledge and not confirmed by a source, it sits under Inferences or Gaps and is flagged "unverified".

Baseline being compared against (the current app):
- per-station, per-lead additive bias correction, shrunk toward zero, trained on about 5–60 days;
- a rain ratio correction;
- an inverse-MAE² blend of IFS, GFS, ICON and GEM;
- PoP from the fraction of ensemble members with rain.

## 1. EMOS/NGR and censored or logistic EMOS for precipitation: gains over raw ensembles and simple bias correction

### Takeaway
EMOS/NGR reliably fixes the main weakness of raw ensembles, which is underdispersion and bias. For T2m it typically cuts CRPS by roughly 10–15% versus the raw ensemble with a global model, and more with a per-station model. Over a bias-corrected ensemble the gain is smaller: about 7–9% on deterministic error in the original paper, plus much better calibration. Hemri et al. 2014 found that the EMOS-over-raw skill gap stayed roughly constant from 2002 to 2014 even as the ECMWF ensemble improved.

### Cited Findings
- Gneiting et al. 2005 (MWR 133, 1098–1118) introduced EMOS fitted by minimum-CRPS estimation, tested on 48 h UW mesoscale-ensemble forecasts of sea-level pressure and surface temperature in the Pacific Northwest. Against the *bias-corrected* ensemble, EMOS deterministic SLP forecasts had 9% lower RMSE and 7% lower MAE. The predictive PDFs were "much better calibrated than the raw ensemble or the bias-corrected ensemble." — [Gneiting et al. 2005 PDF (UW)](https://sites.stat.washington.edu/raftery/Research/PDF/gneiting2005.pdf); [ANU record](https://researchportalplus.anu.edu.au/en/publications/calibrated-probabilistic-forecasting-using-ensemble-model-output-/)
- Rasp & Lerch 2018 (German stations, T2m, ECMWF ENS, trained on 2015): mean CRPS was 1.16 for the raw ensemble and 1.01 for global EMOS, about 13% better. Adding local station information (EMOS-loc) improved the global score by roughly another 10%. — [Rasp & Lerch arXiv 1805.09091](https://arxiv.org/pdf/1805.09091) (via search snippet)
- Hemri et al. 2014 (GRL 41) applied per-station EMOS to ECMWF ENS T2m, 24 h precipitation and 10 m wind at globally distributed stations, 2002–2014. The postprocessing skill gap "remains almost constant over time indicating that postprocessing will keep adding skill in the foreseeable future." — [NOAA repository record](https://repository.library.noaa.gov/view/noaa/14547); [ECMWF interview with Gneiting](https://www.ecmwf.int/node/25583)
- Schulz & Lerch, early results for gusts: simple methods that use only the ensemble gust as input improved mean CRPS by up to 40% over the raw ensemble. — [EGU21-1326 abstract](https://meetingorganizer.copernicus.org/EGU21/EGU21-1326.html)
- Scheuerer & Hamill 2015 (MWR 143, 4578–4596) used censored shifted-gamma EMOS (CSGD) for precipitation. It fits a censored, shifted gamma distribution to raw-ensemble statistics. They found that "even a parametric postprocessing approach crucially relies on the availability of a sufficiently large training dataset." They used 12 years of 11-member GEFS reforecasts, and pooling across grid points partly compensates for shorter training records. — [NOAA repository](https://repository.library.noaa.gov/view/noaa/14608); [AMS 2015 abstract](https://ams.confex.com/ams/95Annual/webprogram/Paper267145.html)
- CSG-EMOS is usually estimated by minimizing CRPS over a rolling training window. — [Parametric post-processing of dual-resolution precipitation forecasts, arXiv 2212.12504](https://arxiv.org/pdf/2212.12504)
- NAEFS 2% decaying-average bias correction, a first-moment method only: in one winter T2m case at 120 h, spread rose 25% and RMSE fell 7%. — [EMC Guan NAEFS slides 2013/14](https://www.emc.ncep.noaa.gov/gmb/ens/WkShopOct13/program/pdf/S3-04-Guan_NAEFS_SPP-3.pdf)

### Inferences
- Unverified, background knowledge: for the app, the step from "additive bias plus member-count PoP" to "per-station EMOS" mainly adds a calibrated spread. The spread term is c + d·(ensemble variance), so you get calibrated quantiles and probabilities. The MAE of the median improves only modestly, because the additive bias already captures most of the first-moment error. Most of the CRPS gain over a bias-corrected ensemble comes from fixing underdispersion.
- Precipitation needs a censored or zero-inflated distribution (censored shifted gamma, censored logistic, or censored GEV), or logistic regression on thresholds. A ratio correction cannot represent PoP and amounts together.

### Gaps
- I could not retrieve per-variable CRPSS tables from Hemri et al. 2014 (fetch blocked).
- I could not retrieve CRPSS-versus-window-length numbers from Scheuerer & Hamill 2015.
- Unverified: Messner et al. censored logistic regression and extended logistic regression (Wilks 2009) gains for precipitation were not retrieved.

## 2. ML post-processing (Rasp & Lerch NN, QRF, gradient boosting, EUPPBench): gains over EMOS and training-data needs

### Takeaway
On large training sets, neural distributional regression with station embeddings beats EMOS by about 15–20% CRPS for T2m. That comes from one global model trained on about 500 stations × 1 year or more. QRF and gradient-boosted EMOS beat EMOS mainly by using extra predictors, and they need several years of data per station or pooled data. In EUPPBench, which uses 20 years of ECMWF reforecasts, most methods performed similarly. For a single developer with a few months of history, the realistic gain from ML is small or negative unless data are pooled across many stations.

### Cited Findings
- Rasp & Lerch 2018 (MWR 146, 3885–3900) trained a distributional regression network as one model for all stations. It uses CRPS as the loss and station embeddings (an ID mapped to a latent vector) for local adaptivity. Mean CRPS was 1.16 raw, 1.01 global EMOS, and 0.82 for NN-aux-emb (auxiliary predictors plus embeddings) when trained on 2015. That is about 19% better than global EMOS and about 29% better than raw. The NN was also computationally cheaper than the benchmarks. — [arXiv 1805.09091](https://arxiv.org/pdf/1805.09091); [Lerch ECMWF talk](https://events.ecmwf.int/event/291/attachments/1518/2728/1._Lerch.pdf)
- Taillardat et al. 2016 (MWR) applied QRF to the 35-member Météo-France PEARP for surface temperature and wind speed, leads 3–54 h. QRF is non-parametric and can use "any predictor available including statistics on other variables." All post-processed ensembles were much better calibrated than raw, and "QRF performs better than EMOS." — [HAL PDF](https://hal-meteofrance.archives-ouvertes.fr/meteo-03544106/file/%5B15200493%20-%20Monthly%20Weather%20Review%5D%20Calibrated%20Ensemble%20Forecasts%20Using%20Quantile%20Regression%20Forests%20and%20Ensemble%20Model%20Output%20Statistics.pdf); [Météo-France library](https://bibliotheque.meteo.fr/pub/DOC00036367-calibrated-ensemble-forecasts-using-quantile-regre.html)
- QRF follow-ups: Evin et al. 2021 used a 22-year reforecast for snow. Météo-France runs QRF operationally for station temperature. — [Evin et al. NPG 2021](https://hal-meteofrance.archives-ouvertes.fr/meteo-03543728/file/npg-28-467-2021.pdf); [Météo-France operational QRF](https://bibliotheque.meteo.fr/pub/DOC00051858-from-research-applications-examples-operational-en.html)
- Schulz & Lerch 2022 (MWR 150, 235–257) compared eight gust methods: EMOS, MBM, IDR, gradient-boosted EMOS, QRF, and three NN variants (DRN, BQN, HEN). NNs adapted better to extremes during winter storms than EMOS. KIT's press summary says AI methods cut forecast error by about 36% on average, a press figure. — [bibbase record](https://bibbase.org/network/publication/schulz-lerch-machinelearningmethodsforpostprocessingensembleforecastsofwindgustsasystematiccomparison-2022); [KIT press release](https://kit.edu/kit/english/pi_2022_021_better-forecasts-of-wind-gusts-with-ai.php); [EGU22-869](https://meetingorganizer.copernicus.org/EGU22/EGU22-869.html); [EMS2022-271](https://meetingorganizer.copernicus.org/EMS2022/EMS2022-271.html)
- EUPPBench (Demaeyer et al. 2023, ESSD 15, 2635–2653) contains ECMWF deterministic, ensemble and reforecast data, gridded and at points, over central Europe. Its first benchmark covers T2m correction. Methods include EMOS, AR-EMOS, DRN, DVQR, ASRE and member-by-member. A referee noted that "most postprocessing methods perform similarly." — [ESSD discussion](https://essd.copernicus.org/articles/15/2635/2023/essd-15-2635-2023-discussion.html); [Zenodo benchmark output](https://zenodo.org/records/7798350); [ECMWF Newsletter 179](https://www.ecmwf.int/node/29045)
- Later work uses the Rasp & Lerch network as its benchmark, for example graph neural networks (arXiv 2407.11050) and transformers on EUPPBench for T2m and wind (arXiv 2412.13957). — [Feik, Lerch & Stühmer](https://export.arxiv.org/pdf/2407.11050); [Transformer postprocessing](https://arxiv.org/pdf/2412.13957)

### Inferences
- Training-data scale: Rasp & Lerch trained on about 500+ German stations with daily forecasts for 1 year (2015), and longer periods helped. EUPPBench uses about 20 years of twice-weekly reforecasts. QRF and boosting in the cited studies used multi-year archives. A developer with a few months at a handful of stations cannot reproduce these gains. Feasible options are:
  1. per-station EMOS with strong regularization;
  2. a single pooled model (NN or LightGBM) across all stations, with station features (elevation, lat/lon, terrain class) instead of per-station embeddings;
  3. backfilling training data from free archives, such as the Open-Meteo historical-forecast API or the ECMWF open-data archive, if available.
- Unverified: LightGBM quantile or distributional regression on pooled stations is a pragmatic and cheap analogue of EMOS-GB/QRF.

### Gaps
- I could not retrieve exact CRPSS tables from EUPPBench (fetch blocked).
- I could not retrieve exact CRPS by method from Schulz & Lerch 2022. The full paper reportedly gives DRN/BQN as best, but that is unverified here.
- I found no source quantifying ML gains when only 3–6 months of training data exist.

## 3. Training window length and seasonality: rolling windows vs multi-year reforecasts vs harmonics

### Takeaway
Multi-year training beats short sliding windows. Lang et al. 2020 found that reducing estimator variance with more data matters more than adapting quickly to recent data. Seasonality is best handled with multi-year data plus seasonal harmonics or day-of-year windows, rather than a 30–60 day rolling window. The NAEFS 2% decaying average is effectively a 50-day window and helps mostly at short range.

### Cited Findings
- Lang, Lerch, Mayr, Simon, Stauffer & Zeileis 2020 ("Remember the past", NPG 27, 23) compared three time-adaptive schemes against a sliding window for NGR of central-European T2m. Multi-year schemes gave steadier coefficients and better skill. "Reducing the variance of the non-homogeneous regression estimates due to increased training data appears to be more important than reducing its bias by adapting rapidly to the most current training data only." Multi-year training is also usually better after model changes. — [KIT repository](https://publikationen.bibliothek.kit.edu/1000117421); [NPG citation](https://npg.copernicus.org/articles/27/23/2020/npg-27-23-2020.bib)
- NAEFS/GEFS decaying average: tested weights were 0.25%, 0.5%, 1%, 2%, 5% and 10%. The chosen 2% equals roughly 50–60 days of memory. All measures improved out to about day 5, with limited success at week 2. — [EMC Bo Cui slides](https://www.emc.ncep.noaa.gov/gmb/ens/Predictability_5Mar_BoCui.pdf); [EMC postprocessing (DTC 2016)](https://dtcenter.org/sites/default/files/events/2016/postprocessing/Post-processing_EMC.pdf); [Cui et al. 2012 manuscript](https://www.emc.ncep.noaa.gov/gmb/ens/papers/manuscript_thorpex_bocui.pdf)
- An MDL study fitted the decay factor for bias-correcting MOS temperature and dewpoint. — [AMS 2014 abstract](https://ams.confex.com/ams/94Annual/webprogram/Paper232884.html)
- An NWS gridded-guidance report used a running 30-day bias for GFS-derived guidance. — [NWS WR TA](https://www.weather.gov/media/wrh/online_publications/TAs/ta9910.pdf)
- Scheuerer & Hamill 2015: precipitation calibration "crucially relies" on large training data, and they used 12-year reforecasts. — [NOAA repository](https://repository.library.noaa.gov/view/noaa/14608)

### Inferences
- The app's 5–60 day shrunk bias is roughly the NAEFS approach, which is sensible while history is short. As history grows past one year, switch to:
  1. a multi-year fit with seasonal harmonics (sin/cos of day-of-year) as predictors for the bias and spread coefficients; or
  2. a "same season" window, e.g. ±30–45 days around the date in all prior years, blended with a recent decaying average to track model upgrades.
- Unverified, background knowledge: Dabernig et al. 2017 standardized anomaly MOS (SAMOS) handles seasonality by working in climatological anomalies. It works with short records when a gridded climatology is available.

### Gaps
- I found no quantitative CRPS comparison of a 30-day vs 60-day window vs harmonics for days 1–7 in the abstracts.

## 4. Kalman filter / decaying average, analog ensembles, regime-dependent bias (wind direction, cloud, snow, inversions; complex terrain, deserts)

### Takeaway
The decaying average and the Kalman filter are cheap and well proven for first-moment bias. Analog ensembles match or beat logistic regression and are cheap, but they need about 12–15 months of forecast/observation pairs. Literature shows the sign and size of T2m bias depend strongly on terrain (valleys too warm, peaks too cold) and season and snow. However, I found no direct source quantifying wind-direction-conditioned bias at desert or southern-Nevada sites. Conditioning is best done implicitly, by adding predictors (wind direction sin/cos, cloud cover, snow, lapse rate) to a regression or tree model, rather than binning.

### Cited Findings
- Delle Monache et al. 2013 (MWR 141, 3498–3516) built an analog ensemble from the deterministic Environment Canada GEM model with 12–15 months of training. It covered 0–48 h 10 m wind and T2m at 550 CONUS stations. The analog ensemble showed "high statistical consistency and reliability and the ability to capture the flow-dependent behavior of errors." Its skill was equal to or better than logistic regression, and it was cheaper in real time than EMOS. The benchmark was the 21-member REPS. — [UCAR OpenSky](https://opensky.library.ucar.edu/islandora/object/articles%3A12922); [UCAR data record](https://data.ucar.edu/dataset/6175cccc-e329-4338-95cb-6635e92b1683)
- NAEFS uses a 2% decaying-average first-moment correction, plus a 2% decaying average of the spread ratio for the second moment. — [EMC Zhu GEFS/NAEFS](https://www.weather.gov/media/owp/oh/hrl/docs/Zhu_GEFS_NAEFS_Final.pdf); [EMC Guan slides](https://www.emc.ncep.noaa.gov/gmb/ens/WkShopOct13/program/pdf/S3-04-Guan_NAEFS_SPP-3.pdf)
- Terrain dependence: "in many cases, mountain valleys are too warm, whereas peaks are too cold." — [DOE EESM presentation](https://eesm.science.energy.gov/presentations/are-atmospheric-models-too-cold-mountains)
- Cold biases in maximum T2 in snow-covered complex terrain occur mainly November–April and are not explained by snow cover alone. — [CU Boulder record](https://vivo.colorado.edu/display/pubid_506021)
- In a terrain-plus-SVM T2m correction (Yanqing, China), the largest improvements came at stations above the model terrain height. — [DOAJ, Journal of Applied Meteorological Science 2023](https://doaj.org/article/e81ac5fcd47c4f36a6f2428f8fc36639)
- NWS Western Region notes that model T2m is interpolated to model elevation, so low-level temperature errors feed directly into MOS. — [NWS WR TA 96-19](https://www.weather.gov/media/wrh/online_publications/TAs/ta9619.pdf)
- QRF gains over EMOS came from adding predictors from other variables, which is an implicit way to condition on regime. — [Taillardat et al. 2016](https://hal-meteofrance.archives-ouvertes.fr/meteo-03544106v1)

### Inferences
- For southern Nevada and Mojave-type sites, the likely regimes are:
  - nocturnal radiational inversions in basins, where Tmin is too warm under clear, calm conditions;
  - downslope/gap winds;
  - monsoon cloud and convection, where Tmax is too warm when clouds or outflows are underforecast.
- A practical, low-data approach is a per-station linear model or small LightGBM. Predictors would be the raw forecast, cloud cover, 10 m wind speed and the sin/cos of direction, and possibly the 850 hPa minus 2 m temperature difference. Fit it pooled across leads, with shrinkage. Hard binning by wind sector splits a few months of data into tiny samples. This is unverified; I have no quantitative source for it.
- Analog ensembles need about 1 year of archived forecasts per station before they are useful.

### Gaps
- I found no peer-reviewed quantification of wind-direction- or regime-conditioned bias correction at desert or southern-Nevada sites.
- I found no Kalman-filter-specific skill numbers (e.g. Libonati et al., Galanis et al.) in the searches.

## 5. NOAA National Blend of Models: methodology, verification, free point data

### Takeaway
NBM blends many models and MOS products. It bias-corrects each input with a decaying average and/or quantile mapping against URMA (or observations at METAR sites), then weights inputs by decaying MAE plus static expert weights. Precipitation uses quantile mapping with gamma distributions. NBM v5.0 was announced as effective 2026-04-30 and moves several temperature and humidity variables from decaying average to quantile mapping. NBM point guidance is free: station text bulletins on NOMADS and on the AWS `noaa-nbm-grib2-pds` bucket under `blend.YYYYMMDD/CC/text/`, plus GRIB2 that Herbie can read. For a CONUS site such as southern Nevada, NBM is a strong extra blend member or benchmark.

### Cited Findings
- Bias correction: the operational NBM uses "decaying average and quantile mapping," with "dynamic decaying MAEs and static expert weights" applied to each input. — [NOMADS BLEND description](https://nomads.ncep.noaa.gov/txt_descriptions/BLEND_txt.html)
- Craven, Rudack & Shafer 2020 (NWA JOM) define a decaying-average MAE computed daily for each member, with URMA as truth. — [NWA JOM 2020-JOM1](https://nwafiles.nwas.org/file/nwafiles/jom/articles/2020/2020-JOM1/2020-JOM1.pdf)
- Quantile mapping uses the full forecast CDF and analysis CDF and avoids the spread collapse of regression when forecasts and observations correlate weakly. Precipitation uses a gamma distribution. — [NBM documentation](https://blend.mdl.nws.noaa.gov/nbm-documentation); [NWS NBM user webinar 15 April 2026](https://www.weather.gov/media/wrn/calendar/NBMUserWebinar4-15-26.pdf)
- Truth: RTMA/URMA is the analysis of record for most bias correction. At METAR sites NBM corrects directly to observations, which can create "bullseyes". — [NWS NBM user webinar 2026](https://www.weather.gov/media/wrn/calendar/NBMUserWebinar4-15-26.pdf)
- NBM v5.0 was effective 2026-04-30. It replaces decaying average with quantile mapping for several temperature and humidity variables, and for significant wave height. — [SCN 26-24 updated](https://www.weather.gov/media/notification/pdf_2026/scn26-24_Updated_NBM_V5.0_aac.pdf); [PNS 25-45](https://www.weather.gov/media/notification/pdf_2025/pns25-45_soliciting_comments_NBM_v5.0.pdf)
- Early NBM development: an MAE-weighted blend beat an equal-weight blend for T2m. — [Veenhuis 2015](https://www.weather.gov/media/mdl/Veenhuis_Presentation2015.pdf)
- Verification:
  - In the NBM v2.0 test (July–November 2016), NBM improved on its bias-corrected components, had T2m skill comparable to the NWS forecaster NDFD, and verified better than NDFD against URMA. — [AMS 2017 NBM verification](https://www.weather.gov/media/mdl/AMS2017-NBMVerification.pdf); [AMS 7B.3](https://ams.confex.com/ams/97Annual/webprogram/Paper305573.html)
  - CBRFC (2018, days 1–10): GFS MOS (MDL) "generally… has the largest errors". A locally bias-corrected NBM was best on MAE and consistency. — [CBRFC NBM temperature project](https://www.cbrfc.noaa.gov/present/projects/NBM_Temperature.pdf)
  - Mount Washington (2024): GFS MOS, NAM MOS and NBM were similar for temperature, with MAE differences under 1°F. NBM did worse on wind speed at that extreme summit site. — [KMWN MOS verification](https://mountwashington.org/wp-content/uploads/2024/08/KMWN_MOS_Verification.pdf)
- Free data:
  - The AWS Open Data bucket `noaa-nbm-grib2-pds` (us-east-1) can be read with no AWS account (`--no-sign-request`). `noaa-nbm-pds` holds the COG files. — [AWS registry noaa-nbm](https://registry.opendata.aws/noaa-nbm)
  - Text bulletins for all stations sit in one file per type under `blend.YYYYMMDD/CC/text/` on AWS, NOMADS and FTP. — [MDL NBM data download](https://vlab.noaa.gov/web/mdl/nbm-download)
  - The Herbie Python library reads NBM GRIB2. — [Herbie NBM docs](https://herbie.readthedocs.io/en/latest/gallery/noaa_models/nbm.html)
  - A parallel (pre-operational) bucket exists. — [AWS noaa-nbm-parallel](https://registry.opendata.aws/noaa-nbm-parallel/)

### Inferences
- Unverified, background knowledge:
  - The bulletin types are NBH (hourly, 1–25 h), NBS (short, 3-hourly to about 72 h), NBE (extended, 12-hourly to about day 8) and NBX (to about day 11). Together they give station Tmax/Tmin, temperature, wind speed and direction, gusts, PoP and QPF, sky cover and more, for thousands of stations including many NWS/COOP sites.
  - Since the bulletins cover days 1–8 at stations, ingesting NBE/NBS for the app's CONUS stations would add a skilled, already-calibrated member at near-zero modelling cost.
- The NBM recipe (decaying-average bias plus decaying MAE weights) is very close to what the app already does. The app's remaining gaps versus NBM are:
  1. quantile mapping for precipitation and full distributions;
  2. far more inputs, including MOS and HRRR/NAM/RAP for the short range;
  3. analysis-based (URMA) training, which gives more training samples than station-only training.

### Gaps
- I could not confirm Open-Meteo's `ncep_nbm_conus` model identifier, its variables or its history depth; no Open-Meteo documentation surfaced in the searches.
- I could not confirm the name "NBM1D" as an official product. The MDL page refers to text bulletins and the "Big Data Archive Viewer".
- I found no recent (v4.2/v4.3/v5.0) national verification numbers against MOS or raw models.

## 6. PoP and amounts: calibration, reliability, multi-ensemble probability blending (ENS 51, GEFS 31, AIFS-ENS)

### Takeaway
Raw member-count PoP is typically unreliable: overconfident and biased toward over-forecasting light rain. The standard fixes are:
- logistic regression or censored-distribution EMOS (CSGD) fitted per station or pooled, calibrated against observed ≥0.1 mm or ≥0.25 mm occurrence;
- quantile mapping, as NBM does with gamma distributions.

For combining ensembles, a weighted linear pool of calibrated probabilities is standard, but linear pools are underconfident or underdispersed unless recalibrated afterwards. Multi-year data matters a lot for precipitation.

### Cited Findings
- CSGD/EMOS for precipitation needs large training sets, and pooling across sites partly compensates. — [Scheuerer & Hamill 2015, NOAA repository](https://repository.library.noaa.gov/view/noaa/14608); [AMS 2015 abstract](https://ams.confex.com/ams/95Annual/webprogram/Paper267145.html)
- Combining predictive distributions: Baran & Lerch study linear pooling of EMOS-type predictive distributions. — [arXiv 1607.08096](https://arxiv.org/pdf/1607.08096)
- NBM precipitation uses quantile mapping with a gamma distribution. — [NBM documentation](https://blend.mdl.nws.noaa.gov/nbm-documentation)
- An ECMWF study compared ecPoint (ECMWF's point-rainfall post-processing) with post-processed multi-model ensembles over Switzerland. — [ECMWF elibrary](https://www.ecmwf.int/en/elibrary/81319-how-do-ecpoint-precipitation-forecasts-compare-postprocessed-multi-model-ensemble)

### Inferences
Unverified practical guidance for the app:
1. Compute member-fraction PoP separately for ENS (51), GEFS (31) and AIFS-ENS (51). Use a *threshold-adjusted* member count, e.g. count a member as wet if it exceeds a station-specific threshold chosen so that the climatological frequency matches.
2. Feed the per-ensemble fractions as predictors into a single logistic regression (pooled across stations and leads, with lead as a feature), using a few months of observations. With only 3–4 coefficients this is feasible with little data.
3. Check reliability diagrams and Brier skill score by lead.
4. For amounts, use quantile mapping of the blended ensemble CDF to the station's observed CDF, or a CSGD with pooled coefficients.

Equal or skill-weighted linear pooling followed by a logistic recalibration (beta-transformed linear pool) is the usual fix for pooled underconfidence.

### Gaps
- I found no published verification yet of AIFS-ENS PoP calibration at stations, or of AIFS-ENS combined with ENS and GEFS.
- I could not retrieve quantitative Brier skill score gains for logistic PoP over member-count PoP in this session.

## 7. Wind gust post-processing specifics

### Takeaway
Gusts benefit most from post-processing of the three variables. Raw NWP gust diagnostics are poorly calibrated and site-dependent. Simple EMOS on the ensemble gust gave up to 40% CRPS improvement over raw. ML methods with extra predictors (mean wind, boundary-layer and stability variables) improved further and handled storms better. Truncated or log-normal distributions are standard.

### Cited Findings
- Schulz & Lerch 2022 compared eight methods for German stations using COSMO-DE-EPS gusts. Simple ensemble-gust-only methods improved CRPS up to 40% over raw. More complex ML methods improved further. NNs beat EMOS during winter storms. KIT summarized this as about 36% average error reduction. — [EGU21-1326](https://meetingorganizer.copernicus.org/EGU21/EGU21-1326.html); [KIT press release](https://kit.edu/kit/english/pi_2022_021_better-forecasts-of-wind-gusts-with-ai.php); [EGU22-869](https://meetingorganizer.copernicus.org/EGU22/EGU22-869.html); [EGU OSPP award summary](https://www.egu.eu/media/awards/ospp-award/2022/benedikt_schulz.pdf)
- At an extreme mountain site, NBM's wind speed lagged MOS. — [KMWN MOS verification](https://mountwashington.org/wp-content/uploads/2024/08/KMWN_MOS_Verification.pdf)

### Inferences
- Unverified, background knowledge:
  - EMOS for wind and gusts commonly uses a zero-truncated normal or logistic distribution, or a log-normal (Thorarinsdottir & Gneiting 2010; Baran & Lerch 2015).
  - Gust factor (gust/mean) regression on forecast mean wind plus a stability proxy is a simple low-data alternative when models lack a gust field. Of the four models, IFS, GFS, ICON and GEM all output 10 m gusts via Open-Meteo, but their diagnostics differ, so per-model, per-station multiplicative correction is warranted rather than additive correction.
  - Multiplicative or quantile-mapped correction suits wind and gusts better than additive correction, because errors scale with speed.

### Gaps
- I could not retrieve the exact Schulz & Lerch CRPS tables, the training period (believed to be several years of COSMO-DE-EPS data) or feature importances.
- I found no gust post-processing studies specific to desert or southwestern US sites.
