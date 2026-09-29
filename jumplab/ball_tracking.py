"""Track a single ball in a static-camera video, for validating the physics.

Film a ball being dropped or tossed side-on, with the same camera setup and calibration
as the jumps. Fitting a parabola to it should give g ~ 9.81 m/s^2. If it doesn't, the
calibration (or the fps the phone reports) is off - and the jump numbers will be too.

Method: background = median of frames (the ball moves, so it disappears from the median);
the ball is the largest blob that differs from the background in each frame.
"""
from __future__ import annotations

import numpy as np


def track_ball(video_path, diff_threshold=40, min_area=20, n_background=60):
    """Returns (t, x_px, y_px_up); frames where the ball wasn't found are NaN."""
    import cv2
    from .pose_tracking import open_video

    cap, fps, _, _ = open_video(video_path)
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    if not frames:
        raise ValueError(f"No frames in {video_path}")

    sample = frames[:: max(1, len(frames) // n_background)]
    background = np.median(np.stack(sample), axis=0).astype(np.int16)
    kernel = np.ones((3, 3), np.uint8)

    xs, ys = [], []
    for frame in frames:
        diff = np.abs(frame.astype(np.int16) - background).max(axis=2).astype(np.uint8)
        mask = cv2.morphologyEx((diff > diff_threshold).astype(np.uint8), cv2.MORPH_OPEN, kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best = max(contours, key=cv2.contourArea, default=None)
        if best is None or cv2.contourArea(best) < min_area:
            xs.append(np.nan)
            ys.append(np.nan)
            continue
        # Centroid weighted by how different each pixel is from the background (sub-pixel)
        x0, y0, w, h = cv2.boundingRect(best)
        wgt = diff[y0:y0 + h, x0:x0 + w].astype(float) * mask[y0:y0 + h, x0:x0 + w]
        yy, xx = np.mgrid[y0:y0 + h, x0:x0 + w]
        xs.append((wgt * xx).sum() / wgt.sum())
        ys.append(-(wgt * yy).sum() / wgt.sum())     # flip so UP is positive

    t = np.arange(len(frames)) / fps
    return t, np.array(xs), np.array(ys)
