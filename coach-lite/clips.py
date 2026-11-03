#!/usr/bin/env python3
"""Cut a 15 s clip per coach tag (10 s before, 5 s after) and a goals reel.

    python clips.py matches/2026-11-08/
    python clips.py matches/2026-11-08/ --reel-types G,A     # reel with goals for AND against

Reads coach.json (tags) and tracks.json (which video belongs to which half).
Writes clips/NN_h1_12m34s_goal.mp4 ... and goals_reel.mp4 into the match folder.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

NAMES = {"G": "goal", "A": "goal-against", "C": "chance", "T": "teaching"}
BEFORE, AFTER = 10.0, 5.0


def find_video(folder, meta):
    """Prefer a copy inside the match folder, else the path recorded at analysis time."""
    for cand in (folder / meta["video_name"], (folder / meta["video"]).resolve()):
        if cand.exists():
            return cand
    sys.exit(f"Can't find video for this half: looked for {meta['video_name']} in {folder} and {meta['video']}")


def ffmpeg_cmd(src, start, dur, dst, audio=True):
    # Re-encode (not stream copy) so every clip starts cleanly and all clips share one format for the reel.
    a = ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"] if audio else ["-an"]
    return ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.2f}", "-i", str(src), "-t", f"{dur:.2f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            *a, "-movflags", "+faststart", str(dst)]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", type=Path)
    ap.add_argument("--reel-types", default="G", help="tag types in goals_reel.mp4 (default: G = our goals)")
    args = ap.parse_args(argv)
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH")
    folder = args.folder
    coach = json.loads((folder / "coach.json").read_text())
    halves = json.loads((folder / "tracks.json").read_text())["halves"]
    tags = sorted(coach.get("tags", []), key=lambda t: (int(t["half"]), float(t["t"])))
    if not tags:
        sys.exit("No tags in coach.json")

    out = folder / "clips"
    out.mkdir(exist_ok=True)
    reel_types = set(args.reel_types.upper().split(","))
    reel = []
    for n, tag in enumerate(tags, 1):
        half = str(tag["half"])
        if half not in halves:
            print(f"  skip tag {n}: no analysed video for half {half}")
            continue
        meta = halves[half]["meta"]
        src = find_video(folder, meta)
        t = float(tag["t"])
        start = max(0.0, t - BEFORE)
        end = min(t + AFTER, meta.get("duration_s") or t + AFTER)
        mm, ss = divmod(int(t), 60)
        dst = out / f"{n:02d}_h{half}_{mm:02d}m{ss:02d}s_{NAMES.get(tag['type'], tag['type'])}.mp4"
        print(f"  {dst.name}  {tag.get('note', '')}")
        r = subprocess.run(ffmpeg_cmd(src, start, end - start, dst), stderr=subprocess.DEVNULL)
        if r.returncode != 0:  # retry without audio (video files with no audio track)
            if subprocess.run(ffmpeg_cmd(src, start, end - start, dst, audio=False)).returncode != 0:
                print(f"  ! ffmpeg failed for {dst.name}")
                continue
        if tag["type"] in reel_types:
            reel.append(dst)

    if reel:
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            for p in reel:
                f.write(f"file '{p.resolve()}'\n")
            lst = f.name
        dst = folder / "goals_reel.mp4"
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
                            "-c", "copy", "-movflags", "+faststart", str(dst)])
        Path(lst).unlink()
        print(f"Wrote {dst} ({len(reel)} clips)" if r.returncode == 0 else "! goals reel failed")
    else:
        print(f"No tags of type {','.join(sorted(reel_types))}, so no goals reel was made")
    print(f"Clips in {out}")


if __name__ == "__main__":
    main()
