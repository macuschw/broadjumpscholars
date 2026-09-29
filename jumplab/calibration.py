"""Click-to-calibrate: two points a known real-world distance apart -> meters per pixel.

Tips for accurate calibration
  * Put the reference (tape measure, meter stick, floor markings) in the SAME plane as
    the jump - along the line the athlete jumps, not in front of or behind it.
  * Use a long reference: a 1 px click error over 500 px is 0.2%, over 50 px it is 2%.
  * Don't move or zoom the camera between calibrating and jumping.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass

import numpy as np


@dataclass
class Calibration:
    m_per_px: float
    p1: tuple
    p2: tuple
    distance_m: float
    video: str = ""
    frame_index: int = 0
    width: int = 0
    height: int = 0

    @property
    def pixel_distance(self):
        return float(np.hypot(self.p2[0] - self.p1[0], self.p2[1] - self.p1[1]))


def scale_from_points(p1, p2, distance_m):
    """Meters per pixel from two pixel points that are distance_m apart in real life."""
    d_px = float(np.hypot(p2[0] - p1[0], p2[1] - p1[1]))
    if d_px == 0:
        raise ValueError("The two calibration points are the same pixel.")
    if distance_m <= 0:
        raise ValueError("The known distance must be positive.")
    return distance_m / d_px


def save_calibration(cal, path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(asdict(cal), f, indent=2)


def load_calibration(path):
    with open(path) as f:
        d = json.load(f)
    d["p1"], d["p2"] = tuple(d["p1"]), tuple(d["p2"])
    return Calibration(**d)


def read_frame(video_path, frame_index=0):
    import cv2
    from .pose_tracking import open_video

    cap, _, _, _ = open_video(video_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise ValueError(f"Could not read frame {frame_index} of {video_path}")
    return frame


def click_two_points(frame, max_display=(1280, 800)):
    """Show the frame and let the user click two points.
    Keys: Enter/Space = accept, r = reset, q/Esc = cancel.
    Returns two (x, y) points in FULL-RESOLUTION pixel coordinates."""
    import cv2

    h, w = frame.shape[:2]
    s = min(1.0, max_display[0] / w, max_display[1] / h)   # shrink big frames to fit the screen
    base = cv2.resize(frame, (int(w * s), int(h * s))) if s < 1 else frame.copy()
    pts = []
    win = "Click two points a known distance apart (Enter=accept, r=reset, q=quit)"

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(pts) < 2:
            pts.append((x / s, y / s))

    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)
    try:
        while True:
            img = base.copy()
            for p in pts:
                cv2.circle(img, (int(p[0] * s), int(p[1] * s)), 5, (0, 0, 255), -1)
            if len(pts) == 2:
                cv2.line(img, *[(int(p[0] * s), int(p[1] * s)) for p in pts], (0, 255, 0), 2)
            cv2.imshow(win, img)
            key = cv2.waitKey(20) & 0xFF
            if key in (13, 10, 32) and len(pts) == 2:
                return pts[0], pts[1]
            if key == ord("r"):
                pts.clear()
            if key in (ord("q"), 27):
                raise KeyboardInterrupt("Calibration cancelled.")
    finally:
        cv2.destroyWindow(win)
        cv2.waitKey(1)


def calibrate_video(video_path, distance_m, frame_index=0):
    """Interactive calibration on one frame of a video. Returns a Calibration."""
    frame = read_frame(video_path, frame_index)
    p1, p2 = click_two_points(frame)
    h, w = frame.shape[:2]
    return Calibration(scale_from_points(p1, p2, distance_m), p1, p2, distance_m,
                       os.path.abspath(video_path), frame_index, w, h)
