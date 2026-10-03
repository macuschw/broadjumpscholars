import numpy as np
import pytest

from jumplab.center_of_mass import (AXIAL_SEGMENTS, LIMB_SEGMENTS, com_from_keypoints,
                                    segment_center, total_mass_fraction, whole_body_com)
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.pose_tracking import LANDMARKS
from jumplab.physics import G

from synthetic import Truth, jumper_keypoints

T = Truth()

# A standing stick figure (meters, y up), same on both sides
STANDING = {
    "EAR": (0.0, 1.60), "SHOULDER": (0.0, 1.45), "ELBOW": (0.0, 1.15), "WRIST": (0.0, 0.90),
    "INDEX": (0.0, 0.82), "HIP": (0.0, 0.95), "KNEE": (0.0, 0.50), "ANKLE": (0.0, 0.08),
    "FOOT_INDEX": (0.15, 0.02),
}


def test_mass_fractions_add_up_to_whole_body():
    assert total_mass_fraction() == pytest.approx(1.0)


def test_segment_table_matches_winter():
    """Values from Winter, Biomechanics and Motor Control of Human Movement, Table 4.1."""
    table = {s[0]: (s[3], s[4]) for s in AXIAL_SEGMENTS + LIMB_SEGMENTS}
    assert table == {
        "trunk": (0.497, 0.50), "head_neck": (0.081, 1.00),
        "upper_arm": (0.028, 0.436), "forearm": (0.016, 0.430), "hand": (0.006, 0.506),
        "thigh": (0.100, 0.433), "shank": (0.0465, 0.433), "foot": (0.0145, 0.50),
    }


def test_segment_center():
    assert segment_center((0, 0), (10, 20), 0.25) == pytest.approx((2.5, 5.0))


def test_standing_figure_by_hand():
    # Each term: mass fraction x height of that segment's own center of mass
    expected_y = (0.497 * (0.95 + 0.50 * (1.45 - 0.95))          # trunk
                  + 0.081 * 1.60                                  # head at the ear
                  + 2 * 0.028 * (1.45 + 0.436 * (1.15 - 1.45))    # upper arms
                  + 2 * 0.016 * (1.15 + 0.430 * (0.90 - 1.15))    # forearms
                  + 2 * 0.006 * (0.90 + 0.506 * (0.82 - 0.90))    # hands
                  + 2 * 0.100 * (0.95 + 0.433 * (0.50 - 0.95))    # thighs
                  + 2 * 0.0465 * (0.50 + 0.433 * (0.08 - 0.50))   # shanks
                  + 2 * 0.0145 * (0.08 + 0.50 * (0.02 - 0.08)))   # feet
    expected_x = 2 * 0.0145 * 0.50 * 0.15                         # only the feet stick out
    x, y = whole_body_com(STANDING, STANDING)
    assert y == pytest.approx(expected_y) and y == pytest.approx(1.0256, abs=1e-4)
    assert x == pytest.approx(expected_x)


def test_raising_one_arm_moves_com_up_by_the_arm_mass_shift():
    raised = dict(STANDING, ELBOW=(0.0, 1.75), WRIST=(0.0, 2.00), INDEX=(0.0, 2.08))
    # Upper arm, forearm and hand centers each move up; weight each by its mass fraction
    shift = 0.028 * 0.2616 + 0.016 * 0.815 + 0.006 * 1.18096       # = 0.02745 m
    _, y0 = whole_body_com(STANDING, STANDING, "both")
    _, y1 = whole_body_com(raised, STANDING, "both")
    assert y1 - y0 == pytest.approx(shift)
    # "symmetric" copies the near arm to the far side, so the shift doubles
    _, y2 = whole_body_com(raised, STANDING, "symmetric")
    assert y2 - y0 == pytest.approx(2 * shift)


def test_modes_agree_when_both_sides_match():
    assert whole_body_com(STANDING, STANDING, "both") == pytest.approx(
        whole_body_com(STANDING, STANDING, "symmetric"))
    with pytest.raises(ValueError):
        whole_body_com(STANDING, STANDING, "left_only")


def test_com_from_keypoints_flips_y_and_sits_between_shoulder_and_knee():
    kp = jumper_keypoints()
    x, y = com_from_keypoints(kp, "LEFT")
    assert len(x) == kp.n_frames and not np.isnan(x).any()
    shoulder_up = -kp.part("LEFT", "SHOULDER")[1]
    knee_up = -kp.part("LEFT", "KNEE")[1]
    assert np.all((y < shoulder_up) & (y > knee_up))


# ---------------------------------------------------------------- in the pipeline

def test_arm_swing_fools_the_hip_but_not_the_center_of_mass():
    """Arms swing up and back in flight. The CoM follows the true parabola; the hip doesn't."""
    kp = jumper_keypoints(arm_swing_deg=150)
    r = analyze_keypoints(kp, T.scale, AnalysisConfig(event_method="toe_heel"))
    tr = r["trajectory"]
    assert tr["point"] == "com"
    assert tr["g_fit_m_s2"] == pytest.approx(G, rel=0.02)
    assert tr["vy_m_s"] == pytest.approx(T.vy, rel=0.05)
    assert tr["vx_m_s"] == pytest.approx(T.vx, rel=0.03)
    assert tr["launch_angle_deg"] == pytest.approx(T.launch_angle_deg, abs=1.5)
    assert abs(tr["g_fit_hip_m_s2"] - G) / G > 0.10          # the hip gets g badly wrong

    hip = analyze_keypoints(kp, T.scale, AnalysisConfig(event_method="toe_heel",
                                                        trajectory_point="hip"))
    assert hip["trajectory"]["point"] == "hip" and "g_fit_hip_m_s2" not in hip["trajectory"]
    assert hip["trajectory"]["g_fit_m_s2"] == pytest.approx(tr["g_fit_hip_m_s2"])


def test_falls_back_to_hip_when_arms_are_not_tracked():
    kp = jumper_keypoints()
    for side in ("LEFT", "RIGHT"):
        for name in ("EAR", "ELBOW", "WRIST", "INDEX"):
            kp.xyv[:, LANDMARKS[side][name], :2] = np.nan
    r = analyze_keypoints(kp, T.scale, AnalysisConfig(event_method="toe_heel"))
    assert r["trajectory"]["point"] == "hip"
    assert [w["code"] for w in r["warnings"]] == ["com_fallback"]
    assert r["trajectory"]["g_fit_m_s2"] == pytest.approx(G, rel=0.02)
