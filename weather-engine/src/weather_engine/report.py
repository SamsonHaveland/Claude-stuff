"""Render a forecast as a terminal table, a standalone HTML page, or JSON for the web app."""

from __future__ import annotations

import html
from pathlib import Path

import pandas as pd

from .config import BASELINE_MODEL, GROUP_LABELS, LABELS, REPORTS_DIR, UNITS, VARIABLES
from .forecast import ForecastResult, baseline


def _rows(result: ForecastResult) -> list[dict]:
    wide = {
        col: result.blend.pivot_table(index="date", columns="var", values=col)
        for col in ("value", "low", "high")
    }
    leads = result.blend.groupby("date")["lead"].first()
    base = baseline(result)
    rows = []
    for d in wide["value"].index:
        def cell(var: str, digits: int = 0):
            v = wide["value"].get(var, pd.Series(dtype=float)).get(d)
            if v is None or pd.isna(v):
                return None
            lo, hi = wide["low"][var][d], wide["high"][var][d]
            return {"value": round(v, digits), "low": round(lo, digits), "high": round(hi, digits)}

        prob = result.rain_prob["rain_prob"].get(d) if not result.rain_prob.empty else None
        rows.append({
            "date": d,
            "lead": int(leads[d]),
            "tmax": cell("tmax"),
            "tmin": cell("tmin"),
            "precip": cell("precip", 2),
            "rain_prob": None if prob is None or pd.isna(prob) else round(100 * prob),
            "wind": cell("wind"),
            "gust": cell("gust"),
            "baseline_tmax": float(base["tmax"][d]) if "tmax" in base and d in base.index and pd.notna(base["tmax"][d]) else None,
        })
    return rows


def _fmt(c: dict | None, unit: str = "", ranged: bool = True) -> str:
    if not c:
        return "—"
    s = f"{c['value']:g}{unit}"
    if ranged and c["low"] != c["high"]:
        s += f" ({c['low']:g}–{c['high']:g})"
    return s


def attribution(result: ForecastResult) -> str:
    names = {"synoptic": "Synoptic Data (MesoWest)", "acis": "NOAA RCC-ACIS", "iem": "NWS / Iowa Environmental Mesonet"}
    used = list(dict.fromkeys(names[s.source] for s in result.stations.values())) or [names["iem"]]
    return f"Weather data by Open-Meteo.com (CC BY 4.0); observations via {', '.join(used)}."


def _is_calibrated(result: ForecastResult) -> bool:
    return result.stats is not None and bool(result.stats["mae_cal"].notna().any())


def _status(result: ForecastResult) -> str:
    if not _is_calibrated(result):
        return "UNCALIBRATED: blend of raw models (no usable local observation history)"
    by_station: dict[str, list[str]] = {}
    for group, s in result.stations.items():
        hour = result.end_hours.get(group, 24)
        window = "" if hour == 24 else f", daily readings at {hour % 12 or 12} {'am' if hour < 12 else 'pm'}"
        by_station.setdefault(f"{s.id} ({s.name}, {s.distance_km:.0f} km away{window})", []).append(GROUP_LABELS[group])
    parts = [f"{', '.join(groups)}: {desc}" for desc, groups in by_station.items()]
    return "Calibrated against " + "; ".join(parts)


def calibration_rows(result: ForecastResult) -> list[dict]:
    """Per variable: how far off the raw models were here, and how much correcting helped."""
    if not _is_calibrated(result):
        return []
    s = result.stats.dropna(subset=["mae_cal"])
    rows = []
    for var in [v for v in VARIABLES if v in set(s["var"])]:
        g, unit = s[s["var"] == var], UNITS[var]
        if var == "precip":
            shift = f"amounts scaled ×{g['ratio'].mean():.2f}"
        else:
            b = g["bias"].mean()
            shift = f"models ran {abs(b):.1f} {unit} too {'high' if b > 0 else 'low'}"
        rows.append({
            "var": var, "label": LABELS[var], "unit": unit, "shift": shift, "days": int(g["n"].max()),
            "error_before": round(float(g["mae_raw"].mean()), 1),
            "error_after": round(float(g["mae_cal"].mean()), 1),
        })
    return rows


