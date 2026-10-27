"""Open-Meteo: geocoding, live model forecasts, archived past runs, ensembles.

Each model is requested in its own call so response keys are never suffixed
with model names, which keeps parsing simple and robust.
"""

from __future__ import annotations

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

def pick_geocode_result(results: list[dict], region: str | None) -> dict | None:
    """Choose the result matching a state/region hint ("CO" or "Colorado")."""
    if not results:
        return None
    if region:
        wanted = US_STATES.get(region.strip().upper(), region.strip()).lower()
        for r in results:
            if (r.get("admin1") or "").lower() == wanted:
                return r
    us = [r for r in results if r.get("country_code") == "US"]
    return (us or results)[0]


def geocode(query: str) -> Location:
    """Resolve "Denver, CO" or "Boulder" to a Location (US results preferred)."""
    city, _, region = (p.strip() for p in query.partition(","))
    payload = http.get_json(GEOCODE_URL, {"name": city, "count": 10, "language": "en"})
    hit = pick_geocode_result(payload.get("results") or [], region or None)
    if hit is None:
        raise ValueError(f"No place found for {query!r}")
    name = ", ".join(x for x in (hit["name"], hit.get("admin1")) if x)
    return Location(
        name=name,
        latitude=hit["latitude"],
        longitude=hit["longitude"],
        elevation=hit.get("elevation"),
        timezone=hit.get("timezone"),
    )


# --- live forecasts --------------------------------------------------------

def parse_daily(payload: dict) -> pd.DataFrame:
    """Daily block -> DataFrame indexed by local date, canonical columns."""
    daily = payload["daily"]
    df = pd.DataFrame({"date": pd.to_datetime(daily["time"]).date})
    for canon, (dvar, _, _) in VARIABLES.items():
        df[canon] = pd.to_numeric(pd.Series(daily.get(dvar, [None] * len(df))), errors="coerce")
    return df.set_index("date")


def fetch_forecast(loc: Location, model: str, days: int = FORECAST_DAYS) -> tuple[pd.DataFrame, dict]:
    params = {
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "daily": ",".join(v[0] for v in VARIABLES.values()),
        "models": model,
        "forecast_days": days,
        **UNIT_PARAMS,
    }
    payload = http.get_json(FORECAST_URL, params)
    meta = {k: payload.get(k) for k in ("timezone", "elevation", "latitude", "longitude")}
    return parse_daily(payload), meta


# --- archived past runs (training data) ------------------------------------

def _hourly_name(base: str, lead: int) -> str:
    return base if lead == 0 else f"{base}_previous_day{lead}"


def parse_previous_runs(payload: dict, leads: range = range(1, MAX_LEAD + 1), min_hours: int = 20) -> pd.DataFrame:
    """Hourly *_previous_dayN series -> long daily table (date, lead, var, value).

    Each hourly value of `x_previous_dayN` comes from the run issued N days
    before that hour, so aggregating a local day gives the lead-N daily value.
    """
    hourly = payload["hourly"]
    times = pd.to_datetime(hourly["time"])
    rows = []
    for canon, (_, hvar, agg) in VARIABLES.items():
        for lead in leads:
            key = _hourly_name(hvar, lead)
            if key not in hourly:
                continue
            s = pd.Series(pd.to_numeric(pd.Series(hourly[key]), errors="coerce").values, index=times)
            g = s.groupby(s.index.date)
            daily = g.agg(agg)
            daily[g.count() < min_hours] = float("nan")
            for d, v in daily.dropna().items():
                rows.append((d, lead, canon, float(v)))
    return pd.DataFrame(rows, columns=["date", "lead", "var", "value"])


def fetch_previous_runs(loc: Location, model: str, past_days: int) -> pd.DataFrame:
    hourly_vars = sorted({v[1] for v in VARIABLES.values()})
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
    df = parse_previous_runs(http.get_json(PREVIOUS_RUNS_URL, params))
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


def fetch_ensemble_precip(loc: Location, model: str, days: int = FORECAST_DAYS) -> pd.DataFrame:
    params = {
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "hourly": "precipitation",
        "models": model,
        "forecast_days": days,
        **UNIT_PARAMS,
    }
    return parse_ensemble_precip(http.get_json(ENSEMBLE_URL, params))
