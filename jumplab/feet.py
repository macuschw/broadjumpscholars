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

Stagger itself is detected from the GAP between the two feet (how far apart they are along
the jump), which needs no trust in the far foot's exact position: in the tape check of
October 2026 every staggered jump showed a gap of 7 cm or more, and the feet-together jump
at most 3.3 cm.

Perspective: the far foot is ~a stance width (DEPTH_M) further from the camera, so it shows up
shifted toward the middle of the picture by (x - cx) * DEPTH_M / Z, Z = the camera's distance =
focal length (px) * scale (m/px). Away from the middle of the frame that looks exactly like
staggered feet: our live session of Oct 27 (takeoff 650 px right of center, feet side by side)
read 12-17 cm "apart" at the toes while standing, and every left-right pair of the body (heels,
ankles, knees, hips, shoulders) was shifted the same way, toward the center. So the far foot's
position is corrected for that shift before comparing, and since the stance width and the lens
are only typical values, gaps within PERSPECTIVE_SLACK of the shift are not called staggered.
The focal length: a phone's main camera sees ~69 degrees across the long side of the picture.
"""
from __future__ import annotations

import numpy as np

MIN_FAR_VISIBILITY = 0.5
MIN_VISIBILITY_GAP = 0.1          # needed to tell the near foot from the far one
MAX_WOBBLE_M = 0.02
STAGGER_WARN_M = 0.05
TRUNK_M = 0.5                     # typical trunk length, for uncalibrated thresholds
DEPTH_M = 0.25                    # how much further the far foot is from the camera (feet side by side)
FOCAL_FRAC = 0.73                 # focal length / the picture's long side (~69 degrees, a phone's main camera)
PERSPECTIVE_SLACK = 0.3           # share of the perspective shift that may be stance width or lens, not stagger


def perspective_shift(x_near, width, height, px_per_m):
    """Where the far foot shows up relative to the near one when the feet are side by side (px,
    signed, along the image x axis): toward the middle of the picture, more so further from it."""
    if not width or not px_per_m:
        return np.zeros_like(np.asarray(x_near, dtype=float))
    focal = FOCAL_FRAC * max(width, height or 0)
    return -(np.asarray(x_near, dtype=float) - width / 2) * DEPTH_M * px_per_m / focal


def compare(kp, part, frames, direction, rear, wobble_px, px_per_m=None):
    """Compare both feet's `part` ("HEEL" or "FOOT_INDEX") over `frames` (a slice).
    rear=True: find the rearmost one (landing heels); False: front-most (takeoff toes).
    Positions are 'forward' pixels: direction * x, so bigger = further along the jump. The far
    (less visible) foot is first moved back by the perspective shift (perspective_shift)."""
    xl, _, vl = kp.part("LEFT", part)
    xr, _, vr = kp.part("RIGHT", part)
    x = np.stack([xl[frames], xr[frames]], axis=1)
    v = np.stack([vl[frames], vr[frames]], axis=1)
    ok = ~np.isnan(x).any(axis=1)
    x, v = x[ok], v[ok]
    if len(x) < 3:
        return {"trusted": False, "reason": "too few tracked frames", "frames": int(len(x))}
    rows = np.arange(len(x))
    near_i, far_i = np.argmax(v, axis=1), np.argmin(v, axis=1)
    shift = perspective_shift(x[rows, near_i], kp.width, kp.height, px_per_m)
    x = x.copy()
    x[rows, far_i] -= shift                                 # where the far foot is, not where it shows up
    f = direction * x
    hidden = f[rows, far_i]                                 # the less visible foot, per frame
    seen = f[rows, near_i]                                  # the camera-side foot, per frame
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
        "perspective_px": float(np.median(np.abs(shift))),            # (after removing this much)
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
    heel = compare(kp, "HEEL", landing_frames, direction, rear=True, wobble_px=wobble_px, px_per_m=px_per_m)
    toe = compare(kp, "FOOT_INDEX", takeoff_frames, direction, rear=False, wobble_px=wobble_px, px_per_m=px_per_m)

    # How much shorter the official-rule distance is than the near-foot one, at each end.
    # Measured against the near (more visible) foot over the SAME frames, so window choices
    # cancel out - and no left/right labels are involved anywhere.
    heel_shift = toe_shift = 0.0
    if heel["trusted"]:
        heel_shift = max(0.0, heel["near_px"] - heel["extreme_px"])
    if toe["trusted"]:
        toe_shift = max(0.0, toe["extreme_px"] - toe["near_px"])
    used = heel["trusted"] or toe["trusted"]
    # A gap counts as stagger only beyond the warning distance plus the slack for perspective
    over = {name: end["gap_px"] - PERSPECTIVE_SLACK * end["perspective_px"]
            for name, end in (("heel", heel), ("toe", toe)) if "gap_px" in end}
    gaps = list(over.values())
    return {
        "stagger_px": max(gaps) if gaps else None,          # widest gap between the feet, either end (less slack)
        "stagger_heel_over_px": over.get("heel"), "stagger_toe_over_px": over.get("toe"),
        "feet_gap_px": max(end["gap_px"] for end in (heel, toe) if "gap_px" in end) if gaps else None,
        "stagger_heel_px": heel.get("gap_px"), "stagger_toe_px": toe.get("gap_px"),
        "distance_px": primary_px - heel_shift - toe_shift if used else None,
        "difference_px": heel_shift + toe_shift if used else None,
        "heel_shift_px": heel_shift, "toe_shift_px": toe_shift,
        "landing_heels": heel, "takeoff_toes": toe,
        "warn_above_px": STAGGER_WARN_M * px_per_m,
        "px_per_m": px_per_m,
    }
