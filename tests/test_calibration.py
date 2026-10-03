import json

import pytest

from jumplab.calibration import (Calibration, depth_corrected_scale, load_calibration,
                                 make_calibration, save_calibration, scale_from_points)


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
    assert back.depth_correction == 1.0


def project(x_m, depth_m, focal_px=1500.0, cx=960.0):
    """Pinhole camera: a point x_m sideways at depth_m lands at pixel cx + f * x / depth."""
    return (cx + focal_px * x_m / depth_m, 540.0)


@pytest.mark.parametrize("ref_depth, jump_depth", [(4.0, 5.0), (6.0, 5.0), (5.0, 5.0)])
def test_depth_correction_matches_pinhole_camera(ref_depth, jump_depth):
    """A 2 m tape at ref_depth; the true scale at the jump line is jump_depth / f."""
    f = 1500.0
    p1, p2 = project(-1.0, ref_depth, f), project(1.0, ref_depth, f)
    ref_scale = scale_from_points(p1, p2, 2.0)
    assert ref_scale == pytest.approx(ref_depth / f)              # scale is right AT the tape...
    corrected = depth_corrected_scale(ref_scale, ref_depth, jump_depth)
    assert corrected == pytest.approx(jump_depth / f)             # ...and corrected AT the jump


def test_uncorrected_tape_in_front_is_wrong_by_the_depth_ratio():
    # Tape 1 m closer than the jump line: every jump distance would be 20% too small
    f = 1500.0
    ref_scale = scale_from_points(project(-1, 4.0, f), project(1, 4.0, f), 2.0)
    assert ref_scale / (5.0 / f) == pytest.approx(0.8)


def test_make_calibration_with_and_without_correction(tmp_path):
    plain = make_calibration((0, 0), (500, 0), 2.0)
    assert plain.m_per_px == pytest.approx(0.004) and plain.m_per_px_at_reference is None

    cal = make_calibration((0, 0), (500, 0), 2.0, camera_to_reference_m=4.0, camera_to_jump_m=5.0)
    assert cal.m_per_px_at_reference == pytest.approx(0.004)
    assert cal.m_per_px == pytest.approx(0.005)
    assert cal.depth_correction == pytest.approx(1.25)

    save_calibration(cal, str(tmp_path / "c.json"))
    assert load_calibration(str(tmp_path / "c.json")) == cal


def test_depth_correction_needs_both_distances():
    with pytest.raises(ValueError):
        make_calibration((0, 0), (500, 0), 2.0, camera_to_reference_m=4.0)
    with pytest.raises(ValueError):
        depth_corrected_scale(0.004, 0.0, 5.0)


def test_old_calibration_files_still_load(tmp_path):
    # Files saved before depth correction existed have no camera-distance fields
    old = {"m_per_px": 0.004, "p1": [0, 0], "p2": [500, 0], "distance_m": 2.0,
           "video": "clip.mp4", "frame_index": 0, "width": 1920, "height": 1080}
    (tmp_path / "old.json").write_text(json.dumps(old))
    cal = load_calibration(str(tmp_path / "old.json"))
    assert cal.m_per_px == 0.004 and cal.depth_correction == 1.0


def test_click_mapping_uses_the_actual_shown_size():
    from jumplab.calibration import display_size, display_to_full
    # A 2582x1440 frame (the 30 fps test clip) is shown at 1280x713: the height rounds
    # down, so width and height are NOT shrunk by exactly the same factor
    shown = display_size(2582, 1440)
    assert shown == (1280, 713)
    # The far corner of the shown image must map to the far corner of the full frame
    assert display_to_full(shown, (2582, 1440), shown) == pytest.approx((2582, 1440))
    assert display_to_full((0, 0), (2582, 1440), shown) == (0, 0)
    assert display_size(3840, 2160) == (1280, 720)
    # Small frames are shown as they are
    assert display_size(640, 480) == (640, 480)
