"""The website bundle and the analysis service behind the site's upload (jumplab/web.py)."""
import json

import numpy as np

from jumplab import web
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.report import save_csv, save_json

from synthetic import Truth, jumper_keypoints

T = Truth()


def _analyzed():
    kp = jumper_keypoints()
    return kp, analyze_keypoints(kp, T.scale, AnalysisConfig(event_method="toe_heel"))


def test_bundle_is_strict_json_with_everything_the_site_shows():
    kp, r = _analyzed()
    b = web.make_bundle(r, kp, "jump.mov")
    text = json.dumps(b, allow_nan=False)                     # strict JSON: no NaN anywhere
    assert b["format"] == web.FORMAT and b["name"] == "jump.mov" and b["results"]["video"] == "jump.mov"
    assert set(b["ratings"]) == {"distance", "trajectory", "trunk", "shin", "contact"}
    assert all(v["rating"] in ("reliable", "care", "rough") for v in b["ratings"].values())
    assert set(web.SERIES_KEYS) <= set(b["series"]) and len(b["series"]["time_s"]) == kp.n_frames
    lm = b["landmarks"]
    assert lm["n_frames"] == kp.n_frames and len(lm["xyv"]) == kp.n_frames and len(lm["xyv"][0]) == 99
    assert "/" not in text.split('"video":')[1][:40]           # no local paths
    assert abs(b["results"]["distance"]["jump_distance_m"] - T.jump_distance) < 0.01


def test_recompute_reproduces_the_analysis_from_the_bundle_alone():
    kp, r = _analyzed()
    b = web.make_bundle(r, kp, "jump.mov")
    again = web.recompute({"landmarks": b["landmarks"], "name": "jump.mov", "scale": T.scale, "event_method": "toe_heel"})
    d0, d1 = r["distance"]["jump_distance_m"], again["results"]["distance"]["jump_distance_m"]
    assert abs(d1 - d0) < 0.001                               # landmarks rounded to 0.1 px: well under 1 mm


def test_recompute_without_scale_is_uncalibrated_and_with_a_new_scale_scales():
    kp, r = _analyzed()
    b = web.make_bundle(r, kp, "jump.mov")
    raw = web.recompute({"landmarks": b["landmarks"], "event_method": "toe_heel"})["results"]
    assert raw["scale_m_per_px"] is None and raw["distance"]["jump_distance_m"] is None
    double = web.recompute({"landmarks": b["landmarks"], "scale": 2 * T.scale, "event_method": "toe_heel"})["results"]
    assert abs(double["distance"]["jump_distance_m"] - 2 * r["distance"]["jump_distance_m"]) < 0.002


def test_bundle_from_saved_files_matches_a_direct_bundle(tmp_path):
    kp, r = _analyzed()
    r = dict(r, video="/somewhere/jump.mov")
    save_json(r, str(tmp_path / "jump_results.json"))
    save_csv(r, str(tmp_path / "jump_keypoints_and_angles.csv"))
    kp.save(str(tmp_path / "jump_keypoints.npz"))
    a, b = web.make_bundle(r, kp, "jump.mov"), web.bundle_from_files(str(tmp_path / "jump_results.json"))
    assert a["results"]["distance"] == b["results"]["distance"] and a["ratings"] == b["ratings"]
    assert np.allclose(np.array(a["series"]["trunk_angle_deg"], float), np.array(b["series"]["trunk_angle_deg"], float), atol=0.01)
    assert a["landmarks"]["xyv"][150] == b["landmarks"]["xyv"][150]
    assert web.find_results(str(tmp_path)) == [str(tmp_path / "jump_results.json")]


def test_options_from_the_query_are_parsed_and_safe():
    o = web.options_from_query({"name": "../../etc/clip.MOV", "fps": "240", "scale": "", "event_method": "toe_heel"})
    assert o == {"name": "clip.MOV", "fps": 240.0, "scale": None, "event_method": "toe_heel"}
    assert web.options_from_query({})["name"] == "video.mp4"


