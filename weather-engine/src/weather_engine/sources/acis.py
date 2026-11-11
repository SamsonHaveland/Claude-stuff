"""ACIS (NOAA Regional Climate Centers): decades of daily temperature and rain, free, no account.

Covers NWS Cooperative Observer (COOP) stations, CoCoRaHS volunteer rain gauges
and airports. Volunteers read their instruments once a day at a fixed time
(often 7 am), so each daily value covers the 24 hours ending at that time.
The engine compares it with the forecast for exactly that window
(openmeteo.aggregate_windows), never a shifted calendar day. Days whose
observation time is unknown or differs from the station's usual time are dropped.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

import pandas as pd

from .. import http
from ..config import Location
from .observations import Station, haversine_km

STN_META_URL = "https://data.rcc-acis.org/StnMeta"
STN_DATA_URL = "https://data.rcc-acis.org/StnData"

FT_TO_M = 0.3048
ACTIVE_WITHIN_DAYS = 30
# Reading times the engine can align exactly; anything else is skipped.
VALID_HOURS = set(range(1, 25))


def _network(sids: list[str]) -> tuple[str, str]:
    """(display id, network name) from ACIS station ids like '264950 2' or 'NV-CL-12 10'."""
    by_type = {}
    for sid in sids or []:
        ident, _, typ = sid.rpartition(" ")
        by_type.setdefault(typ, ident)
    for typ, name in (("10", "CoCoRaHS"), ("2", "NWS COOP"), ("5", "Airport"), ("3", "Airport"), ("6", "GHCN")):
        if typ in by_type:
            return by_type[typ], name
    first = (sids or ["?"])[0].rpartition(" ")[0] or "?"
    return first, "ACIS"


def parse_meta(payload: dict, loc: Location, today: date) -> list[Station]:
    """StnMeta response -> stations with currently reporting temperature and/or rain."""
    if "error" in payload:
        raise RuntimeError(f"ACIS: {payload['error']}")
    cutoff = (today - timedelta(days=ACTIVE_WITHIN_DAYS)).isoformat()
    stations = []
    for st in payload.get("meta", []):
        ll = st.get("ll")
        if not ll or st.get("uid") is None:
            continue
        lon, lat = float(ll[0]), float(ll[1])
        ranges = st.get("valid_daterange") or []
        # elems requested in this order: maxt, mint, pcpn
        active = [bool(r) and len(r) == 2 and r[1] >= cutoff for r in ranges] + [False] * 3
        groups = set()
        if active[0] and active[1]:
            groups.add("temp")
        if active[2]:
            groups.add("precip")
        if not groups:
            continue
        ident, network = _network(st.get("sids", []))
        elev_ft = st.get("elev")
        stations.append(Station(
            id=ident,
            name=str(st.get("name", "")).title(),
            latitude=lat,
            longitude=lon,
            elevation=None if elev_ft in (None, "") else float(elev_ft) * FT_TO_M,
            distance_km=haversine_km(loc.latitude, loc.longitude, lat, lon),
            source="acis",
            network=network,
            variables=frozenset(groups),
            ref=str(st["uid"]),
        ))
    return sorted(stations, key=lambda s: s.distance_km)


def find_stations(loc: Location, radius_km: float, today: date | None = None) -> list[Station]:
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(math.cos(math.radians(loc.latitude)), 0.1))
    params = {
        "bbox": f"{loc.longitude - dlon:.3f},{loc.latitude - dlat:.3f},{loc.longitude + dlon:.3f},{loc.latitude + dlat:.3f}",
        "meta": "name,ll,elev,uid,sids,valid_daterange",
        "elems": "maxt,mint,pcpn",
    }
    found = parse_meta(http.post_json(STN_META_URL, params), loc, today or date.today())
    return [s for s in found if s.distance_km <= radius_km]


def _value(cell) -> tuple[float | None, int | None]:
    """ACIS cell [value, obs_hour] -> (number or None, hour or None).

    'M' missing, 'S' (amount included in a later report) and values flagged
    'A' (multi-day accumulation) are unusable for daily comparison; 'T'
    (trace) is 0.
    """
    if isinstance(cell, list):
        raw, hour = (cell + [None, None])[:2]
    else:
        raw, hour = cell, None
    try:
        hour = int(hour) if hour not in (None, "", -1, "-1") else None
    except (TypeError, ValueError):
        hour = None
    raw = str(raw).strip()
    if raw in ("", "M", "S") or raw.endswith("A"):
        return None, hour
    if raw == "T":
        return 0.0, hour
    try:
        return float(raw), hour
    except ValueError:
        return None, hour


def parse_data(payload: dict) -> pd.DataFrame:
    """StnData -> daily DataFrame indexed by date with tmax, tmin, precip and obs_hour.

    The observation hour is the station's usual (most common) reading time;
    days read at a different or unknown time are dropped, so every kept day
    covers the same 24-hour window.
    """
    if "error" in payload:
        raise RuntimeError(f"ACIS: {payload['error']}")
    rows = []
    for rec in payload.get("data", []):
        d = date.fromisoformat(rec[0])
        vals = [_value(c) for c in rec[1:4]]
        rows.append({"date": d, "tmax": vals[0][0], "tmin": vals[1][0], "precip": vals[2][0],
                     "h_temp": vals[0][1] if vals[0][1] is not None else vals[1][1], "h_precip": vals[2][1]})
    cols = ["tmax", "tmin", "precip", "obs_hour_temp", "obs_hour_precip"]
    if not rows:
        return pd.DataFrame(columns=cols).rename_axis("date")
    df = pd.DataFrame(rows).set_index("date")
    out = pd.DataFrame(index=df.index)
    for group, value_cols, hcol in (("temp", ["tmax", "tmin"], "h_temp"), ("precip", ["precip"], "h_precip")):
        hours = df[hcol].where(df[value_cols[0]].notna())
        usual = hours.mode()
        usual = int(usual.iloc[0]) if not usual.empty else None
        keep = (hours == usual) & (usual in VALID_HOURS) if usual is not None else pd.Series(False, index=df.index)
        for c in value_cols:
            out[c] = pd.to_numeric(df[c], errors="coerce").where(keep)
        out[f"obs_hour_{group}"] = usual if usual in VALID_HOURS else None
    return out[cols]


def fetch_daily(uid: str, start: date, end: date) -> pd.DataFrame:
    params = {
        "uid": int(uid),
        "sdate": start.isoformat(),
        "edate": end.isoformat(),
        "elems": [{"name": n, "add": "t"} for n in ("maxt", "mint", "pcpn")],
    }
    return parse_data(http.post_json(STN_DATA_URL, params))
