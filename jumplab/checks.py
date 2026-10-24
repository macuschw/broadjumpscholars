"""Sanity checks that turn silent failures into errors or warnings.

A physics tool that prints a confident wrong number is worse than one that stops. So:
  * If the jump isn't fully inside the clip, analysis stops with an error (NoJumpFound).
  * Anything else suspicious becomes a warning that says which results it affects.

Each warning is a dict:
    code      short id, e.g. "missing_in_jump"
    message   what looks wrong and what to do about it
    severity  "info" (something was noticed or corrected; ratings unchanged),
              "caution" (numbers usable with care) or "serious" (numbers probably wrong)
    affects   result categories: "distance", "trajectory", "angles", "timing"
    headline  (optional) a few words for the alert banner, e.g. "Feet staggered: distance is
              approximate"; see alerts.py
"""
from __future__ import annotations

import warnings

import numpy as np

from .events import NoJumpFound

ALL = ("distance", "trajectory", "angles", "timing")
INFO, CAUTION, SERIOUS = "info", "caution", "serious"
FOUL = "foul"                     # the attempt itself doesn't count (results["fouls"], not "warnings")

# Plausible limits for a standing broad jump
MIN_FLIGHT_S, MAX_FLIGHT_S = 0.15, 1.0
MAX_LAUNCH_ANGLE_DEG = 65.0       # steeper than this: not a broad jump seen side-on
MAX_SIZE_CHANGE = 0.15            # apparent body size change before vs after the jump
MIN_VISIBILITY = 0.5              # MediaPipe's own confidence that a landmark is visible
MAX_LOW_VIS_FRACTION = 0.10


def warning(code, message, severity=CAUTION, affects=ALL, headline=None):
    w = {"code": code, "message": message, "severity": severity, "affects": list(affects)}
    if headline:
        w["headline"] = headline
    return w


def as_warning(w):
    """Accept old results files, where warnings were plain strings."""
    return w if isinstance(w, dict) else warning("unknown", str(w))


def check_jump_inside_window(takeoff_i, landing_i, lo, hi, fps):
    """Errors if the flight isn't fully inside [lo, hi); a warning if there's barely any
    footage after landing (the landing heel position needs ~0.1 s)."""
    if takeoff_i <= lo:
        raise NoJumpFound("Takeoff is at the very start of the clip/window, so the clip "
                          "probably starts mid-jump. Include the standing start.")
    if landing_i >= hi - 1:
        raise NoJumpFound("No landing was found before the end of the clip/window. Either "
                          "the clip ends mid-air, or the floor sits at a different height in "
                          "the image where the athlete lands (is the camera level?).")
    need = max(2, int(0.1 * fps))
    if hi - landing_i < need:
        return [warning("short_after_landing",
                        f"Only {hi - landing_i} frames after landing; the landing heel "
                        "position needs about 0.1 s of footage.", CAUTION, ("distance",))]
    return []


def check_flight_time(flight_time):
    if MIN_FLIGHT_S <= flight_time <= MAX_FLIGHT_S:
        return []
    return [warning("flight_time_implausible",
                    f"Flight time {flight_time:.3f} s is outside the plausible "
                    f"{MIN_FLIGHT_S}-{MAX_FLIGHT_S} s for a broad jump. Takeoff/landing were "
                    "probably mis-detected (tracking glitch?). Check the events plot.", SERIOUS)]


def check_missing_frames(detected, onset_i, takeoff_i, landing_i, hi, fps):
    """Frames with no person detected inside the jump were filled by interpolation."""
    end = min(hi, landing_i + max(2, int(0.1 * fps)))
    missing = int((~detected[onset_i:end]).sum())
    if missing == 0:
        return []
    in_flight = int((~detected[takeoff_i:landing_i]).sum())
    if in_flight:
        return [warning("missing_in_jump",
                        f"The person wasn't detected in {in_flight} frames during the flight "
                        f"({missing} in the whole jump); those positions were filled in by "
                        "straight-line interpolation, which bends the parabola fit.", SERIOUS)]
    return [warning("missing_in_jump",
                    f"The person wasn't detected in {missing} frames during the jump; those "
                    "positions were filled in by interpolation.", CAUTION)]


