"""Both-feet (official rule) distance: front-most takeoff toe -> rearmost landing heel.
The main jump distance stays the near-foot one; the both-feet number is reported alongside it.

Staggered feet are flagged (SERIOUS, affects distance) whenever the feet are more than 5 cm
apart at landing or takeoff - even when the far foot is too hidden to trust its position -
because the tape check of October 2026 found staggered jumps off by 1.5-4.8 in and the
feet-together jump within 0.3 in.

Thresholds (far-foot visibility >= 0.5, wobble <= 2 cm, warn above 5 cm) are provisional
until checked against tape-measured staggered landings."""
import json
import os

import numpy as np
import pytest

from jumplab.checks import SERIOUS
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.pose_tracking import LANDMARKS, Keypoints

from synthetic import Truth, jumper_keypoints

T = Truth()
CFG = AnalysisConfig(event_method="toe_heel")
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
FOOT = ("HEEL", "ANKLE", "FOOT_INDEX")


# The synthetic near foot has visibility 0.9; 0.7 for the far foot is trusted (>= 0.5) and
# clearly lower, as on real footage (near ~0.95, far 0.34-0.6).


def run(scale=T.scale, **kw):
    return analyze_keypoints(jumper_keypoints(**kw), scale, CFG)


def stagger_warnings(r):
    return [w for w in r["warnings"] if w["code"] == "staggered_feet"]


@pytest.fixture(scope="module")
def level():
    return run(far_visibility=0.7)


def test_level_feet_both_distances_agree_and_no_warning(level):
    d = level["distance"]
    assert d["jump_distance_both_feet_m"] == pytest.approx(d["jump_distance_m"], abs=0.005)
    assert level["both_feet"]["landing_heels"]["far_foot_used"]
    assert stagger_warnings(level) == []


def test_far_heel_behind_is_reported_and_warned(level):
    r = run(far_visibility=0.7, far_heel_offset_m=-0.15)
    d = r["distance"]
    # The main (near-foot) distance does NOT change
    assert d["jump_distance_m"] == pytest.approx(level["distance"]["jump_distance_m"], abs=0.002)
    # The official-rule distance is 15 cm shorter
    assert d["jump_distance_both_feet_m"] == pytest.approx(d["jump_distance_m"] - 0.15, abs=0.01)
    (w,) = stagger_warnings(r)
    assert w["severity"] == SERIOUS and w["affects"] == ["distance"] and "15 cm" in w["message"]


def test_near_heel_behind_needs_no_correction_but_is_still_flagged():
    # Far heel AHEAD: the near heel is already the rearmost one, so the number doesn't change -
    # but a staggered landing is still flagged, since staggered jumps measured poorly on tape
    r = run(far_visibility=0.7, far_heel_offset_m=+0.15)
    d = r["distance"]
    assert d["jump_distance_both_feet_m"] == pytest.approx(d["jump_distance_m"], abs=0.005)
    assert r["both_feet"]["landing_heels"]["heel_gap_cm"] == pytest.approx(15, abs=1)
    assert len(stagger_warnings(r)) == 1


def test_far_toe_ahead_at_takeoff():
    r = run(far_visibility=0.7, far_toe_offset_m=+0.12)
    d = r["distance"]
    assert d["jump_distance_both_feet_m"] == pytest.approx(d["jump_distance_m"] - 0.12, abs=0.01)
    (w,) = stagger_warnings(r)
    assert "toe" in w["message"]


def test_small_stagger_below_5cm_is_recorded_but_not_warned():
    r = run(far_visibility=0.7, far_heel_offset_m=-0.03)
    d = r["distance"]
    assert d["jump_distance_both_feet_m"] == pytest.approx(d["jump_distance_m"] - 0.03, abs=0.01)
    assert stagger_warnings(r) == []


def test_low_confidence_far_foot_falls_back_to_near_foot_but_stagger_is_flagged():
    # Like the 120 fps staggered tape jump: far foot too hidden to measure, feet clearly apart.
    # The near-foot distance is kept, but the result must not look trustworthy.
    r = run(far_visibility=0.3, far_heel_offset_m=-0.15)
    heels = r["both_feet"]["landing_heels"]
    assert not heels["far_foot_used"] and "visibility" in heels["why_not_used"]
    assert r["distance"]["jump_distance_both_feet_m"] is None
    assert r["both_feet"]["feet_gap_cm"] == pytest.approx(15, abs=1)
    (w,) = stagger_warnings(r)
    assert w["severity"] == SERIOUS and "approximate" in w["message"]


def test_feet_together_with_hidden_far_foot_is_not_flagged():
    # Like the spot-on 120 fps tape jump: far foot barely visible, feet side by side
    r = run(far_visibility=0.3)
    assert r["both_feet"]["feet_gap_cm"] < 5
    assert stagger_warnings(r) == []


