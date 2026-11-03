#!/usr/bin/env python3
"""Coach-Lite pipeline: one fixed match video -> tracks.json + stats.json.

    python analyze.py match_h1.mp4 --field 55x36 --out matches/2026-11-08/ --half 1
    python analyze.py match_h2.mp4 --field 55x36 --out matches/2026-11-08/ --half 2

Detection: RF-DETR (person class). Tracking: ByteTrack (supervision).
Field mapping: homography from 4 clicked field corners (saved to calibration_h<N>.json).
Everything runs locally; nothing is uploaded anywhere.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Config (all overridable on the command line; saved into stats.json "meta")
# ---------------------------------------------------------------------------
CONFIG = {
    "hz": 10,                # output sample rate for tracks.json
    "max_gap_s": 1.0,        # interpolate gaps up to this long; longer gaps break the track
    "smooth_window": 5,      # moving-average window in samples (5 @ 10 Hz = 0.5 s)
    "field_margin_m": 0.5,   # positions further than this outside the lines are dropped
    "max_kmh": 30.0,         # steps faster than this are treated as glitches (kids rarely exceed ~25)
    "sprint_kmh": 15.0,      # sprint = above this speed ...
    "sprint_min_s": 1.0,     # ... for at least this long
    "min_track_s": 2.0,      # tracks with less valid time than this are discarded as noise
    "det_threshold": 0.3,    # RF-DETR confidence threshold
}
PERSON_CLASS_ID = 1          # COCO "person" in rfdetr's class map


# ---------------------------------------------------------------------------
# Field geometry
# ---------------------------------------------------------------------------
def parse_field(s):
    """'55x36' -> (length, width) in metres. Length runs goal to goal."""
    a, b = (float(v) for v in s.lower().split("x"))
    return max(a, b), min(a, b)


def field_corners(length, width):
    """Field-metre corners in click order: far-left, far-right, near-right, near-left.
    x runs 0..length left->right as seen from the camera; y runs 0 (far touchline)..width (near)."""
    return np.array([[0, 0], [length, 0], [length, width], [0, width]], dtype=np.float64)


def compute_homography(image_pts, length, width):
    import cv2
    H, _ = cv2.findHomography(np.asarray(image_pts, dtype=np.float64), field_corners(length, width))
    if H is None:
        raise ValueError("Could not compute homography from the 4 points (are they collinear?)")
    return H


def to_field(H, pts):
    """Image pixel points (N,2) -> field metres (N,2)."""
    pts = np.asarray(pts, dtype=np.float64).reshape(-1, 1, 2)
    if len(pts) == 0:
        return np.zeros((0, 2))
    import cv2
    return cv2.perspectiveTransform(pts, H).reshape(-1, 2)


def in_field(xy, length, width, margin):
    x, y = xy[..., 0], xy[..., 1]
    return (x >= -margin) & (x <= length + margin) & (y >= -margin) & (y <= width + margin)


# ---------------------------------------------------------------------------
# Calibration (click 4 corners once per video; reused afterwards)
# ---------------------------------------------------------------------------
CLICK_ORDER = ["FAR-LEFT corner", "FAR-RIGHT corner", "NEAR-RIGHT corner", "NEAR-LEFT corner"]


def calibrate(video, calib_path, corners_arg=None):
    video = Path(video)
    if calib_path.exists():
        data = json.loads(calib_path.read_text())
        if data.get("video") == video.name:
            print(f"Using saved calibration {calib_path}")
            return data["corners_px"]
        print(f"{calib_path} belongs to {data.get('video')}, recalibrating for {video.name}")
    if corners_arg:
        pts = [[float(v) for v in p.split(",")] for p in corners_arg.split(";")]
        if len(pts) != 4:
            sys.exit("--corners needs 4 points: 'x,y;x,y;x,y;x,y' (far-left, far-right, near-right, near-left)")
    else:
        pts = click_corners(video)
    calib_path.write_text(json.dumps({"video": video.name, "order": CLICK_ORDER, "corners_px": pts}, indent=2))
    print(f"Saved calibration to {calib_path}")
    return pts


def click_corners(video):
    import cv2
    cap = cv2.VideoCapture(str(video))
    cap.set(cv2.CAP_PROP_POS_FRAMES, 30)  # skip possible black first frames
    ok, frame = cap.read()
    cap.release()
    if not ok:
        sys.exit(f"Could not read a frame from {video}")
    pad = 200  # grey border so a corner just outside the picture can still be estimated
    canvas = cv2.copyMakeBorder(frame, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(60, 60, 60))
    scale = min(1.0, 1500 / canvas.shape[1], 950 / canvas.shape[0])
    pts = []
    win = "Click 4 field corners (u = undo, Enter = done, Esc = quit)"

    def on_mouse(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN and len(pts) < 4:
            pts.append([x / scale - pad, y / scale - pad])

    try:
        cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)
    except cv2.error:
        sys.exit("No display available for the click window. Re-run with "
                 "--corners 'x,y;x,y;x,y;x,y' (far-left, far-right, near-right, near-left, in pixels).")
    cv2.setMouseCallback(win, on_mouse)
    while True:
        view = canvas.copy()
        for i, (x, y) in enumerate(pts):
            c = (int(x + pad), int(y + pad))
            cv2.circle(view, c, 8, (0, 255, 255), 2)
            cv2.putText(view, str(i + 1), (c[0] + 10, c[1] - 10), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        if len(pts) > 1:
            cv2.polylines(view, [np.int32([[x + pad, y + pad] for x, y in pts])], len(pts) == 4, (0, 255, 255), 2)
        msg = f"Click the {CLICK_ORDER[len(pts)]}" if len(pts) < 4 else "Press Enter to accept, u to undo"
        cv2.putText(view, msg, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 255, 255), 3)
        cv2.imshow(win, cv2.resize(view, None, fx=scale, fy=scale))
        k = cv2.waitKey(30) & 0xFF
        if k == ord("u") and pts:
            pts.pop()
        elif k in (13, 10) and len(pts) == 4:
            break
        elif k == 27:
            sys.exit("Calibration cancelled")
    cv2.destroyAllWindows()
    return [[round(x, 1), round(y, 1)] for x, y in pts]


# ---------------------------------------------------------------------------
# Track post-processing (pure numpy; unit-tested)
# ---------------------------------------------------------------------------
def moving_average(a, window):
    """Centred moving average with a symmetric, shrinking window at the edges
    (keeps straight-line motion exactly straight, so distances aren't biased)."""
    n, h = len(a), window // 2
    if n == 0 or h == 0:
        return a.copy()
    c = np.concatenate([[0.0], np.cumsum(a)])
    out = np.empty(n)
    for i in range(n):
        k = min(h, i, n - 1 - i)
        out[i] = (c[i + k + 1] - c[i - k]) / (2 * k + 1)
    return out


def resample_track(times, xy, length, width, cfg=CONFIG):
    """Raw (time_s, field xy) samples of one track -> 10 Hz series.

    Returns (start_index, xs, ys) where index i means time (start+i)/hz and gaps
    longer than max_gap_s are None. Returns None if too little valid data."""
    hz = cfg["hz"]
    times, xy = np.asarray(times, float), np.asarray(xy, float).reshape(-1, 2)
    keep = in_field(xy, length, width, cfg["field_margin_m"])
    times, xy = times[keep], xy[keep]
    if len(times) == 0:
        return None
    idx = np.round(times * hz).astype(int)
    uniq, inv = np.unique(idx, return_inverse=True)
    pts = np.zeros((len(uniq), 2))
    np.add.at(pts, inv, xy)
    pts /= np.bincount(inv)[:, None]

    start, n = uniq[0], uniq[-1] - uniq[0] + 1
    xs, ys = np.full(n, np.nan), np.full(n, np.nan)
    max_gap = int(round(cfg["max_gap_s"] * hz))
    rel = uniq - start
    xs[rel], ys[rel] = pts[:, 0], pts[:, 1]
    for a, b, pa, pb in zip(rel[:-1], rel[1:], pts[:-1], pts[1:]):
        if 1 < b - a <= max_gap:
            f = np.arange(1, b - a) / (b - a)
            xs[a + 1:b] = pa[0] + (pb[0] - pa[0]) * f
            ys[a + 1:b] = pa[1] + (pb[1] - pa[1]) * f

    for s, e in segments(xs):
        xs[s:e] = moving_average(xs[s:e], cfg["smooth_window"])
        ys[s:e] = moving_average(ys[s:e], cfg["smooth_window"])
    if np.count_nonzero(~np.isnan(xs)) < cfg["min_track_s"] * hz:
        return None
    return int(start), xs, ys


def segments(a):
    """[(start, end)) runs of non-NaN values."""
    valid = ~np.isnan(a)
    edges = np.diff(np.concatenate([[0], valid.astype(int), [0]]))
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)))


