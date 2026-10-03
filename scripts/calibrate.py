"""Click two points a known distance apart to get meters per pixel.

Examples
    # Tape measure lying on the jump line:
    python scripts/calibrate.py calibration_clip.mp4 --distance 2.0

    # Tape 1.0 m in front of the jump line, camera 5.0 m from the jump line:
    python scripts/calibrate.py calibration_clip.mp4 --distance 2.0 \\
        --camera-to-reference 4.0 --camera-to-jump 5.0

Then pass --calibration output/calibration.json to run_analysis.py.
Camera distances are measured straight out from the lens, perpendicular to the jump line.
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
    p.add_argument("--camera-to-reference", type=float, metavar="M",
                   help="camera -> reference (tape) distance in meters; only needed if the "
                        "reference is NOT on the jump line")
    p.add_argument("--camera-to-jump", type=float, metavar="M",
                   help="camera -> jump line distance in meters (use with --camera-to-reference)")
    p.add_argument("--out", default="output/calibration.json")
    args = p.parse_args()

    if (args.camera_to_reference is None) != (args.camera_to_jump is None):
        p.error("give both --camera-to-reference and --camera-to-jump, or neither")

    distance = args.distance or float(input("Known distance between the two points (m): "))
    cal = calibrate_video(args.video, distance, args.frame,
                          args.camera_to_reference, args.camera_to_jump)
    save_calibration(cal, args.out)
    if cal.m_per_px_at_reference is None:
        print(f"{distance} m = {cal.pixel_distance:.1f} px  ->  {cal.m_per_px:.6f} m/px "
              f"({1 / cal.m_per_px:.1f} px/m)")
    else:
        print(f"At the reference: {distance} m = {cal.pixel_distance:.1f} px  ->  "
              f"{cal.m_per_px_at_reference:.6f} m/px")
        print(f"Depth correction: jump line is {cal.camera_to_jump_m} m away, reference "
              f"{cal.camera_to_reference_m} m  ->  x{cal.depth_correction:.3f}")
        print(f"At the jump line: {cal.m_per_px:.6f} m/px ({1 / cal.m_per_px:.1f} px/m)")
    print(f"Saved {args.out}")


if __name__ == "__main__":
    main()