def check_landmarks(kp, landmarks, a, b):
    """Low MediaPipe visibility or positions outside the frame, for the landmarks the
    analysis uses, over frames a..b. `landmarks` is a list of (side, name)."""
    out, low, off = [], [], []
    for side, name in landmarks:
        x, y, v = kp.part(side, name)
        x, y, v = x[a:b], y[a:b], v[a:b]
        ok = ~np.isnan(x)
        if not ok.any():
            continue
        if np.mean(v[ok] < MIN_VISIBILITY) > MAX_LOW_VIS_FRACTION:
            low.append(f"{side.lower()} {name.lower()}")
        if np.any((x[ok] < 0) | (x[ok] >= kp.width) | (y[ok] < 0) | (y[ok] >= kp.height)):
            off.append(f"{side.lower()} {name.lower()}")
    if low:
        out.append(warning("low_confidence_landmarks",
                           "MediaPipe had low confidence (visibility < 0.5) in more than 10% "
                           f"of the jump for: {', '.join(low)}. Positions there are guesses.",
                           CAUTION))
    if off:
        out.append(warning("offframe_landmarks",
                           f"These landmarks left the frame during the jump: {', '.join(off)}. "
                           "Keep the whole body in view.", SERIOUS))
    return out



# Other people in the shot (pose_tracking.find_other_person, ~10 checks a second). On our 15 test
# videos: the 3 with someone walking behind the jumper had 9-18 hits around the jump; the false
# hits (a building corner, a speck on a path) were in 2 checks or under 15% of the athlete's height.
OTHER_MIN_HEIGHT = 0.30       # x the athlete's height: anything smaller is far away or not a person
OTHER_MIN_HITS = 3            # checks that must find them around the jump
OTHER_NEAR = 0.25             # gap to the athlete's box, x their height, that counts as right by them
OTHER_CROSS_S = 1.5           # longest gap between sightings for a side switch to count as passing by


def others_window(onset_i, landing_i, fps, n_frames):
    """The frames checked for other people: 0.5 s before the dip to 1 s after landing."""
    return max(0, onset_i - int(0.5 * fps)), min(n_frames - 1, landing_i + int(1.0 * fps))


def check_other_people(others, xyv, onset_i, landing_i, fps):
    """Warn when someone else is in the shot around the jump: SERIOUS if they come right next to,
    behind or in front of the jumper between the dip and just after landing (MediaPipe follows one
    person and can mix the two up), CAUTION if they stay clear.

    The athlete is covered while looking for others, so someone passing right behind them goes
    unseen for those frames. That shows up as the person switching sides between two sightings,
    which counts as passing by the jumper over that stretch."""
    if others is None:
        return []
    others = np.asarray(others, dtype=float)
    lo, last = others_window(onset_i, landing_i, fps, len(xyv))
    close_lo, close_hi = onset_i - int(0.2 * fps), landing_i + int(0.5 * fps)   # when it matters
    hits = []                                       # (frame, gap x athlete height, side of the athlete)
    for i in range(lo, last + 1):
        o = others[i]                               # zeros: checked, nobody (fails the height test)
        ok = ~np.isnan(xyv[i, :, 0])
        if not np.all(np.isfinite(o)) or ok.sum() < 5:
            continue
        (ax0, ay0), (ax1, ay1) = xyv[i, ok, :2].min(0), xyv[i, ok, :2].max(0)
        tall = ay1 - ay0
        if tall <= 0 or (o[3] - o[1]) < OTHER_MIN_HEIGHT * tall:
            continue
        gap = max(o[0] - ax1, ax0 - o[2], o[1] - ay1, ay0 - o[3], 0.0) / tall      # 0 when overlapping
        hits.append((i, gap, np.sign((o[0] + o[2]) - (ax0 + ax1))))
    if len(hits) < OTHER_MIN_HITS:
        return []
    near = [(i, i) for i, g, _ in hits if g < OTHER_NEAR and close_lo <= i <= close_hi]
    near += [(a[0], b[0]) for a, b in zip(hits, hits[1:])                     # switched sides unseen
             if a[2] * b[2] < 0 and b[0] - a[0] <= OTHER_CROSS_S * fps and a[0] <= close_hi and b[0] >= close_lo]
    when = lambda a, b: f"{a / fps:.1f} s" if a == b else f"{a / fps:.1f}-{b / fps:.1f} s"     # noqa: E731
    if near:
        a, b = min(f for f, _ in near), max(f for _, f in near)
        return [warning("person_near_athlete",
                        f"Another person was in {len(hits)} of the frames checked around the jump, and "
                        f"right next to, behind or in front of the jumper at {when(a, b)} (frames {a}-{b}). "
                        "MediaPipe follows one person and can mix the two up, so every result is less "
                        "certain. Check the skeleton video.", SERIOUS)]
    return [warning("person_in_shot",
                    f"Another person was in {len(hits)} of the frames checked around the jump (frames "
                    f"{hits[0][0]}-{hits[-1][0]}) but never close to the jumper (nearest gap "
                    f"{min(g for _, g, _ in hits):.1f}x their height), so the numbers are probably fine. "
                    "Check the skeleton video.", CAUTION)]


