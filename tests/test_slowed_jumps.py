"""A phone's slow motion saved for playback: the file says nothing, only the physics does (IMG_1607:
a normal jump and two 4x slower, in one 30 fps video). A real 120 fps clip read as 30 fps is exactly that."""
import os
import warnings
from dataclasses import replace

import numpy as np
import pytest

from jumplab.pipeline import analyze_keypoints, slowdown
from jumplab.pose_tracking import Keypoints, SlowedSegment, jumps_in_keypoints
from jumplab.session import analyze_session

DATA = os.path.join(os.path.dirname(__file__), "data")
warnings.filterwarnings("ignore", category=RuntimeWarning)


def clip(name):
    return Keypoints.load(os.path.join(DATA, f"{name}_keypoints.npz"))


def played_slower(kp, k):
    """The same frames, as a file that plays them k times slower."""
    times = None if kp.frame_times is None else np.asarray(kp.frame_times) * k
    return replace(kp, fps=kp.fps / k, frame_times=times)


@pytest.fixture(scope="module")
def real():
    return clip("real_jump_120fps")


def true_scale(kp):
    """This clip's m per px: the one its own flight implies."""
    return analyze_keypoints(kp)["trajectory"]["gravity_implied_scale_m_per_px"]


@pytest.mark.parametrize("tape", [False, True])
def test_a_slowed_jump_is_timed_as_the_real_one(real, tape):
    scale = true_scale(real) if tape else None
    normal = analyze_keypoints(real, scale)
    slowed = analyze_keypoints(played_slower(real, 4), scale)
    assert normal["fps_source"] != "slowed"
    assert slowed["fps_source"] == "slowed" and slowed["slowed_by"] == 4
    assert slowed["timing"]["flight_time_s"] == pytest.approx(normal["timing"]["flight_time_s"], abs=0.02)
    assert slowed["pixels"]["jump_distance_px"] == pytest.approx(normal["pixels"]["jump_distance_px"], rel=0.01)
    codes = {w["code"] for w in slowed["warnings"]}
    assert "slowed_jump" in codes
    assert not codes & {"flight_time_implausible", "slow_motion_suspected", "fps_override"}


def test_a_set_frame_rate_wins(real):
    r = analyze_keypoints(played_slower(real, 4), fps_override=120)
    assert r["fps_source"] == "override" and "slowed_by" not in r


def test_the_slowdown_is_only_believed_with_real_physics(real):
    kp, scale = played_slower(real, 4), true_scale(real)
    r = analyze_keypoints(kp, scale, fps_override=30)
    assert slowdown(r, kp, scale) == 4
    barely_rose = {**r, "pixels": {**r["pixels"], "hip_rise_px": 1.0}}
    assert slowdown(barely_rose, kp, scale) is None
    no_curve = {**r, "trajectory": {**r["trajectory"], "g_fit_px_s2": -5.0}}
    assert slowdown(no_curve, kp, scale) is None
    too_slow = {**r, "timing": {**r["timing"], "flight_time_s": 30.0}}
    assert slowdown(too_slow, kp, scale) is None


@pytest.mark.parametrize("name", ["real_jump_120fps", "multi_jump_120fps", "bystander_jump_30fps"])
def test_normal_videos_stay_as_they_were(name):
    kp = clip(name)
    jumps, _ = analyze_session(kp, jumps_in_keypoints(kp) or [(0, kp.n_frames - 1)])
    assert not [r for _, r in jumps if r["fps_source"] == "slowed"]


def test_a_normal_jump_taken_for_a_slowed_one_is_dropped(real):
    jumps, skipped = analyze_session(real, [SlowedSegment((0, real.n_frames - 1))])
    assert not jumps and "slowed" in skipped[0]["reason"]


def test_the_quick_look_finds_a_slowed_jump(real):
    kp = played_slower(real, 4)
    jumps, _ = analyze_session(kp, jumps_in_keypoints(kp) or [(0, kp.n_frames - 1)])
    assert [r["fps_source"] for _, r in jumps] == ["slowed"]
