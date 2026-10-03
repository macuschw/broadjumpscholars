"""Plain-language summary of pipeline results, organised by the project's five categories:

    1. Jump distance      2. Trajectory      3. Trunk angle
    4. Shin angle         5. Ground contact time

Each category gets a reliability rating based on the built-in checks (the gravity check on
the parabola fit, frame rate, agreement between the two event methods, and every pipeline
warning that affects that category), plus a sentence saying what each number means. Works on the dict from pipeline.analyze_* or on the
saved _results.json.
"""
from __future__ import annotations

import textwrap

from .checks import SERIOUS, as_warning
from .physics import G

M_TO_IN = 1 / 0.0254
WIDTH = 64

RELIABLE = "✓ reliable"
CAREFUL = "~ use with care"
ROUGH = "✗ rough only"


def _inches(m):
    return m * M_TO_IN


def _feet_inches(m):
    total = _inches(m)
    ft = int(total // 12)
    return f"{ft} ft {total - 12 * ft:.1f} in"


def _lean(angle, forward="forward", backward="backward"):
    return f"{abs(angle):.0f}° {forward if angle >= 0 else backward}"


class _Section:
    def __init__(self, number, title, rating, reason):
        self.lines = [f"{number}. {title.upper():<{WIDTH - 20}}{rating:>17}"]
        self.reason = reason

    def value(self, label, value):
        self.lines.append(f"   {label:<30}{value}")

    def text(self, s):
        self.lines.extend(textwrap.wrap(s, WIDTH - 3, initial_indent="   ", subsequent_indent="   "))

    def blank(self):
        self.lines.append("")

    def render(self):
        out = list(self.lines)
        if self.reason:
            out.extend(textwrap.wrap(f"Reliability: {self.reason}", WIDTH - 3,
                                     initial_indent="   ", subsequent_indent="   "))
        return "\n".join(out)


# ---------------------------------------------------------------- reliability checks

_ORDER = [RELIABLE, CAREFUL, ROUGH]


def _worst(a, b):
    return max(a, b, key=_ORDER.index)


def _apply_warnings(r, category, rating, reason, skip=()):
    """Downgrade a rating for every pipeline warning that affects this category:
    caution -> at most '~ use with care', serious -> '✗ rough only'."""
    notes = []
    for w in map(as_warning, r.get("warnings", [])):
        if category in w["affects"] and w["code"] not in skip:
            rating = _worst(rating, ROUGH if w["severity"] == SERIOUS else CAREFUL)
            notes.append(w["message"])
    if notes:
        reason = " ".join([reason] + [f"WARNING: {n}" for n in notes]) if reason else \
            " ".join(f"WARNING: {n}" for n in notes)
    return rating, reason

def _g_check(r):
    """(rating, reason) for anything that comes from the parabola fit."""
    tr = r["trajectory"]
    if "fit_points" not in tr:
        return ROUGH, "too few airborne frames to fit a parabola."
    g = tr.get("g_fit_m_s2")
    if g is None:
        return CAREFUL, ("no calibration, so only the launch angle is available "
                         "(speeds and heights need meters).")
    err = abs(g - G) / G
    if err <= 0.05:
        return RELIABLE, f"gravity check passed (fit gave g = {g:.2f} m/s², expect 9.81)."
    if err <= 0.12:
        return CAREFUL, f"gravity check {100 * err:.0f}% off (g = {g:.2f} m/s², expect 9.81)."
    if tr.get("point") == "com":
        why = ("the center-of-mass estimate still has errors: average-body segment data, "
               "limb tracking, or a calibration that's a few percent off")
    else:
        why = "usually because the hip isn't the body's center of mass"
    return ROUGH, (f"gravity check failed: the fit gave g = {g:.2f} m/s² instead of 9.81, so "
                   f"the path isn't a clean free-fall parabola ({why}). Launch angle and "
                   "speeds are rough.")


def _timing_check(r):
    fps = r["fps"]
    tm = r["timing"]
    frame_ms = 1000 / fps
    other_key = next((k for k in tm if k.startswith("flight_time_") and k.endswith("_method_s")), None)
    other = tm.get(other_key) if other_key else None
    if fps < 100:
        return ROUGH, (f"video is {fps:.0f} fps, so each event time is only good to "
                       f"±{frame_ms:.0f} ms. Record at 120-240 fps.")
    if other is not None and abs(other - tm["flight_time_s"]) > 3 / fps:
        diff = 1000 * abs(other - tm["flight_time_s"])
        hint = (" Re-run with --events toe_heel, which is usually more accurate at high fps."
                if r["event_method"] == "ankle" else "")
        return CAREFUL, (f"the two takeoff/landing methods disagree by {diff:.0f} ms. Check the "
                         f"shaded flight band on the events plot.{hint}")
    return RELIABLE, f"{fps:.0f} fps, each event time good to ±{frame_ms:.0f} ms."


def _angle_check(r):
    d = r["detected_fraction"]
    if d < 0.9:
        return CAREFUL, f"the body was tracked in only {100 * d:.0f}% of frames."
    return RELIABLE, ("depends on MediaPipe's skeleton; check the skeleton video if a "
                      "value looks odd.")


# ---------------------------------------------------------------- sections

def _distance(r):
    d, px = r["distance"], r["pixels"]
    if d["jump_distance_m"] is not None:
        rating, reason = RELIABLE, "uses the tape-measure calibration and the foot markers."
        g = r["trajectory"].get("g_fit_m_s2")
        if g is not None and abs(g - G) / G > 0.05:
            # The distance uses the same calibration scale as g; a failed g check can mean
            # that scale is off (e.g. the tape wasn't on the jump line).
            rating = CAREFUL
            reason += (f" The gravity check is {100 * abs(g - G) / G:.0f}% off (g = {g:.2f} "
                       "m/s²), which can mean the calibration scale is off too; a ball drop "
                       "filmed on the jump line would tell.")
        rating, reason = _apply_warnings(r, "distance", rating, reason)
        s = _Section(1, "Jump distance", rating, reason)
        m = d["jump_distance_m"]
        s.value("Jump distance", f"{m:.2f} m  ({_inches(m):.1f} in, {_feet_inches(m)})")
        s.text("Measured like the official test: from the toe at takeoff to the heel at landing.")
        s.blank()
        s.value("Hip travel while in the air", f"{d['hip_travel_m']:.2f} m  ({_inches(d['hip_travel_m']):.1f} in)")
        s.text("Shorter than the jump distance because you take off leaning forward and land "
               "with your feet out in front of your hips.")
    else:
        rough = d.get("jump_distance_m_gravity_scale")
        s = _Section(1, "Jump distance", *_apply_warnings(
            r, "distance", ROUGH, "no calibration. The meters estimate uses gravity as a ruler "
            "and can be well off. Calibrate for a real measurement."))
        s.value("Jump distance", f"{px['jump_distance_px']:.0f} pixels")
        if rough:
            s.value("Rough estimate (from gravity)", f"{rough:.2f} m  ({_inches(rough):.0f} in)")
    return s


def _trajectory(r):
    tr = r["trajectory"]
    rating, reason = _apply_warnings(r, "trajectory", *_g_check(r))
    s = _Section(2, "Trajectory", rating, reason)
    com = tr.get("point") == "com"
    body = "center of mass" if com else "hips"
    if com:
        s.text("Tracked point: the whole-body center of mass (a mass-weighted average of "
               "all body segments), the one point that truly follows a parabola in flight.")
        s.blank()
    angle = tr.get("launch_angle_deg")
    if angle is not None:
        s.value("Launch angle", f"{angle:.0f}° above horizontal")
        rel = "lower" if angle < 45 else "higher"
        s.text(f"The direction the {body} was moving at takeoff. That's {rel} than 45°, the "
               "angle that gives the longest range for a simple projectile that lands at the "
               "same height it started.")
        s.blank()
    if "speed_m_s" in tr:
        s.value("Takeoff speed", f"{tr['speed_m_s']:.2f} m/s")
        s.value("  forward part (vx)", f"{tr['vx_m_s']:.2f} m/s")
        s.value("  upward part (vy)", f"{tr['vy_m_s']:.2f} m/s")
        s.text("The takeoff velocity split into its horizontal and vertical components, "
               "so speed = √(vx² + vy²).")
        s.blank()
        peak = tr.get("peak_rise_m")
        if peak is not None:
            s.value(f"Peak height ({body})", f"{100 * peak:.0f} cm  ({_inches(peak):.1f} in) above takeoff")
            s.text(f"How much higher the {body} got than at takeoff: the top of the fitted "
                   "parabola, vy² / 2g using the g from the same fit.")
        s.blank()
    if "g_fit_m_s2" in tr and "g_fit_hip_m_s2" in tr:
        s.value("Gravity check", f"g = {tr['g_fit_m_s2']:.2f} m/s² (hip alone: "
                f"{tr['g_fit_hip_m_s2']:.2f}; true value 9.81)")
        s.blank()
    ft = r["timing"]["flight_time_s"]
    s.value("Time in the air", f"{ft:.3f} s")
    s.value("Peak height from air time", f"{100 * tr['peak_rise_from_flight_time_m']:.0f} cm "
            f"({_inches(tr['peak_rise_from_flight_time_m']):.1f} in)")
    s.text("A second estimate that needs only the flight time and g (h = gT²/8). It assumes "
           "you land at the same height you took off, so it's usually a bit high.")
    return s


def _trunk(r):
    rating, reason = _apply_warnings(r, "angles", *_angle_check(r))
    s = _Section(3, "Trunk angle", rating, reason)
    a = r["angles_deg"]
    b, t, l = (a[k]["trunk"] for k in ("countermovement_bottom", "takeoff", "landing"))
    s.text("Lean of the hip→shoulder line from straight up. 0° = upright, positive = "
           "leaning forward (in the jump direction).")
    s.blank()
    s.value("Bottom of the dip", _lean(b))
    s.value("Takeoff", _lean(t))
    s.value("Landing", _lean(l))
    s.blank()
    change = b - t
    verb = "straightened up" if change > 0 else "leaned further forward"
    s.text(f"Between the bottom of the dip and takeoff, the trunk {verb} by {abs(change):.0f}°. "
           f"Hip joint angle went from {a['countermovement_bottom']['hip']:.0f}° to "
           f"{a['takeoff']['hip']:.0f}° (180° = fully extended).")
    return s


def _shin(r):
    rating, reason = _apply_warnings(r, "angles", *_angle_check(r))
    s = _Section(4, "Shin angle", rating, reason)
    a = r["angles_deg"]
    b, t, l = (a[k]["shin"] for k in ("countermovement_bottom", "takeoff", "landing"))
    s.text("Lean of the ankle→knee line from straight up. Positive = knees ahead of the "
           "ankles; negative = feet out in front of the knees.")
    s.blank()
    for label, key, v in (("Bottom of the dip", "countermovement_bottom", b),
                          ("Takeoff", "takeoff", t), ("Landing", "landing", l)):
        s.value(label, f"{_lean(v)}   (knee bent to {a[key]['knee']:.0f}°)")
    s.blank()
    if l < 0:
        s.text(f"At landing the shin tilts back {abs(l):.0f}°: the feet reached out ahead of the "
               "knees, which adds distance.")
    s.text("Knee angle: 180° = straight leg, smaller = more bent.")
    return s


def _contact(r):
    # low_fps is already covered by _timing_check
    rating, reason = _apply_warnings(r, "timing", *_timing_check(r), skip=("low_fps",))
    s = _Section(5, "Ground contact time", rating, reason)
    tm, ev = r["timing"], r["events"]
    s.value("Ground contact", f"{tm['contact_time_s']:.3f} s")
    s.text("From when the hips first start dropping into the dip until the feet leave the ground.")
    s.value("Push-off", f"{tm['push_off_time_s']:.3f} s")
    s.text("The explosive part: from the bottom of the dip to takeoff.")
    s.value("Flight", f"{tm['flight_time_s']:.3f} s")
    s.blank()
    if r["distance"]["countermovement_depth_m"] is not None:
        depth = r["distance"]["countermovement_depth_m"]
        s.value("Dip depth", f"{100 * depth:.0f} cm  ({_inches(depth):.1f} in)")
    s.text("Timeline:  start dip {:.2f}s → bottom {:.2f}s → takeoff {:.2f}s → landing {:.2f}s".format(
        ev["movement_onset"]["time_s"], ev["countermovement_bottom"]["time_s"],
        ev["takeoff"]["time_s"], ev["landing"]["time_s"]))
    return s


def format_summary(r):
    name = r["video"].replace("\\", "/").split("/")[-1]
    cal = "calibrated" if r["scale_m_per_px"] else "NOT calibrated"
    bar = "═" * WIDTH
    head = [bar, f" BROAD JUMP SUMMARY: {name}",
            f" {r['fps']:.0f} fps · {cal} · events: {r['event_method']} · jumping {r['direction']}",
            bar]
    sections = [_distance(r), _trajectory(r), _trunk(r), _shin(r), _contact(r)]
    body = "\n\n".join(s.render() for s in sections)
    key = ("Ratings:  ✓ reliable   ~ use with care   ✗ rough only "
           "(see the reason under each section)")
    return "\n".join(head) + "\n\n" + body + "\n\n" + "─" * WIDTH + "\n" + key
