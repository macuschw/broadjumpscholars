"""Automatic trimming (pose_tracking.track_jump): only the part around the jump is tracked, the rest
of the clip is left empty, and the analysis stays inside the tracked part (Keypoints.segment)."""
from dataclasses import replace

import numpy as np
import pytest

from jumplab import web
from jumplab.events import NoJumpFound
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.pose_tracking import N_LANDMARKS

from synthetic import Truth, jumper_keypoints

T = Truth()
CONFIG = AnalysisConfig(event_method="toe_heel")
PAD = 600                                       # 5 s of untracked video before and after (at 120 fps)


def _long_clip(kp, keep=None):
    """kp inside a longer clip: PAD empty frames before and after, `segment` the tracked part."""
    empty = np.full((PAD, N_LANDMARKS, 3), np.nan)
    empty[:, :, 2] = 0.0
    xyv = np.concatenate([empty, kp.xyv, empty])
    times = np.arange(len(xyv)) / kp.fps
    first, last = keep or (PAD, PAD + kp.n_frames - 1)
    return replace(kp, xyv=xyv, frame_times=times, segment=(first, last))


def test_a_trimmed_clip_gives_the_same_results_as_the_jump_alone():
    kp = jumper_keypoints()
    alone, trimmed = analyze_keypoints(kp, T.scale, CONFIG), analyze_keypoints(_long_clip(kp), T.scale, CONFIG)
    assert trimmed["distance"]["jump_distance_m"] == pytest.approx(alone["distance"]["jump_distance_m"], abs=1e-9)
    assert trimmed["trajectory"]["speed_m_s"] == pytest.approx(alone["trajectory"]["speed_m_s"], abs=1e-9)
    assert trimmed["events"]["takeoff"]["frame"] == alone["events"]["takeoff"]["frame"] + PAD
    assert trimmed["detected_fraction"] == pytest.approx(alone["detected_fraction"])   # of the tracked part
    assert sorted(w["code"] for w in trimmed["warnings"]) == sorted(w["code"] for w in alone["warnings"])


def test_the_tracked_part_survives_the_website_bundle():
    kp = _long_clip(jumper_keypoints())
    b = web.make_bundle(analyze_keypoints(kp, T.scale, CONFIG), kp, "jump.mov")
    lm = b["landmarks"]
    assert lm["segment"] == list(kp.segment) and lm["offset"] == PAD            # only the tracked part is kept
    assert len(lm["xyv"]) == len(lm["frame_times"]) == len(b["series"]["time_s"]) == kp.segment[1] - PAD + 1
    again = web.recompute({"landmarks": lm, "scale": T.scale, "event_method": "toe_heel"})
    assert again["results"]["distance"]["jump_distance_m"] == pytest.approx(b["results"]["distance"]["jump_distance_m"], abs=0.001)


def test_a_wrong_guess_falls_back_to_tracking_the_whole_video(monkeypatch):
    from jumplab import pose_tracking
    kp = jumper_keypoints()
    wrong = _long_clip(kp, keep=(0, PAD - 1))                     # the quick look picked empty video
    with pytest.raises(NoJumpFound):
        analyze_keypoints(wrong, T.scale, CONFIG)
    tracked_all = []
    monkeypatch.setattr(web, "track_upload", lambda path, fps=None, progress=None: (wrong, [wrong.segment], True))
    monkeypatch.setattr(pose_tracking, "track_video", lambda path: tracked_all.append(path) or kp)
    monkeypatch.setattr(web, "still_frame", lambda path, i: None)
    monkeypatch.setattr("jumplab.session.look_for_others", lambda *a: False)
    session = web.analyze_session_upload("/tmp/upload.mov", "jump.mov", scale=T.scale, event_method="toe_heel")
    assert tracked_all and len(session["jumps"]) == 1
    assert abs(session["jumps"][0]["results"]["distance"]["jump_distance_m"] - T.jump_distance) < 0.01
