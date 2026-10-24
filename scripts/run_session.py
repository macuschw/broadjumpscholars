"""Analyze a video with several jumps (a session): find every jump, judge each one, and print a
table with the verdicts.

Examples
    python scripts/run_session.py "../test videos/IMG_6233.MOV"
    python scripts/run_session.py session.mov --calibration output/calibration.json
    python scripts/run_session.py session.mov --scale 0.0031 --fps 120

Writes, in output/<video name>/: <name>_session.json (the table, and each jump's results) and
<name>_session_web.json (open it on the website's Analyze page, with the video, to see every jump).
The tracking is cached in <name>_keypoints.npz, so a second run is quick.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from jumplab.alerts import headline, paint, use_color  # noqa: E402
from jumplab.calibration import load_calibration  # noqa: E402
from jumplab.pipeline import EVENT_METHODS, AnalysisConfig  # noqa: E402
from jumplab.pose_tracking import jumps_in_keypoints, load_or_track  # noqa: E402
from jumplab.report import _jsonable  # noqa: E402
from jumplab.session import analyze_session, best_valid, summary_rows  # noqa: E402
from jumplab.web import SESSION_FORMAT, make_bundle, still_frame  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video")
    cal = p.add_mutually_exclusive_group()
    cal.add_argument("--calibration", help="calibration JSON from scripts/calibrate.py")
    cal.add_argument("--scale", type=float, help="meters per pixel, if you already know it")
    p.add_argument("--events", choices=EVENT_METHODS, default="ankle", help="takeoff/landing method (default: ankle)")
    p.add_argument("--fps", type=float, help="the video's real frame rate, if the file's own is wrong")
    p.add_argument("--output", help="output folder (default: output/<video name>)")
    p.add_argument("--retrack", action="store_true", help="re-run MediaPipe even if cached")
    p.add_argument("--no-people-check", action="store_true", help="skip the check for other people in the shot")
    args = p.parse_args()

    scale = load_calibration(args.calibration).m_per_px if args.calibration else args.scale
    stem = os.path.splitext(os.path.basename(args.video))[0]
    out_dir = args.output or os.path.join("output", stem)
    kp, ran = load_or_track(args.video, os.path.join(out_dir, f"{stem}_keypoints.npz"), retrack=args.retrack)
    segments = jumps_in_keypoints(kp, args.fps)
    print(f"{os.path.basename(args.video)}: {kp.n_frames} frames at {kp.fps:.1f} fps"
          f" ({'tracked now' if ran else 'tracking reused'}); {len(segments)} possible jumps")
    jumps, skipped = analyze_session(kp, segments, scale, AnalysisConfig(event_method=args.events), args.fps,
                                     None if args.no_people_check else args.video,
                                     progress=lambda i, n: print(f"  analyzing {i + 1} of {n}...", end="\r"))
    print(" " * 40, end="\r")
    color, best = use_color(), best_valid(jumps)
    unit = "m" if scale else "m*"
    print(f"\n  #   takeoff   distance  verdict")
    for row, (_, r) in zip(summary_rows(jumps), jumps):
        d = "   —   " if row["distance_m"] is None else f"{row['distance_m']:5.2f} {unit}"
        if row["valid"]:
            verdict = paint("valid" + ("  <- best" if row["jump"] == best else ""), "green", color)
        else:
            verdict = paint("DOESN'T COUNT: " + "; ".join(headline(f) for f in r["fouls"]), "red", color)
        notes = "; ".join(headline(w) for w in r["warnings"] if w["severity"] == "serious")
        print(f"  {row['jump']:<3} {row['takeoff_s']:6.2f} s   {d}  {verdict}" + (f"\n{'':25}check: {notes}" if notes else ""))
    for s in skipped:
        print(f"  (skipped {s['segment'][0] / kp.fps:.1f}-{s['segment'][1] / kp.fps:.1f} s: {s['reason']})")
    if not scale:
        print("  * no tape calibration: distances use the rough gravity-based scale (--calibration or --scale)")

    name = os.path.basename(args.video)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{stem}_session.json"), "w") as f:
        json.dump(_jsonable({"video": name, "best": best, "jumps": summary_rows(jumps), "skipped": skipped,
                             "results": [{k: v for k, v in r.items() if k not in ("series",) and not k.startswith("_")}
                                         for _, r in jumps]}), f, indent=2)
    first = jumps[0][1]["events"]["movement_onset"]["frame"] if jumps else 0
    web_session = {"format": SESSION_FORMAT, "name": name, "jumps": [make_bundle(r, k, name) for k, r in jumps],
                   "skipped": skipped, "best": best, "still": still_frame(args.video, max(0, first - int(0.3 * kp.fps)))}
    with open(os.path.join(out_dir, f"{stem}_session_web.json"), "w") as f:
        json.dump(web_session, f, separators=(",", ":"))
    print(f"\nSaved {os.path.join(out_dir, stem)}_session.json and _session_web.json")


if __name__ == "__main__":
    main()
