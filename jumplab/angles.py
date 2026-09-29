"""Body angles.

Sign convention (kept from the original analyze_angles.py):
    Segment angles are measured from VERTICAL. 0 = straight up.
    Positive = leaning toward +x. The pipeline multiplies by the jump direction
    (+1 or -1) so that FORWARD lean is always positive, whichever way the athlete
    jumps across the frame.
All inputs use "y up" coordinates (image y already flipped).
"""
from __future__ import annotations

import numpy as np


def angle_from_vertical(x1, y1, x2, y2):
    """Angle (degrees) of the vector point1 -> point2 measured from straight up.
    0 = pointing straight up, positive = leaning toward +x (the right of the image)."""
    dx, dy = np.subtract(x2, x1), np.subtract(y2, y1)
    return np.degrees(np.arctan2(dx, dy))


def trunk_angle(hip, shoulder):
    """Trunk: hip -> shoulder, from vertical. `hip` and `shoulder` are (x, y) pairs."""
    return angle_from_vertical(*hip, *shoulder)


def shin_angle(ankle, knee):
    """Shin: ankle -> knee, from vertical. `ankle` and `knee` are (x, y) pairs."""
    return angle_from_vertical(*ankle, *knee)


def joint_angle(a, b, c):
    """Angle ABC at joint b, in degrees (0-180), between segments b->a and b->c.
    Example: knee angle = joint_angle(hip, knee, ankle); 180 = straight leg.
    Unlike segment angles this does not depend on jump direction."""
    v1x, v1y = np.subtract(a[0], b[0]), np.subtract(a[1], b[1])
    v2x, v2y = np.subtract(c[0], b[0]), np.subtract(c[1], b[1])
    cross = v1x * v2y - v1y * v2x
    dot = v1x * v2x + v1y * v2y
    return np.degrees(np.arctan2(np.abs(cross), dot))
