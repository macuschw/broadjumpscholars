"""Make problems impossible to miss in the terminal.

A warning at the bottom of a long report is easy to scroll past, so serious ones are repeated:
  * a banner at the top of the report and of the summary,
  * a marker beside the numbers they affect (e.g. the jump distance),
  * a one-line verdict at the very end of a run, the last thing on screen.
In a terminal that supports it the banner and verdict are coloured (red: serious, yellow:
use with care, green: fine). Saved text files never contain colour codes.
"""
from __future__ import annotations

import os
import sys
import textwrap

from .checks import CAUTION, SERIOUS, as_warning

WIDTH = 64

# Plain language for every warning: a headline, what happened, and how to film it better next time.
# The website shows these above the results; the full technical message stays available too.
PLAIN = {
    "staggered_feet": ("Feet staggered at landing",
                       "One foot landed behind the other. A single side-on camera can't see the far foot well, "
                       "so the distance can be off by up to about 5 inches (12 cm), too long or too short.",
                       "Land with the feet side by side, or treat this distance as approximate."),
    "person_near_athlete": ("Someone walked right behind the jumper",
                            "Another person was right next to or behind the jumper during the jump. The "
                            "tracker follows one person and can mix the two up, so the skeleton, and every "
                            "number from it, may be off.",
                            "Film with nobody else in the frame, especially behind the jumper."),
    "person_in_shot": ("Someone else is in the shot",
                       "Another person was in the video during the jump. They stayed clear of the jumper, "
                       "so the numbers are probably fine, but check the skeleton in Playback.",
                       "Film with nobody else in the frame."),
    "limb_snap": ("The tracking slipped",
                  "For a moment the skeleton jumped away from the jumper, usually onto another person "
                  "or something behind them, so it was wrong for those frames.",
                  "Film with nobody else in the frame and a plain background behind the jumper."),
    "blurry_video": ("The video is blurry",
                     "The athlete looks blurred during the jump, so the tracker had to guess where the body was.",
                     "Use bright, even light, keep the phone still on a tripod, lock focus with a long press, "
                     "and film in slow motion."),
    "low_confidence_landmarks": ("Some body parts were hard to see",
                                 "The tracker was unsure where some joints were (blur, low light, loose clothing "
                                 "or a limb hidden behind the body).",
                                 "Film side-on in good light with the whole body clearly visible."),
    "missing_in_jump": ("The athlete was lost for some frames",
                        "The tracker didn't find the athlete in some frames of the jump; those positions were filled in.",
                        "Keep the whole body in frame and well lit, with nothing passing in front."),
    "offframe_landmarks": ("Part of the body left the frame",
                           "Some of the body went out of the picture during the jump.",
                           "Move the phone back so takeoff to landing fits, with about 1 m to spare at each end."),
    "not_side_on": ("The camera wasn't side-on",
                    "The jump doesn't look side-on to the camera, which shrinks distances and skews angles.",
                    "Put the phone at 90° to the jump line, level with the middle of the jump."),
    "flight_time_implausible": ("Takeoff or landing wasn't found reliably",
                                "The time in the air doesn't look like a broad jump, so takeoff or landing was "
                                "probably detected at the wrong moment.",
                                "Use a clip with one clean jump, standing still before and after."),
    "distance_implausible": ("The distance doesn't look possible",
                             "The measured distance is too short to be a broad jump, so something went wrong "
                             "with the camera angle or the takeoff and landing.",
                             "Film side-on with the whole jump in view, and check the skeleton in playback."),
    "no_downward_curve": ("The flight path doesn't look right",
                          "The body's path in the air should curve downward like a thrown ball; this one doesn't, "
                          "so the tracking is off.",
                          "Film side-on with nobody else in the shot, and check the skeleton in playback."),
    "few_fit_points": ("Too few frames in the air",
                       "There were very few frames between takeoff and landing, so speeds and the launch angle are rough.",
                       "Film in slow motion (120-240 fps)."),
    "low_fps": ("Normal-speed video",
                "At 30 fps each moment is only known to about ±33 ms, so contact and flight times are rough.",
                "Film in slow motion (120-240 fps) for accurate timing."),
    "slow_motion_suspected": ("The frame rate looks wrong",
                              "The timing suggests the video's frame rate isn't what the file says (common with "
                              "slow-motion clips that were exported or shared).",
                              "Choose the real rate under “Recorded at”, or use the original file from the phone."),
    "variable_frame_rate": ("Uneven frame timing",
                            "The frames in this file aren't evenly spaced in time, so timings may be slightly off.",
                            "Use the original file straight from the phone."),
    "scale_mismatch": ("The scale looks off",
                       "The tape-measure scale and the one implied by gravity disagree, so distances and speeds "
                       "may be off.",
                       "Click exactly on the tape ends, check the length you entered, and keep the tape on the jump line."),
    "moving_start": ("The clip starts mid-movement",
                     "The recording doesn't start with the athlete standing still, so ground contact time is unreliable.",
                     "Start recording a second or two before the jump."),
    "short_after_landing": ("The clip ends right after landing",
                            "There's barely any video after landing, so the landing heel position is less certain.",
                            "Keep recording for a second after landing."),
    "event_search_capped": ("Takeoff or landing may be off by a frame",
                            "The takeoff or landing search hit its limit, so an event time may be slightly off.",
                            "Trim the clip so it holds just one jump."),
    "com_fallback": ("Centre of mass estimated from the hips",
                     "Not enough of the body was tracked to place the centre of mass, so the hips were used instead.",
                     "Keep the arms and head in the frame too."),
}
HEADLINES = {code: p[0] for code, p in PLAIN.items()}