def calibration_summary(result: ForecastResult) -> list[str]:
    rows = calibration_rows(result)
    if not rows:
        return []
    days = max(r["days"] for r in rows)
    ids = ", ".join(dict.fromkeys(s.id for s in result.stations.values()))
    lines = [f"Calibration (last {days} days at {ids}, all models and lead days):"]
    for r in rows:
        lines.append(
            f"  {r['label']:<6} {r['shift']}; typical error {r['error_before']:.1f} → "
            f"{r['error_after']:.1f} {r['unit']} after correction"
        )
    lines.append("  (errors measured on the same days used for correction, so slightly optimistic;"
                 " `weather-engine verify` gives the true score)")
    return lines


def pattern_rows(result: ForecastResult) -> dict:
    """Per date: the weather pattern in words, what lies upwind, and what the pattern correction changed."""
    p = result.patterns
    if p is None or p.empty:
        return {}
    out = {}
    for d, row in p.iterrows():
        shifts = {}
        for var in VARIABLES:
            v = row.get(f"shift_{var}")
            if v is not None and pd.notna(v) and abs(v) >= (0.005 if var == "precip" else 0.3):
                shifts[var] = round(float(v), 2 if var == "precip" else 1)
        n = row.get("similar_days")
        out[d] = {"summary": row["summary"], "upwind": row.get("upwind") or "",
                  "shifts": shifts, "similar_days": None if n is None or pd.isna(n) else int(round(n))}
    return out


def pattern_status(result: ForecastResult) -> dict:
    """Which variables get weather-pattern corrections here, and how much they helped in testing."""
    from . import terrain

    pm = result.pattern
    info = {"setting": terrain.setting(result.terrain), "active": [], "tested": False}
    if pm is not None and not pm.cv.empty:
        info["tested"] = True
        for r in pm.cv.itertuples():
            if pm.active(r.var):
                info["active"].append({"var": r.var, "label": LABELS.get(r.var, r.var),
                                       "gain_pct": round(100 * r.gain), "days": int(r.days)})
    return info


def _shift_text(shifts: dict) -> str:
    parts = []
    for var, v in shifts.items():
        if var == "precip":
            parts.append(f"rain {v:+.2f} in")
        else:
            parts.append(f"{LABELS[var].lower()} {v:+.0f}{'°' if var in ('tmax', 'tmin') else ' mph'}")
    return ", ".join(parts)


def pattern_summary(result: ForecastResult) -> list[str]:
    rows, status = pattern_rows(result), pattern_status(result)
    if not rows:
        return []
    lines = ["Weather pattern by day" + (f" (this place: {status['setting']})" if status["setting"] else "") + ":"]
    for d, r in rows.items():
        line = f"  {d:%a %b %d}: {r['summary'] or 'pattern unclear'}"
        if r["upwind"]:
            line += f", {r['upwind']}"
        if r["shifts"]:
            line += f" → adjusted {_shift_text(r['shifts'])} (from ~{r['similar_days']} similar past days here)"
        lines.append(line)
    if status["active"]:
        lines.append("  Pattern corrections on for " + ", ".join(
            f"{a['label'].lower()} ({a['gain_pct']}% smaller error in testing)" for a in status["active"]))
    elif status["tested"]:
        lines.append("  Pattern corrections tested here but didn't beat the plain correction yet, so they're off.")
    return lines


def nowcast_summary(result: ForecastResult) -> list[str]:
    lines = []
    for a in result.nowcast:
        unit = "°F" if a["var"] == "temp" else " mph"
        what = "temperature" if a["var"] == "temp" else "wind"
        lines.append(f"Right now at {a['station']} ({a['time'][11:]}): {what} {a['observed']:g}{unit} vs models "
                     f"{a['model']:g}{unit}; the next hours are nudged toward the reading, fading over ~12 h.")
    return lines


