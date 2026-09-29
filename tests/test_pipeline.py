import json

import numpy as np
import pytest

from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.plotting import plot_events, plot_trajectory
from jumplab.pose_tracking import Keypoints
from jumplab.report import format_report, save_csv, save_json

from synthetic import Truth, jumper_keypoints

T = Truth()


@pytest.mark.parametrize("direction", [1, -1])
@pytest.mark.parametrize("method", ["ankle", "toe_heel"])
def test_synthetic_jump_is_measured_correctly(direction, method):
    r = analyze_keypoints(jumper_keypoints(direction), T.scale, AnalysisConfig(event_method=method))
    assert r["side"] == "LEFT"
    assert r["direction"] == ("right" if direction > 0 else "left")

    # Angles: forward lean positive whichever way the athlete jumps
    for moment in ("countermovement_bottom", "takeoff", "landing"):
        assert r["angles_deg"][moment]["trunk"] == pytest.approx(T.trunk_deg, abs=0.5)
        assert r["angles_deg"][moment]["shin"] == pytest.approx(T.shin_deg, abs=0.5)

    tr = r["trajectory"]
    assert tr["vx_m_s"] == pytest.approx(T.vx, rel=0.02)
    if method == "toe_heel":
        # vy/launch angle are read at the detected takeoff frame, so they are only as good
        # as the takeoff timing (see test_late_takeoff_lowers_vy_and_launch_angle)
        assert tr["vy_m_s"] == pytest.approx(T.vy, rel=0.05)
        assert tr["launch_angle_deg"] == pytest.approx(T.launch_angle_deg, abs=1.5)
    assert tr["g_fit_m_s2"] == pytest.approx(9.81, rel=0.02)
    assert tr["gravity_implied_scale_m_per_px"] == pytest.approx(T.scale, rel=0.02)
    assert r["distance"]["jump_distance_m"] == pytest.approx(T.jump_distance, abs=0.02)

    ev = r["events"]
    assert ev["countermovement_bottom"]["time_s"] == pytest.approx(0.9, abs=0.02)
    assert ev["movement_onset"]["time_s"] == pytest.approx(0.55, abs=0.05)


def test_refined_events_give_more_accurate_flight_time():
    kp = jumper_keypoints()
    old = analyze_keypoints(kp, T.scale, AnalysisConfig(event_method="ankle"))
    new = analyze_keypoints(kp, T.scale, AnalysisConfig(event_method="toe_heel"))
    err_old = abs(old["timing"]["flight_time_s"] - T.flight_time)
    err_new = abs(new["timing"]["flight_time_s"] - T.flight_time)
    assert err_new < err_old
    assert err_new <= 1.5 / T.fps
    assert old["timing"]["flight_time_toe_heel_method_s"] == new["timing"]["flight_time_s"]


def test_late_takeoff_lowers_vy_and_launch_angle():
    """The ankle threshold fires ~3 frames after takeoff on this synthetic jump. The hip
    has already slowed by g * 25 ms by then, so vy and the launch angle come out low."""
    r = analyze_keypoints(jumper_keypoints(), T.scale, AnalysisConfig(event_method="ankle"))
    late_s = r["events"]["takeoff"]["time_s"] - T.t_takeoff
    assert late_s > 1.5 / T.fps
    assert r["trajectory"]["vy_m_s"] == pytest.approx(T.vy - 9.81 * late_s, abs=0.05)
    assert r["trajectory"]["launch_angle_deg"] < T.launch_angle_deg - 2


def test_uncalibrated_run_still_gives_angle_and_gravity_estimates():
    r = analyze_keypoints(jumper_keypoints(noise_px=1.0), None, AnalysisConfig(event_method="toe_heel"))
    assert r["distance"]["jump_distance_m"] is None
    assert r["trajectory"]["launch_angle_deg"] == pytest.approx(T.launch_angle_deg, abs=3)
    assert r["distance"]["jump_distance_m_gravity_scale"] == pytest.approx(T.jump_distance, rel=0.1)
    assert "vx_m_s" not in r["trajectory"]


def test_noisy_tracking(capsys):
    r = analyze_keypoints(jumper_keypoints(noise_px=2.0, seed=3), T.scale,
                          AnalysisConfig(event_method="toe_heel"))
    assert r["trajectory"]["launch_angle_deg"] == pytest.approx(T.launch_angle_deg, abs=3)
    assert r["distance"]["jump_distance_m"] == pytest.approx(T.jump_distance, abs=0.03)
    assert r["angles_deg"]["takeoff"]["trunk"] == pytest.approx(T.trunk_deg, abs=2)


def test_walking_back_after_the_jump_does_not_flip_angles():
    kp = jumper_keypoints(duration=2.6)
    # After landing, walk back past the start line (old whole-clip rule would flip signs)
    t = kp.time
    back = t > 1.9
    kp.xyv[back, :, 0] -= (t[back] - 1.9)[:, None] * 2.0 / T.scale
    r = analyze_keypoints(kp, T.scale)
    assert r["direction"] == "right"
    assert r["angles_deg"]["takeoff"]["trunk"] == pytest.approx(T.trunk_deg, abs=0.5)


def test_time_window():
    r = analyze_keypoints(jumper_keypoints(), T.scale, AnalysisConfig(start_s=0.3, end_s=2.0))
    assert r["events"]["takeoff"]["time_s"] == pytest.approx(T.t_takeoff, abs=0.03)


def test_outputs_are_written(tmp_path):
    r = analyze_keypoints(jumper_keypoints(), T.scale)
    save_csv(r, str(tmp_path / "a.csv"))
    save_json(r, str(tmp_path / "a.json"))
    plot_events(r, str(tmp_path / "e.png"))
    plot_trajectory(r, str(tmp_path / "t.png"))
    assert "Launch angle" in format_report(r)
    data = np.genfromtxt(tmp_path / "a.csv", delimiter=",", names=True)
    assert "trunk_angle_deg" in data.dtype.names and len(data) == r["n_frames"]
    summary = json.loads((tmp_path / "a.json").read_text())
    assert summary["distance"]["jump_distance_m"] == pytest.approx(T.jump_distance, abs=0.02)
    assert (tmp_path / "e.png").exists() and (tmp_path / "t.png").exists()


def test_keypoints_cache_roundtrip(tmp_path):
    kp = jumper_keypoints()
    kp.save(str(tmp_path / "k.npz"))
    back = Keypoints.load(str(tmp_path / "k.npz"))
    assert np.array_equal(back.xyv, kp.xyv, equal_nan=True)
    assert (back.fps, back.width, back.height, back.video_path) == (kp.fps, kp.width, kp.height, "synthetic")
