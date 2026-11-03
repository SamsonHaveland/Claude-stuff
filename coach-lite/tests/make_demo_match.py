#!/usr/bin/env python3
"""Build a fake match folder (synthetic players + test-pattern videos) to try index.html,
clips.py and season.py without real footage. Uses the same resample/stats code as analyze.py.

    python tests/make_demo_match.py demo_matches/2026-01-01 --minutes 3
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import analyze as A  # noqa: E402


def fake_player(rng, seconds, L, W, home_x, home_y):
    """Kid drifting around a home position, with occasional sprints; 10 Hz samples."""
    n = int(seconds * 10)
    pos = np.array([home_x, home_y], float)
    vel = np.zeros(2)
    out = np.zeros((n, 2))
    sprint = 0
    for i in range(n):
        if sprint == 0 and rng.random() < 0.004:
            sprint = int(rng.integers(12, 30))
            ang = rng.uniform(0, 2 * np.pi)
            vel = 5.0 * np.array([np.cos(ang), np.sin(ang)])
        if sprint:
            sprint -= 1
        else:
            pull = (np.array([home_x, home_y]) - pos) * 0.02
            vel = 0.9 * vel + rng.normal(0, 0.25, 2) + pull
            sp = np.hypot(*vel)
            if sp > 2.5:
                vel *= 2.5 / sp
        pos = np.clip(pos + vel * 0.1, [0.5, 0.5], [L - 0.5, W - 0.5])
        out[i] = pos
    return out


def make_half(rng, half, seconds, L, W, folder, video_name):
    tracks, stats = {}, {}
    tid = 1
    for team in (0, 1):
        for k in range(7):
            hx = (L * (0.08 + 0.12 * k)) if team == 0 else (L * (0.92 - 0.12 * k))
            hy = W * (0.2 + 0.6 * ((k * 37) % 7) / 6)
            xy = fake_player(rng, seconds, L, W, hx, hy)
            t = np.arange(len(xy)) / 10
            # break one track mid-half to mimic a lost ID (coach merges them in the page)
            cuts = [(0, len(xy))] if k != 3 else [(0, len(xy) // 2 - 30), (len(xy) // 2, len(xy))]
            for a, b in cuts:
                res = A.resample_track(t[a:b], xy[a:b], L, W)
                if res is None:
                    continue
                start, xs, ys = res
                key = f"{half}-{tid}"
                tracks[key] = {"team": team, "start": start, "x": [A.r1(v) for v in xs], "y": [A.r1(v) for v in ys]}
                stats[key] = {"team": team, **A.track_stats(xs, ys)}
                tid += 1
    meta = {"video": video_name, "video_name": video_name, "fps": 30, "duration_s": seconds,
            "field": [L, W], "hz": 10, "team_colours": ["#1d4ed8", "#f8fafc"], "expected_players": 14,
            "coverage_80pct": 1.0, "mean_people_in_field": 14, "model": "synthetic", "config": A.CONFIG}
    A.merge_half(folder / "tracks.json", half, {"meta": meta, "tracks": tracks})
    A.merge_half(folder / "stats.json", half, {"meta": meta, "players": stats})
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc2=size=640x360:rate=30:duration={seconds}",
                    "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
                    str(folder / video_name)], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--minutes", type=float, default=3)
    ap.add_argument("--field", default="55x36")
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    L, W = A.parse_field(args.field)
    args.folder.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)
    for half in (1, 2):
        make_half(rng, half, args.minutes * 60, L, W, args.folder, f"half{half}.mp4")
    print(f"Demo match written to {args.folder}")


if __name__ == "__main__":
    main()
