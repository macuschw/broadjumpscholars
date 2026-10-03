"""Synthetic jumps under harder conditions: low frame rate and a realistic heel lift.
Fast checks; the real-footage benchmark (test_real_footage.py) is the accuracy reference."""
import numpy as np
import pytest

from jumplab.pipeline import AnalysisConfig, analyze_keypoints

from synthetic import Truth, jumper_keypoints


class Thirty(Truth):
    fps = 30.0


def true_frames(tr):
    return int(np.floor(tr.t_takeoff * tr.fps)) + 1, int(np.ceil(tr.t_landing * tr.fps))


@pytest.mark.parametrize("noise", [0.0, 1.5])
def test_30fps_toe_heel_events_and_physics(noise):
    tr = Thirty()
    r = analyze_keypoints(jumper_keypoints(truth=tr, noise_px=noise), tr.scale,
                          AnalysisConfig(event_method="toe_heel"))
    to, la = true_frames(tr)
    assert abs(r["events"]["takeoff"]["frame"] - to) <= 1
    assert abs(r["events"]["landing"]["frame"] - la) <= 1
    assert r["trajectory"]["g_fit_m_s2"] == pytest.approx(9.81, rel=0.03)
    assert r["distance"]["jump_distance_m"] == pytest.approx(tr.jump_distance, abs=0.02)
    assert [w["code"] for w in r["warnings"]] == ["low_fps"]


def test_30fps_launch_angle_worst_case_takeoff_timing():
    """Audit A6: velocities used to be read at the first airborne frame, up to one frame
    (33 ms at 30 fps) after the real takeoff, so vy read up to g/30 = 0.33 m/s low (~4.5 deg
    here, where takeoff falls exactly on a frame boundary: the worst case). They are now
    read half a frame earlier, at the estimated takeoff instant."""
    tr = Thirty()
    r = analyze_keypoints(jumper_keypoints(truth=tr, noise_px=1.5, seed=0), tr.scale,
                          AnalysisConfig(event_method="toe_heel"))
    assert r["events"]["takeoff"]["frame"] == true_frames(tr)[0]   # events are exact here
    assert r["trajectory"]["launch_angle_deg"] == pytest.approx(tr.launch_angle_deg, abs=2.5)


def test_30fps_timing_is_rated_rough_in_the_summary():
    from jumplab.summary import ROUGH, format_summary
    tr = Thirty()
    r = analyze_keypoints(jumper_keypoints(truth=tr), tr.scale, AnalysisConfig(event_method="toe_heel"))
    assert ROUGH in format_summary(r).split("5. GROUND CONTACT TIME")[1]


@pytest.mark.parametrize("fps", [120.0, 30.0])
def test_heel_lift_toe_heel_finds_true_takeoff(fps):
    tr = type("T", (Truth,), {"fps": fps})()
    r = analyze_keypoints(jumper_keypoints(truth=tr, heel_lift_deg=40), tr.scale,
                          AnalysisConfig(event_method="toe_heel"))
    assert abs(r["events"]["takeoff"]["frame"] - true_frames(tr)[0]) <= 1


def test_heel_lift_makes_the_ankle_method_early():
    """Reproduces the real-footage bias: the ankle rises during heel lift, so the ankle
    method calls takeoff while the toes are still on the floor."""
    r = analyze_keypoints(jumper_keypoints(heel_lift_deg=40), Truth.scale,
                          AnalysisConfig(event_method="ankle"))
    assert r["events"]["takeoff"]["frame"] <= true_frames(Truth())[0] - 5
