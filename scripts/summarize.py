"""Print a plain-language summary of an analyzed jump, by category, with reliability ratings.

Run run_analysis.py first; this reads the _results.json it saved (no re-analysis).

Examples
    python scripts/summarize.py "../caliberationtestvid(120fps).mp4"
    python scripts/summarize.py output/myjump_results.json
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from jumplab.summary import format_summary  # noqa: E402


def results_path(arg, output_dir):
    """Accept either a _results.json file or the original video path."""
    if arg.endswith(".json"):
        return arg
    stem = os.path.splitext(os.path.basename(arg))[0]
    return os.path.join(output_dir, f"{stem}_results.json")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("target", help="the video you analyzed, or its _results.json")
    p.add_argument("--output", default="output", help="folder run_analysis.py saved to")
    args = p.parse_args()

    path = results_path(args.target, args.output)
    if not os.path.exists(path):
        sys.exit(f"No results found at {path}. Run scripts/run_analysis.py on the video first.")
    with open(path) as f:
        text = format_summary(json.load(f))
    print(text)

    txt = path.replace("_results.json", "_summary.txt") if path.endswith("_results.json") \
        else os.path.splitext(path)[0] + "_summary.txt"
    with open(txt, "w") as f:
        f.write(text + "\n")
    print(f"\nSaved {txt}")


if __name__ == "__main__":
    main()
