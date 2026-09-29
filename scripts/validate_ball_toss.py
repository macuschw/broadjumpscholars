"""Physics check: track a dropped/tossed ball, fit a parabola, and compare g to 9.81 m/s^2.

Film it with the same camera setup as the jumps. If g comes out far from 9.81, the
calibration (or the phone's reported fps) is off, and so are the jump results.

Example
    python scripts/validate_ball_toss.py ball.mp4 --calibration output/calibration.json
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from jumplab import physics  # noqa: E402
from jumplab.ball_tracking import track_ball  # noqa: E402
from jumplab.calibration import load_calibration  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video")
    cal = p.add_mutually_exclusive_group(required=True)
    cal.add_argument("--calibration")
    cal.add_argument("--scale", type=float, help="meters per pixel")
    p.add_argument("--start", type=float, help="first time (s) of free flight")
    p.add_argument("--end", type=float, help="last time (s) of free flight")
    args = p.parse_args()

    scale = args.scale or load_calibration(args.calibration).m_per_px
    t, x, y = track_ball(args.video)
    keep = ~np.isnan(x)
    if args.start is not None:
        keep &= t >= args.start
    if args.end is not None:
        keep &= t <= args.end
    print(f"Ball found in {keep.sum()} of {len(t)} frames")
    t0 = t[keep][0]
    fit = physics.fit_projectile(t[keep] - t0, x[keep] * scale, y[keep] * scale)
    err = 100 * (fit.g - physics.G) / physics.G
    print(f"g from fit:      {fit.g:.3f} m/s^2  ({err:+.1f}% vs 9.81)")
    print(f"vx, vy at {t0:.3f}s: {fit.vx:.3f}, {fit.vy:.3f} m/s   launch angle {fit.launch_angle_deg:.1f} deg")
    print(f"RMS residual:    {1000 * fit.rms_residual_y:.1f} mm")
    if abs(err) > 5:
        print("More than 5% off: re-check the calibration, and that the ball stays in the "
              "calibrated plane. Trim --start/--end to free flight only (no hand, no bounce).")


if __name__ == "__main__":
    main()
