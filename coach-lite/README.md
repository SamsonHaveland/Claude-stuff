# Coach-Lite

A small, private match-analysis tool for one youth soccer team. It turns one fixed phone video per half into:

- a top-down 2D replay synced to the video,
- player and team heatmaps,
- per-player running stats (distance, top speed, sprints, minutes),
- 15-second clips of moments you tag, plus a goals reel,
- season totals per player.

Everything runs on your own computer. Nothing is uploaded anywhere.

| File | What it does |
|---|---|
| `analyze.py` | Video → `tracks.json` + `stats.json` (RF-DETR detection, ByteTrack tracking, homography to field metres) |
| `index.html` | Coach page: replay, naming/merging players, tagging, heatmaps, stats table. Open it straight from disk with no server. |
| `clips.py` | Cuts a clip per tag (10 s before, 5 s after) + `goals_reel.mp4` |
| `season.py` | Sums named players' stats across matches → `season.csv` |
| `tests/` | Unit tests, plus `make_demo_match.py` to try everything without real footage |

## Setup

1. Python 3.10+ and [ffmpeg](https://ffmpeg.org/download.html) on your PATH.
2. NVIDIA GPU only: install the CUDA build of PyTorch first, following the selector on pytorch.org.
3. Install the rest:
   ```bash
   python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
   The first run downloads the RF-DETR weights (~390 MB for `medium`) to `~/.roboflow/models/`.

**Speed guide** (30-minute half, 1080p30, default settings, which detect at 10 Hz):

| Where | Approx. time |
|---|---|
| 4-core laptop CPU | ~75–90 min (measured: 0.25 s per frame for detection) |
| NVIDIA GPU (e.g. RTX 3060 or a rented RunPod GPU) | roughly 5–15 min (estimate, not measured) |
| Apple Silicon | not measured; try `--device mps`, otherwise it falls back to CPU |

Use `--model small` or `--model nano` for speed, or `--model large` if far-side kids are being missed.

## Filming tips

- Tripod at 15–20 ft at the halfway line, as far back from the touchline as you can. Higher is better: kids overlap less.
- Frame the **whole field**. All four corner flags should ideally be visible. If a near corner is just off-screen, the click window has a grey border so you can estimate it.
- Lock exposure/focus, use landscape at 1080p30, and **don't touch the phone during a half**. Any camera movement breaks the field mapping.
- One file per half. Name them e.g. `half1.mp4` and `half2.mp4` and **put them in the match folder** so the coach page finds them automatically.
- Avoid shooting into the sun. Strong backlight ruins shirt colours and therefore the team split.

## How to run

### 1. Analyse each half

```bash
python analyze.py matches/2026-11-08/half1.mp4 --field 55x36 --out matches/2026-11-08/ --half 1
python analyze.py matches/2026-11-08/half2.mp4 --field 55x36 --out matches/2026-11-08/ --half 2
```

- `--field` is the **measured** length × width in metres.
- On the first run a window opens on one frame. Click the corners in this order: **far-left, far-right, near-right, near-left** (`u` = undo, `Enter` = accept). The points are saved to `calibration_h1.json` and reused for that video. Delete the file to recalibrate. If you have no display (e.g. a rented GPU server), pass the pixels directly: `--corners "x,y;x,y;x,y;x,y"`.
- `--players 14` is how many players should be on the field (7v7 = 14). It's only used for the detection-coverage report.
- Outputs: `tracks.json` and `stats.json` (both halves in one file; re-running a half replaces only that half), plus `preview_h1.png`, a top-down plot of every track.

**Try a short sample first (gate 1):**

```bash
python analyze.py half1.mp4 --field 55x36 --out matches/test/ --max-seconds 120 --debug
```

`--debug` writes `debug_h1.mp4` with boxes, track ids and team colours. Grey boxes are people outside the field (parents, subs). The run also prints the **share of frames where ≥80% of the expected players were detected**.

Thresholds are command-line flags (and recorded in `stats.json`): `--sprint-kmh 15`, `--sprint-min-s 1`, `--max-kmh 30`, `--max-gap-s 1`, `--smooth-window 5`, `--field-margin-m 0.5`, `--det-threshold 0.3`, `--min-track-s 2`.

### 2. Coach page

Open `index.html` in Chrome or Edge (double-click it) → **Open match folder…** → pick the match folder. Firefox and Safari work too via **Open folder (fallback)**, but there coach.json is saved as a download you move into the folder yourself.

- **Name players:** click a dot, type a name, Enter. **Merge** broken tracks by giving them the same name. The page warns if two tracks with the same name are on the field at the same time, which usually means two different kids.
- **Fix teams:** with a dot selected, use the team dropdown to mark keepers, the referee, or "Ignore" for a parent who walked on. The k-means split only knows two shirt colours, so keepers and the referee need this fix.
- **Tag:** `G` our goal, `A` goal against, `C` chance, `T` teaching moment, then type an optional note and press Enter. Tags appear on the timeline under the video; click one to jump to 3 s before it. `Space` plays/pauses and `←`/`→` skip 5 s.
- **Heatmap:** switch to *Heatmap* and pick a team or a named player and a half. "Both halves" rotates half 2 by default because teams swap ends.
- **Stats table:** click a header to sort. Merged tracks are summed (top speed = best).
- **Save coach.json** writes into the folder (Chrome/Edge) or downloads it. Unsaved edits are also kept as a draft in the browser and restored if you reopen the same folder.

### 3. Clips

```bash
python clips.py matches/2026-11-08/                   # reel = our goals
python clips.py matches/2026-11-08/ --reel-types G,A  # reel = goals for and against
```

This writes `clips/01_h1_12m34s_goal.mp4` … and `goals_reel.mp4`. Clips are re-encoded with `-preset veryfast`.

### 4. Season totals

```bash
python season.py matches/
```

This writes `matches/season.csv`: matches, minutes, distance, m/min, top speed (and which match), sprints. Only named players count, and matches need a saved `coach.json`.

### Try it without footage

```bash
python tests/make_demo_match.py demo_matches/2026-01-01
```

This builds a fake match (synthetic players + test-pattern videos) you can open in the page and run `clips.py` and `season.py` on.

### Tests

```bash
python -m unittest discover -s tests -v
```

These cover the homography (the clicked corners map to the field corners within 0.5 m) and the stats maths on synthetic tracks: distance, top speed, sprint counting, glitch rejection, gap handling and out-of-field filtering.

## Privacy and deleting a match

The players are minors, so:

- Everything stays on your computer. The coach page makes **no network requests**: no CDNs, fonts or analytics (checked in testing). The only download the tools ever make is the one-time RF-DETR model weights.
- If you use a rented GPU, upload the video only to that private machine. Delete it there when done (see below) and terminate the instance. Never put footage in a public bucket or share link.
- `.gitignore` excludes `matches/` and video files so footage can't be committed by accident.

**To delete a match completely:**

1. Delete the match folder: `rm -rf matches/2026-11-08/` (Windows: delete the folder, then empty the Recycle Bin). This removes the videos if you kept them there, `tracks.json`, `stats.json`, `coach.json`, calibration files, previews, the debug video, `clips/` and `goals_reel.mp4`.
2. Delete any original video files kept elsewhere: the phone's camera roll, your Downloads folder, and any rented GPU machine.
3. Re-run `python season.py matches/` so `season.csv` no longer includes that match.
4. Browser draft: unsaved edits are kept in the browser until you click **Save**, which deletes the draft. Before deleting a match, open it and click Save once. Drafts hold names and tags only, never video.

## Known limits

- **Accuracy is approximate.** With one camera at ground level, far-side kids are small, and when kids bunch up tracks swap or break. Accuracy on real youth footage hasn't been measured yet. Treat distances and speeds as good for comparing your own players with each other and over a season, not as exact numbers. Expect IDs to break several times per half. Merging by name fixes broken tracks but not two kids' tracks swapping.
- **Positions use the feet point of the box.** Kids partly hidden behind others get a box that's too short, which places them a bit too far from the camera.
- **Team split is by shirt colour only.** Similar colours (e.g. navy vs black), bibs, or strong shadows can confuse it. Keepers and the referee must be fixed by hand.
- **No ball tracking** (out of scope for v1). This also means no possession stats.
- **A moving camera breaks everything.** If the phone gets bumped, split the video at that point and calibrate each piece.
- **The 30 km/h cap** throws away implausible steps (ID swaps). A genuinely fast teenager would be under-reported; raise `--max-kmh` for older age groups.
- **Halves:** one video per half, analysed separately. Track ids are prefixed with the half (`1-12`, `2-7`), so name players in each half.
