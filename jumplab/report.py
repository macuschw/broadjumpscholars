"""Printed summary, CSV and JSON output for pipeline results."""
from __future__ import annotations

import json
import os

import numpy as np

CSV_COLUMNS = ["hip_x_px", "hip_y_px_up", "ankle_x_px", "ankle_y_px_up", "trunk_angle_deg",
               "shin_angle_deg", "toe_x_px", "toe_y_px_up", "heel_x_px", "heel_y_px_up",
               "knee_angle_deg", "hip_angle_deg"]


def _fmt(v, spec, unit=""):
    return "n/a" if v is None else f"{v:{spec}}{unit}"


def format_report(r):
    lines = []

    def row(label, value):
        lines.append(f"  {label:<46}{value}")

    lines.append("=========== RESULTS ===========")
    lines.append(f"Video: {r['video']}")
    lines.append(f"  {r['fps']:.1f} fps, {r['n_frames']} frames, person detected in "
                 f"{100 * r['detected_fraction']:.0f}%, {r['side']} side, jumping {r['direction']}")
    lines.append(f"  Calibration: " + (f"{r['scale_m_per_px']:.5f} m/px" if r["scale_m_per_px"]
                                         else "none (pixel results + gravity estimates only)"))

    lines.append(f"\nEvents ({r['event_method']} method)")
    for key, label in [("movement_onset", "Movement onset"),
                       ("countermovement_bottom", "Countermovement bottom"),
                       ("takeoff", "Takeoff"), ("landing", "Landing")]:
        e = r["events"][key]
        row(label, f"{e['time_s']:.3f} s  (frame {e['frame']})")

    tm = r["timing"]
    lines.append("\nTiming")
    row("Flight time", f"{tm['flight_time_s']:.3f} s")
    for k, v in tm.items():
        if k.startswith("flight_time_") and k.endswith("_method_s"):
            row(f"  (flight time, {k[12:-9]} method)", _fmt(v, ".3f", " s"))
    row("Ground contact (movement onset -> takeoff)", f"{tm['contact_time_s']:.3f} s")
    row("Push-off (countermovement bottom -> takeoff)", f"{tm['push_off_time_s']:.3f} s")
    row("Timing uncertainty per event", f"+/- {1000 * tm['frame_uncertainty_s']:.0f} ms (1 frame)")

    lines.append("\nAngles (degrees; trunk/shin from vertical, forward lean = positive;")
    lines.append("        knee/hip joint angles, 180 = straight)")
    lines.append(f"  {'':<24}{'trunk':>8}{'shin':>8}{'knee':>8}{'hip':>8}")
    for key, label in [("countermovement_bottom", "Countermovement bottom"),
                       ("takeoff", "Takeoff"), ("landing", "Landing")]:
        a = r["angles_deg"][key]
        lines.append(f"  {label:<24}{a['trunk']:8.1f}{a['shin']:8.1f}{a['knee']:8.1f}{a['hip']:8.1f}")

    tr, d, px = r["trajectory"], r["distance"], r["pixels"]
    lines.append("\nTrajectory (parabola fit to the hip during flight)")
    row("Launch angle", _fmt(tr.get("launch_angle_deg"), ".1f", " deg"))
    if r["scale_m_per_px"]:
        row("Horizontal velocity vx", _fmt(tr.get("vx_m_s"), ".2f", " m/s"))
        row("Vertical velocity vy", _fmt(tr.get("vy_m_s"), ".2f", " m/s"))
        row("Takeoff speed", _fmt(tr.get("speed_m_s"), ".2f", " m/s"))
        row("Peak hip rise above takeoff", _fmt(tr.get("peak_rise_m"), ".3f", " m"))
        row("g from free fit (check, expect ~9.81)", _fmt(tr.get("g_fit_m_s2"), ".2f", " m/s^2"))
    row("Fit points", _fmt(tr.get("fit_points"), "d"))

    lines.append("\nFrom flight time + gravity only (no calibration; assumes equal")
    lines.append("takeoff and landing height, so usually an over-estimate)")
    row("Takeoff vertical speed vy", f"{tr['vy_from_flight_time_m_s']:.2f} m/s")
    row("Peak hip rise", f"{tr['peak_rise_from_flight_time_m']:.3f} m")

    lines.append("\nDistances")
    if r["scale_m_per_px"]:
        row("Jump distance (takeoff toe -> landing heel)", _fmt(d["jump_distance_m"], ".2f", " m"))
        row("Hip horizontal travel in flight", _fmt(d["hip_travel_m"], ".2f", " m"))
        row("Countermovement depth", _fmt(d["countermovement_depth_m"], ".2f", " m"))
    row("Jump distance", f"{px['jump_distance_px']:.0f} px")
    row("Hip travel / rise / countermovement depth",
        f"{px['hip_travel_px']:.0f} / {px['hip_rise_px']:.0f} / {px['countermovement_depth_px']:.0f} px")
    if "gravity_implied_scale_m_per_px" in tr:
        row("Gravity-implied scale (cross-check)", f"{tr['gravity_implied_scale_m_per_px']:.5f} m/px")
        row("Jump distance at that scale (rough)", f"{d['jump_distance_m_gravity_scale']:.2f} m")

    if r["warnings"]:
        lines.append("\nWarnings")
        lines.extend(f"  - {w}" for w in r["warnings"])
    lines.append("================================")
    return "\n".join(lines)


def save_csv(r, path):
    s = r["series"]
    n = len(s["time_s"])
    cols = ["frame", "time_s"] + CSV_COLUMNS
    data = np.column_stack([np.arange(n), s["time_s"]] + [s[c] for c in CSV_COLUMNS])
    if r["scale_m_per_px"]:
        k = r["scale_m_per_px"]
        cols += ["hip_x_m", "hip_y_m_up"]
        data = np.column_stack([data, s["hip_x_px"] * k, s["hip_y_px_up"] * k])
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    np.savetxt(path, data, delimiter=",", header=",".join(cols), comments="", fmt="%.4f")


def _jsonable(v):
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if isinstance(v, np.generic):
        return v.item()
    return v


def save_json(r, path):
    summary = {k: v for k, v in r.items() if k not in ("series",) and not k.startswith("_")}
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(_jsonable(summary), f, indent=2)
