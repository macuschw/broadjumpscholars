"""Frame rate: trust the frames' own timestamps over the file header, and recognise slow-motion
saved for slowed-down playback (real case: IMG_6171 said 30 fps, was 120 fps, and gave g = 0.61)."""
from dataclasses import replace

import numpy as np
import pytest

from jumplab.checks import INFO, SERIOUS
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.summary import RELIABLE, format_summary

from synthetic import Truth, jumper_keypoints

T = Truth()                       # 120 fps
CFG = AnalysisConfig(event_method="toe_heel")


def codes(r):
    return {w["code"]: w for w in r["warnings"]}


def test_wrong_header_is_corrected_from_timestamps():
    # Real case: IMG_6170's header said 116.55 fps, its frames were 8.33 ms apart
    kp = jumper_keypoints()
    kp = replace(kp, fps=116.55, frame_times=np.arange(kp.n_frames) / 120.0)
    r = analyze_keypoints(kp, T.scale, CFG)
    assert r["fps"] == pytest.approx(120.0) and r["header_fps"] == 116.55
    assert r["fps_source"] == "timestamps"
    assert codes(r)["fps_corrected"]["severity"] == INFO
    assert "variable_frame_rate" not in codes(r)
    assert r["trajectory"]["g_fit_m_s2"] == pytest.approx(9.81, rel=0.02)


def test_info_note_does_not_lower_ratings():
    kp = jumper_keypoints()
    kp = replace(kp, fps=116.55, frame_times=np.arange(kp.n_frames) / 120.0)
    text = format_summary(analyze_keypoints(kp, T.scale, CFG))
    assert RELIABLE in text.split("1. JUMP DISTANCE")[1].split("2. TRAJECTORY")[0]


def test_header_used_when_it_matches_or_no_timestamps():
    kp = jumper_keypoints()
    assert analyze_keypoints(kp, T.scale, CFG)["fps_source"] == "header"
    kp.frame_times = np.arange(kp.n_frames) / 120.0
    assert analyze_keypoints(kp, T.scale, CFG)["fps_source"] == "header"


def slowed_down(kp, factor=4):
    """120 fps footage saved for playback at 120/factor fps: same frames, slower clock."""
    return replace(kp, fps=kp.fps / factor, frame_times=np.arange(kp.n_frames) * factor / kp.fps)


@pytest.mark.parametrize("scale", [T.scale, None], ids=["calibrated", "uncalibrated"])
def test_slowed_down_slow_motion_is_recognised(scale):
    r = analyze_keypoints(slowed_down(jumper_keypoints()), scale, CFG)
    w = codes(r)["slow_motion_suspected"]
    assert w["severity"] == SERIOUS and "120 fps" in w["message"] and "--fps 120" in w["message"]


def test_fps_override_recovers_the_physics():
    r = analyze_keypoints(slowed_down(jumper_keypoints()), T.scale, CFG, fps_override=120)
    assert r["fps_source"] == "override"
    assert r["trajectory"]["g_fit_m_s2"] == pytest.approx(9.81, rel=0.02)
    assert set(codes(r)) == {"fps_override"}           # no slow-motion or timing warnings


def test_genuine_30fps_video_is_not_mistaken_for_slow_motion():
    class Thirty(Truth):
        fps = 30.0
    r = analyze_keypoints(jumper_keypoints(truth=Thirty()), T.scale, CFG)
    assert "slow_motion_suspected" not in codes(r)
