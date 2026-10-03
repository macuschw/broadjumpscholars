"""Click-to-calibrate: two points a known real-world distance apart -> meters per pixel.

Tips for accurate calibration
  * Best: put the reference (tape measure, meter stick, floor markings) in the SAME plane
    as the jump - along the line the athlete jumps, not in front of or behind it.
  * If it can't go there, measure how far the camera is from the reference and from the
    jump line, and pass both: the scale is corrected for depth (see depth_corrected_scale).
  * Use a long reference: a 1 px click error over 500 px is 0.2%, over 50 px it is 2%.
  * Don't move or zoom the camera between calibrating and jumping.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from typing import Optional

import numpy as np


@dataclass
class Calibration:
    m_per_px: float                 # scale AT THE JUMP LINE - what the analysis uses
    p1: tuple
    p2: tuple
    distance_m: float
    video: str = ""
    frame_index: int = 0
    width: int = 0
    height: int = 0
    # Optional depth correction (None = reference was on the jump line)
    m_per_px_at_reference: Optional[float] = None
    camera_to_reference_m: Optional[float] = None
    camera_to_jump_m: Optional[float] = None

    @property
    def pixel_distance(self):
        return float(np.hypot(self.p2[0] - self.p1[0], self.p2[1] - self.p1[1]))

    @property
    def depth_correction(self):
        """Factor applied to the reference scale (1.0 = no correction)."""
        if self.camera_to_reference_m and self.camera_to_jump_m:
            return self.camera_to_jump_m / self.camera_to_reference_m
        return 1.0


def scale_from_points(p1, p2, distance_m):
    """Meters per pixel from two pixel points that are distance_m apart in real life."""
    d_px = float(np.hypot(p2[0] - p1[0], p2[1] - p1[1]))
    if d_px == 0:
        raise ValueError("The two calibration points are the same pixel.")
    if distance_m <= 0:
        raise ValueError("The known distance must be positive.")
    return distance_m / d_px


def depth_corrected_scale(m_per_px_at_reference, camera_to_reference_m, camera_to_jump_m):
    """Move a scale measured at the reference over to the jump line.

    Pinhole camera: an object twice as far away looks half as big, so meters per pixel
    grows in proportion to distance from the camera:
        scale_at_jump = scale_at_reference * (camera->jump line) / (camera->reference)
    Distances are measured perpendicular to the jump line, from the camera lens."""
    if camera_to_reference_m <= 0 or camera_to_jump_m <= 0:
        raise ValueError("Camera distances must be positive.")
    return m_per_px_at_reference * camera_to_jump_m / camera_to_reference_m


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


def display_size(w, h, max_display=(1280, 800)):
    """Size to show a w x h frame at so it fits on screen (never enlarged)."""
    s = min(1.0, max_display[0] / w, max_display[1] / h)
    return (int(w * s), int(h * s)) if s < 1 else (w, h)


def display_to_full(point, full_size, shown_size):
    """Map a click on the shown (resized) image back to full-resolution pixels. Uses the
    actual shown size for each axis, since it was rounded down to whole pixels."""
    return (point[0] * full_size[0] / shown_size[0], point[1] * full_size[1] / shown_size[1])


def click_two_points(frame, max_display=(1280, 800)):
    """Show the frame and let the user click two points.
    Keys: Enter/Space = accept, r = reset, q/Esc = cancel.
    Returns two (x, y) points in FULL-RESOLUTION pixel coordinates."""
    import cv2

    h, w = frame.shape[:2]
    dw, dh = display_size(w, h, max_display)          # shrink big frames to fit the screen
    base = cv2.resize(frame, (dw, dh)) if (dw, dh) != (w, h) else frame.copy()
    sx, sy = dw / w, dh / h
    pts = []
    win = "Click two points a known distance apart (Enter=accept, r=reset, q=quit)"

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(pts) < 2:
            pts.append(display_to_full((x, y), (w, h), (dw, dh)))

    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)
    try:
        while True:
            img = base.copy()
            for p in pts:
                cv2.circle(img, (int(p[0] * sx), int(p[1] * sy)), 5, (0, 0, 255), -1)
            if len(pts) == 2:
                cv2.line(img, *[(int(p[0] * sx), int(p[1] * sy)) for p in pts], (0, 255, 0), 2)
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


def make_calibration(p1, p2, distance_m, camera_to_reference_m=None, camera_to_jump_m=None,
                     **info):
    """Build a Calibration from two clicked points, with optional depth correction.
    Give both camera distances or neither."""
    if (camera_to_reference_m is None) != (camera_to_jump_m is None):
        raise ValueError("Give both camera_to_reference_m and camera_to_jump_m, or neither.")
    ref_scale = scale_from_points(p1, p2, distance_m)
    if camera_to_reference_m is None:
        return Calibration(ref_scale, p1, p2, distance_m, **info)
    jump_scale = depth_corrected_scale(ref_scale, camera_to_reference_m, camera_to_jump_m)
    return Calibration(jump_scale, p1, p2, distance_m, **info,
                       m_per_px_at_reference=ref_scale,
                       camera_to_reference_m=camera_to_reference_m,
                       camera_to_jump_m=camera_to_jump_m)


def calibrate_video(video_path, distance_m, frame_index=0, camera_to_reference_m=None,
                    camera_to_jump_m=None):
    """Interactive calibration on one frame of a video. Returns a Calibration."""
    frame = read_frame(video_path, frame_index)
    p1, p2 = click_two_points(frame)
    h, w = frame.shape[:2]
    return make_calibration(p1, p2, distance_m, camera_to_reference_m, camera_to_jump_m,
                            video=os.path.abspath(video_path), frame_index=frame_index,
                            width=w, height=h)
