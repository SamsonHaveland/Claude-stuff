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
PRECIP_URL = f"{BASE_URL}/stations/precipitation"

KM_PER_MILE = 1.609344
FT_TO_M = 0.3048
UNITS_PARAM = "temp|F,speed|mph,precip|in"
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
    """Timeseries -> DataFrame (valid local time, tmpf, wind, gust), mph/°F."""
    if not _check(payload) or not payload.get("STATION"):
        msg = payload.get("SUMMARY", {}).get("RESPONSE_MESSAGE", "no data returned")
        raise SynopticError(f"no observations ({msg})")
    obs = payload["STATION"][0].get("OBSERVATIONS", {})
    units = payload.get("UNITS", {})
    times = pd.to_datetime(pd.Series(obs.get("date_time", [])), utc=True)
    n = len(times)
    return pd.DataFrame({
        "valid": times.dt.tz_convert(tz).dt.tz_localize(None),
        "tmpf": _to_f(_series(obs, "air_temp", n), units.get("air_temp", "")).values,
        "wind": _to_mph(_series(obs, "wind_speed", n), units.get("wind_speed", "")).values,
        "gust": _to_mph(_series(obs, "wind_gust", n), units.get("wind_gust", "")).values,
    })


def daily_from_obs(df: pd.DataFrame) -> pd.DataFrame:
    """Sub-hourly/hourly obs -> daily tmax, tmin, wind, gust (needs 18+ hours of data per day)."""
    if df.empty:
        return pd.DataFrame(columns=["tmax", "tmin", "wind", "gust"]).rename_axis("date")
    # Many stations report gusts only when gusty; a blank gust means "no higher than sustained".
    df = df.assign(gust=df["gust"].fillna(df["wind"]), hour=df["valid"].dt.floor("h"))
    g = df.groupby(df["valid"].dt.date)

    def hours(col: str) -> pd.Series:
        return df.dropna(subset=[col]).groupby(df["valid"].dt.date)["hour"].nunique().reindex(g.size().index, fill_value=0)

    out = pd.DataFrame({
        "tmax": g["tmpf"].max(), "tmin": g["tmpf"].min(),
        "wind": g["wind"].max(), "gust": g["gust"].max(),
    })
    out.loc[hours("tmpf") < MIN_HOURS_PER_DAY, ["tmax", "tmin"]] = float("nan")
    out.loc[hours("wind") < MIN_HOURS_PER_DAY, ["wind", "gust"]] = float("nan")
    out.index.name = "date"
    return out


def parse_daily_precip(payload: dict, start: date) -> pd.Series:
    """Precipitation service in 24-hour intervals starting at local midnight -> inches per date."""
    if not _check(payload) or not payload.get("STATION"):
        msg = payload.get("SUMMARY", {}).get("RESPONSE_MESSAGE", "no data returned")
        raise SynopticError(f"no precipitation ({msg})")
    units = payload.get("UNITS", {})
    intervals = payload["STATION"][0].get("OBSERVATIONS", {}).get("precipitation", [])
    values = {}
    for i, iv in enumerate(intervals):
        idx = int(iv.get("interval", i + 1)) - 1
        total = _num(iv.get("total"))
        if total is None or not iv.get("count"):
            continue
        values[start + timedelta(days=idx)] = total
    s = _to_in(pd.Series(values, dtype=float), units.get("precipitation", units.get("precip", "")))
    s.index.name = "date"
    return s.rename("precip")


def fetch_daily(stid: str, start: date, end: date, tz: str, groups: frozenset) -> pd.DataFrame:
    """Daily observations (tmax, tmin, wind, gust, precip) for local dates start..end."""
    t0, t1 = _utc_bounds(start, end, tz)
    fmt = "%Y%m%d%H%M"
    out = pd.DataFrame(index=pd.Index([start + timedelta(days=i) for i in range((end - start).days + 1)], name="date"))
    errors = []
    if groups & {"temp", "wind"}:
        try:
            payload = http.get_json(TIMESERIES_URL, _params(
                stid=stid, start=t0.strftime(fmt), end=t1.strftime(fmt),
                vars="air_temp,wind_speed,wind_gust", units=UNITS_PARAM,
            ))
            out = out.join(daily_from_obs(parse_timeseries(payload, tz)))
        except Exception as e:
            errors.append(f"temp/wind: {e}")
    if "precip" in groups:
        try:
            payload = http.get_json(PRECIP_URL, _params(
                stid=stid, start=t0.strftime(fmt), end=t1.strftime(fmt),
                pmode="intervals", interval="24", units=UNITS_PARAM,
            ))
            out = out.join(parse_daily_precip(payload, start))
        except Exception as e:
            errors.append(f"rain: {e}")
    if errors and len(errors) == len([g for g in (groups & {"temp", "wind"}, groups & {"precip"}) if g]):
        raise SynopticError("; ".join(errors))
    out.attrs["errors"] = errors
    for col in ("tmax", "tmin", "precip", "wind", "gust"):
        if col not in out:
            out[col] = float("nan")
    return out[["tmax", "tmin", "precip", "wind", "gust"]]


def diagnose(stid: str, start: date, end: date, tz: str) -> list[str]:
    """Human-readable summary of what Synoptic returns for one station (never prints the token)."""
    t0, t1 = _utc_bounds(start, end, tz)
    fmt = "%Y%m%d%H%M"
    lines = []
    for label, url, extra in (
        ("timeseries", TIMESERIES_URL, {"vars": "air_temp,wind_speed,wind_gust"}),
        ("precipitation", PRECIP_URL, {"pmode": "intervals", "interval": "24"}),
    ):
        try:
            payload = http.get_json(url, _params(stid=stid, start=t0.strftime(fmt), end=t1.strftime(fmt),
                                                 units=UNITS_PARAM, **extra))
        except Exception as e:
            lines.append(f"{label}: request failed: {str(e).replace(synoptic_token() or '-', '***')}")
            continue
        summary = payload.get("SUMMARY", {})
        lines.append(f"{label}: code {summary.get('RESPONSE_CODE')} — {summary.get('RESPONSE_MESSAGE')}")
        lines.append(f"  units: {payload.get('UNITS')}")
        for st in payload.get("STATION", [])[:1]:
            obs = st.get("OBSERVATIONS", {})
            for key, vals in obs.items():
                if isinstance(vals, list):
                    non_null = sum(v is not None for v in vals)
                    sample = vals[:2] if key == "precipitation" else (vals[0], vals[-1]) if vals else ()
                    lines.append(f"  {key}: {len(vals)} values, {non_null} non-empty, e.g. {sample}")
    return lines
