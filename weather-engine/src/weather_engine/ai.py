"""Optional Claude features: a plain-English forecast summary and an `analyze` report.

Claude never produces forecast numbers. The statistics in calibrate.py do
that. Here Claude only reads numbers the engine already computed (forecast
tables, verification scores, calibration stats, station coverage) and writes
about them, under instructions to quote figures exactly and say when the
evidence is too thin.

Needs `pip install -e ".[ai]"` and ANTHROPIC_API_KEY (in the project's .env).
Runs only when asked; each call costs a few cents.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from . import store
from .config import BASELINE_MODEL, REPORTS_DIR, UNITS

MODEL = "claude-opus-5-5"
# Re-run a declined request on Anthropic's recommended fallback model instead of failing.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AIError(RuntimeError):
    pass


def configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def _client():
    if not configured():
        raise AIError("No Anthropic API key configured. Add ANTHROPIC_API_KEY=... to weather-engine/.env")
    try:
        import anthropic
    except ImportError:
        raise AIError('The Anthropic SDK is not installed. Run: pip install -e ".[ai]"') from None
    return anthropic.Anthropic()


def _text(message) -> str:
    if message.stop_reason == "refusal":
        raise AIError("Claude declined this request.")
    text = "".join(b.text for b in message.content if b.type == "text").strip()
    if message.stop_reason == "max_tokens":
        text += "\n\n[Output was cut off at the length limit.]"
    if not text:
        raise AIError("Claude returned no text.")
    return text


def _call(system: str, user: str, effort: str, stream: bool = False) -> str:
    import anthropic

    client = _client()
    kwargs = dict(
        model=MODEL,
        max_tokens=64000 if stream else 16000,
        system=system,
        cache_control={"type": "ephemeral"},
        output_config={"effort": effort},
        betas=[FALLBACK_BETA],
        fallbacks="default",
        messages=[{"role": "user", "content": user}],
    )
    try:
        if stream:
            with client.beta.messages.stream(**kwargs) as s:
                return _text(s.get_final_message())
        return _text(client.beta.messages.create(**kwargs))
    except anthropic.AuthenticationError:
        raise AIError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env") from None
    except anthropic.RateLimitError:
        raise AIError("Anthropic rate limit reached; try again in a minute.") from None
    except anthropic.APIStatusError as e:
        raise AIError(f"Anthropic API error ({e.status_code}): {e.message}") from None
    except anthropic.APIConnectionError:
        raise AIError("Could not reach the Anthropic API (network).") from None


# --- plain-English summary -------------------------------------------------

SUMMARY_SYSTEM = """You turn a calibrated 7-day weather forecast (provided as JSON) into a short plain-English summary for one person planning their week.

Rules:
- Use only the numbers in the JSON. Never invent or adjust values, and round only as the JSON already does.
- 3 to 5 sentences. Lead with what matters most for planning: rain days and chances, notably hot/cold days, windy days.
- Temperatures are °F, rain is inches, wind and gusts are mph. "rain_prob" is a percent chance from ensemble forecasts.
- When the low/high range for a day is wide, or the forecast is uncalibrated, say the forecast is less certain. Days 5-7 are inherently less certain than days 1-2.
- Mention rain amounts only when a day's chance is 30% or more.
- No greeting, no headings, no bullet points."""


def _summary_payload(forecast: dict) -> str:
    keep = {
        "location": forecast.get("location", {}).get("name"),
        "calibrated": forecast.get("calibrated"),
        "status": forecast.get("status"),
        "days": [
            {k: d.get(k) for k in ("date", "lead", "tmax", "tmin", "precip", "rain_prob", "wind", "gust")}
            for d in forecast.get("days", [])
        ],
        "notes": forecast.get("notes", [])[:10],
    }
    return json.dumps(keep, default=str)


def summarize(forecast: dict) -> str:
    """Plain-English summary of a forecast as returned by report.to_dict()."""
    if not forecast.get("days"):
        raise AIError("No forecast days to summarize.")
    return _call(SUMMARY_SYSTEM, _summary_payload(forecast), effort="low")


# --- analysis report ---------------------------------------------------------

ANALYZE_SYSTEM = """You are a forecast-verification analyst reviewing a personal weather engine. The engine blends global models (ECMWF, GFS, ICON, GEM), bias-corrects each model per location against nearby station observations (rolling window, corrections shrunk when history is short), and logs every forecast. You receive tables the engine computed. Your report helps its owner decide what to change.

