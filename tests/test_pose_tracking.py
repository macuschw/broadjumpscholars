import numpy as np
import pytest

from jumplab import pose_tracking
from jumplab.pose_tracking import LANDMARKS, Keypoints, load_or_track, tracking_settings

from synthetic import jumper_keypoints


def test_landmark_numbers_match_mediapipe():
    mp = pytest.importorskip("mediapipe")
    L = mp.solutions.pose.PoseLandmark
    for side, parts in LANDMARKS.items():
        for name, index in parts.items():
            assert getattr(L, f"{side}_{name}").value == index, f"{side} {name}"


def test_save_load_keeps_settings_and_frame_times(tmp_path):
    kp = jumper_keypoints()
    kp.settings = tracking_settings()
    kp.frame_times = np.arange(kp.n_frames) / kp.fps
    kp.save(str(tmp_path / "k.npz"))
    back = Keypoints.load(str(tmp_path / "k.npz"))
    assert back.settings == kp.settings
    assert np.array_equal(back.frame_times, kp.frame_times)


def test_old_cache_files_still_load(tmp_path):
    kp = jumper_keypoints()
    np.savez_compressed(tmp_path / "old.npz", xyv=kp.xyv, fps=kp.fps, width=kp.width,
                        height=kp.height, video_path="v.mp4")      # the pre-audit format
    back = Keypoints.load(str(tmp_path / "old.npz"))
    assert back.settings == {} and back.frame_times is None


@pytest.fixture
def fake_tracker(monkeypatch):
    """Replace MediaPipe with a stub that counts how often it runs."""
    calls = []

    def fake(video_path, skeleton_video_path=None, **kw):
        calls.append(video_path)
        kp = jumper_keypoints()
        kp.video_path = str(video_path)
        kp.settings = tracking_settings()
        return kp
    monkeypatch.setattr(pose_tracking, "track_video", fake)
    return calls


def test_cache_is_reused_when_settings_match(tmp_path, fake_tracker):
    video = tmp_path / "jump.mp4"
    video.write_bytes(b"")
    cache = str(tmp_path / "jump_keypoints.npz")
    _, ran1 = load_or_track(str(video), cache)
    _, ran2 = load_or_track(str(video), cache)
    assert (ran1, ran2) == (True, False) and len(fake_tracker) == 1


def test_cache_made_with_other_settings_is_not_reused(tmp_path, fake_tracker):
    video = tmp_path / "jump.mp4"
    video.write_bytes(b"")
    cache = str(tmp_path / "jump_keypoints.npz")
    kp = jumper_keypoints()
    kp.video_path = str(video)
    kp.settings = dict(tracking_settings(), model_complexity=2)
    kp.save(cache)
    _, ran = load_or_track(str(video), cache)
    assert ran and len(fake_tracker) == 1
