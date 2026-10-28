"""The ground around a place: what the wind crosses before it arrives.

Elevation is sampled on rings 25, 80 and 160 km out in 8 compass directions
(Open-Meteo's free elevation API, ~90 m Copernicus DEM; fetched once per place
and kept). That says whether a given wind comes down off mountains (drier,
warmer, gustier lee side), climbs from lower ground (more cloud and rain
upslope), or arrives over sea-level ground that may be open water.
"""

from __future__ import annotations

import math

import pandas as pd

from . import http, store
from .config import Location

ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"
DIRECTIONS = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}
DISTANCES_KM = (25, 80, 160)
HIGHER_M = 500  # terrain this much higher upwind counts as "mountains"
LOWER_M = 400
FT_PER_M = 3.28084


def _ft(m: float) -> str:
    return f"{round(m * FT_PER_M, -2):,.0f} ft"


def _offset(lat: float, lon: float, bearing_deg: float, km: float) -> tuple[float, float]:
    """Point `km` away on a bearing (spherical earth; plenty accurate at these distances)."""
    r = 6371.0
    b, p1, l1 = map(math.radians, (bearing_deg, lat, lon))
    p2 = math.asin(math.sin(p1) * math.cos(km / r) + math.cos(p1) * math.sin(km / r) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(km / r) * math.cos(p1), math.cos(km / r) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def ring(loc: Location) -> pd.DataFrame:
    rows = [{"dir": "C", "km": 0, "lat": loc.latitude, "lon": loc.longitude}]
    for name, bearing in DIRECTIONS.items():
        for km in DISTANCES_KM:
            lat, lon = _offset(loc.latitude, loc.longitude, bearing, km)
            rows.append({"dir": name, "km": km, "lat": round(lat, 4), "lon": round(lon, 4)})
    return pd.DataFrame(rows)


def fetch(loc: Location) -> pd.DataFrame:
    """dir, km, elevation (m) for the centre ("C") and the ring points; cached for a year."""
    def get() -> pd.DataFrame:
        pts = ring(loc)
        payload = http.get_json(ELEVATION_URL, {"latitude": ",".join(map(str, pts["lat"])),
                                                "longitude": ",".join(map(str, pts["lon"]))})
        return pts.assign(elevation=payload["elevation"])
    return store.cached_frame(f"terrain_{loc.latitude:.2f}_{loc.longitude:.2f}", 24 * 365, get)


def _sector(wind_from_deg: float) -> str:
    names = list(DIRECTIONS)
    return names[int(((wind_from_deg % 360) + 22.5) // 45) % 8]


def upwind(t: pd.DataFrame, wind_from_deg: float) -> dict:
    """What lies upwind: the sector, its highest/lowest ground relative to here, and whether it reaches sea level."""
    centre = float(t.loc[t["dir"] == "C", "elevation"].iloc[0])
    sector = _sector(wind_from_deg)
    s = t[t["dir"] == sector]
    return {"sector": sector, "rise": float(s["elevation"].max() - centre),
            "drop": float(centre - s["elevation"].min()),
            "sea_km": next((int(r.km) for r in s.sort_values("km").itertuples() if r.elevation <= 1), None)}


def describe_upwind(t: pd.DataFrame | None, wind_from_deg: float | None) -> str:
    if t is None or t.empty or wind_from_deg is None or pd.isna(wind_from_deg):
        return ""
    u = upwind(t, wind_from_deg)
    if u["sea_km"] is not None:
        return f"in off sea-level ground {u['sea_km'] * 0.621:.0f} miles away, likely open water (moist, mild air)"
    if u["rise"] >= HIGHER_M:
        return (f"down off high ground up to {_ft(u['rise'])} above here "
                f"(air coming down off it tends to be drier and warmer, often gusty)")
    if u["drop"] >= LOWER_M:
        return (f"up from ground {_ft(u['drop'])} lower "
                f"(air forced upward tends to bring more cloud and showers)")
    return "across fairly level ground"


def setting(t: pd.DataFrame | None) -> str:
    """One-line description of the place's surroundings (valley, ridge, coast, plain...)."""
    if t is None or t.empty:
        return ""
    centre = float(t.loc[t["dir"] == "C", "elevation"].iloc[0])
    near = t[t["km"] == DISTANCES_KM[0]]["elevation"]
    mid = t[t["km"] == DISTANCES_KM[1]]["elevation"]
    parts = []
    if (t[t["km"] <= DISTANCES_KM[1]]["elevation"] <= 1).any():
        parts.append("near the coast")
    if (near > centre + 150).sum() >= 5:
        parts.append("in a valley or basin (higher ground on most sides; cold air pools here on calm nights)")
    elif (near < centre - 150).sum() >= 5:
        parts.append("on high ground (exposed to wind; lower ground on most sides)")
    high = [d for d in DIRECTIONS if (t[(t["dir"] == d) & (t["km"] <= DISTANCES_KM[1])]["elevation"] - centre).max() >= HIGHER_M]
    if high:
        rise = (t[t["km"] <= DISTANCES_KM[1]]["elevation"] - centre).max()
        parts.append(f"high ground to the {', '.join(high)} (up to {_ft(rise)} above, within 50 miles)")
    return "; ".join(parts) or "on fairly open, level terrain"
