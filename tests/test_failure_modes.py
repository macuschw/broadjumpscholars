"""Situations that used to produce confident wrong numbers without any warning (audit A2).
Each must now either stop with an error or raise a warning that names the problem."""
import numpy as np
import pytest

from jumplab.checks import SERIOUS
from jumplab.events import NoJumpFound
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.pose_tracking import LANDMARKS, Keypoints

from synthetic import Truth, jumper_keypoints

T = Truth()
CFG = AnalysisConfig(event_method="toe_heel")


def codes(r):
    return {w["code"]: w for w in r["warnings"]}


def trimmed(kp, start_s=0.0, end_s=None):
    a = int(start_s * kp.fps)
    b = None if end_s is None else int(end_s * kp.fps)
    return Keypoints(kp.xyv[a:b], kp.fps, kp.width, kp.height)


def shift_feet_after(kp, t_s, dy_px):
    """Make the floor appear dy_px higher in the image after t_s (camera roll / slope)."""
    for side in ("LEFT", "RIGHT"):
        for n in ("HEEL", "FOOT_INDEX", "ANKLE", "KNEE"):
            kp.xyv[kp.time > t_s, LANDMARKS[side][n], 1] -= dy_px


def test_clean_jump_has_no_warnings():
    for method in ("ankle", "toe_heel"):
        assert analyze_keypoints(jumper_keypoints(), T.scale,
                                 AnalysisConfig(event_method=method))["warnings"] == []


def test_clip_ending_mid_air_is_an_error():
    # Used to report a 0.36 m jump for a 0.88 m one, with the g check passing
    with pytest.raises(NoJumpFound, match="end of the clip"):
        analyze_keypoints(trimmed(jumper_keypoints(), end_s=1.45), T.scale, CFG)


def test_clip_starting_mid_air_is_an_error():
    with pytest.raises(NoJumpFound, match="start of the clip"):
        analyze_keypoints(trimmed(jumper_keypoints(), start_s=1.25), T.scale, CFG)


def test_person_lost_during_flight_is_serious():
    kp = jumper_keypoints()
    kp.xyv[150:165] = np.nan
    kp.xyv[150:165, :, 2] = 0
    w = codes(analyze_keypoints(kp, T.scale, CFG))
    assert w["missing_in_jump"]["severity"] == SERIOUS


def test_clip_starting_mid_countermovement_flags_contact_time():
    r = analyze_keypoints(trimmed(jumper_keypoints(), start_s=0.7), T.scale, CFG)
    assert codes(r)["moving_start"]["affects"] == ["timing"]


@pytest.mark.parametrize("method", ["ankle", "toe_heel"])
def test_single_frame_foot_glitch_is_flagged(method):
    kp = jumper_keypoints()
    for side in ("LEFT", "RIGHT"):
        for n in ("ANKLE", "HEEL", "FOOT_INDEX"):
            kp.xyv[60, LANDMARKS[side][n], 1] -= 400          # one-frame 400 px spike
    w = codes(analyze_keypoints(kp, None, AnalysisConfig(event_method=method)))
    assert w["flight_time_implausible"]["severity"] == SERIOUS
    assert "distance_implausible" in w


def test_large_floor_offset_at_landing_is_an_error():
    # Used to report a 0.99 s flight: the landing search ran to the end of the clip
    kp = jumper_keypoints()
    shift_feet_after(kp, 1.55, 60)
    with pytest.raises(NoJumpFound, match="floor sits at a different height"):
        analyze_keypoints(kp, T.scale, CFG)


def test_small_floor_offset_no_longer_runs_away():
    kp = jumper_keypoints()
    shift_feet_after(kp, 1.55, 5)
    r = analyze_keypoints(kp, T.scale, CFG)
    true_landing = int(np.ceil(T.t_landing * T.fps))
    assert abs(r["events"]["landing"]["frame"] - true_landing) <= 5


def test_jump_toward_the_camera_is_serious():
    class Toward(Truth):
        vx = 0.3                                   # mostly toward the camera
    w = codes(analyze_keypoints(jumper_keypoints(truth=Toward()), T.scale, CFG))
    assert w["not_side_on"]["severity"] == SERIOUS


def test_athlete_changing_size_is_flagged():
    kp = jumper_keypoints()
    # After landing, everything 25% bigger about the planted heel (feet stay on the
    # floor): they ended up closer to the camera
    post = kp.time > 1.7
    heel = kp.xyv[post, LANDMARKS["LEFT"]["HEEL"], :2][:, None, :]
    kp.xyv[post, :, :2] = heel + 1.25 * (kp.xyv[post, :, :2] - heel)
    assert "not_side_on" in codes(analyze_keypoints(kp, T.scale, CFG))


def test_low_confidence_landmarks_are_flagged():
    kp = jumper_keypoints()
    kp.xyv[:, :, 2] = 0.05
    assert "low_confidence_landmarks" in codes(analyze_keypoints(kp, T.scale, CFG))


def test_landmark_leaving_the_frame_is_flagged():
    kp = jumper_keypoints()
    kp.xyv[140:170, LANDMARKS["LEFT"]["WRIST"], 1] = -30.0     # hand above the top edge
    w = codes(analyze_keypoints(kp, T.scale, CFG))
    assert "left wrist" in w["offframe_landmarks"]["message"]


def test_variable_frame_rate_is_flagged():
    kp = jumper_keypoints()
    times = np.arange(kp.n_frames) / kp.fps
    times[100:] += 0.02                            # a 20 ms hiccup (2.4 frames)
    kp.frame_times = times
    assert "variable_frame_rate" in codes(analyze_keypoints(kp, T.scale, CFG))


def test_file_timestamp_rounding_is_not_flagged():
    # Real 120 fps files show 7.9-8.8 ms gaps from rounding; that must not warn
    kp = jumper_keypoints()
    rng = np.random.default_rng(0)
    kp.frame_times = np.arange(kp.n_frames) / kp.fps + rng.uniform(-0.0004, 0.0004, kp.n_frames)
    assert analyze_keypoints(kp, T.scale, CFG)["warnings"] == []
