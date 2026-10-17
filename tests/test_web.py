"""The website bundle and the analysis service behind the site's upload (jumplab/web.py)."""
import json

import numpy as np

from jumplab import web
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.report import save_csv, save_json

from synthetic import Truth, jumper_keypoints

T = Truth()


def _analysed():
    kp = jumper_keypoints()
    return kp, analyze_keypoints(kp, T.scale, AnalysisConfig(event_method="toe_heel"))


def test_bundle_is_strict_json_with_everything_the_site_shows():
    kp, r = _analysed()
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
    kp, r = _analysed()
    b = web.make_bundle(r, kp, "jump.mov")
    again = web.recompute({"landmarks": b["landmarks"], "name": "jump.mov", "scale": T.scale, "event_method": "toe_heel"})
    d0, d1 = r["distance"]["jump_distance_m"], again["results"]["distance"]["jump_distance_m"]
    assert abs(d1 - d0) < 0.001                               # landmarks rounded to 0.1 px: well under 1 mm


def test_recompute_without_scale_is_uncalibrated_and_with_a_new_scale_scales():
    kp, r = _analysed()
    b = web.make_bundle(r, kp, "jump.mov")
    raw = web.recompute({"landmarks": b["landmarks"], "event_method": "toe_heel"})["results"]
    assert raw["scale_m_per_px"] is None and raw["distance"]["jump_distance_m"] is None
    double = web.recompute({"landmarks": b["landmarks"], "scale": 2 * T.scale, "event_method": "toe_heel"})["results"]
    assert abs(double["distance"]["jump_distance_m"] - 2 * r["distance"]["jump_distance_m"]) < 0.002


def test_bundle_from_saved_files_matches_a_direct_bundle(tmp_path):
    kp, r = _analysed()
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
    kp, r = _analysed()
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