# Athlete sharpness (pose_tracking.athlete_sharpness) during the jump. On our 14 real clips the athlete
# scores 780-4400 in flight; blurred copies of the same frames (Gaussian sigma 4 px) score 20-310.
BLURRY_BELOW = 250            # clearly blurred: the tracker is guessing
SOFT_BELOW = 500              # softer than any of our good clips


def check_blur(sharpness, onset_i, landing_i, hi, fps):
    """Warn when the athlete looks blurred during the jump (motion blur, focus, low light)."""
    if sharpness is None:
        return []
    end = min(hi, landing_i + max(2, int(0.1 * fps)))
    s = np.asarray(sharpness, dtype=float)[onset_i:end]
    s = s[np.isfinite(s)]
    if s.size < 3:
        return []
    level = float(np.median(s))
    if level >= SOFT_BELOW:
        return []
    severe = level < BLURRY_BELOW
    return [warning("blurry_video",
                    f"The athlete looks {'blurred' if severe else 'soft'} during the jump (sharpness "
                    f"{level:.0f}; sharp footage scores 800 or more), so the tracker had to guess body "
                    "positions and every number is less certain.",
                    SERIOUS if severe else CAUTION)]


def check_standing_start(hip_y_window, onset_rel, depth_px, fps):
    """Movement onset and contact time assume the window starts with the athlete still."""
    n = max(3, int(0.3 * fps))
    moving = depth_px > 0 and np.ptp(hip_y_window[:n]) > 0.25 * depth_px
    if moving or onset_rel < n:
        return [warning("moving_start",
                        "The clip/window doesn't start with the athlete standing still, so "
                        "movement onset and ground contact time are unreliable. Start "
                        "recording (or --start) at least 0.3 s before the dip.",
                        CAUTION, ("timing",))]
    return []


def check_distance(distance_px, shin_px):
    if distance_px <= 0:
        return [warning("distance_implausible",
                        "Jump distance came out zero or negative: the landing heel is not "
                        "ahead of the takeoff toe. The jump may not be side-on, or the "
                        "events are wrong.", SERIOUS, ("distance",))]
    if shin_px > 0 and distance_px < shin_px:
        return [warning("distance_implausible",
                        "Jump distance is shorter than one shin length, which is implausible "
                        "for a broad jump. Check the events plot and the skeleton video.",
                        CAUTION, ("distance",))]
    return []


def check_stagger(both, m_per_px):
    """Flag staggered feet: the two heels at landing or the two toes at takeoff more than 5 cm
    apart (10% of trunk length uncalibrated). Uses the gap between the feet, so it fires even
    when the far foot is too hidden to measure exactly.

    Why SERIOUS: in the tape check of October 2026 (6 jumps), the staggered jumps' distances were
    off by 1.5-4.8 in, too long or too short, while the feet-together jump was within 0.3 in.
    The both-feet ("official rule") correction was further off (4.4-5.9 in), so it is still
    reported but no longer suggested as the better number."""
    gap = both.get("stagger_px")
    if gap is None or gap <= both["warn_above_px"]:
        return []
    fmt = (lambda px: f"{100 * px * m_per_px:.0f} cm") if m_per_px else (lambda px: f"{px:.0f} px")
    parts = []
    for key, where in (("stagger_heel_px", "the heels were {} apart at landing"),
                       ("stagger_toe_px", "the toes were {} apart at takeoff")):
        if both.get(key) is not None and both[key] > both["warn_above_px"]:
            parts.append(where.format(fmt(both[key])))
    return [warning("staggered_feet",
                    f"The feet look staggered: {' and '.join(parts)}. One camera can't see the far "
                    "foot well enough to measure a staggered jump: on tape-checked jumps the distance "
                    "was off by up to about 5 in (12 cm), too long or too short, while feet-together "
                    "jumps were within about 1 in. Treat this distance as approximate, and jump with "
                    "the feet side by side for an accurate result.",
                    SERIOUS, ("distance",),
                    headline="Feet staggered: distance is approximate (could be off by ~5 in)")]



