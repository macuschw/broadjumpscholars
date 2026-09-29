"""Gap filling and zero-lag low-pass filtering for keypoint time series."""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, filtfilt

# ~10 Hz is typical for jumping. Lower = smoother.
DEFAULT_CUTOFF_HZ = 10.0


def fill_gaps(values):
    """Linearly interpolate over missing (NaN) frames.

    With fewer than 2 good samples there is nothing to interpolate from, so the
    array is returned unchanged (still containing NaNs)."""
    v = np.array(values, dtype=float)
    idx = np.arange(len(v))
    good = ~np.isnan(v)
    if good.sum() < 2:
        return v
    return np.interp(idx, idx[good], v[good])


def lowpass(values, fps, cutoff_hz=DEFAULT_CUTOFF_HZ, order=2):
    """Zero-lag Butterworth low-pass filter (filtfilt runs it forward and backward,
    so peaks are not shifted in time)."""
    v = np.array(values, dtype=float)
    if np.isnan(v).any():
        return v
    cutoff = min(cutoff_hz, 0.4 * fps)          # must stay below Nyquist (fps/2)
    b, a = butter(order, cutoff / (fps / 2), btype="low")
    if len(v) > 3 * max(len(a), len(b)):
        v = filtfilt(b, a, v)
    return v


def fill_and_smooth(values, fps, cutoff_hz=DEFAULT_CUTOFF_HZ):
    """Interpolate over missing frames, then apply a zero-lag low-pass filter."""
    return lowpass(fill_gaps(values), fps, cutoff_hz)
