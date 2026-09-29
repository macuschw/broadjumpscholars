"""Ties everything together: video (or saved keypoints) in -> full results dict out."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import numpy as np

from . import angles, events, physics
from .pose_tracking import BODY_PARTS, load_or_track
from .smoothing import DEFAULT_CUTOFF_HZ, fill_and_smooth, fill_gaps

EVENT_METHODS = ("ankle", "toe_heel")


@dataclass
class AnalysisConfig:
    cutoff_hz: float = DEFAULT_CUTOFF_HZ
    # "ankle": original threshold method on the ankle.
    # "toe_heel": refined method, toe for takeoff and heel for landing (see events.py).
    event_method: str = "ankle"
    # How far the foot must rise (fraction of its total jump rise) to count as "off the
    # ground". Raise it if events fire on noise; lower it if they fire too late.
    threshold_fraction: float = 0.15
    min_rise_px: float = 20.0
    # Analyze only this time window (seconds), e.g. if the clip has several jumps.
    start_s: Optional[float] = None
    end_s: Optional[float] = None
    side: Optional[str] = None          # "LEFT"/"RIGHT"; None = better-tracked side


def choose_side(kp):
    """The side of the body facing the camera has higher MediaPipe visibility."""
    vis = {s: float(np.mean([kp.part(s, n)[2] for n in BODY_PARTS])) for s in ("LEFT", "RIGHT")}
    return "LEFT" if vis["LEFT"] >= vis["RIGHT"] else "RIGHT"


def _window(t, start_s, end_s):
    mask = np.ones(len(t), dtype=bool)
    if start_s is not None:
        mask &= t >= start_s
    if end_s is not None:
        mask &= t <= end_s
    idx = np.flatnonzero(mask)
    if len(idx) == 0:
        raise ValueError("The start/end window contains no frames.")
    return int(idx[0]), int(idx[-1]) + 1


def _detect(method, hip_y, fps, sm, w, config):
    if method == "ankle":
        return events.detect_events(hip_y[w], fps, sm["ANKLE"][1][w],
                                    threshold_fraction=config.threshold_fraction,
                                    min_rise=config.min_rise_px)
    if method == "toe_heel":
        return events.detect_events(hip_y[w], fps, sm["FOOT_INDEX"][1][w], sm["HEEL"][1][w],
                                    refine=True, threshold_fraction=config.threshold_fraction,
                                    min_rise=config.min_rise_px)
    raise ValueError(f"event_method must be one of {EVENT_METHODS}, got {method!r}")


def _event(t, i):
    return {"frame": int(i), "time_s": float(t[i])}


def analyze_keypoints(kp, scale_m_per_px=None, config=None):
    """Full analysis of already-tracked keypoints. scale_m_per_px=None -> uncalibrated
    (pixel results, plus gravity/flight-time estimates that need no calibration)."""
    config = config or AnalysisConfig()
    fps, t = kp.fps, kp.time
    side = config.side or choose_side(kp)
    warnings = []
    if fps < 100:
        warnings.append(f"This video is {fps:.0f} fps (under 100). Angles are fine, but event "
                        f"times are only good to +/-{1000 / fps:.0f} ms; contact time needs "
                        "120-240 fps to be meaningful.")
    detected = float(kp.detected.mean())
    if detected < 0.9:
        warnings.append(f"A person was detected in only {100 * detected:.0f}% of frames; "
                        "gaps were filled by interpolation.")

    # Gap-filled ("raw") and smoothed positions, y flipped so UP is positive.
    raw, sm = {}, {}
    for name in BODY_PARTS:
        x, y, _ = kp.part(side, name)
        raw[name] = (fill_gaps(x), -fill_gaps(y))
        sm[name] = (fill_and_smooth(x, fps, config.cutoff_hz),
                    -fill_and_smooth(y, fps, config.cutoff_hz))
    hip_x, hip_y = sm["HIP"]

    # ---------- Events ----------
    lo, hi = _window(t, config.start_s, config.end_s)
    w = slice(lo, hi)
    ev = _detect(config.event_method, hip_y, fps, sm, w, config).shifted(lo)
    to, la, bo, on = ev.takeoff_i, ev.landing_i, ev.bottom_i, ev.onset_i
    flight_time = (la - to) / fps

    other = [m for m in EVENT_METHODS if m != config.event_method][0]
    try:
        ev_other = _detect(other, hip_y, fps, sm, w, config).shifted(lo)
        flight_time_other = (ev_other.landing_i - ev_other.takeoff_i) / fps
    except events.NoJumpFound:
        flight_time_other = None

    # Jump direction from takeoff -> landing (not whole clip, so walking back after the
    # jump can't flip it). +1 = toward the right of the image.
    direction = 1 if hip_x[la] >= hip_x[to] else -1

    # ---------- Angles (forward lean = positive) ----------
    trunk = direction * angles.trunk_angle(sm["HIP"], sm["SHOULDER"])
    shin = direction * angles.shin_angle(sm["ANKLE"], sm["KNEE"])
    knee = angles.joint_angle(sm["HIP"], sm["KNEE"], sm["ANKLE"])
    hip_joint = angles.joint_angle(sm["SHOULDER"], sm["HIP"], sm["KNEE"])

    def angles_at(i):
        return {"trunk": float(trunk[i]), "shin": float(shin[i]),
                "knee": float(knee[i]), "hip": float(hip_joint[i])}

    # ---------- Pixel measurements ----------
    stand_hip = events.standing_hip_height(hip_y[w], fps)
    pixels = {
        "countermovement_depth_px": float(stand_hip - hip_y[bo]),
        "hip_rise_px": float(hip_y[to:la + 1].max() - hip_y[to]),
        "hip_travel_px": float(abs(hip_x[la] - hip_x[to])),
    }

    # Jump distance, measured like the real test: takeoff toe -> landing heel.
    # Medians over frames where each foot marker is planted, to beat jitter.
    toe_x = np.median(raw["FOOT_INDEX"][0][bo:to] if to > bo else raw["FOOT_INDEX"][0][to - 1:to])
    heel_x = np.median(raw["HEEL"][0][la:la + max(2, int(0.1 * fps))])
    pixels["jump_distance_px"] = float(direction * (heel_x - toe_x))

    # ---------- Trajectory physics ----------
    ft = physics.flight_time_estimates(flight_time)
    traj = {"vy_from_flight_time_m_s": ft["vy"], "peak_rise_from_flight_time_m": ft["peak_rise"]}
    scale = scale_m_per_px
    implied = None
    fit_px = None
    if la - to >= 4:
        # Fit the gap-filled but UNSMOOTHED hip: least squares already averages out
        # jitter, and the low-pass filter would smear landing impact into the flight.
        tf = t[to:la] - t[to]
        xf = direction * raw["HIP"][0][to:la]
        yf = raw["HIP"][1][to:la]
        fit_px = physics.fit_projectile(tf, xf, yf)
        traj.update({
            "fit_points": fit_px.n_points,
            "g_fit_px_s2": fit_px.g,
            "fit_px": {"t0_s": float(t[to]), "x0": fit_px.x0 * direction, "y0": fit_px.y0,
                       "vx": fit_px.vx * direction, "vy": fit_px.vy, "g": fit_px.g},
        })
        if fit_px.g > 0:
            implied = physics.gravity_implied_scale(fit_px.g)
            traj["gravity_implied_scale_m_per_px"] = implied
        else:
            warnings.append("The hip path during flight doesn't curve downward; check tracking.")
        if scale:
            fit_m = physics.fit_projectile(tf, xf * scale, yf * scale, g=physics.G)
            traj.update({
                "vx_m_s": fit_m.vx, "vy_m_s": fit_m.vy, "speed_m_s": fit_m.speed,
                "launch_angle_deg": fit_m.launch_angle_deg,
                "peak_rise_m": fit_m.peak_rise,
                "g_fit_m_s2": fit_px.g * scale,
            })
        else:
            # Angle is a ratio, so it needs no calibration (assumes square pixels).
            traj["launch_angle_deg"] = fit_px.launch_angle_deg
    else:
        warnings.append(f"Only {la - to} airborne frames; too few for a parabola fit.")

    distance = {"jump_distance_m": pixels["jump_distance_px"] * scale if scale else None,
                "hip_travel_m": pixels["hip_travel_px"] * scale if scale else None,
                "countermovement_depth_m": pixels["countermovement_depth_px"] * scale if scale else None}
    if implied:
        distance["jump_distance_m_gravity_scale"] = pixels["jump_distance_px"] * implied
    if scale and implied and abs(implied / scale - 1) > 0.15:
        warnings.append(f"Tape-measure scale ({scale:.5f} m/px) and gravity-implied scale "
                        f"({implied:.5f} m/px) differ by {100 * abs(implied / scale - 1):.0f}%. "
                        "Check the calibration, the event detection and the video fps.")

    return {
        "video": kp.video_path,
        "fps": float(fps),
        "n_frames": int(kp.n_frames),
        "frame_size": [int(kp.width), int(kp.height)],
        "detected_fraction": detected,
        "side": side,
        "direction": "right" if direction > 0 else "left",
        "scale_m_per_px": scale,
        "event_method": config.event_method,
        "events": {"movement_onset": _event(t, on), "countermovement_bottom": _event(t, bo),
                   "takeoff": _event(t, to), "landing": _event(t, la)},
        "timing": {
            "flight_time_s": flight_time,
            f"flight_time_{other}_method_s": flight_time_other,
            "contact_time_s": (to - on) / fps,     # movement onset -> takeoff
            "push_off_time_s": (to - bo) / fps,    # countermovement bottom -> takeoff
            "frame_uncertainty_s": 1 / fps,
        },
        "angles_deg": {"countermovement_bottom": angles_at(bo), "takeoff": angles_at(to),
                       "landing": angles_at(la)},
        "trajectory": traj,
        "distance": distance,
        "pixels": pixels,
        "warnings": warnings,
        # Per-frame arrays for CSV/plots (image x, y up; smoothed unless marked raw)
        "series": {
            "time_s": t, "hip_x_px": hip_x, "hip_y_px_up": hip_y,
            "hip_x_px_raw": raw["HIP"][0], "hip_y_px_up_raw": raw["HIP"][1],
            "ankle_x_px": sm["ANKLE"][0], "ankle_y_px_up": sm["ANKLE"][1],
            "toe_x_px": sm["FOOT_INDEX"][0], "toe_y_px_up": sm["FOOT_INDEX"][1],
            "heel_x_px": sm["HEEL"][0], "heel_y_px_up": sm["HEEL"][1],
            "trunk_angle_deg": trunk, "shin_angle_deg": shin,
            "knee_angle_deg": knee, "hip_angle_deg": hip_joint,
        },
        "_thresholds": {"takeoff": ev.takeoff_threshold, "landing": ev.landing_threshold},
    }


def analyze_video(video_path, scale_m_per_px=None, config=None, output_dir="output",
                  skeleton_video=True, retrack=False):
    """Video in -> results dict out. MediaPipe runs once; keypoints are cached in
    output_dir so re-analysing (new window, new calibration) is instant."""
    stem = os.path.splitext(os.path.basename(video_path))[0]
    cache = os.path.join(output_dir, f"{stem}_keypoints.npz")
    skeleton = os.path.join(output_dir, f"{stem}_skeleton.mp4") if skeleton_video else None
    kp, ran = load_or_track(video_path, cache, skeleton, retrack)
    results = analyze_keypoints(kp, scale_m_per_px, config)
    results["files"] = {"keypoints": cache, "skeleton_video": skeleton, "ran_mediapipe": ran}
    return results
