"""Several jumps in one video (a session): find every jump, then analyze each one on its own.

Each jump gets the normal analysis (pipeline.analyze_keypoints) on its own stretch of the video
(pose_tracking.find_jumps / jumps_in_keypoints: 2.5 s before the dip to 1.8 s after), with the
other jumps blanked out, so two athletes taking turns never mix. Its verdict is in its results:
"valid" and "fouls" (checks.check_landing: stepped forward or back, hand on the ground).
"""
from __future__ import annotations

from dataclasses import replace

import numpy as np

from .checks import _standing_height
from .events import NoJumpFound
from .pipeline import analyze_keypoints, look_for_others

NOT_A_JUMP_RISE = 0.06     # x standing height: the hips rose less than this, with an impossible
                           # flight time -> not a jump (walking off from a crouch rises ~0.02; jumps 0.11-0.18)


def jump_keypoints(kp, segment):
    """The keypoints of one jump: only its own stretch, everything else blanked, and the analysis
    kept inside it (Keypoints.segment)."""
    first, last = int(segment[0]), int(segment[1])
    keep = slice(first, last + 1)

    def only(a, empty):
        if a is None:
            return None
        out = np.full_like(np.asarray(a, dtype=float), empty)
        out[keep] = np.asarray(a, dtype=float)[keep]
        return out
    xyv = np.full_like(kp.xyv, np.nan)
    xyv[:, :, 2] = 0.0
    xyv[keep] = kp.xyv[keep]
    return replace(kp, xyv=xyv, sharpness=only(kp.sharpness, np.nan), others=only(kp.others, np.nan),
                   segment=(first, last))


def not_a_jump(results, kp):
    """Something the quick look took for a jump that isn't one (e.g. walking off quickly from the
    landing squat): an impossible flight time, and a path through the "air" that doesn't curve
    down like a thrown ball, or hips that barely rose."""
    codes = {w["code"] for w in results["warnings"]}
    if "flight_time_implausible" not in codes:
        return False
    if "no_downward_curve" in codes:                           # a real jump's path curves down, even
        return True                                            # when its takeoff/landing are mistimed
    tall = _standing_height(kp.xyv, results["events"]["movement_onset"]["frame"], kp.fps)
    return bool(tall) and results["pixels"]["hip_rise_px"] < NOT_A_JUMP_RISE * tall


def analyze_session(kp, segments, scale_m_per_px=None, config=None, fps_override=None,
                    video_path=None, progress=None):
    """Analyze each jump of a session. kp: keypoints of the whole video (tracked everywhere, or
    only inside the segments). With video_path, each jump is also checked for other people in the
    shot (pipeline.look_for_others). progress(i, n) is called before jump i of n.

    Returns (jumps, skipped): jumps is a list of (keypoints, results) in time order, numbered from 1
    in results["jump"]; skipped lists the stretches that held no measurable jump, with the reason."""
    jumps, skipped = [], []
    for i, segment in enumerate(segments):
        if progress:
            progress(i, len(segments))
        k = jump_keypoints(kp, segment)
        try:
            r = analyze_keypoints(k, scale_m_per_px, config, fps_override)
            if video_path and look_for_others(video_path, k, r):
                r = analyze_keypoints(k, scale_m_per_px, config, fps_override)
        except NoJumpFound as e:
            skipped.append({"segment": [int(v) for v in segment], "reason": str(e)})
            continue
        if len(segments) > 1 and not_a_jump(r, k):
            skipped.append({"segment": [int(v) for v in segment], "reason": "not a jump (the hips barely rose)"})
            continue
        r["jump"] = len(jumps) + 1
        r["segment"] = [int(v) for v in segment]
        jumps.append((k, r))
    return jumps, skipped


def summary_rows(jumps):
    """One row per jump for a printed table / CSV: number, times, distance, verdict, reasons."""
    rows = []
    for k, r in jumps:
        ev, d = r["events"], r["distance"]
        serious = [w for w in r["warnings"] if w["severity"] == "serious"]
        rows.append({
            "jump": r["jump"],
            "takeoff_s": ev["takeoff"]["time_s"], "landing_s": ev["landing"]["time_s"],
            "distance_m": d.get("jump_distance_m") if d.get("jump_distance_m") is not None else d.get("jump_distance_m_gravity_scale"),
            "calibrated": r["scale_m_per_px"] is not None,
            "valid": r["valid"],
            "fouls": [f["code"] for f in r["fouls"]],
            "serious_warnings": [w["code"] for w in serious],
        })
    return rows


def best_valid(jumps):
    """The longest jump that counts, or None."""
    ok = [(r["distance"].get("jump_distance_m") or r["distance"].get("jump_distance_m_gravity_scale") or 0, r["jump"])
          for _, r in jumps if r["valid"]]
    return max(ok)[1] if ok else None
