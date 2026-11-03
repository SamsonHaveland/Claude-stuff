#!/usr/bin/env python3
"""Season totals per named player across all match folders.

    python season.py matches/            -> matches/season.csv

A match counts only if it has stats.json and coach.json (names come from coach.json).
Tracks given the same name are summed; tracks marked Referee/Ignore and unnamed tracks are skipped.
"""
import argparse
import csv
import json
import sys
from pathlib import Path


def match_totals(folder):
    stats = json.loads((folder / "stats.json").read_text())
    coach = json.loads((folder / "coach.json").read_text())
    names, team_fix = coach.get("names", {}), coach.get("team", {})
    out = {}
    for half in stats["halves"].values():
        for tid, s in half["players"].items():
            name = names.get(tid)
            if not name or team_fix.get(tid) in ("REF", "X"):
                continue
            p = out.setdefault(name, {"minutes": 0.0, "distance_m": 0.0, "top_speed_kmh": 0.0, "sprints": 0})
            p["minutes"] += s["minutes"]
            p["distance_m"] += s["distance_m"]
            p["sprints"] += s["sprints"]
            p["top_speed_kmh"] = max(p["top_speed_kmh"], s["top_speed_kmh"])
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("matches", type=Path)
    ap.add_argument("--out", type=Path, help="default: <matches>/season.csv")
    args = ap.parse_args(argv)

    season, used = {}, []
    for folder in sorted(p for p in args.matches.iterdir() if p.is_dir()):
        if not (folder / "stats.json").exists():
            continue
        if not (folder / "coach.json").exists():
            print(f"  skip {folder.name}: no coach.json (name players in index.html and save first)")
            continue
        used.append(folder.name)
        for name, s in match_totals(folder).items():
            p = season.setdefault(name, {"matches": 0, "minutes": 0.0, "distance_m": 0.0, "top_speed_kmh": 0.0,
                                         "sprints": 0, "best_match": ""})
            p["matches"] += 1
            p["minutes"] += s["minutes"]
            p["distance_m"] += s["distance_m"]
            p["sprints"] += s["sprints"]
            if s["top_speed_kmh"] > p["top_speed_kmh"]:
                p["top_speed_kmh"], p["best_match"] = s["top_speed_kmh"], folder.name
    if not season:
        sys.exit("No named players found. Name players in index.html and save coach.json first.")

    out = args.out or args.matches / "season.csv"
    cols = ["player", "matches", "minutes", "distance_km", "m_per_min", "top_speed_kmh", "top_speed_match",
            "sprints", "sprints_per_match"]
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for name, p in sorted(season.items(), key=lambda kv: -kv[1]["distance_m"]):
            w.writerow([name, p["matches"], round(p["minutes"], 1), round(p["distance_m"] / 1000, 2),
                        round(p["distance_m"] / p["minutes"]) if p["minutes"] else 0,
                        round(p["top_speed_kmh"], 1), p["best_match"], p["sprints"],
                        round(p["sprints"] / p["matches"], 1)])
    print(f"{len(season)} players across {len(used)} matches ({', '.join(used)}) -> {out}")


if __name__ == "__main__":
    main()