# Fouls: a broad jump only counts if the landing is held. Thresholds from one example of each foul
# (IMG_6233, Oct 2026; 22 valid landings for comparison), so provisional. In standing heights of the
# jumper (the visible body, just before the dip):
STEP_AHEAD = 0.22      # a foot lands this far ahead of the front foot's landing spot within 1 s
                       #   (stumbled forward: 0.30; valid landings at most 0.15)
STEP_BEHIND = 0.20     # ...or behind the rear foot's within 1.5 s, which moves the mark back
                       #   (stepped back: 0.33; valid at most 0.07)
HAND_FLOOR = 0.04      # a hand this close to the floor (the lowest foot point at landing)...
HAND_DOWN_S = 0.25     # ...for this long, moving less than HAND_STILL: put down, not swung past
HAND_STILL = 0.10      #   (hands on the ground: 0.58 s, moved 0.03; valid at most 0.15 s, swinging)
FEET = {"left": (27, 29, 31), "right": (28, 30, 32)}        # ankle, heel, toe
HANDS = (15, 16, 17, 18, 19, 20)                              # wrists, little fingers, index fingers


def _standing_height(xyv, onset_i, fps):
    vis = xyv[:, :, 2] > 0.5
    spans = [np.ptp(xyv[i, vis[i], 1]) for i in range(max(0, onset_i - int(0.6 * fps)), onset_i) if vis[i].sum() >= 8]
    return float(np.median(spans)) if spans else None


def check_landing(xyv, direction, onset_i, landing_i, hi, fps):
    """Fouls after landing: a step forward past the front foot, a step back behind the rear foot,
    or a hand put down on the ground. Bringing the back foot up to the front one is fine. Each foul
    is a warning dict with severity FOUL and the frame it happened at."""
    with warnings.catch_warnings():                 # frames with nobody tracked are all-NaN: fine
        warnings.simplefilter("ignore", RuntimeWarning)
        return _landing_fouls(xyv, direction, onset_i, landing_i, hi, fps)


def _landing_fouls(xyv, direction, onset_i, landing_i, hi, fps):
    tall = _standing_height(xyv, onset_i, fps)
    settle = landing_i + max(1, int(0.1 * fps))
    if not tall or settle + 3 >= hi:
        return []
    xy = xyv[:, :, :2]
    pos = {side: direction * np.nanmean(xy[:, idx, 0], axis=1) for side, idx in FEET.items()}   # + = jump direction
    land = {side: np.nanmedian(p[landing_i:settle]) for side, p in pos.items()}
    if not all(np.isfinite(v) for v in land.values()):
        return []
    front, rear = max(land.values()), min(land.values())
    fouls = []
    ahead_end, behind_end = min(hi, landing_i + int(1.0 * fps)), min(hi, landing_i + int(1.5 * fps))
    ahead = np.nanmax([p[settle:ahead_end] for p in pos.values()], axis=0) - front
    behind = np.nanmin([p[settle:behind_end] for p in pos.values()], axis=0) - rear
    if np.nanmax(ahead) > STEP_AHEAD * tall:
        i = settle + int(np.nanargmax(ahead > STEP_AHEAD * tall))
        fouls.append(warning("foul_step_forward",
                             f"A foot came down {100 * np.nanmax(ahead) / tall:.0f}% of the jumper's height ahead of "
                             f"where the front foot landed, {(i - landing_i) / fps:.1f} s after landing (frame {i}): "
                             "the landing wasn't held.", FOUL, ("distance",)))
        fouls[-1]["frame"] = int(i)
    if np.nanmin(behind) < -STEP_BEHIND * tall:
        i = settle + int(np.nanargmax(behind < -STEP_BEHIND * tall))
        fouls.append(warning("foul_step_back",
                             f"A foot moved {100 * -np.nanmin(behind) / tall:.0f}% of the jumper's height behind where "
                             f"the rear foot landed, {(i - landing_i) / fps:.1f} s after landing (frame {i}). The mark "
                             "is the rearmost point, so the measured distance would be shorter.", FOUL, ("distance",)))
        fouls[-1]["frame"] = int(i)
    floor = np.nanmax(xy[landing_i:settle, [29, 30, 31, 32], 1])
    hand_y, hand_x = xy[landing_i:behind_end, HANDS, 1], xy[landing_i:behind_end, HANDS, 0]
    if np.isfinite(floor) and np.isfinite(hand_y).any():
        low = np.nanmax(np.where(np.isnan(hand_y), -np.inf, hand_y), axis=1)
        down = low >= floor - HAND_FLOOR * tall
        need = max(2, int(HAND_DOWN_S * fps))
        start = run = 0
        for k, d in enumerate(down):
            run = run + 1 if d else 0
            if run >= need:
                start = k - run + 1
                seg = range(start, k + 1)
                j = [int(np.nanargmax(hand_y[m])) for m in seg]
                pts = np.array([[hand_x[m, jj], hand_y[m, jj]] for m, jj in zip(seg, j)])
                if np.nanmax(np.hypot(*(pts - pts[0]).T)) < HAND_STILL * tall:
                    i = landing_i + start
                    fouls.append(warning("foul_hand_down",
                                         f"A hand was on the ground for at least {HAND_DOWN_S:.2f} s, from "
                                         f"{(i - landing_i) / fps:.1f} s after landing (frame {i}).", FOUL, ("distance",)))
                    fouls[-1]["frame"] = int(i)
                    break
    return fouls

