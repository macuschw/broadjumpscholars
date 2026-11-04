"""A fingertip past the picture's edge isn't "part of the body left the frame"; anything else still is."""
import os
from dataclasses import replace

from jumplab.checks import check_landmarks
from jumplab.pose_tracking import Keypoints, LANDMARKS

DATA = os.path.join(os.path.dirname(__file__), "data")


def codes(kp, used):
    return {w["code"] for w in check_landmarks(kp, used, 0, kp.n_frames)}


def out_of_picture(kp, side, name):
    xyv = kp.xyv.copy()
    xyv[10, LANDMARKS[side][name], 0] = -5.0
    return replace(kp, xyv=xyv)


def test_only_a_fingertip_out_is_fine_a_foot_out_is_not():
    kp = Keypoints.load(os.path.join(DATA, "real_jump_120fps_keypoints.npz"))
    used = [("LEFT", "INDEX"), ("LEFT", "ANKLE"), ("LEFT", "HEEL"), ("LEFT", "WRIST")]
    base = codes(kp, used)
    assert "offframe_landmarks" not in base
    assert "offframe_landmarks" not in codes(out_of_picture(kp, "LEFT", "INDEX"), used)
    assert "offframe_landmarks" in codes(out_of_picture(kp, "LEFT", "HEEL"), used)
    assert "offframe_landmarks" in codes(out_of_picture(kp, "LEFT", "WRIST"), used)
