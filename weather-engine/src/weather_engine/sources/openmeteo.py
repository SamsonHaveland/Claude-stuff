"""Open-Meteo: geocoding, live model forecasts, archived past runs, ensembles.

Each model is requested in its own call so response keys are never suffixed
with model names, which keeps parsing simple and robust.
"""

from __future__ import annotations

import unicodedata

import pandas as pd

from .. import http
from ..config import FORECAST_DAYS, MAX_LEAD, RAIN_THRESHOLD_IN, VARIABLES, Location

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
ENSEMBLE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"

UNIT_PARAMS = {
    "temperature_unit": "fahrenheit",
    "wind_speed_unit": "mph",
    "precipitation_unit": "inch",
    "timezone": "auto",
}

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico",
}


# --- geocoding -------------------------------------------------------------

# Everyday names the geocoder doesn't know as places (it only matches official names).
NICKNAMES = {
    "cabo": "Cabo San Lucas, Baja California Sur, Mexico",
    "los cabos": "San José del Cabo, Baja California Sur, Mexico",
    "vegas": "Las Vegas, Nevada",
    "nyc": "New York, New York",
    "la": "Los Angeles, California",
    "sf": "San Francisco, California",
    "dc": "Washington, District of Columbia",
    "philly": "Philadelphia, Pennsylvania",
    "nola": "New Orleans, Louisiana",
    "cdmx": "Mexico City, Mexico",
}
# Other ways people write a country after the comma -> ISO country code.
COUNTRY_ALIASES = {
    "usa": "US", "us": "US", "united states": "US", "united states of america": "US", "america": "US",
    "uk": "GB", "england": "GB", "scotland": "GB", "wales": "GB", "britain": "GB", "great britain": "GB",
    "mexico": "MX", "canada": "CA",
}
US_BOOST = 10  # a US place wins unless the other is over 10x bigger ("Paris" is France, "Portland" Oregon)
MAX_ALTERNATIVES = 5


