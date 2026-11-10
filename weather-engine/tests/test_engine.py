import math
import random

from weather_engine.engine import ErrorStats, ForecastIndex, Params, blend_weights, correct, predict, training_stats
from weather_engine.records import PRECIP, PRECIP_PROB, TEMPERATURE, WIND, Forecast
from weather_engine.timeutil import DAY, HOUR
from weather_engine.verify import backtest

T0 = 20_000 * DAY  # arbitrary midnight


def truth(t):
    hours = t / HOUR
    return 10 + 8 * math.sin(2 * math.pi * hours / 24) + 3 * math.sin(2 * math.pi * hours / (24 * 9))


def synthetic(days=70, seed=1):
    """Truth plus three fake models issuing daily 00Z runs out to 7 days:
    warm-biased, cold-biased and noisy, each worse at longer leads."""
    rng = random.Random(seed)
    obs, rows = {}, []
    end = T0 + days * DAY
    for t in range(T0, end, HOUR):
        obs[(TEMPERATURE, t)] = truth(t) + rng.gauss(0, 0.3)
    models = {"warm": (2.5, 0.8), "cold": (-1.5, 0.8), "noisy": (0.0, 2.5)}
    for issue in range(T0 - 8 * DAY, end, DAY):
        for name, (bias, sd) in models.items():
            for h in range(1, 169):
                valid = issue + h * HOUR
                spread = sd * (1 + h / 96)
                rows.append(Forecast("x", name, TEMPERATURE, issue, valid, truth(valid) + bias + rng.gauss(0, spread)))
    return rows, obs, list(models)


def test_index_latest_respects_cutoff():
    rows = [Forecast("x", "m", TEMPERATURE, 0, 10 * HOUR, 1.0),
            Forecast("x", "m", TEMPERATURE, 5 * HOUR, 10 * HOUR, 2.0)]
    index = ForecastIndex(rows)
    assert index.latest("m", TEMPERATURE, 10 * HOUR, 4 * HOUR) == (0, 1.0)
    assert index.latest("m", TEMPERATURE, 10 * HOUR, 5 * HOUR) == (5 * HOUR, 2.0)
    assert index.latest("m", TEMPERATURE, 10 * HOUR, -1) is None


def test_training_never_sees_the_future():
    """Observations at or after the cutoff must not influence the forecast."""
    rows, obs, models = synthetic(days=40)
    cutoff = T0 + 35 * DAY
    a = predict(ForecastIndex(rows), obs, cutoff, location="x", sources=models, variables=[TEMPERATURE])
    tampered = {k: (v + 100 if k[1] >= cutoff else v) for k, v in obs.items()}
    b = predict(ForecastIndex(rows), tampered, cutoff, location="x", sources=models, variables=[TEMPERATURE])
    assert a == b


def test_bias_learned_and_removed():
    rows, obs, models = synthetic(days=40)
    cutoff = T0 + 35 * DAY
    stats = training_stats(ForecastIndex(rows), obs, cutoff, models, [TEMPERATURE], Params())
    s = stats[("warm", TEMPERATURE, 2)]  # 12-24h lead
    assert abs(s.sum_err / s.n - 2.5) < 0.3
    assert abs(correct(TEMPERATURE, 12.5, s, Params()) - 10.0) < 0.4


def test_precip_correction_is_multiplicative_and_non_negative():
    s = ErrorStats()
    for f, o in [(2.0, 1.0)] * 50 + [(0.0, 0.0)] * 50:
        s.add(f, o)
    p = Params()
    assert correct(PRECIP, 0.0, s, p) == 0.0  # dry stays dry
    assert 0.5 * 2.0 <= correct(PRECIP, 2.0, s, p) < 2.0
    s2 = ErrorStats()
    s2.add(-5.0, 0.0)
    assert correct(WIND, 0.1, s2, p) >= 0.0


def test_weights_floor_and_renormalise():
    p = Params()
    good, bad = ErrorStats(), ErrorStats()
    for i in range(100):
        good.add(0.1 * (-1) ** i, 0)
        bad.add(3.0 * (-1) ** i, 0)
    stats = {("good", TEMPERATURE, 0): good, ("bad", TEMPERATURE, 0): bad}
    w = blend_weights({"good": 0, "bad": 0}, TEMPERATURE, stats, p)
    assert w["good"] > w["bad"] >= p.equal_mix / 2 - 1e-12
    assert abs(sum(w.values()) - 1) < 1e-9
    # A model with no history still gets the floor, not zero.
    w = blend_weights({"good": 0, "new": 0}, TEMPERATURE, stats, p)
    assert w["new"] > 0


def test_short_range_model_missing_at_long_lead_is_fine():
    rows = [Forecast("x", "global", TEMPERATURE, 0, h * HOUR, 5.0) for h in range(1, 100)]
    rows += [Forecast("x", "short", TEMPERATURE, 0, h * HOUR, 7.0) for h in range(1, 19)]
    out = predict(ForecastIndex(rows), {}, 0, location="x", sources=["global", "short"], variables=[TEMPERATURE])
    by_valid = {r.valid_time: r.value for r in out}
    assert by_valid[10 * HOUR] == 6.0  # equal blend without history
    assert by_valid[50 * HOUR] == 5.0  # only global reaches 50h


def test_precip_probability_output():
    rows = [Forecast("x", m, PRECIP, 0, HOUR, v) for m, v in [("a", 1.0), ("b", 0.0)]]
    out = predict(ForecastIndex(rows), {}, 0, location="x", sources=["a", "b"], variables=[PRECIP])
    prob = [r.value for r in out if r.variable == PRECIP_PROB]
    assert prob == [0.5]


def test_backtest_engine_beats_every_raw_model():
    rows, obs, models = synthetic(days=70)
    index = ForecastIndex(rows)
    results = backtest(index, obs, location="x", start=T0 + 31 * DAY, end=T0 + 62 * DAY,
                       step_hours=24, sources=models, baselines=models)
    assert results.cases > 0
    for model in models:
        src = sum(p.src_abs for (s, _, _), p in results.paired.items() if s == model)
        eng = sum(p.eng_abs for (s, _, _), p in results.paired.items() if s == model)
        assert eng < 0.85 * src, model