def test_problems_the_visitor_can_fix_are_422_with_a_message():
    kp, r = _analyzed()
    b = web.make_bundle(r, kp, "jump.mov")
    still = {k: v for k, v in b["landmarks"].items()}
    still["xyv"] = [[None] * 99 for _ in still["xyv"]]          # nobody in the video
    status, body = web.handle("recompute", payload={"landmarks": still})
    assert status == 422 and body["error"]
    status, body = web.handle("recompute", payload={"landmarks": b["landmarks"], "scale": 5})
    assert status == 422 and "scale" in body["error"]
    assert web.handle("nope")[0] == 404


def test_unreadable_video_gives_a_plain_message_without_server_paths(tmp_path):
    bad = tmp_path / "clip.mp4"
    bad.write_bytes(b"not really a video" * 1000)
    status, body = web.handle("analyze", video_path=str(bad), options=web.options_from_query({"name": "clip.mp4"}))
    assert status == 422 and "couldn't be read" in body["error"] and str(tmp_path) not in body["error"]


def test_blur_check_flags_blurred_jumps_and_survives_the_bundle():
    from jumplab.checks import check_blur
    sharp = np.full(300, 2000.0)
    assert check_blur(sharp, 100, 200, 300, 120) == []
    soft = check_blur(np.full(300, 400.0), 100, 200, 300, 120)
    blurred = check_blur(np.full(300, 120.0), 100, 200, 300, 120)
    assert soft[0]["code"] == "blurry_video" and soft[0]["severity"] == "caution"
    assert blurred[0]["severity"] == "serious"
    assert check_blur(None, 100, 200, 300, 120) == []
    # The sharpness travels in the bundle, so a recompute (after calibration) still sees the blur
    kp, r = _analyzed()
    kp.sharpness = np.full(kp.n_frames, 120.0)
    r = analyze_keypoints(kp, T.scale, AnalysisConfig(event_method="toe_heel"))
    b = web.make_bundle(r, kp, "jump.mov")
    assert any(w["code"] == "blurry_video" and w["headline"] == "The video is blurry" and w["fix"] for w in b["warnings"])
    again = web.recompute({"landmarks": b["landmarks"], "scale": T.scale, "event_method": "toe_heel"})
    assert any(w["code"] == "blurry_video" for w in again["warnings"])


def test_an_uploaded_video_keeps_its_sharpness_and_is_checked_for_other_people(monkeypatch):
    """analyze_upload renames the tracked video; the sharpness must survive that (it once didn't).
    Then a second, short pass looks for other people around the jump the first analysis found."""
    from jumplab import pose_tracking
    kp, _ = _analyzed()
    kp.sharpness = np.full(kp.n_frames, 120.0)
    scanned = []

    def scan(path, k, first, last):                            # someone right beside the jumper
        scanned.append((first, last))
        others = np.zeros((k.n_frames, 4))
        for i in range(first, last + 1, 12):
            xy = k.xyv[i, :, :2]
            (x0, y0), (x1, y1) = np.nanmin(xy, 0), np.nanmax(xy, 0)
            others[i] = [x1, y0, x1 + (x1 - x0), y1]
        return others
    monkeypatch.setattr(pose_tracking, "track_jump", lambda path, fps=None: None)     # a short clip: no trimming
    monkeypatch.setattr(pose_tracking, "track_video", lambda path: kp)
    monkeypatch.setattr(pose_tracking, "scan_for_others", scan)
    monkeypatch.setattr(web, "still_frame", lambda path, i: None)
    b = web.analyze_upload("/tmp/upload123.mp4", "jump.mov", scale=T.scale, event_method="toe_heel")
    assert b["landmarks"]["sharpness"][0] == 120.0
    codes = {w["code"]: w["severity"] for w in b["warnings"]}
    assert codes.get("blurry_video") == "serious" and codes.get("person_near_athlete") == "serious"
    ev = b["results"]["events"]
    assert len(scanned) == 1 and scanned[0][0] < ev["movement_onset"]["frame"] and scanned[0][1] > ev["landing"]["frame"]