def check_side_on(launch_angle_deg, size_before_px, size_after_px):
    """Broad jumps filmed side-on launch well below vertical, and the athlete's apparent
    size doesn't change (no movement toward/away from the camera)."""
    out = []
    if launch_angle_deg is not None and launch_angle_deg > MAX_LAUNCH_ANGLE_DEG:
        out.append(warning("not_side_on",
                           f"Launch angle {launch_angle_deg:.0f}° is steeper than "
                           f"{MAX_LAUNCH_ANGLE_DEG:.0f}°: the jump looks mostly vertical in the "
                           "image. Was it filmed side-on, perpendicular to the jump?", SERIOUS))
    if size_before_px and size_after_px:
        change = size_after_px / size_before_px - 1
        if abs(change) > MAX_SIZE_CHANGE:
            out.append(warning("not_side_on",
                               f"The athlete's apparent size changed by {100 * change:+.0f}% "
                               "between standing before and after the jump, so they moved "
                               "toward/away from the camera. Distances assume the jump is "
                               "across the frame.", SERIOUS))
    return out


def measured_fps(frame_times):
    """Frame rate from the frames' own timestamps (median spacing), or None if unknown.
    Phone files can carry a wrong rate in the header (one 120 fps clip said 116.55)."""
    if frame_times is None or len(frame_times) < 10:
        return None
    gap = float(np.median(np.diff(np.asarray(frame_times, dtype=float))))
    return 1.0 / gap if gap > 0 else None


SLOW_MOTION_FACTORS = (2, 4, 8)        # 60, 120, 240 fps footage saved for 30 fps playback


def check_slow_motion(flight_time, fps, g_m_s2=None):
    """Slow-motion saved for slowed-down playback looks like an ordinary video in which
    everything happens k times too slowly: flight lasts k times longer and g comes out k^2
    times too small. Nothing in the file says so, so look for that physics signature."""
    from .physics import G

    candidates = []
    if g_m_s2 is not None and g_m_s2 > 0:
        est = (G / g_m_s2) ** 0.5
        candidates = [k for k in SLOW_MOTION_FACTORS if abs(est / k - 1) < 0.2]
        evidence = f"g came out {g_m_s2:.2f} m/s² instead of 9.81"
    elif flight_time > MAX_FLIGHT_S:
        candidates = [k for k in SLOW_MOTION_FACTORS if 0.25 <= flight_time / k <= 0.7]
        evidence = f"the flight lasted {flight_time:.2f} s"
    if not candidates:
        return []
    k = candidates[0]
    return [warning("slow_motion_suspected",
                    f"This looks like a slow-motion video saved for slowed-down playback: "
                    f"{evidence}, as if everything happened {k}x too slowly. The real frame rate "
                    f"is probably {fps * k:.0f} fps, not {fps:.0f}. Transfer the original (AirDrop "
                    f"with 'All Photos Data' on, or 'Export Unmodified Original'), or re-run with "
                    f"--fps {fps * k:.0f}.", SERIOUS)]