def track_stats(xs, ys, cfg=CONFIG):
    """Distance (m), top speed (km/h), sprint count, minutes on field for one 10 Hz series."""
    hz = cfg["hz"]
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    dist, top, sprints = 0.0, 0.0, 0
    min_run = int(round(cfg["sprint_min_s"] * hz))
    for s, e in segments(xs):
        if e - s < 2:
            continue
        step = np.hypot(np.diff(xs[s:e]), np.diff(ys[s:e]))
        kmh = step * hz * 3.6
        ok = kmh <= cfg["max_kmh"]                 # glitch steps are ignored entirely
        dist += float(step[ok].sum())
        kmh = np.where(ok, kmh, np.nan)
        if len(kmh) >= hz:                          # top speed = best 1-second average
            win = np.convolve(np.nan_to_num(kmh), np.ones(hz), "valid")
            cnt = np.convolve(ok.astype(float), np.ones(hz), "valid")
            full = cnt == hz
            if full.any():
                top = max(top, float((win[full] / hz).max()))
        fast = np.nan_to_num(kmh) > cfg["sprint_kmh"]
        for a, b in segments(np.where(fast, 1.0, np.nan)):
            if b - a >= min_run:
                sprints += 1
    minutes = np.count_nonzero(~np.isnan(xs)) / hz / 60
    return {"distance_m": round(dist, 1), "top_speed_kmh": round(min(top, cfg["max_kmh"]), 1),
            "sprints": sprints, "minutes": round(minutes, 2)}


