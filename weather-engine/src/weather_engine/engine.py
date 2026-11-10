"""Bias correction and skill-weighted blending of model forecasts.

Everything here is a pure function of (forecasts, observations, cutoff). Only
information that was available at ``cutoff`` is used:

* a forecast counts if its issue_time <= cutoff;
* a training pair counts only if its valid_time < cutoff, i.e. the outcome had
  already been observed.

That rule is what makes the walk-forward backtest in verify.py honest.
"""

from __future__ import annotations

import bisect
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from .records import PRECIP, PRECIP_PROB, TEMPERATURE, WIND, Forecast
from .timeutil import DAY, HOUR, floor_hour

# Lead-time buckets (upper bounds, hours). Errors grow with lead, so each bucket
# gets its own bias and weight.
LEAD_BUCKETS = (6, 12, 24, 48, 72, 120, 168)
BUCKET_LABELS = ("0-6h", "6-12h", "12-24h", "24-48h", "48-72h", "72-120h", "120h+")


def lead_bucket(lead_seconds: int) -> int:
    hours = lead_seconds / HOUR
    for i, upper in enumerate(LEAD_BUCKETS):
        if hours < upper:
            return i
    return len(LEAD_BUCKETS) - 1


@dataclass(frozen=True)
class Params:
    window_days: int = 30  # trailing training window
    horizon_hours: int = 168
    shrink: float = 10.0  # pseudo-count pulling small-sample biases toward zero
    min_pairs: int = 24  # below this a model gets the equal-weight share only
    equal_mix: float = 0.2  # blend weight floor: 20% equal, 80% skill-based
    precip_ratio_bounds: tuple[float, float] = (0.5, 2.0)
    wet_mm: float = 0.1  # an hour with at least this much is "wet"


@dataclass
class ErrorStats:
    n: int = 0
    sum_err: float = 0.0
    sum_err2: float = 0.0
    sum_fcst: float = 0.0
    sum_obs: float = 0.0

    def add(self, fcst: float, obs: float) -> None:
        e = fcst - obs
        self.n += 1
        self.sum_err += e
        self.sum_err2 += e * e
        self.sum_fcst += fcst
        self.sum_obs += obs


class ForecastIndex:
    """All forecasts for one location, indexed for "latest run as of T" lookups."""

    def __init__(self, rows: Iterable[Forecast]):
        series: dict[tuple[str, str, int], list[tuple[int, float]]] = defaultdict(list)
        for r in rows:
            series[(r.source, r.variable, r.valid_time)].append((r.issue_time, r.value))
        self._issues: dict[tuple[str, str, int], list[int]] = {}
        self._values: dict[tuple[str, str, int], list[float]] = {}
        for key, items in series.items():
            items.sort()
            self._issues[key] = [i for i, _ in items]
            self._values[key] = [v for _, v in items]
        self.sources = sorted({k[0] for k in series})

    def latest(self, source: str, variable: str, valid: int, cutoff: int) -> tuple[int, float] | None:
        """The most recent forecast for this hour issued at or before cutoff."""
        key = (source, variable, valid)
        issues = self._issues.get(key)
        if not issues:
            return None
        i = bisect.bisect_right(issues, cutoff) - 1
        if i < 0:
            return None
        return issues[i], self._values[key][i]

    def all_issued(self, source: str, variable: str, valid: int, cutoff: int):
        """Every forecast for this hour issued at or before cutoff."""
        key = (source, variable, valid)
        issues = self._issues.get(key, [])
        end = bisect.bisect_right(issues, cutoff)
        return zip(issues[:end], self._values[key][:end]) if end else ()


