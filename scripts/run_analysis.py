"""Analyze a broad jump video.

Examples
    python scripts/run_analysis.py jump.mp4
    python scripts/run_analysis.py jump.mp4 --calibration output/calibration.json
    python scripts/run_analysis.py jump.mp4 --scale 0.0021 --start 1.5 --end 4.0
    python scripts/run_analysis.py jump.mp4 --events toe_heel --show
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from jumplab.calibration import load_calibration  # noqa: E402
from jumplab.events import NoJumpFound  # noqa: E402
from jumplab.center_of_mass import MODES  # noqa: E402
from jumplab.pipeline import EVENT_METHODS, TRAJECTORY_POINTS, AnalysisConfig, analyze_video  # noqa: E402
from jumplab.alerts import use_color, verdict  # noqa: E402
from jumplab.report import format_report, save_csv, save_json  # noqa: E402
from jumplab.web import make_bundle  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video")
    cal = p.add_mutually_exclusive_group()
    cal.add_argument("--calibration", help="calibration JSON from scripts/calibrate.py")
    cal.add_argument("--scale", type=float, help="meters per pixel, if you already know it")
    p.add_argument("--output", help="output folder (default: output/<video name>, one folder per video)")
    p.add_argument("--start", type=float, help="analyze from this time (s)")
    p.add_argument("--end", type=float, help="analyze up to this time (s)")
    p.add_argument("--events", choices=EVENT_METHODS, default="ankle",
                   help="takeoff/landing method (default: ankle, the original)")
    p.add_argument("--threshold", type=float, default=0.15,
                   help="fraction of foot rise that counts as airborne (default 0.15)")
    p.add_argument("--cutoff", type=float, default=10.0, help="smoothing cutoff in Hz (default 10)")
    p.add_argument("--side", choices=["LEFT", "RIGHT"], help="force a body side")
    p.add_argument("--trajectory-point", choices=TRAJECTORY_POINTS, default="com",
                   help="fit the parabola to the whole-body center of mass (default) or the hip")
    p.add_argument("--com-mode", choices=MODES, default="symmetric",
                   help="symmetric (default): camera-side limbs count for both sides; "
                        "both: use MediaPipe's guess for the hidden far-side limbs")
    p.add_argument("--no-skeleton", action="store_true", help="don't write the skeleton video")
    p.add_argument("--retrack", action="store_true", help="re-run MediaPipe even if cached")
    p.add_argument("--fps", type=float, help="the video's real frame rate, if the file's own is "
                   "wrong (e.g. slow-motion saved for slowed-down playback: use 120 or 240)")
    p.add_argument("--show", action="store_true", help="show plots in a window")
    args = p.parse_args()

    if not args.show:
        import matplotlib
        matplotlib.use("Agg")
    from jumplab.plotting import plot_events, plot_trajectory

    scale = args.scale
    if args.calibration:
        c = load_calibration(args.calibration)
        scale = c.m_per_px
        print(f"Calibration: {c.distance_m} m = {c.pixel_distance:.1f} px -> {scale:.5f} m/px"
              + (f" (includes depth correction x{c.depth_correction:.3f})"
                 if c.depth_correction != 1.0 else ""))

    config = AnalysisConfig(cutoff_hz=args.cutoff, event_method=args.events,
                            threshold_fraction=args.threshold, start_s=args.start,
                            end_s=args.end, side=args.side,
                            trajectory_point=args.trajectory_point, com_mode=args.com_mode)
    stem = os.path.splitext(os.path.basename(args.video))[0]
    args.output = args.output or os.path.join("output", stem)   # everything from one video together
    print(f"Analyzing {args.video} ...")
    try:
        r = analyze_video(args.video, scale, config, args.output,
                          skeleton_video=not args.no_skeleton, retrack=args.retrack,
                          fps_override=args.fps)
    except NoJumpFound as e:
        sys.exit(f"No jump found: {e}")

    w, h = r["frame_size"]
    if args.calibration and c.width and (c.width, c.height) != (w, h):
        print(f"WARNING: calibration was made on a {c.width}x{c.height} video; this one is {w}x{h}.")

    color = use_color()
    print(format_report(r, color=color))
    out = lambda name: os.path.join(args.output, f"{stem}_{name}")  # noqa: E731
    save_csv(r, out("keypoints_and_angles.csv"))
    save_json(r, out("results.json"))
    with open(out("web.json"), "w") as f:                    # open this on the website's Demo page
        json.dump(make_bundle(r, r["_keypoints"], os.path.basename(args.video)), f, separators=(",", ":"))
    plot_events(r, out("events_plot.png"), show=args.show)
    plot_trajectory(r, out("trajectory_plot.png"), show=args.show)
    print(f"\nKeypoints cache: {r['files']['keypoints']}"
          + ("  (MediaPipe run)" if r["files"]["ran_mediapipe"] else "  (reused, MediaPipe skipped)"))
    if r["files"]["skeleton_video"]:
        print(f"Skeleton video:  {r['files']['skeleton_video']}")
    print(f"Saved {out('keypoints_and_angles.csv')}, {out('results.json')}, {out('web.json')},")
    print(f"      {out('events_plot.png')}, {out('trajectory_plot.png')}")
    print("\n" + verdict(r["warnings"], color))             # the last line on screen: the verdict


if __name__ == "__main__":
    main()
