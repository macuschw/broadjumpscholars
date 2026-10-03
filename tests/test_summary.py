import json

from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.report import save_json
from jumplab.summary import CAREFUL, RELIABLE, ROUGH, _feet_inches, format_summary  # noqa: F401

from synthetic import Truth, jumper_keypoints

T = Truth()


def _via_json(r, tmp_path):
    """The summary script reads the saved JSON, so test through it."""
    save_json(r, str(tmp_path / "r.json"))
    return json.loads((tmp_path / "r.json").read_text())


def test_all_five_categories_present(tmp_path):
    r = _via_json(analyze_keypoints(jumper_keypoints(), T.scale,
                                    AnalysisConfig(event_method="toe_heel")), tmp_path)
    text = format_summary(r)
    for heading in ("1. JUMP DISTANCE", "2. TRAJECTORY", "3. TRUNK ANGLE",
                    "4. SHIN ANGLE", "5. GROUND CONTACT TIME"):
        assert heading in text
    assert f"{T.jump_distance:.2f} m" in text
    assert f"{T.jump_distance / 0.0254:.1f} in" in text
    assert "20° forward" in text                      # synthetic trunk lean
    assert text.count(RELIABLE) >= 4


def test_feet_inches():
    assert _feet_inches(1.3081) == "4 ft 3.5 in"      # 51.5 in


def test_failed_gravity_check_marks_trajectory_rough(tmp_path):
    r = _via_json(analyze_keypoints(jumper_keypoints(), T.scale,
                                    AnalysisConfig(event_method="toe_heel")), tmp_path)
    r["trajectory"]["g_fit_m_s2"] = 7.76
    traj = format_summary(r).split("2. TRAJECTORY")[1].split("3. TRUNK")[0]
    assert ROUGH in traj and "7.76" in traj


def test_disagreeing_event_methods_flag_timing(tmp_path):
    r = _via_json(analyze_keypoints(jumper_keypoints(), T.scale,
                                    AnalysisConfig(event_method="ankle")), tmp_path)
    contact = format_summary(r).split("5. GROUND CONTACT TIME")[1]
    assert CAREFUL in contact and "--events toe_heel" in contact


def test_uncalibrated_summary(tmp_path):
    r = _via_json(analyze_keypoints(jumper_keypoints(), None,
                                    AnalysisConfig(event_method="toe_heel")), tmp_path)
    text = format_summary(r)
    assert "NOT calibrated" in text and "pixels" in text
    dist = text.split("1. JUMP DISTANCE")[1].split("2. TRAJECTORY")[0]
    assert ROUGH in dist


def test_low_fps_marks_timing_rough(tmp_path):
    r = _via_json(analyze_keypoints(jumper_keypoints(), T.scale,
                                    AnalysisConfig(event_method="toe_heel")), tmp_path)
    r["fps"] = 30.0
    assert ROUGH in format_summary(r).split("5. GROUND CONTACT TIME")[1]


# ---- ratings follow the pipeline's warnings and the gravity check (audit A4)

def _section(text, number):
    heads = ["1. JUMP DISTANCE", "2. TRAJECTORY", "3. TRUNK ANGLE", "4. SHIN ANGLE",
             "5. GROUND CONTACT TIME"]
    rest = text.split(heads[number - 1])[1]
    return rest.split(heads[number])[0] if number < 5 else rest


def _clean(tmp_path):
    return _via_json(analyze_keypoints(jumper_keypoints(), T.scale,
                                       AnalysisConfig(event_method="toe_heel")), tmp_path)


def test_clean_jump_distance_is_reliable(tmp_path):
    assert RELIABLE in _section(format_summary(_clean(tmp_path)), 1)


def test_distance_not_reliable_when_gravity_check_is_off(tmp_path):
    r = _clean(tmp_path)
    r["trajectory"]["g_fit_m_s2"] = 8.9               # 9% off: the scale may be off too
    dist = " ".join(_section(format_summary(r), 1).split())    # undo line wrapping
    assert CAREFUL in dist and "ball drop" in dist


def test_serious_warning_makes_its_categories_rough(tmp_path):
    from jumplab.checks import SERIOUS, warning
    r = _clean(tmp_path)
    r["warnings"] = [warning("distance_implausible", "negative distance", SERIOUS, ("distance",))]
    text = format_summary(r)
    assert ROUGH in _section(text, 1) and "negative distance" in _section(text, 1)
    assert RELIABLE in _section(text, 3)              # angles not affected


def test_caution_warning_downgrades_only_what_it_affects(tmp_path):
    from jumplab.checks import CAUTION, warning
    r = _clean(tmp_path)
    r["warnings"] = [warning("moving_start", "not standing still", CAUTION, ("timing",))]
    text = format_summary(r)
    assert CAREFUL in _section(text, 5)
    assert RELIABLE in _section(text, 1)


def test_old_results_files_with_text_warnings_still_work(tmp_path):
    r = _clean(tmp_path)
    r["warnings"] = ["some old-style warning"]
    assert "some old-style warning" in format_summary(r)
