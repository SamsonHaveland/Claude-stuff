"""Open-Meteo: multi-model NWP forecasts and archived past runs.

Free tier is for non-commercial use (see DATA_SOURCES.md).
"""

from __future__ import annotations

from datetime import date, timedelta

from ..locations import Location
from ..net import get_json
from ..records import VARIABLES, Forecast
from ..timeutil import DAY, floor_hour

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"

COMMON_PARAMS = {
    "timezone": "UTC",
    "timeformat": "unixtime",
    "wind_speed_unit": "ms",
    "temperature_unit": "celsius",
    "precipitation_unit": "mm",
}

LEAD_DAYS = range(1, 8)  # previous-runs offsets requested on backfill


def source_name(model: str) -> str:
    return f"om:{model}"


def parse_hourly(
    payload: dict, location_id: str, models: list[str], issue_time: int | None = None
) -> list[Forecast]:
    """Turn an Open-Meteo hourly response into Forecast rows.

    Keys look like ``temperature_2m`` (single model), ``temperature_2m_gfs_seamless``
    (multi-model) or ``temperature_2m_previous_day3[_<model>]`` (past runs).
    A ``previous_dayN`` series is the forecast made N days before each valid hour,
    so its issue time is valid_time - N days. Plain series use ``issue_time``.
    """
    hourly = payload.get("hourly", {})
    times = hourly.get("time", [])
    by_length = sorted(models, key=len, reverse=True)
    rows = []
    for key, values in hourly.items():
        if key == "time":
            continue
        model = next((m for m in by_length if key.endswith("_" + m)), None)
        if model:
            base = key[: -len(model) - 1]
        elif len(models) == 1:
            model, base = models[0], key
        else:
            continue
        if "_previous_day" in base:
            variable, n = base.split("_previous_day")
            offset = int(n) * DAY
        else:
            variable, offset = base, None
            if issue_time is None:
                continue
        if variable not in VARIABLES:
            continue
        for t, v in zip(times, values):
            if v is None:
                continue
            issue = t - offset if offset is not None else issue_time
            rows.append(Forecast(location_id, source_name(model), variable, issue, int(t), float(v)))
    return rows


def fetch_forecast(
    loc: Location, models: list[str], *, now: int, user_agent: str, days: int = 7
) -> list[Forecast]:
    """Current forecast from each model, stamped as issued at the fetch hour."""
    payload = get_json(
        FORECAST_URL,
        {
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "hourly": ",".join(VARIABLES),
            "models": ",".join(models),
            "forecast_days": days,
            **COMMON_PARAMS,
        },
        user_agent=user_agent,
    )
    return parse_hourly(payload, loc.id, models, issue_time=floor_hour(now))


def fetch_previous_runs(
    loc: Location, models: list[str], start: date, end: date, *, user_agent: str
) -> list[Forecast]:
    """Archived forecasts made 1-7 days before each hour in [start, end]."""
    hourly = [f"{v}_previous_day{n}" for v in VARIABLES for n in LEAD_DAYS]
    rows: list[Forecast] = []
    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(chunk_start + timedelta(days=30), end)
        payload = get_json(
            PREVIOUS_RUNS_URL,
            {
                "latitude": loc.latitude,
                "longitude": loc.longitude,
                "hourly": ",".join(hourly),
                "models": ",".join(models),
                "start_date": chunk_start.isoformat(),
                "end_date": chunk_end.isoformat(),
                **COMMON_PARAMS,
            },
            user_agent=user_agent,
        )
        rows.extend(parse_hourly(payload, loc.id, models))
        chunk_start = chunk_end + timedelta(days=1)
    return rows