# ---------------------------------------------------------------------------
# Team split: k-means on shirt colour
# ---------------------------------------------------------------------------
def shirt_colour(frame, box):
    """Median Lab colour of the shirt area: upper half of the box, minus head, central strip."""
    import cv2
    x1, y1, x2, y2 = box
    h, w = y2 - y1, x2 - x1
    crop = frame[int(y1 + 0.15 * h):int(y1 + 0.5 * h), int(x1 + 0.25 * w):int(x2 - 0.25 * w)]
    if crop.size < 12:
        return None
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).reshape(-1, 3)
    return np.median(lab, axis=0)


def assign_teams(colour_samples):
    """{track_id: [lab,...]} -> ({track_id: 0|1}, [hex colour team0, team1])."""
    import cv2
    from sklearn.cluster import KMeans
    ids = [t for t, c in colour_samples.items() if len(c) > 0]
    if len(ids) < 2:
        return {t: 0 for t in ids}, ["#3b82f6", "#f97316"]
    feats = np.array([np.median(colour_samples[t], axis=0) for t in ids])
    weights = np.array([len(colour_samples[t]) for t in ids], float)
    km = KMeans(n_clusters=2, n_init=10, random_state=0).fit(feats, sample_weight=weights)
    hexes = []
    for c in km.cluster_centers_:
        bgr = cv2.cvtColor(np.uint8([[c]]), cv2.COLOR_LAB2BGR)[0, 0]
        hexes.append("#%02x%02x%02x" % (bgr[2], bgr[1], bgr[0]))
    return {t: int(l) for t, l in zip(ids, km.labels_)}, hexes


# ---------------------------------------------------------------------------
# Detection + tracking (streams frames; never holds the video in memory)
# ---------------------------------------------------------------------------
def load_detector(name, device=None):
    import rfdetr
    cls = {"nano": "RFDETRNano", "small": "RFDETRSmall", "medium": "RFDETRMedium",
           "large": "RFDETRLarge"}[name]
    kw = {"device": device} if device else {}
    model = getattr(rfdetr, cls)(**kw)
    try:
        model.optimize_for_inference()
    except Exception:
        pass  # optional speed-up; not available on every device
    return model


