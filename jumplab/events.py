"""Jump event detection: takeoff, landing, countermovement bottom, movement onset.

All height signals are in "y up" pixels (bigger = higher).

Two takeoff/landing methods:

  1. Threshold (original analyze_events.py logic, the default): a foot marker must rise
     `threshold_fraction` (15%) of its total jump rise above ground level to count as
     airborne. Robust to noise, but BIASED: takeoff is found after the foot has already
     risen 15%, and landing while it is still 15% above the ground. Both errors shorten
     the flight time, which in turn under-estimates vy and peak height from flight time.

  2. Refined (refine=True): find the crossings as above, then walk them back / forward
     until the marker is within noise of ground level. Used with the toe (FOOT_INDEX)
     for takeoff - the last point to leave the ground - and the heel for landing - the
     first point to touch down. The ankle is a poor takeoff marker because it rises
     during heel lift, before the toes leave the ground.

     The walk has two safety stops, because MediaPipe's foot markers drift by 1-4 cm
     while the foot is planted and the floor can sit at a different image height where
     the athlete lands (camera roll): it stops as soon as the marker stops moving toward
     the ground, and it never walks more than 0.1 s. Hitting that cap is reported.

Accuracy benchmark: tests/test_real_footage.py checks both methods against takeoff and
landing frames read by eye from a real 120 fps jump.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np


class NoJumpFound(ValueError):
    pass


@dataclass
class JumpEvents:
    """Frame indices. takeoff_i is the FIRST airborne frame; landing_i is the FIRST frame
    back on the ground, so the flight lasts (landing_i - takeoff_i) frames."""
    onset_i: int
    bottom_i: int
    takeoff_i: int
    landing_i: int
    takeoff_threshold: float
    landing_threshold: float
    search_capped: bool = False     # a refined search hit its 0.1 s limit

    def shifted(self, offset):
        return replace(self, onset_i=self.onset_i + offset, bottom_i=self.bottom_i + offset,
                       takeoff_i=self.takeoff_i + offset, landing_i=self.landing_i + offset)


def threshold_crossings(height, threshold_fraction=0.15, min_rise=20.0):
    """Original method. Returns (takeoff_i, landing_i, baseline, rise, threshold)."""
    height = np.asarray(height, dtype=float)
    baseline = np.percentile(height, 20)          # roughly "foot on the ground"
    peak_i = int(np.argmax(height))
    rise = height[peak_i] - baseline
    if rise < min_rise:
        raise NoJumpFound(
            f"The foot barely rises ({rise:.0f} px < {min_rise:.0f} px), so no jump was "
            "found. Check the start/end window or the tracking video.")

    thr = baseline + threshold_fraction * rise

    # Walk outward from the peak until the foot drops back to ground level
    i = peak_i
    while i > 0 and height[i - 1] > thr:
        i -= 1
    j = peak_i
    while j < len(height) - 1 and height[j] > thr:
        j += 1
    return i, j, baseline, rise, thr


def ground_tolerance(height, baseline, threshold, noise_k=3.0, min_fraction=0.02, rise=0.0):
    """How far above baseline still counts as 'on the ground': a few times the jitter of
    the on-ground samples (robust MAD estimate), but never less than min_fraction of the rise."""
    ground = np.asarray(height)[np.asarray(height) <= threshold]
    noise = 1.4826 * np.median(np.abs(ground - np.median(ground))) if len(ground) else 0.0
    return max(noise_k * noise, min_fraction * rise)


def refine_takeoff(height, takeoff_i, baseline, tol, max_steps=None):
    """Walk back from a threshold crossing to the first frame that leaves ground level.
    Stops early if the marker stops getting lower going back in time (it has reached
    whatever level it sat at on the ground) or after max_steps. Returns (frame, capped)."""
    i = takeoff_i
    while i > 0 and height[i - 1] > baseline + tol and height[i - 1] < height[i]:
        if max_steps is not None and takeoff_i - i >= max_steps:
            return i, True
        i -= 1
    return i, False


def refine_landing(height, landing_i, baseline, tol, max_steps=None):
    """Walk forward from a threshold crossing to the first frame back at ground level.
    Stops early if the marker stops falling (it has touched down, even if the floor is at
    a different image height there) or after max_steps. Returns (frame, capped)."""
    j = landing_i
    while j < len(height) - 1 and height[j] > baseline + tol and height[j + 1] < height[j]:
        if max_steps is not None and j - landing_i >= max_steps:
            return j, True
        j += 1
    return j, False


def countermovement_bottom(hip_y, takeoff_i, fps, search_s=1.0):
    """Lowest hip point in the `search_s` seconds before takeoff."""
    lo = max(0, takeoff_i - int(search_s * fps))
    return lo + int(np.argmin(hip_y[lo:takeoff_i + 1]))


def standing_hip_height(hip_y, fps, standing_s=0.3):
    """Median hip height at the start of the window (assumes the athlete starts standing)."""
    return float(np.median(hip_y[: max(3, int(standing_s * fps))]))


def movement_onset(hip_y, bottom_i, fps, fraction=0.05):
    """Start of the countermovement: walk back from the bottom until the hip is within
    `fraction` of the countermovement depth from standing height."""
    stand = standing_hip_height(hip_y, fps)
    depth = stand - hip_y[bottom_i]
    if depth <= 0:
        return bottom_i
    i = bottom_i
    while i > 0 and hip_y[i - 1] < stand - fraction * depth:
        i -= 1
    return i


def detect_events(hip_y, fps, takeoff_signal, landing_signal=None, refine=False,
                  threshold_fraction=0.15, min_rise=20.0):
    """Detect all events. With landing_signal=None and refine=False this is exactly the
    original analyze_events.py behaviour (one signal, usually the ankle)."""
    hip_y = np.asarray(hip_y, dtype=float)
    takeoff_signal = np.asarray(takeoff_signal, dtype=float)
    landing_signal = takeoff_signal if landing_signal is None else np.asarray(landing_signal, float)

    to_i, _, to_base, to_rise, to_thr = threshold_crossings(takeoff_signal, threshold_fraction, min_rise)
    _, la_i, la_base, la_rise, la_thr = threshold_crossings(landing_signal, threshold_fraction, min_rise)
    capped = False
    if refine:
        max_steps = max(2, int(round(0.1 * fps)))
        to_tol = ground_tolerance(takeoff_signal, to_base, to_thr, rise=to_rise)
        la_tol = ground_tolerance(landing_signal, la_base, la_thr, rise=la_rise)
        to_i, cap_to = refine_takeoff(takeoff_signal, to_i, to_base, to_tol, max_steps)
        la_i, cap_la = refine_landing(landing_signal, la_i, la_base, la_tol, max_steps)
        to_thr, la_thr = to_base + to_tol, la_base + la_tol
        capped = cap_to or cap_la
    if la_i <= to_i:
        raise NoJumpFound("Landing was detected before takeoff; check the window/tracking.")

    bottom_i = countermovement_bottom(hip_y, to_i, fps)
    onset_i = movement_onset(hip_y, bottom_i, fps)
    return JumpEvents(onset_i, bottom_i, to_i, la_i, float(to_thr), float(la_thr), capped)
