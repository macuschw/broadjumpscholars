import numpy as np
import pytest

from jumplab import events
from jumplab.physics import G


def original_takeoff_landing(ankle_y, threshold_fraction=0.15):
    """Verbatim logic from the old analyze_events.py, kept as a regression reference."""
    baseline = np.percentile(ankle_y, 20)
    peak_i = int(np.argmax(ankle_y))
    rise = ankle_y[peak_i] - baseline
    thr = baseline + threshold_fraction * rise
    i = peak_i
    while i > 0 and ankle_y[i - 1] > thr:
        i -= 1
    j = peak_i
    while j < len(ankle_y) - 1 and ankle_y[j] > thr:
        j += 1
    return i, j


def foot_curve(fps=120.0, t_takeoff=0.8, vy=2.2, n=240, scale=0.004, noise_px=0.0, seed=0):
    """Foot height (px, up): on the ground, then a parabolic hop. Returns
    (height, true first airborne frame, true first grounded frame)."""
    t = np.arange(n) / fps
    tau = t - t_takeoff
    h = np.clip(vy * tau - 0.5 * G * tau ** 2, 0, None) / scale
    h[tau < 0] = 0
    if noise_px:
        h = h + np.random.default_rng(seed).normal(0, noise_px, n)
    first_air = int(np.floor(t_takeoff * fps)) + 1
    first_ground = int(np.ceil((t_takeoff + 2 * vy / G) * fps))
    return h, first_air, first_ground


@pytest.mark.parametrize("seed", range(5))
def test_threshold_method_matches_original_script(seed):
    h, _, _ = foot_curve(noise_px=3.0, seed=seed)
    to, la, *_ = events.threshold_crossings(h)
    assert (to, la) == original_takeoff_landing(h)


def test_threshold_method_is_biased_toward_short_flight():
    """Documents the known bias: takeoff late AND landing early -> flight time too short."""
    h, true_to, true_la = foot_curve()
    to, la, *_ = events.threshold_crossings(h)
    assert to > true_to + 1          # late takeoff
    assert la < true_la - 1          # early landing
    assert (la - to) < (true_la - true_to) - 3


@pytest.mark.parametrize("noise_px", [0.0, 1.5])
def test_refined_method_is_within_one_frame(noise_px):
    h, true_to, true_la = foot_curve(noise_px=noise_px)
    hip = np.zeros_like(h)
    ev = events.detect_events(hip, 120.0, h, refine=True)
    assert abs(ev.takeoff_i - true_to) <= 1
    assert abs(ev.landing_i - true_la) <= 1


def test_no_jump_raises():
    flat = np.random.default_rng(0).normal(0, 2, 200)
    with pytest.raises(events.NoJumpFound):
        events.detect_events(np.zeros(200), 120.0, flat)


def test_countermovement_bottom_and_onset():
    fps = 100.0
    t = np.arange(200) / fps
    hip = np.full(200, 500.0)
    dip = (t >= 0.5) & (t < 1.1)                  # smooth dip, deepest at t = 0.8 s
    hip[dip] -= 80 * np.sin(np.pi * (t[dip] - 0.5) / 0.6)
    bottom = events.countermovement_bottom(hip, takeoff_i=115, fps=fps)
    assert bottom == 80
    onset = events.movement_onset(hip, bottom, fps)
    assert 50 <= onset <= 53                      # just after the dip starts at frame 50
