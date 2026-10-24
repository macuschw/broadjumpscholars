"""Several jumps in one video (jumplab/session.py) and the landing fouls (checks.check_landing).

The benchmark is a real session (tests/data/multi_jump_120fps_*): 8 jumps by two athletes taking
turns, the last three failed (stumbled forward, stepped back, hands on the ground). Its answer key
was written by eye from the video; the keypoints are MediaPipe's for every frame of it."""
import json
import os

import numpy as np
import pytest

from jumplab.checks import FOUL, _standing_height
from jumplab.pipeline import AnalysisConfig, analyze_keypoints
from jumplab.pose_tracking import Keypoints, jump_moments, jumps_in_keypoints
from jumplab.session import analyze_session, best_valid, summary_rows

from synthetic import Truth, jumper_keypoints

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
T = Truth()
CONFIG = AnalysisConfig(event_method="toe_heel")


@pytest.fixture(scope="module")
def session():
    kp = Keypoints.load(os.path.join(DATA, "multi_jump_120fps_keypoints.npz"))
    with open(os.path.join(DATA, "multi_jump_120fps_labels.json")) as f:
        key = json.load(f)["jumps"]
    jumps, skipped = analyze_session(kp, jumps_in_keypoints(kp), 0.003, AnalysisConfig(event_method="ankle"))
    return key, jumps, skipped


def test_every_jump_of_the_session_is_found_once(session):
    key, jumps, skipped = session
    assert len(jumps) == len(key)
    for (_, r), k in zip(jumps, key):
        assert abs(r["events"]["takeoff"]["time_s"] - k["takeoff_s"]) < 0.25, r["jump"]
    assert [r["jump"] for _, r in jumps] == list(range(1, len(key) + 1))
    # Walking off quickly from the landing squat after jump 7 looked like a jump to the quick look
    assert any("not a jump" in s["reason"] for s in skipped)


def test_each_jump_gets_the_verdict_of_the_answer_key(session):
    key, jumps, _ = session
    assert [r["valid"] for _, r in jumps] == [k["valid"] for k in key]
    assert [[f["code"] for f in r["fouls"]] for _, r in jumps][5:] == [
        ["foul_step_forward"], ["foul_step_back"], ["foul_hand_down"]]
    assert all(f["severity"] == FOUL and f["frame"] > r["events"]["landing"]["frame"] for _, r in jumps for f in r["fouls"])


def test_the_best_jump_is_the_longest_that_counts(session):
    _, jumps, _ = session
    rows = summary_rows(jumps)
    best = best_valid(jumps)
    assert rows[best - 1]["valid"]
    assert rows[best - 1]["distance_m"] == max(r["distance_m"] for r in rows if r["valid"])


def test_each_jump_only_sees_its_own_stretch(session):
    _, jumps, _ = session
    for k, r in jumps:
        first, last = r["segment"]
        assert k.segment == (first, last)
        assert np.isnan(k.xyv[:first, :, 0]).all() and np.isnan(k.xyv[last + 1:, :, 0]).all()


# ---------------------------------------------------------------- fouls on a synthetic landing

def _landed():
    kp = jumper_keypoints(duration=3.6)
    r = analyze_keypoints(kp, T.scale, CONFIG)
    la, on = r["events"]["landing"]["frame"], r["events"]["movement_onset"]["frame"]
    return kp, la, _standing_height(kp.xyv, on, kp.fps)


def _codes(kp):
    return [f["code"] for f in analyze_keypoints(kp, T.scale, CONFIG)["fouls"]]


def test_a_held_landing_counts():
    kp, _, _ = _landed()
    r = analyze_keypoints(kp, T.scale, CONFIG)
    assert r["valid"] and r["fouls"] == []


@pytest.mark.parametrize("sign, code", [(+1, "foul_step_forward"), (-1, "foul_step_back")])
def test_a_step_after_landing_is_a_foul(sign, code):
    kp, la, tall = _landed()
    after = slice(la + int(0.4 * kp.fps), None)
    for j in (27, 29, 31):                                     # the near foot steps (jumping right: +x)
        kp.xyv[after, j, 0] += sign * 0.4 * tall
    assert _codes(kp) == [code]


def test_bringing_the_back_foot_up_to_the_front_one_is_fine():
    kp, la, tall = _landed()
    after = slice(la + int(0.4 * kp.fps), None)
    front = max(np.nanmedian(kp.xyv[la:la + 12, j, 0]) for j in (27, 28, 29, 30, 31, 32))
    for j in (28, 30, 32):                                     # the far foot landed 0.2 behind ...
        kp.xyv[la:, j, 0] -= 0.2 * tall
        kp.xyv[after, j, 0] = np.minimum(kp.xyv[after, j, 0] + 0.2 * tall, front)   # ... then joins
    assert _codes(kp) == []


def test_a_hand_put_down_is_a_foul_but_a_swing_past_the_floor_is_not():
    kp, la, tall = _landed()
    floor = np.nanmax(kp.xyv[la:la + 12, [29, 30, 31, 32], 1])
    x = np.nanmedian(kp.xyv[la:la + 12, 31, 0]) + 0.2 * tall
    swing = range(la + 20, la + 30)                            # under 0.1 s near the floor, moving
    for n, i in enumerate(swing):
        kp.xyv[i, [15, 19], 0], kp.xyv[i, [15, 19], 1] = x + n * 8, floor
    assert _codes(kp) == []
    down = range(la + 40, la + 40 + int(0.5 * kp.fps))         # half a second, still
    kp.xyv[down.start:down.stop, [15, 19], 0], kp.xyv[down.start:down.stop, [15, 19], 1] = x, floor
    assert _codes(kp) == ["foul_hand_down"]


# ---------------------------------------------------------------- finding the jumps (quick look)

def _looks(spec, fps=10):
    """[(seconds, hip x, body height)] -> looks at 10 a second, standing height 100."""
    return [(int(t * fps), x, h) for t, x, h in spec]


def test_the_dip_and_the_landing_squat_are_one_jump_and_walking_is_none():
    fps = 10
    stand = [(t / 10, 0.0, 100) for t in range(0, 20)]
    jump = [(2.0, 0, 60), (2.2, 40, 90), (2.4, 120, 110), (2.6, 160, 55), (2.8, 160, 60), (3.0, 165, 100)]
    walk = [(4.0 + t / 10, 165 + 15 * t, 100) for t in range(30)]       # upright: never crouches
    looks = _looks(stand + jump + walk, fps)
    assert jump_moments(looks, fps) == [(20, 30)]                     # from the dip to the furthest travel within 1 s
    second = [(t + 6.0, x - 165 + 600, h) for t, x, h in jump]           # another jump 6 s later
    assert len(jump_moments(_looks(stand + jump + walk + second, fps), fps)) == 2


def test_a_jump_keeps_its_number_when_its_scale_is_set_later(session):
    from jumplab import web
    _, jumps, _ = session
    k, r = jumps[5]
    b = web.make_bundle(r, k, "IMG_6233.MOV")
    again = web.recompute({"landmarks": b["landmarks"], "scale": 0.0025, "event_method": "ankle", "jump": r["jump"]})
    assert again["results"]["jump"] == 6 and again["results"]["segment"] == r["segment"]
    assert [f["code"] for f in again["fouls"]] == ["foul_step_forward"] and again["valid"] is False
