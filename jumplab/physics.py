"""Projectile-motion physics.

During flight the only force (ignoring air resistance) is gravity, so any tracked point
on a rigid-ish body - and exactly the center of mass - follows
    x(t) = x0 + vx t
    y(t) = y0 + vy t - 1/2 g t^2
Fitting these to the tracked hip gives vx, vy and the launch angle. The functions are
unit-agnostic: pass pixels and get px/s, or pass meters and get m/s.

Note: the hip is only an approximation of the center of mass. Arm swing and leg tuck
during flight move the CoM relative to the hip, so expect a few percent of error.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

G = 9.81  # m/s^2


@dataclass
class ProjectileFit:
    x0: float
    y0: float
    vx: float
    vy: float
    g: float              # fitted (free fit) or the fixed value that was supplied
    g_was_fixed: bool
    rms_residual_y: float
    n_points: int

    @property
    def speed(self):
        return float(np.hypot(self.vx, self.vy))

    @property
    def launch_angle_deg(self):
        """Angle of the velocity above horizontal at t = 0 (degrees)."""
        return float(np.degrees(np.arctan2(self.vy, self.vx)))

    @property
    def time_to_peak(self):
        return self.vy / self.g

    @property
    def peak_rise(self):
        """How far the point rises above its t = 0 height: vy^2 / 2g."""
        return self.vy ** 2 / (2 * self.g)

    def x_at(self, t):
        return self.x0 + self.vx * np.asarray(t)

    def y_at(self, t):
        t = np.asarray(t)
        return self.y0 + self.vy * t - 0.5 * self.g * t ** 2


def fit_projectile(t, x, y, g=None):
    """Least-squares fit of projectile motion.

    g=None  -> free parabola fit; the fitted g is a CHECK (should be ~9.81 m/s^2 if the
               calibration and tracking are good, or tells you the px/s^2 of gravity).
    g=9.81  -> gravity fixed, only y0 and vy fitted. More stable with few points, but
               only valid in meters (needs calibration)."""
    t, x, y = (np.asarray(a, dtype=float) for a in (t, x, y))
    need = 3 if g is None else 2
    if len(t) < need:
        raise ValueError(f"Need at least {need} points to fit, got {len(t)}.")

    vx, x0 = np.polyfit(t, x, 1)
    if g is None:
        a, vy, y0 = np.polyfit(t, y, 2)
        g_fit = -2 * a
    else:
        # y + 1/2 g t^2 = y0 + vy t  -> a straight-line fit
        vy, y0 = np.polyfit(t, y + 0.5 * g * t ** 2, 1)
        g_fit = g
    resid = y - (y0 + vy * t - 0.5 * g_fit * t ** 2)
    return ProjectileFit(float(x0), float(y0), float(vx), float(vy), float(g_fit),
                         g is not None, float(np.sqrt(np.mean(resid ** 2))), len(t))


def flight_time_estimates(flight_time, g=G):
    """Physics that needs NO calibration (original analyze_events.py formulas).

    If takeoff and landing heights are equal, the flight is symmetric:
        vy = g T / 2      (takeoff vertical speed)
        h  = g T^2 / 8    (rise of the center of mass)
    In a broad jump the hips usually land LOWER than they took off, which lengthens T
    and makes both of these over-estimates. Prefer the parabola fit when available."""
    return {"vy": g * flight_time / 2, "peak_rise": g * flight_time ** 2 / 8}


def gravity_implied_scale(g_px, g=G):
    """Meters per pixel implied by gravity: the free parabola fit measures g in px/s^2,
    and we know it should be 9.81 m/s^2. A cross-check for the tape-measure calibration."""
    if g_px <= 0:
        raise ValueError("Fitted gravity is not positive; the trajectory isn't a downward parabola.")
    return g / g_px
