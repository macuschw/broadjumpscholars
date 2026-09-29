import numpy as np
import pytest

from jumplab import angles


def test_vertical_is_zero():
    assert angles.angle_from_vertical(0, 0, 0, 1) == pytest.approx(0)


def test_lean_toward_plus_x_is_positive():
    assert angles.angle_from_vertical(0, 0, 1, 1) == pytest.approx(45)
    assert angles.angle_from_vertical(0, 0, -1, 1) == pytest.approx(-45)
    assert angles.angle_from_vertical(0, 0, 1, 0) == pytest.approx(90)


def test_trunk_and_shin_use_proximal_to_distal_order():
    hip, shoulder = (np.array([0.0]), np.array([0.0])), (np.array([np.sin(0.3)]), np.array([np.cos(0.3)]))
    assert angles.trunk_angle(hip, shoulder)[0] == pytest.approx(np.degrees(0.3))
    ankle, knee = (0.0, 0.0), (-1.0, 1.0)
    assert angles.shin_angle(ankle, knee) == pytest.approx(-45)


def test_mirroring_flips_sign():
    # Same posture filmed from the other side: x mirrored -> angle negated, which the
    # pipeline undoes by multiplying with the jump direction.
    a = angles.angle_from_vertical(0, 0, 0.4, 1)
    b = angles.angle_from_vertical(0, 0, -0.4, 1)
    assert b == pytest.approx(-a)


@pytest.mark.parametrize("rot", [0, 30, 135, -80])
def test_joint_angle_is_rotation_invariant(rot):
    r = np.radians(rot)
    R = np.array([[np.cos(r), -np.sin(r)], [np.sin(r), np.cos(r)]])
    a, b, c = (R @ p for p in (np.array([0, 1.0]), np.array([0, 0.0]), np.array([1.0, 0])))
    assert angles.joint_angle(a, b, c) == pytest.approx(90)


def test_joint_angle_straight_and_folded():
    assert angles.joint_angle((0, 2), (0, 1), (0, 0)) == pytest.approx(180)
    assert angles.joint_angle((0.1, 0), (0, 1), (0, 0)) == pytest.approx(np.degrees(np.arctan(0.1)), abs=1e-9)
