"""Someone else in the shot (checks.check_other_people, from pose_tracking.find_other_person)."""
import numpy as np

from jumplab import web
from jumplab.checks import CAUTION, SERIOUS, check_other_people
from jumplab.pipeline import AnalysisConfig, analyze_keypoints

from synthetic import Truth, jumper_keypoints

T = Truth()
CONFIG = AnalysisConfig(event_method="toe_heel")


def _jump(duration=2.2):
    kp = jumper_keypoints(duration=duration)
    r = analyze_keypoints(kp, T.scale, CONFIG)
    ev = {k: v["frame"] for k, v in r["events"].items()}
    return kp, ev["movement_onset"], ev["landing"]


def _athlete(kp, i):
    xy = kp.xyv[i, :, :2]
    return np.nanmin(xy, 0), np.nanmax(xy, 0)


def _person(kp, i, dx, height=1.0):
    """A box like the athlete's at frame i, shifted dx athlete-heights sideways."""
    (x0, y0), (x1, y1) = _athlete(kp, i)
    tall = y1 - y0
    return np.array([x0 + dx * tall, y1 - height * tall, x1 + dx * tall, y1])


def _others(kp, frames, dx, height=1.0):
    others = np.full((kp.n_frames, 4), np.nan)
    for i in frames:
        if i < kp.n_frames:
            others[i] = _person(kp, i, dx(i) if callable(dx) else dx, height)
    return others


def test_nobody_or_not_checked_raises_nothing():
    kp, on, la = _jump()
    assert check_other_people(None, kp.xyv, on, la, kp.fps) == []
    assert check_other_people(np.full((kp.n_frames, 4), np.nan), kp.xyv, on, la, kp.fps) == []   # not checked
    assert check_other_people(np.zeros((kp.n_frames, 4)), kp.xyv, on, la, kp.fps) == []           # checked, nobody


def test_a_scanned_stretch_is_not_scanned_again():
    from jumplab.pose_tracking import others_checked
    others = np.full((300, 4), np.nan)
    assert not others_checked(None, 50, 200, 120) and not others_checked(others, 50, 200, 120)
    others[50:201:12] = 0                                      # scanned 50..200, every 12th frame
    assert others_checked(others, 50, 200, 120) and others_checked(others, 60, 190, 120)
    assert not others_checked(others, 30, 200, 120) and not others_checked(others, 50, 260, 120)


def test_someone_clear_of_the_jumper_is_a_caution():
    kp, on, la = _jump()
    w = check_other_people(_others(kp, range(on, la, 12), dx=2.0), kp.xyv, on, la, kp.fps)
    assert [x["code"] for x in w] == ["person_in_shot"] and w[0]["severity"] == CAUTION


def test_someone_right_beside_the_jumper_is_serious():
    kp, on, la = _jump()
    w = check_other_people(_others(kp, range(on, la, 12), dx=0.5), kp.xyv, on, la, kp.fps)
    assert [x["code"] for x in w] == ["person_near_athlete"] and w[0]["severity"] == SERIOUS


def test_passing_unseen_behind_the_jumper_is_serious():
    """Covered while behind the athlete: seen on the right, then (after a gap) on the left."""
    kp, on, la = _jump()
    seen = list(range(on - 50, on, 12)) + list(range(la + 30, la + 90, 12))
    w = check_other_people(_others(kp, seen, dx=lambda i: 1.0 if i < on else -1.0), kp.xyv, on, la, kp.fps)
    assert [x["code"] for x in w] == ["person_near_athlete"]


def test_brief_or_small_hits_are_ignored():
    kp, on, la = _jump()
    assert check_other_people(_others(kp, [on, on + 12], dx=0.5), kp.xyv, on, la, kp.fps) == []      # 2 checks
    assert check_other_people(_others(kp, range(on, la, 12), dx=0.5, height=0.15), kp.xyv, on, la, kp.fps) == []
    kp, on, la = _jump(duration=4.0)                              # someone walks up well after landing
    late = range(la + int(1.1 * kp.fps), kp.n_frames, 12)
    assert len(late) >= 3 and check_other_people(_others(kp, late, dx=0.5), kp.xyv, on, la, kp.fps) == []


def test_other_people_survive_the_website_bundle_and_recompute():
    kp, on, la = _jump()
    kp.others = _others(kp, range(on, la, 12), dx=0.5)
    r = analyze_keypoints(kp, T.scale, CONFIG)
    b = web.make_bundle(r, kp, "jump.mov")
    assert len(b["landmarks"]["others"]) == len(range(on, la, 12))
    assert any(w["code"] == "person_near_athlete" and w["headline"] == "Someone walked right behind the jumper"
               for w in b["warnings"])
    again = web.recompute({"landmarks": b["landmarks"], "scale": T.scale, "event_method": "toe_heel"})
    assert any(w["code"] == "person_near_athlete" for w in again["warnings"])
    kp.others = np.zeros((kp.n_frames, 4))                      # checked, nobody: {} (not None)
    assert web.make_bundle(analyze_keypoints(kp, T.scale, CONFIG), kp, "jump.mov")["landmarks"]["others"] == {}
