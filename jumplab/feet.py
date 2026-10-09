"""Both feet: the official broad-jump distance runs from the takeoff line to the REARMOST heel
at landing. The main jump distance uses only the foot nearest the camera, because MediaPipe
has to guess the hidden far foot. This module compares both feet and decides whether the
far foot can be trusted.

Left/right safety: MediaPipe sometimes swaps which foot it calls "left" and "right" in side
views. So the feet are compared by POSITION in each frame (whichever heel is further back,
whichever toe is further forward) and by visibility (the hidden foot is the less visible
one in that frame), never by label.

The near and far foot are told apart by visibility. If the two feet's visibilities are within
0.1 of each other, it can't tell which one is hidden, so the far foot is not trusted.

When the far foot can be trusted (both must hold):
  * MediaPipe's median visibility for it is at least 0.5 - MediaPipe's own cut-off for
    "visible" (its skeleton drawing hides anything below 0.5). On our real clips the far
    heel scored 0.34-0.59 after landing, so this accepts it in about half of them.
  * its position is steady over the window: wobble under 2 cm (4% of trunk length if
    uncalibrated). A planted foot doesn't move; a guessed one drifts.
Visibility measures whether a point is seen, not how accurate its position is, so both
thresholds are provisional until checked against tape-measured staggered landings.
"""
from __future__ import annotations

import numpy as np

MIN_FAR_VISIBILITY = 0.5
MIN_VISIBILITY_GAP = 0.1          # needed to tell the near foot from the far one
MAX_WOBBLE_M = 0.02
STAGGER_WARN_M = 0.05
TRUNK_M = 0.5                     # typical trunk length, for uncalibrated thresholds


def compare(kp, part, frames, direction, rear, wobble_px):
    """Compare both feet's `part` ("HEEL" or "FOOT_INDEX") over `frames` (a slice).
    rear=True: find the rearmost one (landing heels); False: front-most (takeoff toes).
    Positions are 'forward' pixels: direction * x, so bigger = further along the jump."""
    xl, _, vl = kp.part("LEFT", part)
    xr, _, vr = kp.part("RIGHT", part)
    f = direction * np.stack([xl[frames], xr[frames]], axis=1)
    v = np.stack([vl[frames], vr[frames]], axis=1)
    ok = ~np.isnan(f).any(axis=1)
    f, v = f[ok], v[ok]
    if len(f) < 3:
        return {"trusted": False, "reason": "too few tracked frames", "frames": int(len(f))}
    rows = np.arange(len(f))
    hidden = f[rows, np.argmin(v, axis=1)]                  # the less visible foot, per frame
    seen = f[rows, np.argmax(v, axis=1)]                    # the camera-side foot, per frame
    hidden_vis = float(np.median(np.min(v, axis=1)))
    wobble = float(1.4826 * np.median(np.abs(hidden - np.median(hidden))))
    extreme = np.min(f, axis=1) if rear else np.max(f, axis=1)
    vis_gap = float(np.median(np.abs(v[:, 0] - v[:, 1])))
    out = {
        "trusted": (hidden_vis >= MIN_FAR_VISIBILITY and wobble <= wobble_px
                    and vis_gap >= MIN_VISIBILITY_GAP),
        "hidden_foot_visibility": hidden_vis,
        "wobble_px": wobble,
        "gap_px": float(np.median(np.abs(f[:, 0] - f[:, 1]))),      # how far apart the feet are
        "extreme_px": float(np.median(extreme)),                      # rearmost heel / front toe
        "near_px": float(np.median(seen)),                            # camera-side foot
        "frames": int(len(f)),
    }
    if not out["trusted"]:
        if vis_gap < MIN_VISIBILITY_GAP:
            out["reason"] = f"can't tell the near foot from the far one (visibilities within {vis_gap:.2f})"
        elif hidden_vis < MIN_FAR_VISIBILITY:
            out["reason"] = f"far foot visibility {hidden_vis:.2f} < {MIN_FAR_VISIBILITY}"
        else:
            out["reason"] = f"far foot position not steady (wobble {wobble:.1f} px)"
    return out


def both_feet(kp, direction, takeoff_frames, landing_frames, primary_px, m_per_px, trunk_px):
    """Distance from the front-most takeoff toe to the rearmost landing heel, using the far
    foot only where it can be trusted. Returns a details dict; 'distance_px' is None when the
    far foot couldn't be trusted at either end."""
    px_per_m = (1 / m_per_px) if m_per_px else trunk_px / TRUNK_M
    wobble_px = MAX_WOBBLE_M * px_per_m
    heel = compare(kp, "HEEL", landing_frames, direction, rear=True, wobble_px=wobble_px)
    toe = compare(kp, "FOOT_INDEX", takeoff_frames, direction, rear=False, wobble_px=wobble_px)

    # How much shorter the official-rule distance is than the near-foot one, at each end.
    # Measured against the near (more visible) foot over the SAME frames, so window choices
    # cancel out - and no left/right labels are involved anywhere.
    heel_shift = toe_shift = 0.0
    if heel["trusted"]:
        heel_shift = max(0.0, heel["near_px"] - heel["extreme_px"])
    if toe["trusted"]:
        toe_shift = max(0.0, toe["extreme_px"] - toe["near_px"])
    used = heel["trusted"] or toe["trusted"]
    return {
        "distance_px": primary_px - heel_shift - toe_shift if used else None,
        "difference_px": heel_shift + toe_shift if used else None,
        "heel_shift_px": heel_shift, "toe_shift_px": toe_shift,
        "landing_heels": heel, "takeoff_toes": toe,
        "warn_above_px": STAGGER_WARN_M * px_per_m,
        "px_per_m": px_per_m,
    }
