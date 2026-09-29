"""Click two points a known distance apart to get meters per pixel.

Example
    python scripts/calibrate.py calibration_clip.mp4 --distance 2.0
Then pass --calibration output/calibration.json to run_analysis.py.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from jumplab.calibration import calibrate_video, save_calibration  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video")
    p.add_argument("--distance", type=float, help="real distance between the points, in meters")
    p.add_argument("--frame", type=int, default=0, help="which frame to click on (default 0)")
    p.add_argument("--out", default="output/calibration.json")
    args = p.parse_args()

    distance = args.distance or float(input("Known distance between the two points (m): "))
    cal = calibrate_video(args.video, distance, args.frame)
    save_calibration(cal, args.out)
    print(f"{distance} m = {cal.pixel_distance:.1f} px  ->  {cal.m_per_px:.6f} m/px "
          f"({1 / cal.m_per_px:.1f} px/m)")
    print(f"Saved {args.out}")


if __name__ == "__main__":
    main()
