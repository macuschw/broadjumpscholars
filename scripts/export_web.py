"""Make website files (<video>_web.json) from analyses you have already run.

run_analysis.py writes a _web.json for every new run. For older runs, this builds one from the
files they saved (_results.json, _keypoints_and_angles.csv, _keypoints.npz) - nothing is
re-analyzed, so the numbers are exactly the ones you already have. Open the _web.json on the
website's Demo page ("Open results"), optionally with the video, to see the jump there.

Examples
    python scripts/export_web.py output/jump9
    python scripts/export_web.py output                 # every run under output/
    python scripts/export_web.py output/jump9/IMG_6199_results.json
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from jumplab.web import bundle_from_files, find_results  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("target", help="an output folder, or one _results.json")
    args = p.parse_args()
    found = find_results(args.target)
    if not found:
        sys.exit(f"No _results.json found in {args.target}.")
    for path in found:
        out = path[: -len("_results.json")] + "_web.json"
        try:
            bundle = bundle_from_files(path)
        except (FileNotFoundError, ValueError) as e:
            print(f"Skipped {path}: {e}")
            continue
        with open(out, "w") as f:
            json.dump(bundle, f, separators=(",", ":"))
        print(f"Saved {out}  ({os.path.getsize(out) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