def run_tracking(video, H, length, width, args, cfg):
    import cv2
    import supervision as sv

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        sys.exit(f"Cannot open {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    if args.max_seconds:
        total = min(total, int(args.max_seconds * fps)) if total else int(args.max_seconds * fps)
    stride = args.stride or max(1, round(fps / cfg["hz"]))
    det_fps = fps / stride
    print(f"Video {video.name}: {fps:.2f} fps, ~{total} frames; detecting every {stride} frame(s) "
          f"({det_fps:.1f} Hz)")

    model = load_detector(args.model, args.device)
    tracker = sv.ByteTrack(track_activation_threshold=max(0.4, cfg["det_threshold"]),
                           lost_track_buffer=int(2 * det_fps), frame_rate=det_fps,
                           minimum_consecutive_frames=3)

    samples = {}            # tid -> ([t], [[x,y]])
    colours = {}            # tid -> [lab]  (capped)
    boxes = [] if args.debug else None   # (frame, tid, x1,y1,x2,y2, in_field)
    coverage = []           # in-field people per detection frame
    t0 = last_print = time.time()
    frame_i = 0
    while True:
        if total and frame_i >= total:
            break
        if frame_i % stride:
            if not cap.grab():
                break
            frame_i += 1
            continue
        ok, frame = cap.read()
        if not ok:
            break
        det = model.predict(frame[:, :, ::-1].copy(), threshold=cfg["det_threshold"])
        det = det[det.class_id == PERSON_CLASS_ID]
        det = tracker.update_with_detections(det)
        t = frame_i / fps
        n_in = 0
        if len(det):
            feet = np.column_stack([(det.xyxy[:, 0] + det.xyxy[:, 2]) / 2, det.xyxy[:, 3]])
            xy = to_field(H, feet)
            inside = in_field(xy, length, width, cfg["field_margin_m"])
            n_in = int(inside.sum())
            for k, tid in enumerate(det.tracker_id):
                tid = int(tid)
                if boxes is not None:
                    boxes.append((frame_i, tid, *map(int, det.xyxy[k]), bool(inside[k])))
                if not inside[k]:
                    continue
                st = samples.setdefault(tid, ([], []))
                st[0].append(t)
                st[1].append(xy[k].tolist())
                cs = colours.setdefault(tid, [])
                if len(cs) < 60 and len(st[0]) % 5 == 1:
                    c = shirt_colour(frame, det.xyxy[k])
                    if c is not None:
                        cs.append(c)
        coverage.append(n_in)
        frame_i += 1
        now = time.time()
        if now - last_print > 10:
            last_print = now
            rate = frame_i / (now - t0)
            eta = (total - frame_i) / rate if total else 0
            pct = f"{100 * frame_i / total:5.1f}%" if total else ""
            print(f"  {pct} frame {frame_i}/{total}  {rate:.0f} frames/s  ETA {eta / 60:.1f} min", flush=True)
    cap.release()
    duration = frame_i / fps
    print(f"Detection+tracking done: {frame_i} frames in {time.time() - t0:.0f}s")
    return samples, colours, boxes, coverage, fps, duration


# ---------------------------------------------------------------------------
# Rendering: debug video + top-down preview
# ---------------------------------------------------------------------------
TEAM_BGR = {0: (246, 130, 59), 1: (22, 115, 249), None: (160, 160, 160)}


def draw_field(length, width, ppm=12, pad=20):
    import cv2
    img = np.full((int(width * ppm) + 2 * pad, int(length * ppm) + 2 * pad, 3), (60, 130, 60), np.uint8)
    p = lambda x, y: (int(pad + x * ppm), int(pad + y * ppm))
    w = (240, 240, 240)
    cv2.rectangle(img, p(0, 0), p(length, width), w, 2)
    cv2.line(img, p(length / 2, 0), p(length / 2, width), w, 2)
    cv2.circle(img, p(length / 2, width / 2), int(min(width * 0.12, 9.15) * ppm), w, 2)
    return img, p


def render_preview(path, tracks, length, width):
    import cv2
    img, p = draw_field(length, width)
    for tr in tracks.values():
        col = TEAM_BGR.get(tr["team"], TEAM_BGR[None])
        pts = [p(x, y) for x, y in zip(tr["x"], tr["y"]) if x is not None]
        for a in pts[::3]:
            cv2.circle(img, a, 1, col, -1)
    cv2.imwrite(str(path), img)


def render_debug(video, out_path, boxes, teams, max_frames):
    import cv2
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    tmp = out_path.with_suffix(".tmp.mp4")
    vw = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    by_frame = {}
    for b in boxes:
        by_frame.setdefault(b[0], []).append(b[1:])
    det_frames = sorted(by_frame)
    current, j, i = [], 0, 0
    while i < max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        while j < len(det_frames) and det_frames[j] <= i:
            current = by_frame[det_frames[j]]
            j += 1
        for tid, x1, y1, x2, y2, inside in current:
            col = TEAM_BGR.get(teams.get(tid), TEAM_BGR[None]) if inside else (128, 128, 128)
            cv2.rectangle(frame, (x1, y1), (x2, y2), col, 2)
            cv2.putText(frame, str(tid), (x1, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2)
        vw.write(frame)
        i += 1
    vw.release()
    cap.release()
    if shutil.which("ffmpeg"):  # re-encode to H.264 so it plays in a browser
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp), "-c:v", "libx264",
                            "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", str(out_path)])
        if r.returncode == 0:
            tmp.unlink()
            return
    tmp.replace(out_path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def r1(v):
    return None if v is None or math.isnan(v) else round(float(v), 2)


def merge_half(path, half, payload):
    """tracks.json / stats.json hold both halves; re-running one half replaces only that half."""
    data = json.loads(path.read_text()) if path.exists() else {}
    data.setdefault("halves", {})[str(half)] = payload
    data["version"] = 1
    path.write_text(json.dumps(data, separators=(",", ":")))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", type=Path)
    ap.add_argument("--field", required=True, help="field size in metres, e.g. 55x36")
    ap.add_argument("--out", required=True, type=Path, help="match folder, e.g. matches/2026-11-08/")
    ap.add_argument("--half", type=int, default=1, choices=[1, 2])
    ap.add_argument("--players", type=int, default=14,
                    help="players expected on the field at once (both teams, incl. keepers); 7v7 = 14")
    ap.add_argument("--model", default="medium", choices=["nano", "small", "medium", "large"])
    ap.add_argument("--device", default=None, help="cuda / cpu / mps (default: let RF-DETR decide)")
    ap.add_argument("--stride", type=int, default=0, help="detect every Nth frame (default: fps/10)")
    ap.add_argument("--max-seconds", type=float, default=0, help="only process the first N seconds")
    ap.add_argument("--corners", help="skip the click window: 'x,y;x,y;x,y;x,y' (FL, FR, NR, NL pixels)")
    ap.add_argument("--debug", action="store_true", help="also render debug.mp4 with boxes/ids/teams")
    for k, v in CONFIG.items():
        ap.add_argument("--" + k.replace("_", "-"), type=type(v), default=v)
    args = ap.parse_args(argv)

    t_start = time.time()
    cfg = {k: getattr(args, k) for k in CONFIG}
    length, width = parse_field(args.field)
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    if not args.video.exists():
        sys.exit(f"No such video: {args.video}")

    corners = calibrate(args.video, out / f"calibration_h{args.half}.json", args.corners)
    H = compute_homography(corners, length, width)

    samples, colours, boxes, coverage, fps, duration = run_tracking(args.video, H, length, width, args, cfg)

    teams, team_hex = assign_teams(colours)
    tracks, stats = {}, {}
    for tid, (ts, xy) in samples.items():
        res = resample_track(ts, xy, length, width, cfg)
        if res is None:
            continue
        start, xs, ys = res
        key = f"{args.half}-{tid}"
        tracks[key] = {"team": teams.get(tid), "start": start,
                       "x": [r1(v) for v in xs], "y": [r1(v) for v in ys]}
        stats[key] = {"team": teams.get(tid), **track_stats(xs, ys, cfg)}

    need = math.ceil(0.8 * args.players)
    cov = (sum(c >= need for c in coverage) / len(coverage)) if coverage else 0.0
    video_ref = os.path.relpath(args.video.resolve(), out.resolve())
    meta = {"video": video_ref, "video_name": args.video.name, "fps": fps, "duration_s": round(duration, 2),
            "field": [length, width], "hz": cfg["hz"], "team_colours": team_hex,
            "expected_players": args.players, "coverage_80pct": round(cov, 3),
            "mean_people_in_field": round(float(np.mean(coverage)) if coverage else 0, 2),
            "model": args.model, "config": cfg}
    merge_half(out / "tracks.json", args.half, {"meta": meta, "tracks": tracks})
    merge_half(out / "stats.json", args.half, {"meta": meta, "players": stats})
    render_preview(out / f"preview_h{args.half}.png", tracks, length, width)
    if args.debug:
        print("Rendering debug video ...")
        render_debug(args.video, out / f"debug_h{args.half}.mp4", boxes, teams, int(duration * fps))

    print(f"\nHalf {args.half}: {len(tracks)} tracks kept (of {len(samples)} raw), "
          f"team colours {team_hex}")
    print(f"Frames with >= {need} of {args.players} expected players detected in field: {100 * cov:.1f}% "
          f"(mean {meta['mean_people_in_field']} people in field)")
    print(f"Wrote {out / 'tracks.json'}, {out / 'stats.json'}, preview_h{args.half}.png"
          + (f", debug_h{args.half}.mp4" if args.debug else ""))
    print(f"Total runtime: {time.time() - t_start:.0f}s")


if __name__ == "__main__":
    main()