def check_frame_timing(frame_times, fps):
    """Time is computed as frame / fps, which assumes evenly spaced frames. Timestamps in
    video files are rounded (a 120 fps file shows 7.9-8.8 ms gaps), so compare the real
    timestamps with frame / fps and only warn if they drift apart by over half a frame."""
    if frame_times is None or len(frame_times) < 3:
        return []
    t = np.asarray(frame_times, dtype=float)
    drift = np.abs((t - t[0]) - np.arange(len(t)) / fps)
    if drift.max() > 0.5 / fps:
        i = int(np.argmax(drift))
        return [warning("variable_frame_rate",
                        f"Frame timestamps drift up to {1000 * drift.max():.0f} ms from "
                        f"frame / fps (worst at frame {i}), so this may be a variable-frame-rate "
                        "video. All times assume evenly spaced frames.",
                        CAUTION, ("timing", "trajectory"))]
    return []


# ---------------------------------------------------------------- limb snapping
# A landmark that leaps away from where its neighboring frames put it, then comes back, is
# usually MediaPipe briefly attaching that limb to something else - often another person
# standing behind the jumper. Measured as a fraction of trunk length, so it doesn't depend
# on resolution. Thresholds were set from real footage (provisional: one confirmed snap):
#   clean clips: one-frame excursion <= 23%, two-frame <= 30% of trunk length
#   bystander clips: 35-79%
SNAP_LANDMARKS = ("HIP", "SHOULDER", "KNEE", "ANKLE", "HEEL", "FOOT_INDEX")
SNAP_ONE_FRAME = 0.30
SNAP_TWO_FRAME = 0.40


def limb_snap_frames(kp, side):
    """{frame: [landmark names]} for frames where a near-side landmark snaps away.
    One-frame test: distance from the midpoint of the previous and next frames.
    Two-frame test: both middle frames of a 4-frame window, against the straight line
    between its two end frames (catches a limb that stays snapped for two frames)."""
    from .pose_tracking import LANDMARKS

    idx = LANDMARKS[side]
    xy = kp.xyv[:, :, :2]
    trunk = np.nanmedian(np.hypot(*(xy[:, idx["HIP"]] - xy[:, idx["SHOULDER"]]).T))
    flagged = {}
    if not np.isfinite(trunk) or trunk <= 0 or kp.n_frames < 4:
        return flagged
    for name in SNAP_LANDMARKS:
        p = xy[:, idx[name]]
        with np.errstate(invalid="ignore"):
            one = np.hypot(*(p[1:-1] - (p[:-2] + p[2:]) / 2).T) / trunk          # frame t = 1..n-2
            a, b = p[:-3], p[3:]                                                  # window t-1 .. t+2
            first = np.hypot(*(p[1:-2] - (a + (b - a) / 3)).T) / trunk            # frame t
            second = np.hypot(*(p[2:-1] - (a + 2 * (b - a) / 3)).T) / trunk       # frame t+1
            hits = set((np.flatnonzero(one > SNAP_ONE_FRAME) + 1).tolist())
            hits |= set((np.flatnonzero(first > SNAP_TWO_FRAME) + 1).tolist())
            hits |= set((np.flatnonzero(second > SNAP_TWO_FRAME) + 2).tolist())
        for f in hits:
            flagged.setdefault(int(f), []).append(name.lower().replace("foot_index", "toe"))
    return dict(sorted(flagged.items()))


def check_limb_snaps(snaps, onset_i, takeoff_i, landing_i, hi, fps):
    """Warn about snaps inside the jump. Warn only: the data is NOT changed (repairing it
    automatically waits until the thresholds are validated on more real videos)."""
    end = min(hi, landing_i + max(2, int(0.1 * fps)))
    inside = {f: n for f, n in snaps.items() if onset_i <= f < end}
    if not inside:
        return []
    margin = max(1, int(0.1 * fps))
    near_events = [f for f in inside if takeoff_i - margin <= f <= landing_i + margin]
    parts = sorted({n for names in inside.values() for n in names})
    frames = sorted(inside)
    msg = (f"MediaPipe briefly put the {', '.join(parts)} far from where the neighboring "
           f"frames had them, at frame(s) {', '.join(map(str, frames[:8]))}"
           f"{' ...' if len(frames) > 8 else ''}. This is usually a limb snapping onto "
           "something else, often another person behind the jumper. Results near those "
           "frames may be off; check the skeleton video. (The data was not changed.)")
    severity = SERIOUS if near_events else CAUTION
    return [warning("limb_snap", msg, severity)]

