"""Unit tests for the maths in analyze.py (no video or GPU needed).
Run:  python -m unittest discover -s tests -v
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import analyze as A  # noqa: E402

L, W = 55.0, 36.0
CFG = dict(A.CONFIG)


def series(points_per_s, seconds, fn):
    t = np.arange(0, seconds, 1 / points_per_s)
    return t, np.array([fn(v) for v in t])


class Homography(unittest.TestCase):
    # A realistic midfield-tripod view of a 55x36 field in a 1920x1080 frame:
    # far touchline small and high, near touchline wide and low (near corners off-frame).
    CLICKS = [[540, 250], [1380, 255], [2150, 1010], [-230, 1000]]

    def test_corners_map_within_half_metre(self):
        H = A.compute_homography(self.CLICKS, L, W)
        got = A.to_field(H, self.CLICKS)
        err = np.hypot(*(got - A.field_corners(L, W)).T)
        self.assertTrue((err < 0.5).all(), f"corner errors {err}")

    def test_round_trip_interior_point(self):
        H = A.compute_homography(self.CLICKS, L, W)
        Hinv = np.linalg.inv(H)
        field_pt = np.array([[20.0, 12.0]])
        img = A.to_field(Hinv, field_pt)  # field -> image using the inverse
        back = A.to_field(H, img)
        self.assertLess(np.hypot(*(back - field_pt)[0]), 0.01)

    def test_centre_maps_inside(self):
        H = A.compute_homography(self.CLICKS, L, W)
        c = A.to_field(H, [[960, 500]])
        self.assertTrue(A.in_field(c, L, W, 0).all())

    def test_parse_field_orders_length_first(self):
        self.assertEqual(A.parse_field("36x55"), (55.0, 36.0))


class Resample(unittest.TestCase):
    def test_short_gap_interpolated_long_gap_broken(self):
        t = np.concatenate([np.arange(0, 5, 0.1), np.arange(5.8, 10, 0.1),   # 0.8 s gap -> filled
                            np.arange(12, 16, 0.1)])                          # 2 s gap   -> broken
        xy = np.column_stack([10 + t, np.full_like(t, 18)])
        start, xs, ys = A.resample_track(t, xy, L, W, CFG)
        self.assertEqual(start, 0)
        segs = A.segments(xs)
        self.assertEqual(len(segs), 2)
        self.assertAlmostEqual(xs[53], 15.3, places=6)  # inside the filled 0.8 s gap

    def test_outside_field_dropped(self):
        t = np.arange(0, 10, 0.1)
        xy = np.column_stack([np.full_like(t, 10), np.full_like(t, 18)])
        xy[30:40, 1] = W + 5  # walked off the near touchline (a parent / sub)
        _, xs, _ = A.resample_track(t, xy, L, W, CFG)
        self.assertTrue(np.isnan(xs[30:40]).all())

    def test_too_short_rejected(self):
        t = np.arange(0, 1, 0.1)
        self.assertIsNone(A.resample_track(t, np.column_stack([t, t]) + 5, L, W, CFG))

    def test_30fps_detections_downsample_to_10hz(self):
        t = np.arange(0, 10, 1 / 30)
        xy = np.column_stack([5 + 2 * t, np.full_like(t, 10)])
        start, xs, _ = A.resample_track(t, xy, L, W, CFG)
        self.assertEqual(len(xs), 101)

    def test_smoothing_keeps_straight_line(self):
        a = np.arange(20, dtype=float)
        np.testing.assert_allclose(A.moving_average(a, 5), a)


class Stats(unittest.TestCase):
    def stats_for(self, t, xy):
        start, xs, ys = A.resample_track(t, xy, L, W, CFG)
        return A.track_stats(xs, ys, CFG)

    def test_constant_jog(self):
        # 3 m/s (10.8 km/h) for 10 s diagonally -> 30 m, no sprints
        t = np.arange(0, 10.0001, 0.1)
        d = 3 * t / np.sqrt(2)
        s = self.stats_for(t, np.column_stack([5 + d, 5 + d]))
        self.assertAlmostEqual(s["distance_m"], 30.0, delta=0.2)
        self.assertAlmostEqual(s["top_speed_kmh"], 10.8, delta=0.1)
        self.assertEqual(s["sprints"], 0)
        self.assertAlmostEqual(s["minutes"], 101 / 10 / 60, places=2)

    def test_sprint_counting(self):
        # walk 1.5 m/s; sprint 5 m/s (18 km/h) for 2 s, three times; plus a 0.5 s burst that must NOT count
        v = np.full(600, 1.5)
        for s0 in (100, 250, 400):
            v[s0:s0 + 20] = 5.0
        v[500:505] = 5.0
        d = np.concatenate([[0], np.cumsum(v[:-1] * 0.1)])
        ang = d / 15.0  # run laps of a 15 m-radius circle around the centre spot (stays on the field)
        t = np.arange(600) / 10
        st = self.stats_for(t, np.column_stack([L / 2 + 15 * np.cos(ang), W / 2 + 15 * np.sin(ang)]))
        self.assertEqual(st["sprints"], 3)
        self.assertGreater(st["top_speed_kmh"], 15)
        self.assertLessEqual(st["top_speed_kmh"], 18.1)

    def test_glitch_rejected(self):
        # standing still with a single 20 m teleport for 1 sample (ID swap)
        t = np.arange(0, 20, 0.1)
        xy = np.column_stack([np.full_like(t, 10.0), np.full_like(t, 10.0)])
        xy[100, 0] = 30
        cfg = dict(CFG, smooth_window=1)
        start, xs, ys = A.resample_track(t, xy, L, W, cfg)
        st = A.track_stats(xs, ys, cfg)
        self.assertLess(st["distance_m"], 0.01)
        self.assertLessEqual(st["top_speed_kmh"], cfg["max_kmh"])
        self.assertEqual(st["sprints"], 0)

    def test_thresholds_are_config(self):
        t = np.arange(0, 10, 0.1)
        x = 5 + 3.5 * t  # 12.6 km/h
        st = self.stats_for(t, np.column_stack([x, np.full_like(t, 10)]))
        self.assertEqual(st["sprints"], 0)
        start, xs, ys = A.resample_track(t, np.column_stack([x, np.full_like(t, 10)]), L, W, CFG)
        self.assertEqual(A.track_stats(xs, ys, dict(CFG, sprint_kmh=12))["sprints"], 1)

    def test_gap_not_counted_as_distance(self):
        # player leaves the field (sub) and comes back 30 m away 3 minutes later
        t = np.concatenate([np.arange(0, 10, 0.1), np.arange(190, 200, 0.1)])
        xy = np.column_stack([np.where(t < 100, 10.0, 40.0), np.full_like(t, 10)])
        st = self.stats_for(t, xy)
        self.assertLess(st["distance_m"], 0.01)
        self.assertAlmostEqual(st["minutes"], 20 / 60, places=2)


if __name__ == "__main__":
    unittest.main()
