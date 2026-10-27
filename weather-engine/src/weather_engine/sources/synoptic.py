"""Synoptic Data (MesoWest): stations from every network, not just airports.

Needs a free API token in WEATHER_ENGINE_SYNOPTIC_TOKEN (put it in the
project's .env file). Units are requested explicitly and then checked against
the UNITS block of each response, so a unit mismatch is converted, not trusted.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pandas as pd

from .. import http
from ..config import Location, synoptic_token
from .observations import Station, haversine_km

BASE_URL = "https://api.synopticdata.com/v2"
METADATA_URL = f"{BASE_URL}/stations/metadata"
NETWORKS_URL = f"{BASE_URL}/networks"
TIMESERIES_URL = f"{BASE_URL}/stations/timeseries"

KM_PER_MILE = 1.609344
FT_TO_M = 0.3048
UNITS_PARAM = "temp|F,speed|mph,precip|in"
# Rain gauges report in different ways; the daily total is derived from whichever is present,
# in this order of preference (see daily_precip). The free tier has no precipitation service.
PRECIP_VARS = {
    "p_midnight": "precip_accum_since_local_midnight",
    "p_accum": "precip_accum",
    "p_1h": "precip_accum_one_hour",
    "p_15m": "precip_accum_fifteen_minute",
    "p_5m": "precip_accum_five_minute",
}
TIMESERIES_VARS = ",".join(["air_temp", "wind_speed", "wind_gust", *PRECIP_VARS.values()])
MIN_HOURS_PER_DAY = 18


class SynopticError(RuntimeError):
    pass


def _params(**extra) -> dict:
    token = synoptic_token()
    if not token:
        raise SynopticError("no Synoptic token configured (WEATHER_ENGINE_SYNOPTIC_TOKEN in .env)")
    return {"token": token, **extra}


def _check(payload: dict) -> bool:
    """True if the response has stations; False for 'no stations found'; raise on errors."""
    summary = payload.get("SUMMARY", {})
    code = summary.get("RESPONSE_CODE")
    if code == 1:
        return True
    if code == 2:  # no stations matched the query
        return False
    raise SynopticError(summary.get("RESPONSE_MESSAGE") or f"Synoptic error (code {code})")


def _num(v) -> float | None:
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


def _groups(sensor_vars: dict) -> frozenset:
    names = set(sensor_vars or {})
    groups = set()
    if "air_temp" in names:
        groups.add("temp")
    if "wind_speed" in names:
        groups.add("wind")
    if any(n.startswith("precip") for n in names):
        groups.add("precip")
    return frozenset(groups)


# --- station search -----------------------------------------------------------

def parse_networks(payload: dict) -> dict[str, str]:
    """MNET_ID -> readable network name."""
    out = {}
    for net in payload.get("MNET", []):
        name = net.get("SHORTNAME") or net.get("LONGNAME")
        if net.get("ID") is not None and name:
            out[str(net["ID"])] = str(name)
    return out


def network_names() -> dict[str, str]:
    from .. import store  # local import: store imports config only, but keep sources light

    try:
        df = store.cached_frame("synoptic_networks", 24 * 30, lambda: pd.DataFrame(
            sorted(parse_networks(http.get_json(NETWORKS_URL, _params())).items()), columns=["id", "name"]))
        return dict(zip(df["id"].astype(str), df["name"].astype(str)))
    except Exception:  # names are cosmetic; never fail a forecast over them
        return {}


def parse_metadata(payload: dict, loc: Location, networks: dict[str, str] | None = None) -> list[Station]:
    networks = networks or {}
    if not _check(payload):
        return []
    stations = []
    for st in payload.get("STATION", []):
        lat, lon = _num(st.get("LATITUDE")), _num(st.get("LONGITUDE"))
        if lat is None or lon is None:
            continue
        elev_ft = _num(st.get("ELEVATION"))
        groups = _groups(st.get("SENSOR_VARIABLES"))
        if not groups:
            continue
        stations.append(Station(
            id=st["STID"],
            name=st.get("NAME", "").title() if st.get("NAME", "").isupper() else st.get("NAME", ""),
            latitude=lat,
            longitude=lon,
            elevation=None if elev_ft is None else elev_ft * FT_TO_M,
            distance_km=haversine_km(loc.latitude, loc.longitude, lat, lon),
            source="synoptic",
            network=str(st.get("SHORTNAME") or networks.get(str(st.get("MNET_ID")))
                        or f"network {st.get('MNET_ID', '?')}"),
            variables=groups,
        ))
    return sorted(stations, key=lambda s: s.distance_km)


def find_stations(loc: Location, radius_km: float, limit: int = 100) -> list[Station]:
    # No variable filter: rain gauges name their sensors many ways (precip_accum_fifteen_minute,
    # precip_accum_since_local_midnight, ...). Stations without weather sensors are dropped in parsing.
    params = _params(
        radius=f"{loc.latitude:.4f},{loc.longitude:.4f},{radius_km / KM_PER_MILE:.1f}",
        limit=limit,
        status="active",
        sensorvars=1,
    )
    return parse_metadata(http.get_json(METADATA_URL, params), loc, network_names())


# --- observations -----------------------------------------------------------

def _utc_bounds(start: date, end: date, tz: str) -> tuple[datetime, datetime]:
    """Local midnight at `start` .. local midnight after `end`, as naive UTC datetimes."""
    z = ZoneInfo(tz)
    utc = ZoneInfo("UTC")
    t0 = datetime.combine(start, time(0), z).astimezone(utc).replace(tzinfo=None)
    t1 = datetime.combine(end + timedelta(days=1), time(0), z).astimezone(utc).replace(tzinfo=None)
    return t0, t1


def _series(obs: dict, var: str, n: int) -> pd.Series:
    # Prefer the measured set (x_set_1) over derived ones (x_set_1d).
    keys = sorted(k for k in obs if k.startswith(f"{var}_set_"))
    if not keys:
        return pd.Series([float("nan")] * n)
    return pd.to_numeric(pd.Series(obs[keys[0]]), errors="coerce")


def _to_f(s: pd.Series, unit: str) -> pd.Series:
    return s * 9 / 5 + 32 if "celsius" in unit.lower() else s


def _to_mph(s: pd.Series, unit: str) -> pd.Series:
    u = unit.lower()
    if "knot" in u:
        return s * 1.15078
    if "m/s" in u or "meters/second" in u:
        return s * 2.23694
    if "km" in u:
        return s / KM_PER_MILE
    return s


def _to_in(s: pd.Series, unit: str) -> pd.Series:
    u = unit.lower()
    if "millimeter" in u or u == "mm":
        return s / 25.4
    if "centimeter" in u:
        return s / 2.54
    return s


def parse_timeseries(payload: dict, tz: str) -> pd.DataFrame:
    """Timeseries -> DataFrame (valid local time, tmpf, wind, gust, p_* rain columns), °F/mph/in."""
    if not _check(payload) or not payload.get("STATION"):
        msg = payload.get("SUMMARY", {}).get("RESPONSE_MESSAGE", "no data returned")
        raise SynopticError(f"no observations ({msg})")
    obs = payload["STATION"][0].get("OBSERVATIONS", {})
    units = payload.get("UNITS", {})
    times = pd.to_datetime(pd.Series(obs.get("date_time", [])), utc=True)
    n = len(times)
    df = pd.DataFrame({
        "valid": times.dt.tz_convert(tz).dt.tz_localize(None),
        "tmpf": _to_f(_series(obs, "air_temp", n), units.get("air_temp", "")).values,
        "wind": _to_mph(_series(obs, "wind_speed", n), units.get("wind_speed", "")).values,
        "gust": _to_mph(_series(obs, "wind_gust", n), units.get("wind_gust", "")).values,
    })
    for col, var in PRECIP_VARS.items():
        df[col] = _to_in(_series(obs, var, n), units.get(var, "")).values
    return df.sort_values("valid").reset_index(drop=True)


def _hours_with(df: pd.DataFrame, col: str, index: pd.Index) -> pd.Series:
    d = df.dropna(subset=[col])
    return d.groupby(d["valid"].dt.date)["valid"].apply(lambda v: v.dt.floor("h").nunique()).reindex(index, fill_value=0)


def daily_precip(df: pd.DataFrame) -> pd.Series:
    """Daily rain (inches, local days) from whichever accumulation the gauge reports."""
    day = df["valid"].dt.date
    for col in PRECIP_VARS:
        if col not in df or df[col].notna().sum() == 0:
            continue
        d = df.dropna(subset=[col])
        dday = d["valid"].dt.date
        if col == "p_midnight":  # resets at local midnight: the day's maximum is the total
            totals = d.groupby(dday)[col].max()
        elif col == "p_accum":  # running counter: add up increases; drops are resets
            inc = d[col].diff()
            inc[(inc < 0) | (inc > 2.0)] = 0.0  # resets and implausible jumps
            totals = inc.fillna(0.0).groupby(dday).sum()
        elif col == "p_1h":  # rolling hourly total: take each clock hour's value once
            hourly = d.groupby(d["valid"].dt.floor("h"))[col].max()
            totals = hourly.groupby(hourly.index.date).sum()
        else:  # fixed short intervals: sum them
            totals = d.groupby(dday)[col].sum()
        index = pd.Index(sorted(set(day)), name="date")
        totals = totals.reindex(index)
        totals[_hours_with(df, col, index) < MIN_HOURS_PER_DAY] = float("nan")
        return totals.rename("precip")
    return pd.Series(dtype=float, name="precip")


def daily_from_obs(df: pd.DataFrame) -> pd.DataFrame:
    """Sub-hourly/hourly obs -> daily tmax, tmin, wind, gust, precip (needs 18+ hours of data per day)."""
    cols = ["tmax", "tmin", "wind", "gust", "precip"]
    if df.empty:
        return pd.DataFrame(columns=cols).rename_axis("date")
    # Many stations report gusts only when gusty; a blank gust means "no higher than sustained".
    df = df.assign(gust=df["gust"].fillna(df["wind"]))
    g = df.groupby(df["valid"].dt.date)
    out = pd.DataFrame({
        "tmax": g["tmpf"].max(), "tmin": g["tmpf"].min(),
        "wind": g["wind"].max(), "gust": g["gust"].max(),
    })
    out.loc[_hours_with(df, "tmpf", out.index) < MIN_HOURS_PER_DAY, ["tmax", "tmin"]] = float("nan")
    out.loc[_hours_with(df, "wind", out.index) < MIN_HOURS_PER_DAY, ["wind", "gust"]] = float("nan")
    out["precip"] = daily_precip(df).reindex(out.index)
    out.index.name = "date"
    return out[cols]


def fetch_daily(stid: str, start: date, end: date, tz: str, groups: frozenset) -> pd.DataFrame:
    """Daily observations (tmax, tmin, wind, gust, precip) for local dates start..end.

    Free accounts only return about the last 7 days; older days come back empty
    and are filled from the local archive (see stations.fetch_daily).
    """
    t0, t1 = _utc_bounds(start, end, tz)
    fmt = "%Y%m%d%H%M"
    payload = http.get_json(TIMESERIES_URL, _params(
        stid=stid, start=t0.strftime(fmt), end=t1.strftime(fmt), vars=TIMESERIES_VARS, units=UNITS_PARAM,
    ))
    daily = daily_from_obs(parse_timeseries(payload, tz))
    index = pd.Index([start + timedelta(days=i) for i in range((end - start).days + 1)], name="date")
    return daily.reindex(index)[["tmax", "tmin", "precip", "wind", "gust"]]


def diagnose(stid: str, start: date, end: date, tz: str) -> list[str]:
    """Human-readable summary of what Synoptic returns for one station (never prints the token)."""
    t0, t1 = _utc_bounds(start, end, tz)
    fmt = "%Y%m%d%H%M"
    try:
        payload = http.get_json(TIMESERIES_URL, _params(
            stid=stid, start=t0.strftime(fmt), end=t1.strftime(fmt), vars=TIMESERIES_VARS, units=UNITS_PARAM))
    except Exception as e:
        return [f"timeseries: request failed: {str(e).replace(synoptic_token() or '-', '***')}"]
    summary = payload.get("SUMMARY", {})
    lines = [f"timeseries: code {summary.get('RESPONSE_CODE')} — {summary.get('RESPONSE_MESSAGE')}",
             f"  units: {payload.get('UNITS')}"]
    for st in payload.get("STATION", [])[:1]:
        for key, vals in st.get("OBSERVATIONS", {}).items():
            if isinstance(vals, list):
                non_null = sum(v is not None for v in vals)
                lines.append(f"  {key}: {len(vals)} values, {non_null} non-empty, e.g. {(vals[0], vals[-1]) if vals else ()}")
        if summary.get("RESPONSE_CODE") == 1:
            try:
                daily = daily_from_obs(parse_timeseries(payload, tz))
                lines.append("  daily values the engine derives (blank = fewer than 18 hours of data that day):")
                lines += ["    " + ln for ln in daily.round(2).to_string().splitlines()]
            except Exception as e:
                lines.append(f"  could not derive daily values: {e}")
    return lines
