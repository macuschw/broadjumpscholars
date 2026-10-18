"""Serious problems are impossible to miss: banner at the top, marker beside the number,
verdict at the end. Clean jumps get none of it."""
import json

from jumplab.alerts import banner, headline, marker, verdict
from jumplab.checks import CAUTION, SERIOUS, warning
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.report import format_report, save_json
from jumplab.summary import format_summary

from synthetic import Truth, jumper_keypoints

T = Truth()
STAGGER = warning("staggered_feet", "The feet look staggered: the heels were 11 cm apart at landing.",
                  SERIOUS, ("distance",), headline="Feet staggered: distance is approximate")


def _clean(tmp_path):
    r = analyze_keypoints(jumper_keypoints(), T.scale, AnalysisConfig(event_method="toe_heel"))
    save_json(r, str(tmp_path / "r.json"))
    return r, json.loads((tmp_path / "r.json").read_text())


def test_clean_jump_has_no_alerts(tmp_path):
    r, saved = _clean(tmp_path)
    assert banner(r["warnings"]) == ""
    assert "WARNING:" not in format_report(r) and "APPROXIMATE" not in format_report(r)
    assert "WARNING:" not in format_summary(saved)
    assert verdict(r["warnings"]) == "OK: no problems found."


def test_staggered_feet_shows_banner_marker_and_verdict(tmp_path):
    r, saved = _clean(tmp_path)
    r["warnings"] = saved["warnings"] = [STAGGER]
    report, summary = format_report(r), format_summary(saved)
    for text in (report, summary):
        top = text.split("Events")[0] if text is report else text.split("1. JUMP DISTANCE")[0]
        assert "WARNING: FEET STAGGERED: DISTANCE IS APPROXIMATE" in top      # banner before any numbers
        assert "APPROXIMATE, see WARNING" in text                            # beside the distance
    assert "[!! SERIOUS]" in report
    assert verdict(r["warnings"]).startswith("!! CHECK THIS JUMP: Feet staggered")


def test_caution_is_marked_mildly_and_not_bannered():
    w = [warning("short_after_landing", "Only 3 frames after landing.", CAUTION, ("distance",))]
    assert banner(w) == ""
    assert marker(w, "distance") == "   <-- use with care" and marker(w, "angles") == ""
    assert verdict(w).startswith("~  Usable with care: 1 warning")


def test_colour_only_when_asked():
    assert "\033[" not in banner([STAGGER]) + verdict([STAGGER])
    assert banner([STAGGER], color=True).startswith("\033[1;31m")


def test_old_results_files_still_get_a_headline():
    old = {"code": "staggered_feet", "message": "The feet look staggered: ...", "severity": SERIOUS,
           "affects": ["distance"]}                   # saved before warnings had headlines
    assert headline(old) == "Feet staggered at landing"
    assert headline("plain old string warning. More text") == "plain old string warning"


def test_every_warning_the_analysis_can_raise_has_plain_language():
    import re
    from pathlib import Path
    from jumplab.alerts import PLAIN, plain
    src = "".join(p.read_text() for p in Path("jumplab").glob("*.py"))
    codes = set(re.findall(r'warning\(\s*"([a-z_]+)"', src)) - {"unknown", "fps_corrected", "fps_override"}   # info notes
    assert codes <= set(PLAIN), sorted(codes - set(PLAIN))
    p = plain({"code": "limb_snap", "message": "x", "severity": SERIOUS, "affects": ["distance"]})
    assert p["headline"] == "The tracking slipped" and p["fix"]
