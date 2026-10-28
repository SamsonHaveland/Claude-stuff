"""Terrain descriptions from the elevation ring (synthetic elevations)."""

import pandas as pd

from weather_engine import terrain
from weather_engine.config import Location


def ground(west=2400.0, east=1300.0, centre=1609.0, sea_south=False):
    pts = terrain.ring(Location("X", 39.74, -104.99))
    elev = []
    for r in pts.itertuples():
        if r.dir == "C":
            elev.append(centre)
        elif sea_south and r.dir == "S" and r.km >= 80:
            elev.append(0.0)
        else:
            elev.append(west if "W" in r.dir else east if "E" in r.dir else centre)
    return pts.assign(elevation=elev)


def test_ring_points_are_where_they_should_be():
    pts = terrain.ring(Location("X", 40.0, -105.0)).set_index(["dir", "km"])
    assert abs(pts.loc[("N", 80), "lat"] - (40 + 80 / 111.2)) < 0.01
    assert abs(pts.loc[("E", 25), "lat"] - 40.0) < 0.01 and pts.loc[("E", 25), "lon"] > -105


def test_upwind_wording():
    t = ground(sea_south=True)
    assert "down off high ground" in terrain.describe_upwind(t, 270)  # west wind off the mountains
    assert "up from ground" not in terrain.describe_upwind(t, 90)
    assert "open water" in terrain.describe_upwind(t, 180)
    assert terrain.describe_upwind(t, None) == ""
    assert "high ground to the" in terrain.setting(t) and "coast" in terrain.setting(t)


def test_setting_valley():
    t = ground(west=2000.0, east=2000.0)
    t.loc[t["dir"].isin(["N", "S"]), "elevation"] = 2000.0
    assert "valley or basin" in terrain.setting(t)