def to_text(result: ForecastResult) -> str:
    loc = result.location
    lines = [
        f"{loc.name}  ({loc.latitude:.3f}, {loc.longitude:.3f})",
        f"Issued {result.issued_at:%Y-%m-%d %H:%M} UTC · {_status(result)}",
        "Ranges show the spread between corrected models; wider = less certain.",
        "",
        f"{'Date':<12}{'High':<16}{'Low':<16}{'Rain':<18}{'Chance':<8}{'Wind':<14}{'Gusts':<10}",
    ]
    for r in _rows(result):
        chance = "—" if r["rain_prob"] is None else f"{r['rain_prob']}%"
        lines.append(
            f"{r['date']:%a %b %d}  "
            f"{_fmt(r['tmax'], '°'):<16}{_fmt(r['tmin'], '°'):<16}"
            f"{_fmt(r['precip'], '″'):<18}{chance:<8}"
            f"{_fmt(r['wind'], '', False) + ' mph':<14}{_fmt(r['gust'], '', False) + ' mph':<10}"
        )
    details, _ = _detail(result)
    if details:
        lines += ["", "Details:"]
        for d, info in details.items():
            lines.append(f"  {d:%a %b %d}: {_detail_line(info)}")
    for block in (pattern_summary(result), nowcast_summary(result), calibration_summary(result)):
        if block:
            lines += [""] + block
    if result.notes:
        lines += ["", "Notes:"] + [f"  - {n}" for n in result.notes]
    lines += ["", attribution(result)]
    return "\n".join(lines)


def to_html(result: ForecastResult, path: Path | None = None) -> Path:
    loc = result.location
    path = path or REPORTS_DIR / f"{loc.slug}_{result.issued_at:%Y%m%d_%H%M}.html"
    body = []
    for r in _rows(result):
        chance = "—" if r["rain_prob"] is None else f"{r['rain_prob']}%"
        base = r["baseline_tmax"]
        body.append(
            "<tr>"
            f"<td>{r['date']:%a %b %d}</td>"
            f"<td>{html.escape(_fmt(r['tmax'], '°'))}</td>"
            f"<td>{html.escape(_fmt(r['tmin'], '°'))}</td>"
            f"<td>{html.escape(_fmt(r['precip'], ' in'))}</td>"
            f"<td>{chance}</td>"
            f"<td>{html.escape(_fmt(r['wind'], ' mph', False))}</td>"
            f"<td>{html.escape(_fmt(r['gust'], ' mph', False))}</td>"
            f"<td class=muted>{'—' if base is None or pd.isna(base) else f'{base:.0f}°'}</td>"
            "</tr>"
        )
    notes = "".join(f"<li>{html.escape(n)}</li>" for n in result.notes)
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(loc.name)} Forecast</title>
<style>
:root {{ --bg:#fafaf9; --fg:#1c1917; --muted:#78716c; --line:#e7e5e4; --accent:#0369a1; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#1c1917; --fg:#f5f5f4; --muted:#a8a29e; --line:#44403c; --accent:#7dd3fc; }} }}
body {{ background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; margin:0; padding:24px 16px; }}
main {{ max-width:960px; margin:0 auto; }}
h1 {{ font-size:1.5rem; margin:0 0 4px; }}
.muted {{ color:var(--muted); }}
.wrap {{ overflow-x:auto; }}
table {{ border-collapse:collapse; width:100%; margin-top:16px; font-variant-numeric:tabular-nums; }}
th, td {{ text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); white-space:nowrap; }}
th {{ font-weight:600; color:var(--muted); font-size:.85rem; }}
.status {{ color:var(--accent); }}
</style></head>
<body><main>
<h1>{html.escape(loc.name)}</h1>
<div class=muted>{loc.latitude:.3f}, {loc.longitude:.3f} · issued {result.issued_at:%Y-%m-%d %H:%M} UTC</div>
<div class=status>{html.escape(_status(result))}</div>
<div class=wrap><table>
<tr><th>Date</th><th>High</th><th>Low</th><th>Rain</th><th>Chance</th><th>Wind</th><th>Gusts</th><th>Raw {BASELINE_MODEL} high</th></tr>
{''.join(body)}
</table></div>
<p class=muted>Ranges show the spread between corrected models; wider means less certain.</p>
{f'<h2>Notes</h2><ul>{notes}</ul>' if notes else ''}
<p class=muted>Weather data by <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0); observations via NWS / Iowa Environmental Mesonet.</p>
</main></body></html>
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(page)
    return path


def scores_to_text(scores: pd.DataFrame) -> str:
    if scores.empty:
        return "Nothing to verify yet: forecasts need a station and at least one past target date."
    lines = []
    for var, g in scores.groupby("var"):
        unit = UNITS.get(var, "")
        lines.append(f"\n{var} — mean absolute error ({unit}), lower is better")
        t = g.pivot_table(index="lead", columns="source", values="mae").round(2)
        lines.append(t.to_string())
    return "\n".join(lines)