def test_wobbly_far_foot_is_not_trusted():
    kp = jumper_keypoints(far_visibility=0.7, far_heel_offset_m=-0.15)
    after = kp.time > T.t_landing
    rng = np.random.default_rng(0)
    for n in FOOT:          # far foot drifting 4 cm (16 px) around: a guess, not a planted foot
        kp.xyv[after, LANDMARKS["RIGHT"][n], 0] += rng.normal(0, 16, after.sum())
    r = analyze_keypoints(kp, T.scale, CFG)
    heels = r["both_feet"]["landing_heels"]
    assert not heels["far_foot_used"] and "steady" in heels["why_not_used"]


def test_feet_equally_visible_cannot_be_told_apart():
    r = run(far_visibility=0.9, far_heel_offset_m=-0.15)
    heels = r["both_feet"]["landing_heels"]
    assert not heels["far_foot_used"] and "can't tell" in heels["why_not_used"]


def swap_feet(kp, frames):
    """MediaPipe calling the left foot 'right' and vice versa in these frames."""
    for n in FOOT:
        a, b = LANDMARKS["LEFT"][n], LANDMARKS["RIGHT"][n]
        kp.xyv[frames, a], kp.xyv[frames, b] = kp.xyv[frames, b].copy(), kp.xyv[frames, a].copy()
    return kp


def test_left_right_label_swaps_do_not_change_the_comparison():
    plain = analyze_keypoints(jumper_keypoints(far_visibility=0.7, far_heel_offset_m=-0.15,
                                               far_toe_offset_m=0.08), T.scale, CFG)
    kp = jumper_keypoints(far_visibility=0.7, far_heel_offset_m=-0.15, far_toe_offset_m=0.08)
    settled = np.flatnonzero(kp.time >= T.t_landing + 0.1)[::2]     # every other frame after landing
    planted = np.flatnonzero((kp.time > 0.9) & (kp.time < T.t_takeoff))[::2]
    swapped = analyze_keypoints(swap_feet(swap_feet(kp, settled), planted), T.scale, CFG)
    assert swapped["both_feet"]["difference_cm"] == pytest.approx(plain["both_feet"]["difference_cm"], abs=0.5)


def test_uncalibrated_uses_trunk_based_threshold():
    r = run(scale=None, far_visibility=0.7, far_heel_offset_m=-0.15)
    assert r["distance"]["jump_distance_both_feet_m"] is None        # no meters without calibration
    assert r["pixels"]["jump_distance_both_feet_px"] < r["pixels"]["jump_distance_px"]
    assert len(stagger_warnings(r)) == 1


def test_real_benchmark_jump_has_no_stagger_warning():
    with open(os.path.join(DATA, "real_jump_120fps.json")) as f:
        meta = json.load(f)
    kp = Keypoints.load(os.path.join(DATA, "real_jump_120fps_keypoints.npz"))
    r = analyze_keypoints(kp, meta["m_per_px"], CFG)
    assert stagger_warnings(r) == []
    if r["distance"]["jump_distance_both_feet_m"] is not None:
        assert r["distance"]["jump_distance_both_feet_m"] == pytest.approx(r["distance"]["jump_distance_m"], abs=0.05)


class OffCenter(Truth):
    x_start = -2.0              # the takeoff ~750 px left of the middle of the picture, as on our live videos


def test_feet_side_by_side_far_from_the_middle_are_not_called_staggered():
    # Through a lens the far foot shows up shifted toward the middle of the picture (feet.perspective_shift):
    # ~11 cm here, which used to read as staggered feet on every jump of a real live session
    kp = jumper_keypoints(truth=OffCenter(), far_visibility=0.7)
    r = analyze_keypoints(kp, T.scale, CFG)
    toes = r["both_feet"]["takeoff_toes"]
    assert toes["perspective_px"] * T.scale > 0.08            # a big shift was there, and removed
    assert toes["toe_gap_cm"] < 1
    assert stagger_warnings(r) == []


def test_real_stagger_far_from_the_middle_is_still_flagged():
    kp = jumper_keypoints(truth=OffCenter(), far_visibility=0.7, far_toe_offset_m=0.12)
    r = analyze_keypoints(kp, T.scale, CFG)
    assert r["both_feet"]["takeoff_toes"]["toe_gap_cm"] == pytest.approx(12, abs=1)
    (w,) = stagger_warnings(r)
    assert "toe" in w["message"]


def test_without_the_correction_the_lens_shift_looked_like_stagger():
    # The same side-by-side feet, if perspective were ignored: what the old check saw
    from jumplab import feet
    kp = jumper_keypoints(truth=OffCenter(), far_visibility=0.7)
    planted = slice(int(0.9 * T.fps), int(T.t_takeoff * T.fps))
    raw = feet.compare(kp, "FOOT_INDEX", planted, 1, rear=False, wobble_px=10)              # no px_per_m: no correction
    fixed = feet.compare(kp, "FOOT_INDEX", planted, 1, rear=False, wobble_px=10, px_per_m=1 / T.scale)
    assert raw["gap_px"] * T.scale > 0.08 and fixed["gap_px"] * T.scale < 0.01
