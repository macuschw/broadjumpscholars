"""ACCURACY BENCHMARK on real footage.

These tests run the real analysis pipeline on keypoints tracked from a real 120 fps jump
(tests/data/real_jump_120fps_*) and compare the detected takeoff/landing with frames a
person read off the video by eye. This is the benchmark for event detection: the synthetic
tests are fast and useful, but the synthetic jumper has no marker drift or tracking
glitches, and the audit showed methods that were perfect on synthetic data failing here.

Ground truth (see tests/data/real_jump_120fps.json and the two .jpg evidence images):
    takeoff = frame 384, first frame the toe is clearly off the floor (383 marginal)
    landing = frame 431, first frame the heel touches the floor (foot flat at 433)
Labels are good to about +/-1 frame, so the benchmark allows +/-2 frames (17 ms).

To add more labelled jumps, see tests/data/make_benchmark_clip.py.
"""
import json
import os

import numpy as np
import pytest

from jumplab import physics
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.pose_tracking import Keypoints

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
TOLERANCE_FRAMES = 2


def load_clip(name):
    with open(os.path.join(DATA, f"{name}.json")) as f:
        meta = json.load(f)
    return Keypoints.load(os.path.join(DATA, f"{name}_keypoints.npz")), meta


@pytest.fixture(scope="module")
def real():
    return load_clip("real_jump_120fps")


def run(kp, meta, method):
    r = analyze_keypoints(kp, meta["m_per_px"], AnalysisConfig(event_method=method))
    first = meta["first_frame"]              # report frames in the original video's numbering
    return r, r["events"]["takeoff"]["frame"] + first, r["events"]["landing"]["frame"] + first


def assert_events_match(kp, meta, method):
    _, takeoff, landing = run(kp, meta, method)
    true_to, true_la = meta["true_takeoff_frame"], meta["true_landing_frame"]
    assert abs(takeoff - true_to) <= TOLERANCE_FRAMES, (
        f"{method}: takeoff detected at frame {takeoff}, hand-labelled {true_to} "
        f"({takeoff - true_to:+d} frames, allowed +/-{TOLERANCE_FRAMES})")
    assert abs(landing - true_la) <= TOLERANCE_FRAMES, (
        f"{method}: landing detected at frame {landing}, hand-labelled {true_la} "
        f"({landing - true_la:+d} frames, allowed +/-{TOLERANCE_FRAMES})")


def test_toe_heel_events_match_hand_labels(real):
    assert_events_match(*real, "toe_heel")


@pytest.mark.xfail(strict=True, reason=(
    "Known bias of the DEFAULT ankle method: takeoff is found ~7 frames early because the "
    "ankle rises during heel lift, before the toes leave the floor. It stays the default "
    "until the students' accuracy study. strict=True: if this starts passing, the method "
    "changed and this marker should be removed."))
def test_ankle_events_match_hand_labels(real):
    assert_events_match(*real, "ankle")


def test_ankle_landing_matches_hand_label(real):
    """The ankle method's landing is fine; test it on its own so a landing regression in
    the default method is still caught while its takeoff is marked as a known failure."""
    kp, meta = real
    _, _, landing = run(kp, meta, "ankle")
    assert abs(landing - meta["true_landing_frame"]) <= TOLERANCE_FRAMES


@pytest.mark.parametrize("method", ["ankle", "toe_heel"])
def test_no_false_warnings_on_a_good_real_jump(real, method):
    kp, meta = real
    r, _, _ = run(kp, meta, method)
    assert r["warnings"] == []


def test_center_of_mass_behaves_like_a_projectile(real):
    """Over the hand-labelled flight, the CoM should have ~zero horizontal acceleration
    (no horizontal force) and follow a parabola more closely than the hip does."""
    kp, meta = real
    r, _, _ = run(kp, meta, "toe_heel")
    s, k = r["series"], meta["m_per_px"]
    a, b = meta["true_takeoff_frame"] - meta["first_frame"], meta["true_landing_frame"] - meta["first_frame"]
    t = s["time_s"][a:b] - s["time_s"][a]
    ax = 2 * np.polyfit(t, s["com_x_px_raw"][a:b] * k, 2)[0]
    assert abs(ax) < 0.5
    com = physics.fit_projectile(t, s["com_x_px_raw"][a:b] * k, s["com_y_px_up_raw"][a:b] * k)
    hip = physics.fit_projectile(t, s["hip_x_px_raw"][a:b] * k, s["hip_y_px_up_raw"][a:b] * k)
    assert com.rms_residual_y < 0.5 * hip.rms_residual_y


def test_jump_distance_near_tape_measurement(real):
    """The athlete tape-measured about 51.5 in (1.31 m). Loose tolerance: the calibration
    tape was in front of the jump line (audit B1), so this is a sanity check only."""
    kp, meta = real
    r, _, _ = run(kp, meta, "toe_heel")
    assert r["distance"]["jump_distance_m"] == pytest.approx(1.31, abs=0.08)