def backtest_to_text(summary: pd.DataFrame) -> str:
    """Backtest table: error of each method per variable and lead band, plus the improvement."""
    if summary.empty:
        return "Not enough history to backtest yet."
    names = {"ecmwf": "ECMWF raw", "mean": "All-model avg", "plain": "Bias-corrected", "pattern": "+ Pattern"}
    lines = ["Mean absolute error on replayed days (lower is better):"]
    order = [v for v in LABELS if v in set(summary["var"])]
    for var in order:
        g = summary[summary["var"] == var]
        unit = UNITS.get(var, "")
        lines.append(f"\n{LABELS.get(var, var)} ({unit})")
        lines.append(f"  {'lead':<9}{'days':>5}" + "".join(f"{names[m]:>16}" for m in names) + f"{'vs ECMWF':>11}")
        for _, r in g.iterrows():
            gain = f"{(1 - r['pattern'] / r['ecmwf']) * 100:>+10.0f}%" if r["ecmwf"] > 1e-6 else f"{'—':>11}"
            digits = 3 if var == "precip" else 1
            lines.append(f"  {r['leads']:<9}{r['n']:>5}" + "".join(f"{r[m]:>16.{digits}f}" for m in names) + gain)
    lines.append("\n'vs ECMWF' = how much smaller the engine's error is than the raw ECMWF model's.")
    if (summary["pattern_days"] == 0).all():
        lines.append("Pattern corrections weren't active yet (they need about 90 days of history at this place).")
    return "\n".join(lines)


def _detail(result: ForecastResult) -> tuple[dict, dict]:
    """(per-date day details, per-date hourly timeline) or empty dicts without hourly data."""
    if result.hourly is None or result.hourly.empty:
        return {}, {}
    from zoneinfo import ZoneInfo

    from . import detail

    now = None
    if result.location.timezone:
        now = pd.Timestamp(result.issued_at.astimezone(ZoneInfo(result.location.timezone)).replace(tzinfo=None))
    return detail.day_details(result.hourly, result.sun), detail.timeline(result.hourly, now)


def _detail_line(d: dict) -> str:
    parts = []
    kind = d["precip_type"] or "rain"
    if d["rain_windows"]:
        parts.append(f"{kind} likely {', '.join(d['rain_windows'])}")
    if d["rain_possible"]:
        parts.append(f"{kind} possible {', '.join(d['rain_possible'])}")
    if d["thunder"] and kind != "thunderstorms":
        parts.append("thunder risk")
    if d["wind_from"]:
        parts.append(f"wind from {d['wind_from']}" + (f", gusts peak ~{d['gust_peak_time']}" if d["gust_peak_time"] else ""))
    if d["sky"]:
        parts.append(d["sky"].lower())
    if d["humidity_min"] is not None:
        parts.append(f"humidity {d['humidity_min']}–{d['humidity_max']}%")
    if d["feels_min"] is not None:
        parts.append(f"feels {d['feels_min']}–{d['feels_max']}°")
    if d["sunrise"]:
        parts.append(f"sun {d['sunrise']}–{d['sunset']}")
    return "; ".join(parts)


def to_dict(result: ForecastResult) -> dict:
    """JSON-ready forecast for the web app."""
    loc, stn = result.location, result.station
    details, hours = _detail(result)
    patterns = pattern_rows(result)
    days = [{**r, "date": r["date"].isoformat(), "detail": details.get(r["date"]), "hours": hours.get(r["date"]),
             "pattern": patterns.get(r["date"])}
            for r in _rows(result)]
    return {
        "location": {"name": loc.name, "latitude": loc.latitude, "longitude": loc.longitude,
                     "timezone": loc.timezone},
        "issued_at": result.issued_at.isoformat(timespec="seconds"),
        "calibrated": _is_calibrated(result),
        "status": _status(result),
        "station": None if stn is None else {
            "id": stn.id, "name": stn.name, "distance_km": round(stn.distance_km, 1)},
        "station_rejected": result.station_rejected,
        "stations": [
            {"group": g, "label": GROUP_LABELS[g], "id": s.id, "name": s.name,
             "distance_km": round(s.distance_km, 1), "network": s.network}
            for g, s in result.stations.items()
        ],
        "units": UNITS,
        "days": days,
        "calibration": calibration_rows(result),
        "patterns": pattern_status(result),
        "history": result.history,
        "nowcast": result.nowcast,
        "notes": result.notes,
        "baseline_model": BASELINE_MODEL,
        "attribution": attribution(result),
    }
