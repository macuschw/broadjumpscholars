"""End-to-end physics validation with a synthetic video of a projectile.

Draw a ball following ideal projectile motion into an .mp4 (with known g, launch
velocity and px/m scale), then track it from the video pixels, fit a parabola and
check we get the physics back. This tests video I/O, tracking, the fit, and the
calibration <-> gravity relationship together. The same check works on a real
ball-toss video: see scripts/validate_ball_toss.py.
"""
import numpy as np
import pytest

from jumplab import physics
from jumplab.ball_tracking import track_ball
from jumplab.physics import G

from synthetic import write_projectile_video

SCALE = 0.005   # m/px


@pytest.fixture(scope="module")
def toss(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("ball") / "toss.mp4")
    truth = write_projectile_video(path, x0=0.3, y0=0.5, vx=1.5, vy=2.5, scale=SCALE)
    return path, truth


@pytest.fixture(scope="module")
def drop(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("ball") / "drop.mp4")
    truth = write_projectile_video(path, x0=1.6, y0=2.2, vx=0.0, vy=0.0, duration=0.5, scale=SCALE)
    return path, truth


def test_tracker_finds_ball_every_frame_to_subpixel(toss):
    path, (t_true, x_true, y_true) = toss
    t, x, y = track_ball(path)
    assert len(t) == len(t_true) and not np.isnan(x).any()
    assert np.max(np.abs(x - x_true)) < 0.5
    assert np.max(np.abs(y - y_true)) < 0.5


def test_toss_recovers_g_velocity_and_angle(toss):
    path, _ = toss
    t, x, y = track_ball(path)
    fit = physics.fit_projectile(t, x * SCALE, y * SCALE)
    assert fit.g == pytest.approx(G, rel=0.01)
    assert fit.vx == pytest.approx(1.5, rel=0.01)
    assert fit.vy == pytest.approx(2.5, rel=0.01)
    assert fit.launch_angle_deg == pytest.approx(np.degrees(np.arctan2(2.5, 1.5)), abs=0.5)
    assert fit.peak_rise == pytest.approx(2.5 ** 2 / (2 * G), rel=0.02)


def test_drop_recovers_g(drop):
    path, _ = drop
    t, x, y = track_ball(path)
    fit = physics.fit_projectile(t, x * SCALE, y * SCALE)
    assert fit.g == pytest.approx(G, rel=0.01)
    assert abs(fit.vx) < 0.02 and abs(fit.vy) < 0.05


def test_gravity_alone_recovers_the_calibration(toss):
    """Uncalibrated fit in pixels + known g = the scale a tape measure would give."""
    path, _ = toss
    t, x, y = track_ball(path)
    fit_px = physics.fit_projectile(t, x, y)
    assert physics.gravity_implied_scale(fit_px.g) == pytest.approx(SCALE, rel=0.01)


def test_wrong_calibration_shows_up_as_wrong_g(toss):
    """If the tape-measure scale is 10% off, g from the fit is 10% off too - which is
    why a ball toss is a good check of the calibration."""
    path, _ = toss
    t, x, y = track_ball(path)
    fit = physics.fit_projectile(t, x * SCALE * 1.1, y * SCALE * 1.1)
    assert fit.g == pytest.approx(1.1 * G, rel=0.01)
