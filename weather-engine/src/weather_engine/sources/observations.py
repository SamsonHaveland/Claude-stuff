"""US station observations: nearest ASOS station (NWS API) and history (Iowa Mesonet)."""

from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from datetime import date, timedelta

import pandas as pd

from .. import http
from ..config import VAR_GROUPS, Location

NWS_POINTS_URL = "https://api.weather.gov/points/{lat:.4f},{lon:.4f}"
IEM_ASOS_URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"

KNOTS_TO_MPH = 1.15078
# Beyond these, a station is a poor stand-in for the location (see ARCHITECTURE.md).
MAX_STATION_DISTANCE_KM = 25.0
MAX_STATION_ELEVATION_DIFF_M = 150.0


@dataclass
class Station:
    id: str  # ICAO (KDEN) for airport stations, Synoptic STID otherwise
    name: str
    latitude: float
    longitude: float
    elevation: float | None  # metres
    distance_km: float
    source: str = "iem"  # "iem" (airport history via Iowa Mesonet) or "synoptic"
    network: str = "ASOS/AWOS"
    variables: frozenset = field(default_factory=lambda: frozenset(VAR_GROUPS))  # groups measured

    @property
    def key(self) -> str:
        return f"{self.source}:{self.id}"

    def quality_warnings(self, loc: Location) -> list[str]:
        warnings = []
        if self.distance_km > MAX_STATION_DISTANCE_KM:
            warnings.append(f"station {self.id} is {self.distance_km:.0f} km away")
        if loc.elevation is not None and self.elevation is not None:
            diff = abs(loc.elevation - self.elevation)
            if diff > MAX_STATION_ELEVATION_DIFF_M:
                warnings.append(f"station {self.id} elevation differs by {diff:.0f} m")
        return warnings


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def parse_nws_stations(payload: dict, loc: Location) -> list[Station]:
    stations = []
    for feat in payload.get("features", []):
        props, geom = feat["properties"], feat["geometry"]
        lon, lat = geom["coordinates"][:2]
        stations.append(Station(
            id=props["stationIdentifier"],
            name=props.get("name", ""),
            latitude=lat,
            longitude=lon,
            elevation=(props.get("elevation") or {}).get("value"),
            distance_km=haversine_km(loc.latitude, loc.longitude, lat, lon),
        ))
    # Only 4-letter ICAO ids are ASOS/AWOS stations with history at Iowa Mesonet.
    stations = [s for s in stations if len(s.id) == 4 and s.id.isalpha()]
    return sorted(stations, key=lambda s: s.distance_km)


def nearest_stations(loc: Location, n: int = 5) -> list[Station]:
    # Documented NWS flow: the point's metadata links to its forecast grid's station list.
    point = http.get_json(NWS_POINTS_URL.format(lat=loc.latitude, lon=loc.longitude))
    stations_url = point["properties"]["observationStations"]
    return parse_nws_stations(http.get_json(stations_url), loc)[:n]


def iem_station_id(icao: str) -> str:
    # Iowa Mesonet drops the leading K for contiguous-US stations (KDEN -> DEN).
    return icao[1:] if len(icao) == 4 and icao.startswith("K") else icao


def parse_iem_csv(text: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(text), na_values=["M", ""], comment="#")
    df["valid"] = pd.to_datetime(df["valid"])
    for col in ("tmpf", "sknt", "gust", "p01i"):
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def daily_from_hourly(df: pd.DataFrame, min_reports: int = 18) -> pd.DataFrame:
    """Hourly routine reports (local time) -> daily canonical variables.

    Daily high/low from hourly reports can miss the true extremes by ~1 °F;
    calibration learns against the same definition, so it stays consistent.
    """
    # ASOS only reports a gust when it is notably above the sustained wind, so a
    # blank gust means "no higher than sustained", not missing. Without this,
    # only gusty days would count and the gust climatology would skew high.
    df = df.assign(gust=df["gust"].fillna(df["sknt"]))
    g = df.groupby(df["valid"].dt.date)
    out = pd.DataFrame({
        "tmax": g["tmpf"].max(),
        "tmin": g["tmpf"].min(),
        "precip": g["p01i"].sum(min_count=1),
        "wind": g["sknt"].max() * KNOTS_TO_MPH,
        "gust": g["gust"].max() * KNOTS_TO_MPH,
    })
    out.loc[g["tmpf"].count() < min_reports, ["tmax", "tmin"]] = float("nan")
    out.loc[g["p01i"].count() < min_reports, "precip"] = float("nan")
    out.loc[g["sknt"].count() < min_reports, ["wind", "gust"]] = float("nan")
    out.index.name = "date"
    return out


def fetch_daily(station: str, start: date, end: date, tz: str) -> pd.DataFrame:
    """Daily observations for local dates start..end inclusive."""
    stop = end + timedelta(days=1)
    params = [
        ("station", iem_station_id(station)),
        *[("data", d) for d in ("tmpf", "sknt", "gust", "p01i")],
        ("year1", start.year), ("month1", start.month), ("day1", start.day),
        ("year2", stop.year), ("month2", stop.month), ("day2", stop.day),
        ("tz", tz),
        ("format", "onlycomma"),
        ("missing", "M"),
        ("trace", "0.0001"),
        ("report_type", "3"),  # routine hourly reports only; avoids double-counting rain
    ]
    df = parse_iem_csv(http.get_text(IEM_ASOS_URL, params))
    daily = daily_from_hourly(df)
    return daily[(daily.index >= start) & (daily.index <= end)]
