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

# Short headlines for warnings saved before warnings carried their own
HEADLINES = {
    "staggered_feet": "Feet staggered: distance is approximate",
}

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
