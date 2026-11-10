"""Verification: score the engine against each raw source on identical cases.

Each engine forecast (issued at T for hour V) is paired with every other
source's latest forecast for V issued at or before T, and with what was observed
at V. Engine and source are scored on exactly the same cases, so the skill
figures are a like-for-like comparison.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from .engine import ForecastIndex, Params, lead_bucket, predict
from .records import PRECIP, PRECIP_PROB, Forecast
from .timeutil import HOUR


@dataclass
class Paired:
    """Engine vs one source on the same cases."""

    n: int = 0
    src_abs: float = 0.0
    src_sq: float = 0.0
    src_err: float = 0.0
    eng_abs: float = 0.0
    eng_sq: float = 0.0
    eng_err: float = 0.0
    src_wet_ok: int = 0  # precip only: wet/dry call correct
    eng_wet_ok: int = 0

    def add(self, src: float, eng: float, obs: float, wet_mm: float) -> None:
        self.n += 1
        es, ee = src - obs, eng - obs
        self.src_abs += abs(es)
        self.src_sq += es * es
        self.src_err += es
        self.eng_abs += abs(ee)
        self.eng_sq += ee * ee
        self.eng_err += ee
        wet = obs >= wet_mm
        self.src_wet_ok += (src >= wet_mm) == wet
        self.eng_wet_ok += (eng >= wet_mm) == wet

    @property
    def src_mae(self) -> float:
        return self.src_abs / self.n

    @property
    def eng_mae(self) -> float:
        return self.eng_abs / self.n

    @property
    def src_rmse(self) -> float:
        return (self.src_sq / self.n) ** 0.5

    @property
    def eng_rmse(self) -> float:
        return (self.eng_sq / self.n) ** 0.5

    @property
    def skill(self) -> float:
        """MAE skill vs this source: +0.2 means engine errors are 20% smaller."""
        return 1 - self.eng_abs / self.src_abs if self.src_abs else 0.0


@dataclass
class Brier:
    n: int = 0
    total: float = 0.0
    wet: int = 0

    @property
    def score(self) -> float:
        return self.total / self.n

    @property
    def climatology(self) -> float:
        """Brier score of always forecasting the sample's wet frequency."""
        p = self.wet / self.n
        return p * (1 - p)


@dataclass
class Results:
    paired: dict[tuple[str, str, int], Paired]  # (source, variable, bucket)
    brier: dict[int, Brier]  # engine probability of precip, by bucket
    cases: int


def compare(
    engine_rows: list[Forecast],
    index: ForecastIndex,
    obs: dict[tuple[str, int], float],
    baselines: list[str],
    wet_mm: float = Params.wet_mm,
) -> Results:
    paired: dict[tuple[str, str, int], Paired] = defaultdict(Paired)
    brier: dict[int, Brier] = defaultdict(Brier)
    cases = 0
    for e in engine_rows:
        if e.variable == PRECIP_PROB:
            o = obs.get((PRECIP, e.valid_time))
            if o is not None:
                b = brier[lead_bucket(e.valid_time - e.issue_time)]
                wet = o >= wet_mm
                b.n += 1
                b.wet += wet
                b.total += (e.value - wet) ** 2
            continue
        o = obs.get((e.variable, e.valid_time))
        if o is None:
            continue
        cases += 1
        bucket = lead_bucket(e.valid_time - e.issue_time)
        for source in baselines:
            hit = index.latest(source, e.variable, e.valid_time, e.issue_time)
            if hit is not None:
                paired[(source, e.variable, bucket)].add(hit[1], e.value, o, wet_mm)
    return Results(dict(paired), dict(brier), cases)


def backtest(
    index: ForecastIndex,
    obs: dict[tuple[str, int], float],
    *,
    location: str,
    start: int,
    end: int,
    step_hours: int,
    sources: list[str],
    baselines: list[str],
    params: Params = Params(),
) -> Results:
    """Walk forward through history, issuing an engine forecast at each step
    from only what was known then, and score it."""
    engine_rows: list[Forecast] = []
    for cutoff in range(start, end, step_hours * HOUR):
        engine_rows.extend(
            predict(index, obs, cutoff, location=location, sources=sources, params=params)
        )
    return compare(engine_rows, index, obs, baselines, params.wet_mm)
