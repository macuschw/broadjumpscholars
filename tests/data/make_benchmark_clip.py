"""Save a labelled real-footage benchmark clip for tests/test_real_footage.py.

Keeps only the tracked keypoints (not the video) for a frame range around one jump, plus
the takeoff/landing frames a person read off the video by eye. To label a jump:
  * takeoff = first frame the toe is clearly off the floor
  * landing = first frame the heel (or toe) touches the floor
Use a FIXED crop around the foot at full resolution (not one that follows the foot), or
the floor is hard to judge and labels come out 1-2 frames late.

Example (how real_jump_120fps was made):
    python tests/data/make_benchmark_clip.py output/caliberationtestvid\\(120fps\\)_keypoints.npz \\
        "../caliberationtestvid(120fps).mp4" real_jump_120fps --first 150 --last 559 \\
        --takeoff 384 --landing 431 --scale 0.0012598847715044733
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from jumplab.pose_tracking import Keypoints, tracking_settings  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("keypoints"); p.add_argument("video"); p.add_argument("name")
    p.add_argument("--first", type=int, required=True); p.add_argument("--last", type=int, required=True)
    p.add_argument("--takeoff", type=int, required=True); p.add_argument("--landing", type=int, required=True)
    p.add_argument("--scale", type=float, help="calibration used, m/px")
    p.add_argument("--note", default="")
    a = p.parse_args()

    import cv2
    kp = Keypoints.load(a.keypoints)
    cap = cv2.VideoCapture(a.video); times = []
    while True:
        ok = cap.grab()
        if not ok:
            break
        times.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)
    sl = slice(a.first, a.last + 1)
    settings = kp.settings or tracking_settings()    # older caches predate recorded settings
    clip = Keypoints(kp.xyv[sl], kp.fps, kp.width, kp.height, os.path.basename(a.video),
                     settings, np.array(times[sl]) - times[a.first])
    here = os.path.dirname(os.path.abspath(__file__))
    clip.save(os.path.join(here, f"{a.name}_keypoints.npz"))
    with open(os.path.join(here, f"{a.name}.json"), "w") as f:
        json.dump({"source_video": os.path.basename(a.video), "first_frame": a.first,
                   "last_frame": a.last, "fps": kp.fps,
                   "true_takeoff_frame": a.takeoff, "true_landing_frame": a.landing,
                   "m_per_px": a.scale, "note": a.note}, f, indent=2)
    print(f"saved {a.name}: {clip.n_frames} frames")


if __name__ == "__main__":
    main()