def training_stats(
    index: ForecastIndex,
    obs: dict[tuple[str, int], float],
    cutoff: int,
    sources: list[str],
    variables: Iterable[str],
    params: Params,
) -> dict[tuple[str, str, int], ErrorStats]:
    """Error statistics per (source, variable, lead bucket) over the trailing window."""
    stats: dict[tuple[str, str, int], ErrorStats] = defaultdict(ErrorStats)
    first = floor_hour(cutoff - params.window_days * DAY)
    for valid in range(first, cutoff, HOUR):  # valid < cutoff: outcome already known
        for variable in variables:
            o = obs.get((variable, valid))
            if o is None:
                continue
            for source in sources:
                for issue, value in index.all_issued(source, variable, valid, cutoff):
                    stats[(source, variable, lead_bucket(valid - issue))].add(value, o)
    return stats


def correct(variable: str, value: float, s: ErrorStats | None, params: Params) -> float:
    if s is None or s.n == 0:
        return max(0.0, value) if variable in (WIND, PRECIP) else value
    if variable == PRECIP:
        # Additive bias would invent rain on dry hours; scale amounts instead.
        lo, hi = params.precip_ratio_bounds
        ratio = (s.sum_obs + 1.0) / (s.sum_fcst + 1.0)
        return max(0.0, value * min(hi, max(lo, ratio)))
    corrected = value - s.sum_err / (s.n + params.shrink)
    return max(0.0, corrected) if variable == WIND else corrected


def residual_mse(variable: str, s: ErrorStats) -> float:
    """Expected squared error after correction (variance for additive biases)."""
    mean_sq = s.sum_err2 / s.n
    if variable == PRECIP:
        return mean_sq
    mean = s.sum_err / s.n
    return max(mean_sq - mean * mean, 1e-6)


def blend_weights(
    buckets: dict[str, int], variable: str, stats, params: Params
) -> dict[str, float]:
    """Weights for the members available at one hour; ``buckets`` maps each
    member to its own lead bucket (its run may be older than the cutoff)."""
    equal = 1.0 / len(buckets)
    inverse = {}
    for source, bucket in buckets.items():
        s = stats.get((source, variable, bucket))
        if s is not None and s.n >= params.min_pairs:
            inverse[source] = 1.0 / (residual_mse(variable, s) + 1e-6)
    total = sum(inverse.values())
    if not total:
        return {source: equal for source in buckets}
    # Every member keeps a floor; members with enough history split the rest in
    # proportion to inverse error, so one lucky month can't zero out a model.
    skill_share = (1 - params.equal_mix) * len(inverse) / len(buckets)
    weights = {}
    for source in buckets:
        w = params.equal_mix * equal
        if source in inverse:
            w += skill_share * inverse[source] / total
        weights[source] = w
    return weights


def predict(
    index: ForecastIndex,
    obs: dict[tuple[str, int], float],
    cutoff: int,
    *,
    location: str,
    sources: list[str],
    variables: Iterable[str] = (TEMPERATURE, WIND, PRECIP),
    params: Params = Params(),
) -> list[Forecast]:
    """Engine forecast for every hour in (cutoff, cutoff + horizon]."""
    variables = list(variables)
    stats = training_stats(index, obs, cutoff, sources, variables, params)
    out = []
    first = floor_hour(cutoff) + HOUR
    for valid in range(first, cutoff + params.horizon_hours * HOUR + 1, HOUR):
        for variable in variables:
            members, buckets = {}, {}
            for source in sources:
                hit = index.latest(source, variable, valid, cutoff)
                if hit is None:
                    continue  # e.g. a short-range model that doesn't reach this far
                issue, value = hit
                buckets[source] = lead_bucket(valid - issue)
                s = stats.get((source, variable, buckets[source]))
                members[source] = correct(variable, value, s, params)
            if not members:
                continue
            weights = blend_weights(buckets, variable, stats, params)
            norm = sum(weights.values())
            value = sum(weights[s] * members[s] for s in members) / norm
            out.append(Forecast(location, "engine", variable, cutoff, valid, value))
            if variable == PRECIP:
                wet = sum(weights[s] for s in members if members[s] >= params.wet_mm) / norm
                out.append(Forecast(location, "engine", PRECIP_PROB, cutoff, valid, wet))
    return out
