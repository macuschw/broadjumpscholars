"""Limb-snap check: a landmark leaping away from where the neighbouring frames put it
(usually a limb attaching to a person behind the jumper). Warn only - data is never changed.

Thresholds (checks.SNAP_ONE_FRAME = 30%, SNAP_TWO_FRAME = 40% of trunk length) are
provisional: set from 2 clean and 2 bystander real clips, with one snap confirmed by eye."""
import json
import os

import numpy as np
import pytest

from jumplab import checks
from jumplab.checks import CAUTION, SERIOUS
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.pose_tracking import LANDMARKS, Keypoints

from synthetic import Truth, jumper_keypoints

T = Truth()
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
TRUNK_PX = 0.5 / T.scale          # synthetic trunk is 0.5 m
CFG = AnalysisConfig(event_method="toe_heel")


def snap(kp, side, name, frames, fraction_of_trunk=0.5):
    """Move one landmark straight down by a fraction of the trunk length in some frames."""
    kp.xyv[frames, LANDMARKS[side][name], 1] += fraction_of_trunk * TRUNK_PX
    return kp


def snap_warnings(r):
    return [w for w in r["warnings"] if w["code"] == "limb_snap"]


# ---------------------------------------------------------------- no false alarms

class Thirty(Truth):
    fps = 30.0


@pytest.mark.parametrize("kwargs", [
    {}, {"noise_px": 1.5}, {"truth": Thirty()}, {"truth": Thirty(), "noise_px": 1.5},
    {"heel_lift_deg": 40}, {"arm_swing_deg": 150}, {"direction": -1},
], ids=["clean", "noise", "30fps", "30fps-noise", "heel-lift", "arm-swing", "left"])
def test_clean_synthetic_jumps_have_no_snaps(kwargs):
    kp = jumper_keypoints(**kwargs)
    assert checks.limb_snap_frames(kp, "LEFT") == {}
    assert checks.limb_snap_frames(kp, "RIGHT") == {}


def test_real_clean_jump_has_no_snaps_on_either_leg():
    kp = Keypoints.load(os.path.join(DATA, "real_jump_120fps_keypoints.npz"))
    assert checks.limb_snap_frames(kp, "RIGHT") == {}       # near side
    assert checks.limb_snap_frames(kp, "LEFT") == {}        # far side


# ---------------------------------------------------------------- snaps are caught

def test_one_frame_snap_in_flight_is_serious():
    r = analyze_keypoints(snap(jumper_keypoints(), "LEFT", "ANKLE", [170]), T.scale, CFG)
    (w,) = snap_warnings(r)
    assert w["severity"] == SERIOUS and "170" in w["message"]
    assert r["tracking_quality"]["limb_snap_frames"] == {"170": ["ankle"]}


def test_two_frame_snap_is_caught():
    # Each frame moves 0.24 trunk from the one-frame midpoint (under 30%), so this relies
    # on the two-frame test
    kp = snap(jumper_keypoints(), "LEFT", "KNEE", [170, 171], 0.48)
    assert set(checks.limb_snap_frames(kp, "LEFT")) == {170, 171}


def test_small_wobble_is_not_a_snap():
    kp = snap(jumper_keypoints(), "LEFT", "ANKLE", [170], 0.2)
    assert checks.limb_snap_frames(kp, "LEFT") == {}


def test_snap_away_from_takeoff_and_landing_is_caution():
    r = analyze_keypoints(snap(jumper_keypoints(), "LEFT", "KNEE", [100]), T.scale, CFG)
    (w,) = snap_warnings(r)
    assert w["severity"] == CAUTION


def test_snap_outside_the_jump_is_listed_not_warned():
    r = analyze_keypoints(snap(jumper_keypoints(), "LEFT", "HEEL", [20]), T.scale, CFG)
    assert snap_warnings(r) == []
    assert "20" in r["tracking_quality"]["limb_snap_frames"]


def test_warn_only_the_data_is_not_changed():
    kp = snap(jumper_keypoints(), "LEFT", "ANKLE", [170])
    before = kp.xyv.copy()
    analyze_keypoints(kp, T.scale, CFG)
    assert np.array_equal(kp.xyv, before, equal_nan=True)


# ---------------------------------------------------------------- far leg

def test_far_leg_snap_is_listed_but_not_warned():
    r = analyze_keypoints(snap(jumper_keypoints(), "RIGHT", "ANKLE", [170]), T.scale, CFG)
    assert r["side"] == "LEFT"
    assert snap_warnings(r) == []
    assert r["tracking_quality"]["far_leg_snap_frames"] == {"170": ["ankle"]}


def test_far_leg_snap_warns_when_the_far_leg_is_used():
    # com_mode="both" puts the far leg into the center of mass
    cfg = AnalysisConfig(event_method="toe_heel", com_mode="both")
    r = analyze_keypoints(snap(jumper_keypoints(), "RIGHT", "ANKLE", [170]), T.scale, cfg)
    assert len(snap_warnings(r)) == 1


# ---------------------------------------------------------------- real bystander footage

@pytest.fixture(scope="module")
def bystander():
    with open(os.path.join(DATA, "bystander_jump_30fps.json")) as f:
        meta = json.load(f)
    return Keypoints.load(os.path.join(DATA, "bystander_jump_30fps_keypoints.npz")), meta


def test_real_bystander_snap_is_caught_on_the_far_leg(bystander):
    kp, meta = bystander
    r = analyze_keypoints(kp, None, CFG)
    assert r["side"] == meta["near_side"] and r["direction"] == meta["jump_direction"]
    assert str(meta["known_far_leg_snap_frame"]) in r["tracking_quality"]["far_leg_snap_frames"]
    # The near leg - used by every default result - stayed on the jumper
    assert r["tracking_quality"]["limb_snap_frames"] == {}
    assert snap_warnings(r) == []


def test_real_bystander_snap_warns_in_both_legs_mode(bystander):
    kp, _ = bystander
    r = analyze_keypoints(kp, None, AnalysisConfig(event_method="toe_heel", com_mode="both"))
    assert len(snap_warnings(r)) == 1