def _norm(text: str | None) -> str:
    """Lower case without accents: "Carbó" -> "carbo"."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower().strip()


def _matches_hint(r: dict, hint: str) -> bool:
    """Does one comma part ("CO", "Sonora", "Mexico", "MX") describe this result?"""
    h = _norm(hint)
    names = {_norm(r.get(k)) for k in ("admin1", "admin2", "admin3", "country")} - {""}
    if h in names:
        return True
    code = (r.get("country_code") or "").upper()
    if r.get("country_code") == "US" and _norm(US_STATES.get(hint.strip().upper())) in names:
        return True
    return COUNTRY_ALIASES.get(h, h.upper() if len(h) == 2 else None) == code


def _is_place(r: dict) -> bool:
    return (r.get("feature_code") or "PPL").startswith("PPL")  # towns, not peaks, parks or airports


def _rank(r: dict, name: str) -> tuple:
    n = _norm(r.get("name"))
    match = 0 if n == name else 1 if n.startswith(name) else 2
    is_place = _is_place(r)
    us = r.get("country_code") == "US"
    size = (r.get("population") or 0) * (US_BOOST if us else 1)
    return (match, not is_place, -size, not us)


def pick_geocode_results(results: list[dict], query: str) -> list[dict]:
    """Geocoder results that fit the query, best first.

    The first comma part is the place name; any further parts ("Sonora",
    "Mexico", "CO") must each match the result's state/region or country.
    """
    name, *hints = [p.strip() for p in query.split(",") if p.strip()]
    fitting = [r for r in results if all(_matches_hint(r, h) for h in hints)]
    return sorted(fitting, key=lambda r: _rank(r, _norm(name)))


def pick_geocode_result(results: list[dict], region: str | None) -> dict | None:
    """Best result for a name with an optional region hint ("CO" or "Colorado")."""
    name = results[0].get("name", "") if results else ""
    ranked = pick_geocode_results(results, f"{name}, {region}" if region else name)
    return ranked[0] if ranked else None


def display_name(r: dict) -> str:
    """ "Denver, Colorado" in the US (unchanged, so saved history still matches);
    "Carbó, Sonora, Mexico" elsewhere."""
    parts = [r["name"], r.get("admin1")]
    if r.get("country_code") != "US":
        parts.append(r.get("country"))
    return ", ".join(dict.fromkeys(p for p in parts if p))


def _to_location(r: dict) -> Location:
    return Location(name=display_name(r), latitude=r["latitude"], longitude=r["longitude"],
                    elevation=r.get("elevation"), timezone=r.get("timezone"))


def search(query: str) -> list[Location]:
    """Places matching "Denver, CO", "Carbo, Mexico", "Cabo", ..., best first."""
    first, *rest = query.split(",")
    if _norm(first) in NICKNAMES:
        query = ", ".join([NICKNAMES[_norm(first)], *rest])
    name = query.split(",")[0].strip()
    payload = http.get_json(GEOCODE_URL, {"name": name, "count": 25, "language": "en"})
    results = payload.get("results") or []
    ranked = pick_geocode_results(results, query)
    if not ranked:
        if results and "," in query:
            others = "; ".join(display_name(r) for r in pick_geocode_results(results, name)[:MAX_ALTERNATIVES])
            raise ValueError(f"No {name!r} found in {query.split(',', 1)[1].strip()!r}. Did you mean: {others}?")
        raise ValueError(f"No place found for {query!r}")
    best_is_place = _is_place(ranked[0])
    out, seen = [], set()
    for r in ranked:
        if out and best_is_place and not _is_place(r):
            continue  # don't offer airports or capes as "did you mean"
        loc = _to_location(r)
        if loc.name not in seen:  # the geocoder sometimes lists the same town twice
            seen.add(loc.name)
            out.append(loc)
    return out


def geocode(query: str) -> Location:
    """Resolve "Denver, CO", "Carbó, Sonora, Mexico" or "Cabo" to the best-matching Location."""
    return search(query)[0]


# --- live forecasts --------------------------------------------------------

def parse_daily(payload: dict) -> pd.DataFrame:
    """Daily block -> DataFrame indexed by local date, canonical columns."""
    daily = payload["daily"]
    df = pd.DataFrame({"date": pd.to_datetime(daily["time"]).date})
    for canon, (dvar, _, _) in VARIABLES.items():
        df[canon] = pd.to_numeric(pd.Series(daily.get(dvar, [None] * len(df))), errors="coerce")
    return df.set_index("date")


# Hour-by-hour detail (Open-Meteo names -> our column names).
HOURLY_DETAIL = {
    "temperature_2m": "temp",
    "apparent_temperature": "feels",
    "relative_humidity_2m": "humidity",
    "cloud_cover": "cloud",
    "precipitation": "precip",
    "snowfall": "snow",
    "weather_code": "code",
    "cape": "cape",
    "wind_speed_10m": "wind",
    "wind_direction_10m": "wind_dir",
    "wind_gusts_10m": "gust",
    "pressure_msl": "pressure",
}

# Extra past-run series that describe the weather pattern of each day (see regime.py).
REGIME_HOURLY = ["wind_direction_10m", "pressure_msl"]


def parse_hourly(payload: dict) -> pd.DataFrame:
    """Hourly detail block -> DataFrame (time + HOURLY_DETAIL columns); missing variables are NaN."""
    hourly = payload.get("hourly") or {}
    if "time" not in hourly:
        return pd.DataFrame(columns=["time", *HOURLY_DETAIL.values()])
    df = pd.DataFrame({"time": pd.to_datetime(hourly["time"])})
    for src, col in HOURLY_DETAIL.items():
        df[col] = pd.to_numeric(pd.Series(hourly.get(src, [None] * len(df))), errors="coerce").values
    return df


def parse_sun(payload: dict) -> pd.DataFrame:
    daily = payload.get("daily") or {}
    if "sunrise" not in daily:
        return pd.DataFrame(columns=["sunrise", "sunset"])
    return pd.DataFrame({
        "date": pd.to_datetime(daily["time"]).date,
        "sunrise": pd.to_datetime(pd.Series(daily["sunrise"]), errors="coerce"),
        "sunset": pd.to_datetime(pd.Series(daily.get("sunset", [None] * len(daily["sunrise"]))), errors="coerce"),
    }).set_index("date")


def fetch_forecast(loc: Location, model: str, days: int = FORECAST_DAYS) -> tuple[pd.DataFrame, dict]:
    """Daily forecast plus meta; meta["hourly"] and meta["sun"] hold the detail tables."""
    params = {
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "daily": ",".join([*(v[0] for v in VARIABLES.values()), "sunrise", "sunset"]),
        "hourly": ",".join(HOURLY_DETAIL),
        "models": model,
        "forecast_days": days,
        **UNIT_PARAMS,
    }
    payload = http.get_json(FORECAST_URL, params)
    meta = {k: payload.get(k) for k in ("timezone", "elevation", "latitude", "longitude")}
    meta["hourly"] = parse_hourly(payload)
    meta["sun"] = parse_sun(payload)
    return parse_daily(payload), meta


# --- archived past runs (training data) ------------------------------------

def _hourly_name(base: str, lead: int) -> str:
    return base if lead == 0 else f"{base}_previous_day{lead}"


def _past_run_vars() -> list[str]:
    return sorted({v[1] for v in VARIABLES.values()} | set(REGIME_HOURLY))


def parse_previous_runs_hourly(payload: dict, leads: range = range(1, MAX_LEAD + 1)) -> pd.DataFrame:
    """Hourly *_previous_dayN series -> long hourly table (time, lead, hvar, value).

    Each hourly value of `x_previous_dayN` comes from the run issued N days
    before that hour.
    """
    hourly = payload["hourly"]
    times = pd.to_datetime(hourly["time"])
    frames = []
    for hvar in _past_run_vars():
        for lead in leads:
            key = _hourly_name(hvar, lead)
            if key in hourly:
                frames.append(pd.DataFrame({
                    "time": times, "lead": lead, "hvar": hvar,
                    "value": pd.to_numeric(pd.Series(hourly[key]), errors="coerce").values,
                }))
    if not frames:
        return pd.DataFrame(columns=["time", "lead", "hvar", "value"])
    return pd.concat(frames, ignore_index=True).dropna(subset=["value"])


def aggregate_windows(hourly: pd.DataFrame, end_hour: int = 24, min_hours: int = 20) -> pd.DataFrame:
    """Hourly forecasts -> daily values over 24-hour windows ending at `end_hour` local time.

    The window labelled D covers (D-1 end_hour, D end_hour]; end_hour=24 is the
    calendar day. This matches how observers report: a 7 am reading on the 5th
    covers 7 am on the 4th to 7 am on the 5th. (Open-Meteo's hourly precipitation
    at time t is the total for the hour ending at t, so the right-closed window is exact.)
    """
    if hourly.empty:
        return pd.DataFrame(columns=["date", "lead", "var", "value"])
    times = pd.to_datetime(hourly["time"])
    label = (times - pd.Timedelta(hours=end_hour) - pd.Timedelta(seconds=1)).dt.date + pd.Timedelta(days=1)
    df = hourly.assign(label=pd.to_datetime(label).dt.date)
    keys = ["label", "lead"] + (["model"] if "model" in df else [])
    frames = []
    for canon, (_, hvar, agg) in VARIABLES.items():
        sub = df[df["hvar"] == hvar]
        if sub.empty:
            continue
        g = sub.groupby(keys)["value"]
        out = g.agg(agg).to_frame("value")
        out = out[g.count() >= min_hours].reset_index().rename(columns={"label": "date"})
        frames.append(out.assign(var=canon))
    cols = ["date", "lead", "var", "value"] + (["model"] if "model" in df else [])
    return pd.concat(frames, ignore_index=True)[cols]


def parse_previous_runs(payload: dict, leads: range = range(1, MAX_LEAD + 1), min_hours: int = 20) -> pd.DataFrame:
    """Calendar-day (date, lead, var, value) table from a previous-runs payload."""
    return aggregate_windows(parse_previous_runs_hourly(payload, leads), 24, min_hours)


def previous_runs_wide(payload: dict) -> pd.DataFrame:
    """Previous-runs payload -> wide table (index time, one column per API series), for archiving."""
    hourly = dict(payload["hourly"])
    times = pd.to_datetime(hourly.pop("time"))
    wide = pd.DataFrame({k: pd.to_numeric(pd.Series(v), errors="coerce").values for k, v in hourly.items()},
                        index=pd.DatetimeIndex(times, name="time"))
    return wide


def wide_to_long(wide: pd.DataFrame) -> pd.DataFrame:
    """Inverse of previous_runs_wide -> long hourly table (time, lead, hvar, value), like parse_previous_runs_hourly."""
    frames = []
    for hvar in _past_run_vars():
        for lead in range(1, MAX_LEAD + 1):
            key = _hourly_name(hvar, lead)
            if key in wide:
                frames.append(pd.DataFrame({"time": wide.index, "lead": lead, "hvar": hvar,
                                            "value": wide[key].to_numpy(dtype=float)}))
    if not frames:
        return pd.DataFrame(columns=["time", "lead", "hvar", "value"])
    return pd.concat(frames, ignore_index=True).dropna(subset=["value"])


def daily_from_wide(wide: pd.DataFrame, end_hour: int = 24, min_hours: int = 20) -> pd.DataFrame:
    """Archived wide past runs -> daily (date, lead, var, value), like aggregate_windows but without
    first unpacking years of hourly data into a long table (much less memory)."""
    if wide.empty:
        return pd.DataFrame(columns=["date", "lead", "var", "value"])
    label = ((wide.index - pd.Timedelta(hours=end_hour) - pd.Timedelta(seconds=1)).normalize()
             + pd.Timedelta(days=1)).date
    frames = []
    for canon, (_, hvar, agg) in VARIABLES.items():
        cols = {_hourly_name(hvar, lead): lead for lead in range(1, MAX_LEAD + 1) if _hourly_name(hvar, lead) in wide}
        if not cols:
            continue
        g = wide[list(cols)].groupby(label)
        vals = g.agg(agg).where(g.count() >= min_hours).rename(columns=cols)
        long = vals.rename_axis("date").reset_index().melt(id_vars="date", var_name="lead", value_name="value")
        frames.append(long.dropna(subset=["value"]).assign(var=canon))
    if not frames:
        return pd.DataFrame(columns=["date", "lead", "var", "value"])
    out = pd.concat(frames, ignore_index=True)
    out["lead"] = out["lead"].astype(int)
    out["value"] = out["value"].astype(float)
    return out[["date", "lead", "var", "value"]]


def fetch_previous_runs_range(loc: Location, model: str, start, end) -> pd.DataFrame:
    """Past runs for local dates start..end (inclusive) as a wide table (see previous_runs_wide)."""
    params = {
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "hourly": ",".join(_hourly_name(h, lead) for h in _past_run_vars() for lead in range(1, MAX_LEAD + 1)),
        "models": model,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        **UNIT_PARAMS,
    }
    return previous_runs_wide(http.get_json(PREVIOUS_RUNS_URL, params))


def fetch_previous_runs(loc: Location, model: str, past_days: int) -> pd.DataFrame:
    hourly_vars = _past_run_vars()
    params = {
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "hourly": ",".join(
            _hourly_name(h, lead) for h in hourly_vars for lead in range(1, MAX_LEAD + 1)
        ),
        "models": model,
        "past_days": min(past_days, 92),
        "forecast_days": 1,
        **UNIT_PARAMS,
    }
    df = parse_previous_runs_hourly(http.get_json(PREVIOUS_RUNS_URL, params))
    df["model"] = model
    return df


# --- ensembles (rain probability) ------------------------------------------

def parse_ensemble_precip(payload: dict, threshold: float = RAIN_THRESHOLD_IN, min_hours: int = 20) -> pd.DataFrame:
    """Per local day: fraction of ensemble members with rain >= threshold."""
    hourly = payload["hourly"]
    times = pd.to_datetime(hourly["time"])
    members = {
        k: pd.to_numeric(pd.Series(v), errors="coerce").values
        for k, v in hourly.items()
        if k.startswith("precipitation")
    }
    if not members:
        return pd.DataFrame(columns=["n_members", "rain_prob"])
    frame = pd.DataFrame(members, index=times)
    g = frame.groupby(frame.index.date)
    totals = g.sum(min_count=1)
    totals[g.count() < min_hours] = float("nan")
    wet = (totals >= threshold).where(totals.notna())
    out = pd.DataFrame({"n_members": wet.notna().sum(axis=1), "rain_prob": wet.mean(axis=1)})
    out.index.name = "date"
    return out[out["n_members"] > 0]


def parse_ensemble_hourly(payload: dict, threshold: float = RAIN_THRESHOLD_IN) -> pd.DataFrame:
    """Per hour: number of members and how many have rain >= threshold in that hour."""
    hourly = payload["hourly"]
    times = pd.to_datetime(hourly["time"])
    members = {k: pd.to_numeric(pd.Series(v), errors="coerce").values
               for k, v in hourly.items() if k.startswith("precipitation")}
    if not members:
        return pd.DataFrame(columns=["n_members", "wet_members"])
    frame = pd.DataFrame(members, index=times)
    out = pd.DataFrame({"n_members": frame.notna().sum(axis=1), "wet_members": (frame >= threshold).sum(axis=1)})
    out.index.name = "time"
    return out[out["n_members"] > 0]


def fetch_ensemble_precip(loc: Location, model: str, days: int = FORECAST_DAYS) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(daily rain probability, hourly member counts) from one ensemble."""
    params = {
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "hourly": "precipitation",
        "models": model,
        "forecast_days": days,
        **UNIT_PARAMS,
    }
    payload = http.get_json(ENSEMBLE_URL, params)
    return parse_ensemble_precip(payload), parse_ensemble_hourly(payload)