Rules for accuracy:
- Quote numbers exactly as given in the tables. Do not compute new statistics beyond simple differences between two numbers that appear in the tables, and say when you do.
- Always state the sample size (n) behind a claim. Treat n < 10 as anecdotal and n < 30 as tentative, and say so.
- Separate what the data shows from what you suspect. Never present a hypothesis as a finding.
- If the data is too thin to support a recommendation, say that instead of recommending.

Write a Markdown report with these sections:
1. **Verdict**: one or two sentences. Is the calibrated blend beating raw ECMWF (the baseline) for each variable? Say "not enough data yet" if that is the honest answer.
2. **What's working**: with evidence.
3. **Problems**: with evidence (variable, lead day, location, numbers, n).
4. **Station and data quality**: coverage gaps, short history, stations that look suspect (implausible biases, missing days), 7 am observer windows.
5. **Recommendations**: ranked by expected impact. For each: the change, why (the evidence), and how to check it worked with `weather-engine verify`. Prefer concrete, testable changes, such as a different station, a shorter or longer training window, dropping a model that never helps, or more history.
6. **What can't be concluded yet**: what data would settle it."""


def _csv(df: pd.DataFrame, max_rows: int = 400) -> str:
    if df is None or df.empty:
        return "(none)"
    return df.head(max_rows).to_csv(index=False)


def build_context(scores: pd.DataFrame) -> str:
    """All the numbers the analyst sees, as text tables. Pure function of local files + scores."""
    parts = [f"Report date: {date.today().isoformat()}. Baseline model: {BASELINE_MODEL}. Units: {UNITS}."]

    if scores is not None and not scores.empty:
        mae = scores.pivot_table(index=["var", "lead"], columns="source", values="mae").round(3)
        n = scores.pivot_table(index=["var", "lead"], columns="source", values="n")
        table = mae.copy()
        if "blend" in mae and BASELINE_MODEL in mae:
            table["blend_minus_baseline"] = (mae["blend"] - mae[BASELINE_MODEL]).round(3)
        table["n_blend"] = n.get("blend")
        parts.append("## Verification: mean absolute error by variable and lead day "
                     "(lower is better; negative blend_minus_baseline = blend beats the baseline)\n"
                     + _csv(table.reset_index()))
        rain = scores[scores["var"] == "precip"].dropna(subset=["rain_hit_rate"])
        if not rain.empty:
            parts.append("## Rain yes/no hit rate (share of days where rain >= 0.01 in was correctly forecast)\n"
                         + _csv(rain[["lead", "source", "n", "rain_hit_rate"]].round(3)))
    else:
        parts.append("## Verification\n(no scored forecasts yet)")

    log = store.read_log()
    if not log.empty:
        usage = (log[log["source"] == "blend"].groupby(["location", "station"])
                 .agg(forecasts=("issued_at", "nunique"), first=("issued_at", "min"), last=("issued_at", "max"))
                 .reset_index())
        parts.append("## Forecasts issued per location and station set "
                     "(station = group=source:id[@end_hour], end_hour 7 = 7am observer)\n" + _csv(usage))

    cal = store.read_calibration()
    if not cal.empty:
        summary = (cal.groupby(["location", "var", "model"])
                   .agg(n=("n", "max"), bias=("bias", "mean"), ratio=("ratio", "mean"),
                        mae_raw=("mae_raw", "mean"), mae_cal=("mae_cal", "mean"))
                   .round(3).reset_index())
        parts.append("## Latest calibration per location (averaged over lead days; bias = correction applied, "
                     "in variable units; ratio = rain multiplier; mae_* are in-sample)\n" + _csv(summary))

    coverage = store.archive_coverage()
    if not coverage.empty:
        parts.append("## Station observation archive coverage (days with data per variable)\n" + _csv(coverage))
    return "\n\n".join(parts)


def analyze(scores: pd.DataFrame, out_dir: Path = REPORTS_DIR) -> tuple[str, Path]:
    report = _call(ANALYZE_SYSTEM, build_context(scores), effort="high", stream=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"analysis_{datetime.now():%Y%m%d_%H%M}.md"
    path.write_text(report + "\n")
    return report, path
