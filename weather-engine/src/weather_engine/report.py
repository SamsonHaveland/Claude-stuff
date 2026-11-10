"""Write verification results and forecasts to reports/ as Markdown and CSV."""

from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

from .engine import BUCKET_LABELS
from .records import PRECIP, PRECIP_PROB, TEMPERATURE, WIND, Forecast
from .timeutil import fmt
from .verify import Results

UNITS = {TEMPERATURE: "°C", WIND: "m/s", PRECIP: "mm/h"}


def _rows(results: Results):
    for (source, variable, bucket), p in sorted(results.paired.items(), key=lambda kv: (kv[0][1], kv[0][2], kv[0][0])):
        yield {
            "variable": variable,
            "lead": BUCKET_LABELS[bucket],
            "baseline": source,
            "cases": p.n,
            "baseline_mae": round(p.src_mae, 3),
            "engine_mae": round(p.eng_mae, 3),
            "baseline_rmse": round(p.src_rmse, 3),
            "engine_rmse": round(p.eng_rmse, 3),
            "baseline_bias": round(p.src_err / p.n, 3),
            "engine_bias": round(p.eng_err / p.n, 3),
            "skill_pct": round(100 * p.skill, 1),
            "baseline_wetdry_pct": round(100 * p.src_wet_ok / p.n, 1) if variable == PRECIP else "",
            "engine_wetdry_pct": round(100 * p.eng_wet_ok / p.n, 1) if variable == PRECIP else "",
        }


def overall(results: Results) -> dict[tuple[str, str], tuple[int, float]]:
    """(baseline, variable) -> (cases, skill) pooled over all lead times."""
    pooled: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0, 0.0, 0.0])
    for (source, variable, _), p in results.paired.items():
        acc = pooled[(source, variable)]
        acc[0] += p.n
        acc[1] += p.src_abs
        acc[2] += p.eng_abs
    return {k: (int(n), 1 - e / s if s else 0.0) for k, (n, s, e) in pooled.items()}


def write_verification(results: Results, out_dir: Path, name: str, title: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = list(_rows(results))
    csv_path = out_dir / f"{name}.csv"
    if rows:
        with open(csv_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    lines = [f"# {title}", ""]
    if not rows:
        lines.append("No scored cases yet: forecasts and observations don't overlap.")
    else:
        lines += [
            "Skill = how much smaller the engine's mean absolute error is than the "
            "baseline's on the same cases. Positive = engine better.",
            "",
            "## Overall",
            "",
            "| Baseline | Variable | Cases | Engine skill |",
            "|---|---|---:|---:|",
        ]
        for (source, variable), (n, skill) in sorted(overall(results).items(), key=lambda kv: (kv[0][1], kv[0][0])):
            lines.append(f"| {source} | {variable} | {n} | {100 * skill:+.1f}% |")
        lines += [
            "",
            "## By lead time",
            "",
            "| Variable | Lead | Baseline | Cases | Baseline MAE | Engine MAE | Skill |",
            "|---|---|---|---:|---:|---:|---:|",
        ]
        for r in rows:
            unit = UNITS.get(r["variable"], "")
            lines.append(
                f"| {r['variable']} | {r['lead']} | {r['baseline']} | {r['cases']} | "
                f"{r['baseline_mae']} {unit} | {r['engine_mae']} {unit} | {r['skill_pct']:+}% |"
            )
    if results.brier:
        lines += [
            "",
            "## Engine chance of rain (Brier score, lower is better)",
            "",
            "| Lead | Cases | Engine | Always-climatology |",
            "|---|---:|---:|---:|",
        ]
        for bucket, b in sorted(results.brier.items()):
            lines.append(f"| {BUCKET_LABELS[bucket]} | {b.n} | {b.score:.4f} | {b.climatology:.4f} |")
    md_path = out_dir / f"{name}.md"
    md_path.write_text("\n".join(lines) + "\n")
    return md_path


def write_forecast(rows: list[Forecast], out_dir: Path, name: str, title: str, hours: int = 48) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    table: dict[int, dict[str, float]] = defaultdict(dict)
    for r in rows:
        table[r.valid_time][r.variable] = r.value
    lines = [
        f"# {title}",
        "",
        "| Valid (UTC) | Temp °C | Wind m/s | Precip mm | Chance of rain |",
        "|---|---:|---:|---:|---:|",
    ]
    for valid in sorted(table)[:hours]:
        v = table[valid]
        def cell(key, f):
            return f.format(v[key]) if key in v else "–"
        lines.append(
            f"| {fmt(valid)} | {cell(TEMPERATURE, '{:.1f}')} | {cell(WIND, '{:.1f}')} | "
            f"{cell(PRECIP, '{:.2f}')} | {cell(PRECIP_PROB, '{:.0%}')} |"
        )
    path = out_dir / f"{name}.md"
    path.write_text("\n".join(lines) + "\n")
    return path