_ANSI = {"red": "\033[1;31m", "yellow": "\033[1;33m", "green": "\033[1;32m", "reset": "\033[0m"}


def use_color(stream=None) -> bool:
    """Colour only for a real terminal, and never when NO_COLOR is set (https://no-color.org)."""
    stream = stream or sys.stdout
    if os.environ.get("NO_COLOR") or not getattr(stream, "isatty", lambda: False)():
        return False
    if os.name == "nt":
        os.system("")                    # switches the Windows console to understanding ANSI codes
    return True


def paint(text: str, colour: str, color: bool) -> str:
    return f"{_ANSI[colour]}{text}{_ANSI['reset']}" if color else text


def headline(w) -> str:
    """A few words saying what's wrong, e.g. 'Feet staggered: distance is approximate'."""
    w = as_warning(w)
    if w.get("headline"):
        return w["headline"]
    if w["code"] in HEADLINES:
        return HEADLINES[w["code"]]
    first = w["message"].split(". ")[0].rstrip(".")
    return first if len(first) <= 60 else first[:57] + "..."


def serious(warnings):
    return [w for w in map(as_warning, warnings or []) if w["severity"] == SERIOUS]


def banner(warnings, color: bool = False) -> str:
    """A boxed alert for every serious warning, or '' when there are none."""
    found = serious(warnings)
    if not found:
        return ""
    rule = "!" * WIDTH
    lines = [rule]
    for i, w in enumerate(found):
        if i:
            lines.append("!!")
        lines.append(f"!!  WARNING: {headline(w).upper()}")
        lines += textwrap.wrap(w["message"], WIDTH - 4, initial_indent="!!  ", subsequent_indent="!!  ")
        if w.get("affects"):
            lines.append(f"!!  Affects: {', '.join(w['affects'])}")
    lines.append(rule)
    return paint("\n".join(lines), "red", color)


def marker(warnings, category: str) -> str:
    """Text to put beside a number in `category`: loud for serious warnings, mild for caution."""
    ws = [w for w in map(as_warning, warnings or []) if category in w.get("affects", [])]
    if any(w["severity"] == SERIOUS for w in ws):
        return "   <-- APPROXIMATE, see WARNING"
    if any(w["severity"] == CAUTION for w in ws):
        return "   <-- use with care"
    return ""


def verdict(warnings, color: bool = False) -> str:
    """One line for the very end of a run: what, if anything, needs a second look."""
    ws = list(map(as_warning, warnings or []))
    bad = [w for w in ws if w["severity"] == SERIOUS]
    care = [w for w in ws if w["severity"] == CAUTION]
    if bad:
        what = "; ".join(headline(w) for w in bad)
        return paint(f"!! CHECK THIS JUMP: {what}. (Details in the WARNING box above.)", "red", color)
    if care:
        n = len(care)
        return paint(f"~  Usable with care: {n} warning{'s' if n > 1 else ''} (see Warnings above).", "yellow", color)
    return paint("OK: no problems found.", "green", color)


def plain(w) -> dict:
    """Plain-language version of a warning for the website: {"headline", "explain", "fix"}."""
    w = as_warning(w)
    if w["code"] in PLAIN:
        h, explain, fix = PLAIN[w["code"]]
        return {"headline": h, "explain": explain, "fix": fix}
    return {"headline": headline(w), "explain": w["message"], "fix": ""}
