"""Sanity checks that turn silent failures into errors or warnings.

A physics tool that prints a confident wrong number is worse than one that stops. So:
  * If the jump isn't fully inside the clip, analysis stops with an error (NoJumpFound).
  * Anything else suspicious becomes a warning that says which results it affects.

Each warning is a dict:
    code      short id, e.g. "missing_in_jump"
    message   what looks wrong and what to do about it
    severity  "caution" (numbers usable with care) or "serious" (numbers probably wrong)
    affects   result categories: "distance", "trajectory", "angles", "timing"
"""
from __future__ import annotations

import numpy as np

from .events import NoJumpFound

ALL = ("distance", "trajectory", "angles", "timing")
CAUTION, SERIOUS = "caution", "serious"

# Plausible limits for a standing broad jump
MIN_FLIGHT_S, MAX_FLIGHT_S = 0.15, 1.0
MAX_LAUNCH_ANGLE_DEG = 65.0       # steeper than this: not a broad jump seen side-on
MAX_SIZE_CHANGE = 0.15            # apparent body size change before vs after the jump
MIN_VISIBILITY = 0.5              # MediaPipe's own confidence that a landmark is visible
MAX_LOW_VIS_FRACTION = 0.10


def warning(code, message, severity=CAUTION, affects=ALL):
    return {"code": code, "message": message, "severity": severity, "affects": list(affects)}


def as_warning(w):
    """Accept old results files, where warnings were plain strings."""
    return w if isinstance(w, dict) else warning("unknown", str(w))


def check_jump_inside_window(takeoff_i, landing_i, lo, hi, fps):
    """Errors if the flight isn't fully inside [lo, hi); a warning if there's barely any
    footage after landing (the landing heel position needs ~0.1 s)."""
    if takeoff_i <= lo:
        raise NoJumpFound("Takeoff is at the very start of the clip/window, so the clip "
                          "probably starts mid-jump. Include the standing start.")
    if landing_i >= hi - 1:
        raise NoJumpFound("No landing was found before the end of the clip/window. Either "
                          "the clip ends mid-air, or the floor sits at a different height in "
                          "the image where the athlete lands (is the camera level?).")
    need = max(2, int(0.1 * fps))
    if hi - landing_i < need:
        return [warning("short_after_landing",
                        f"Only {hi - landing_i} frames after landing; the landing heel "
                        "position needs about 0.1 s of footage.", CAUTION, ("distance",))]
    return []


def check_flight_time(flight_time):
    if MIN_FLIGHT_S <= flight_time <= MAX_FLIGHT_S:
        return []
    return [warning("flight_time_implausible",
                    f"Flight time {flight_time:.3f} s is outside the plausible "
                    f"{MIN_FLIGHT_S}-{MAX_FLIGHT_S} s for a broad jump. Takeoff/landing were "
                    "probably mis-detected (tracking glitch?). Check the events plot.", SERIOUS)]


def check_missing_frames(detected, onset_i, takeoff_i, landing_i, hi, fps):
    """Frames with no person detected inside the jump were filled by interpolation."""
    end = min(hi, landing_i + max(2, int(0.1 * fps)))
    missing = int((~detected[onset_i:end]).sum())
    if missing == 0:
        return []
    in_flight = int((~detected[takeoff_i:landing_i]).sum())
    if in_flight:
        return [warning("missing_in_jump",
                        f"The person wasn't detected in {in_flight} frames during the flight "
                        f"({missing} in the whole jump); those positions were filled in by "
                        "straight-line interpolation, which bends the parabola fit.", SERIOUS)]
    return [warning("missing_in_jump",
                    f"The person wasn't detected in {missing} frames during the jump; those "
                    "positions were filled in by interpolation.", CAUTION)]


