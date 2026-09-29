import pytest

from jumplab.calibration import Calibration, load_calibration, save_calibration, scale_from_points


def test_scale_from_points():
    # 3-4-5 triangle: 500 px apart, 2 m -> 0.004 m/px
    assert scale_from_points((100, 100), (400, 500), 2.0) == pytest.approx(0.004)


def test_bad_calibration_inputs():
    with pytest.raises(ValueError):
        scale_from_points((1, 1), (1, 1), 1.0)
    with pytest.raises(ValueError):
        scale_from_points((0, 0), (10, 0), 0.0)


def test_save_load_roundtrip(tmp_path):
    cal = Calibration(0.004, (100.0, 100.0), (400.0, 500.0), 2.0, "clip.mp4", 5, 1920, 1080)
    path = tmp_path / "sub" / "cal.json"
    save_calibration(cal, str(path))
    back = load_calibration(str(path))
    assert back == cal
    assert back.pixel_distance == pytest.approx(500)
