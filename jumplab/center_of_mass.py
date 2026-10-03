"""Whole-body center of mass (CoM) from body segments.

Why: in flight, only the CoM is guaranteed to follow a perfect parabola. The hip marker
moves relative to the CoM as the arms swing and the legs tuck, so a parabola fitted to the
hip gives the wrong g, launch angle and takeoff speed.

How: treat the body as segments (trunk, head, upper arms, forearms, hands, thighs, shanks,
feet). Each segment's own center of mass sits a known fraction of the way along it, and
each carries a known fraction of total body mass. The whole-body CoM is the
mass-weighted average of the segment centers:

        CoM = sum(m_i * r_i) / sum(m_i)

Segment data: Dempster (1955) as tabulated in D. A. Winter, "Biomechanics and Motor Control
of Human Movement", Table 4.1. Average adult values (based mostly on male cadavers), so
expect a couple of centimeters of error for any one person.
"""
from __future__ import annotations

import numpy as np

from .smoothing import fill_gaps

# (segment, proximal landmark, distal landmark, fraction of body mass,
#  segment CoM location as a fraction of the way from proximal to distal)
AXIAL_SEGMENTS = [
    # Trunk: greater trochanter (hip) -> glenohumeral joint (shoulder)
    ("trunk", "HIP", "SHOULDER", 0.497, 0.50),
    # Head and neck: Winter puts its CoM at the ear canal
    ("head_neck", "EAR", "EAR", 0.081, 1.00),
]
LIMB_SEGMENTS = [   # one per side
    ("upper_arm", "SHOULDER", "ELBOW", 0.028, 0.436),
    ("forearm", "ELBOW", "WRIST", 0.016, 0.430),
    ("hand", "WRIST", "INDEX", 0.006, 0.506),
    ("thigh", "HIP", "KNEE", 0.100, 0.433),
    ("shank", "KNEE", "ANKLE", 0.0465, 0.433),
    ("foot", "ANKLE", "FOOT_INDEX", 0.0145, 0.50),
]
COM_LANDMARKS = sorted({n for s in AXIAL_SEGMENTS + LIMB_SEGMENTS for n in s[1:3]})
MODES = ("both", "symmetric")


def total_mass_fraction():
    return (sum(s[3] for s in AXIAL_SEGMENTS) + 2 * sum(s[3] for s in LIMB_SEGMENTS))


def segment_center(proximal, distal, fraction):
    """Point `fraction` of the way from proximal to distal. Works on (x, y) arrays."""
    return tuple(np.asarray(p) + fraction * (np.asarray(d) - np.asarray(p))
                 for p, d in zip(proximal, distal))


def whole_body_com(near, far, mode="both"):
    """Whole-body CoM from landmark positions.

    near, far: dicts {landmark name: (x, y)} for the side facing the camera and the far side.
    mode="both":      use each side's own limbs.
    mode="symmetric": use the near side's limbs twice. In a side-on video the far limbs are
                      hidden and MediaPipe has to guess them; a two-footed broad jump is
                      close to symmetric, so the visible side is often the better estimate.
    Axial segments (trunk, head) use the midpoint of both sides in "both" mode."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}, got {mode!r}")
    other = far if mode == "both" else near

    def mid(name):
        return tuple((np.asarray(a) + np.asarray(b)) / 2 for a, b in zip(near[name], other[name]))

    sx, sy, total = 0.0, 0.0, 0.0
    for _, prox, dist, mass, frac in AXIAL_SEGMENTS:
        cx, cy = segment_center(mid(prox), mid(dist), frac)
        sx, sy, total = sx + mass * cx, sy + mass * cy, total + mass
    for side in (near, other):
        for _, prox, dist, mass, frac in LIMB_SEGMENTS:
            cx, cy = segment_center(side[prox], side[dist], frac)
            sx, sy, total = sx + mass * cx, sy + mass * cy, total + mass
    return sx / total, sy / total


def com_from_keypoints(kp, near_side, mode="both"):
    """Per-frame CoM (x_px, y_px_up) from tracked keypoints: gap-filled, not smoothed
    (the parabola fit does its own averaging). Image y is flipped so UP is positive."""
    far_side = "LEFT" if near_side == "RIGHT" else "RIGHT"

    def landmarks(side):
        out = {}
        for name in COM_LANDMARKS:
            x, y, _ = kp.part(side, name)
            out[name] = (fill_gaps(x), -fill_gaps(y))
        return out

    return whole_body_com(landmarks(near_side), landmarks(far_side), mode)