def check_landmarks(kp, landmarks, a, b):
    """Low MediaPipe visibility or positions outside the frame, for the landmarks the
    analysis uses, over frames a..b. `landmarks` is a list of (side, name)."""
    out, low, off = [], [], []
    for side, name in landmarks:
        x, y, v = kp.part(side, name)
        x, y, v = x[a:b], y[a:b], v[a:b]
        ok = ~np.isnan(x)
        if not ok.any():
            continue
        if np.mean(v[ok] < MIN_VISIBILITY) > MAX_LOW_VIS_FRACTION:
            low.append(f"{side.lower()} {name.lower()}")
        if np.any((x[ok] < 0) | (x[ok] >= kp.width) | (y[ok] < 0) | (y[ok] >= kp.height)):
            off.append(f"{side.lower()} {name.lower()}")
    if low:
        out.append(warning("low_confidence_landmarks",
                           "MediaPipe had low confidence (visibility < 0.5) in more than 10% "
                           f"of the jump for: {', '.join(low)}. Positions there are guesses.",
                           CAUTION))
    if off:
        out.append(warning("offframe_landmarks",
                           f"These landmarks left the frame during the jump: {', '.join(off)}. "
                           "Keep the whole body in view.", SERIOUS))
    return out


def check_standing_start(hip_y_window, onset_rel, depth_px, fps):
    """Movement onset and contact time assume the window starts with the athlete still."""
    n = max(3, int(0.3 * fps))
    moving = depth_px > 0 and np.ptp(hip_y_window[:n]) > 0.25 * depth_px
    if moving or onset_rel < n:
        return [warning("moving_start",
                        "The clip/window doesn't start with the athlete standing still, so "
                        "movement onset and ground contact time are unreliable. Start "
                        "recording (or --start) at least 0.3 s before the dip.",
                        CAUTION, ("timing",))]
    return []


def check_distance(distance_px, shin_px):
    if distance_px <= 0:
        return [warning("distance_implausible",
                        "Jump distance came out zero or negative: the landing heel is not "
                        "ahead of the takeoff toe. The jump may not be side-on, or the "
                        "events are wrong.", SERIOUS, ("distance",))]
    if shin_px > 0 and distance_px < shin_px:
        return [warning("distance_implausible",
                        "Jump distance is shorter than one shin length, which is implausible "
                        "for a broad jump. Check the events plot and the skeleton video.",
                        CAUTION, ("distance",))]
    return []


def check_side_on(launch_angle_deg, size_before_px, size_after_px):
    """Broad jumps filmed side-on launch well below vertical, and the athlete's apparent
    size doesn't change (no movement toward/away from the camera)."""
    out = []
    if launch_angle_deg is not None and launch_angle_deg > MAX_LAUNCH_ANGLE_DEG:
        out.append(warning("not_side_on",
                           f"Launch angle {launch_angle_deg:.0f}° is steeper than "
                           f"{MAX_LAUNCH_ANGLE_DEG:.0f}°: the jump looks mostly vertical in the "
                           "image. Was it filmed side-on, perpendicular to the jump?", SERIOUS))
    if size_before_px and size_after_px:
        change = size_after_px / size_before_px - 1
        if abs(change) > MAX_SIZE_CHANGE:
            out.append(warning("not_side_on",
                               f"The athlete's apparent size changed by {100 * change:+.0f}% "
                               "between standing before and after the jump, so they moved "
                               "toward/away from the camera. Distances assume the jump is "
                               "across the frame.", SERIOUS))
    return out


def check_frame_timing(frame_times, fps):
    """Time is computed as frame / fps, which assumes evenly spaced frames. Timestamps in
    video files are rounded (a 120 fps file shows 7.9-8.8 ms gaps), so compare the real
    timestamps with frame / fps and only warn if they drift apart by over half a frame."""
    if frame_times is None or len(frame_times) < 3:
        return []
    t = np.asarray(frame_times, dtype=float)
    drift = np.abs((t - t[0]) - np.arange(len(t)) / fps)
    if drift.max() > 0.5 / fps:
        i = int(np.argmax(drift))
        return [warning("variable_frame_rate",
                        f"Frame timestamps drift up to {1000 * drift.max():.0f} ms from "
                        f"frame / fps (worst at frame {i}), so this may be a variable-frame-rate "
                        "video. All times assume evenly spaced frames.",
                        CAUTION, ("timing", "trajectory"))]
    return []
