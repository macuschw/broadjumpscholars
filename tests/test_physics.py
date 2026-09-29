import numpy as np
import pytest

from jumplab import physics
from jumplab.physics import G


def _trajectory(vx=2.5, vy=2.2, x0=0.3, y0=0.9, g=G, n=50, fps=120.0):
    t = np.arange(n) / fps
    return t, x0 + vx * t, y0 + vy * t - 0.5 * g * t ** 2


def test_free_fit_recovers_exact_parameters():
    t, x, y = _trajectory()
    f = physics.fit_projectile(t, x, y)
    assert (f.vx, f.vy, f.x0, f.y0, f.g) == pytest.approx((2.5, 2.2, 0.3, 0.9, G))
    assert f.rms_residual_y == pytest.approx(0, abs=1e-9)
    assert f.launch_angle_deg == pytest.approx(np.degrees(np.arctan2(2.2, 2.5)))
    assert f.peak_rise == pytest.approx(2.2 ** 2 / (2 * G))


def test_fixed_g_fit():
    t, x, y = _trajectory()
    f = physics.fit_projectile(t, x, y, g=G)
    assert f.g_was_fixed and f.vy == pytest.approx(2.2)


def test_noisy_fit_is_close():
    t, x, y = _trajectory()
    rng = np.random.default_rng(1)
    f = physics.fit_projectile(t, x + rng.normal(0, 0.005, len(t)), y + rng.normal(0, 0.005, len(t)))
    assert f.g == pytest.approx(G, rel=0.05)
    assert f.launch_angle_deg == pytest.approx(41.35, abs=1.0)


def test_flight_time_formulas():
    # Symmetric flight: rise and fall take T/2 each
    est = physics.flight_time_estimates(0.5)
    assert est["vy"] == pytest.approx(G * 0.25)
    assert est["peak_rise"] == pytest.approx(G * 0.5 ** 2 / 8)
    # consistent with the parabola: peak = vy^2 / 2g
    assert est["peak_rise"] == pytest.approx(est["vy"] ** 2 / (2 * G))


def test_gravity_implied_scale_recovers_calibration():
    scale = 0.004
    t, x, y = _trajectory()
    f = physics.fit_projectile(t, x / scale, y / scale)        # fit in pixels
    assert physics.gravity_implied_scale(f.g) == pytest.approx(scale)


def test_too_few_points():
    with pytest.raises(ValueError):
        physics.fit_projectile([0, 1], [0, 1], [0, 1])
    with pytest.raises(ValueError):
        physics.gravity_implied_scale(-1.0)
