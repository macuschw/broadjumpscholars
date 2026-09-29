import numpy as np
import pytest

from jumplab.smoothing import fill_and_smooth, fill_gaps, lowpass


def test_fill_gaps_interpolates_and_holds_edges():
    v = [np.nan, 1.0, np.nan, 3.0, np.nan]
    assert fill_gaps(v) == pytest.approx([1, 1, 2, 3, 3])


def test_fill_gaps_with_too_little_data_returns_unchanged():
    out = fill_gaps([np.nan, 5.0, np.nan])
    assert np.isnan(out[0]) and out[1] == 5.0


def test_lowpass_keeps_slow_motion_and_removes_jitter():
    fps = 120.0
    t = np.arange(240) / fps
    slow = np.sin(2 * np.pi * 1.5 * t)
    jitter = 0.3 * np.sin(2 * np.pi * 40 * t)
    out = lowpass(slow + jitter, fps, cutoff_hz=10)
    core = slice(20, -20)                       # ignore filter edge effects
    assert np.max(np.abs(out[core] - slow[core])) < 0.03
    # zero lag: the peak stays in the same frame
    assert np.argmax(out[:100]) == np.argmax(slow[:100])


def test_cutoff_is_clamped_below_nyquist_for_low_fps():
    fps = 15.0                                  # 10 Hz cutoff would be above Nyquist (7.5 Hz)
    out = fill_and_smooth(np.random.default_rng(0).normal(size=60), fps, cutoff_hz=10)
    assert np.all(np.isfinite(out))


def test_short_series_is_not_filtered():
    v = np.array([1.0, 2.0, 3.0])
    assert lowpass(v, 120) == pytest.approx(v)
