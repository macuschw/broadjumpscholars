"""Results for the website, and the analysis service behind its upload.

A *bundle* is one JSON file holding everything the website shows for a real jump:
  results    the saved results (as in _results.json), with local file paths removed
  ratings    the summary's five category ratings (summary.ratings)
  warnings   each with its short headline (alerts.headline)
  series     per-frame curves for the charts (hip, toe, heel, angles), image pixels with y up
  landmarks  all 33 MediaPipe points per frame (x, y in image pixels with y DOWN, visibility) and
             each frame's timestamp in the file, for drawing the skeleton over the video
  still      (uploads only) one frame from before the jump, for clicking the tape to calibrate
The website converts pixels to meters with the bundle's own scale, so every number it shows is the
one the Python summary prints.

The same functions serve the site's upload, on a laptop (scripts/serve_local.py) or in the cloud
(server/modal_app.py): analyze_upload() tracks a video and analyzes it; recompute() analyzes saved
landmarks again, e.g. with a scale once the visitor has clicked the tape. Neither keeps anything.
"""
from __future__ import annotations

import base64
import csv
from dataclasses import replace
import glob
import json
import math
import os
from typing import Optional

import numpy as np

from . import alerts, summary
from .checks import as_warning
from .origins import ALLOWED_ORIGINS  # noqa: F401  (scripts/serve_local.py reads it from here)
from .pipeline import AnalysisConfig, analyze_keypoints, look_for_others
from .pose_tracking import N_LANDMARKS, Keypoints

FORMAT = "jumplab-web/1"
SERIES_KEYS = ("time_s", "hip_x_px", "hip_y_px_up", "toe_x_px", "toe_y_px_up", "heel_x_px", "heel_y_px_up",
               "trunk_angle_deg", "shin_angle_deg", "knee_angle_deg", "hip_angle_deg")
EVENT_METHODS = ("ankle", "toe_heel")


def _num(v, digits):
    """A float rounded for JSON, or None for NaN/inf (JSON has no NaN)."""
    v = float(v)
    return round(v, digits) if math.isfinite(v) else None


def _jsonable(v):
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if isinstance(v, np.ndarray):
        return [_jsonable(x) for x in v.tolist()]
    if isinstance(v, (np.floating, float)):
        return _num(v, 6)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def make_bundle(results, keypoints: Keypoints, name: Optional[str] = None, still=None):
    """The website bundle for one analysis. `results` is the dict from pipeline.analyze_* (with
    its "series"), or a loaded _results.json with "series" added (see bundle_from_files)."""
    name = name or os.path.basename(str(results.get("video") or "")) or "jump"
    saved = _jsonable({k: v for k, v in results.items() if k not in ("series", "files") and not k.startswith("_")})
    saved["video"] = name                                     # no local paths in a file meant for sharing
    s = results["series"]
    xyv = np.asarray(keypoints.xyv, dtype=float)
    # One jump of a longer video keeps only its own stretch: every per-frame list below (series,
    # landmarks.xyv / frame_times / sharpness) starts at frame landmarks.offset, not 0
    first, last = keypoints.segment if keypoints.segment else (0, xyv.shape[0] - 1)
    keep = slice(int(first), int(last) + 1)
    series = {k: [_num(v, 3 if k == "time_s" else 2) for v in np.asarray(s[k], dtype=float)[keep]] for k in SERIES_KEYS if k in s}
    frames = [None if np.isnan(row[:, 0]).all() else [_num(v, 2 if (j % 3) == 2 else 1) for j, v in enumerate(row.reshape(-1))]
              for row in xyv[keep]]                              # None: nobody found, or not tracked
    times = None if keypoints.frame_times is None else np.asarray(keypoints.frame_times)[keep]
    bundle = {
        "format": FORMAT,
        "name": name,
        "results": saved,
        "ratings": summary.ratings(saved),
        "warnings": [{**as_warning(w), **alerts.plain(w)} for w in saved.get("warnings", [])],
        # Does the attempt count? (checks.check_landing: stepped forward / back, hand on the ground)
        "valid": bool(saved.get("valid", True)),
        "fouls": [{**f, **alerts.plain(f)} for f in saved.get("fouls", [])],
        "series": series,
        "landmarks": {
            "fps": float(keypoints.fps), "width": int(keypoints.width), "height": int(keypoints.height),
            "n_frames": int(xyv.shape[0]), "per_frame": N_LANDMARKS * 3,
            "frame_times": None if times is None or not len(times) else [_num(t, 4) for t in times],
            "sharpness": None if keypoints.sharpness is None else [_num(v, 0) for v in np.asarray(keypoints.sharpness)[keep]],
            # Other people found in the shot: {frame: [x0, y0, x1, y1]}, {} if nobody, None if not checked
            "others": None if keypoints.others is None else {
                str(i): [_num(v, 0) for v in box] for i, box in enumerate(np.asarray(keypoints.others, dtype=float))
                if np.all(np.isfinite(box)) and box[2] > box[0] and box[3] > box[1]},
            "segment": None if keypoints.segment is None else [int(v) for v in keypoints.segment],
            "offset": int(first),
            "xyv": frames,
        },
    }
    if still:
        bundle["still"] = still
    return bundle


def keypoints_from_bundle(landmarks, name="jump"):
    """Rebuild Keypoints from a bundle's "landmarks" (to analyze them again)."""
    n, offset = int(landmarks["n_frames"]), int(landmarks.get("offset") or 0)
    empty = [np.nan, np.nan, 0.0] * N_LANDMARKS
    rows = landmarks["xyv"]
    if offset < 0 or offset + len(rows) > n:
        raise ValueError(f"Expected at most {n} frames from frame {offset}, got {len(rows)}.")
    flat = np.array([empty] * n, dtype=float)
    if rows:
        part = np.array([empty if row is None else [np.nan if v is None else v for v in row] for row in rows], dtype=float)
        if part.shape[1:] != (N_LANDMARKS * 3,):
            raise ValueError(f"Expected {N_LANDMARKS * 3} values per frame, got {part.shape[1:]}.")
        flat[offset:offset + len(rows)] = part
    times, sharp = landmarks.get("frame_times"), landmarks.get("sharpness")

    def as_array(xs):                                          # a per-frame list, back to every frame
        if not xs:
            return None
        out = np.full(n, np.nan)
        out[offset:offset + len(xs)] = [np.nan if v is None else v for v in xs]
        return out
    others = None
    if landmarks.get("others") is not None:
        others = np.full((n, 4), np.nan)
        for i, box in landmarks["others"].items():
            if 0 <= int(i) < n:
                others[int(i)] = box
    segment = tuple(int(v) for v in landmarks["segment"]) if landmarks.get("segment") else None
    return Keypoints(flat.reshape(n, N_LANDMARKS, 3), float(landmarks["fps"]), int(landmarks["width"]),
                     int(landmarks["height"]), name, {}, as_array(times), as_array(sharp), others, segment)


def _config(event_method):
    if event_method not in EVENT_METHODS:
        raise ValueError(f"event_method must be one of {EVENT_METHODS}")
    return AnalysisConfig(event_method=event_method)


def _check_options(fps, scale):
    if scale is not None and not (0 < scale < 1):
        raise ValueError("scale (meters per pixel) must be between 0 and 1.")
    if fps is not None and not (1 <= fps <= 1000):
        raise ValueError("fps must be between 1 and 1000.")


def analyze_tracked(kp: Keypoints, name, fps=None, scale=None, event_method="ankle", still=None):
    """Analyze tracked keypoints (the same analyze_keypoints the command line uses) -> bundle."""
    _check_options(fps, scale)
    results = analyze_keypoints(kp, scale, _config(event_method), fps_override=fps)
    return make_bundle(results, kp, name, still)


def still_frame(video_path, frame_index, max_width=1600, quality=85):
    """One frame as a JPEG (base64) for the calibration clicks, and how it maps back to full size."""
    import cv2

    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(frame_index)))
    ok, frame = cap.read()
    cap.release()
    if not ok:
        return None
    h, w = frame.shape[:2]
    k = min(1.0, max_width / w)
    if k < 1:
        frame = cv2.resize(frame, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
    ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return {"frame": int(frame_index), "width": int(frame.shape[1]), "height": int(frame.shape[0]),
            "full_width": int(w), "full_height": int(h), "jpeg": base64.b64encode(jpg.tobytes()).decode("ascii")} if ok else None


SESSION_FORMAT = "jumplab-session/1"


def track_upload(video_path, fps=None, progress=None):
    """MediaPipe for an upload. Clips over 6.5 s: a quick look finds every jump and only the 4-5 s
    around each one are tracked (pose_tracking.find_jumps, track_segments), so standing around
    between jumps costs little. Shorter clips, or when the quick look finds nothing, are tracked
    whole. Returns (keypoints, segments, trimmed)."""
    import cv2

    from .pose_tracking import MIN_CLIP_TO_TRIM_S, find_jumps, jumps_in_keypoints, open_video, track_segments, track_video

    say = progress or (lambda *a: None)
    cap, file_fps, _, _ = open_video(video_path)
    seconds = cap.get(cv2.CAP_PROP_FRAME_COUNT) / (fps or file_fps)
    cap.release()
    if seconds >= MIN_CLIP_TO_TRIM_S:
        say("looking", 0, 1)
        times, segments = find_jumps(video_path, fps, progress=lambda i, n: say("looking", i, n))
        if segments:
            kp = track_segments(video_path, segments, times, progress=lambda i, n: say("tracking", i, n))
            return kp, segments, True
    say("tracking", 0, 1)
    kp = track_video(video_path)
    return kp, jumps_in_keypoints(kp, fps) or [(0, kp.n_frames - 1)], False


def analyze_session_upload(video_path, name, fps=None, scale=None, event_method="ankle", progress=None):
    """A visitor's video, with one jump or several -> session: {"format", "name", "jumps": [bundle,
    ...] in time order (each with its verdict: "valid", "fouls"), "skipped" (stretches that held no
    measurable jump), "best" (the longest jump that counts: its number), "still" (a frame from
    before the first jump, for calibrating)}. progress(stage, done, total) with stage "looking",
    "tracking" or "analyzing". Raises NoJumpFound / ValueError with a message meant for the visitor."""
    from .events import NoJumpFound
    from .pose_tracking import jumps_in_keypoints, track_video
    from .session import analyze_session, best_valid

    _check_options(fps, scale)
    config, say = _config(event_method), progress or (lambda *a: None)
    kp, segments, trimmed = track_upload(video_path, fps, say)
    kp = replace(kp, video_path=name)                          # keeps the frame times and sharpness
    run = lambda k, segs: analyze_session(k, segs, scale, config, fps, video_path,   # noqa: E731
                                          progress=lambda i, n: say("analyzing", i, n))
    jumps, skipped = run(kp, segments)
    if not jumps and trimmed:                                  # the quick look picked the wrong moments
        say("tracking", 0, 1)
        kp = replace(track_video(video_path), video_path=name)
        jumps, skipped = run(kp, jumps_in_keypoints(kp, fps) or [(0, kp.n_frames - 1)])
    if not jumps:
        raise NoJumpFound(skipped[0]["reason"] if skipped else "No jump was found in this video.")
    first = jumps[0][1]["events"]["movement_onset"]["frame"]
    return {"format": SESSION_FORMAT, "name": name,
            "jumps": [make_bundle(r, k, name) for k, r in jumps],
            "skipped": skipped, "best": best_valid(jumps),
            "still": still_frame(video_path, max(0, first - int(0.3 * kp.fps)))}


def analyze_upload(video_path, name, fps=None, scale=None, event_method="ankle"):
    """The older one-jump reply (for pages that haven't updated): the first jump's bundle with the
    still. New pages use analyze_session_upload, through a job (jumplab/jobs.py)."""
    session = analyze_session_upload(video_path, name, fps, scale, event_method)
    return {**session["jumps"][0], "still": session["still"]}


def recompute(payload):
    """Analyze a bundle's landmarks again (no video needed): {"landmarks", "name", "fps", "scale",
    "event_method", "still", "jump"} -> bundle. This is how a scale clicked on the still is applied.
    "jump": its number in the video it came from (a session), kept in the new results."""
    name = payload.get("name") or "jump"
    kp = keypoints_from_bundle(payload["landmarks"], name)
    _check_options(payload.get("fps"), payload.get("scale"))
    results = analyze_keypoints(kp, payload.get("scale"), _config(payload.get("event_method") or "ankle"),
                                fps_override=payload.get("fps"))
    if payload.get("jump"):
        results["jump"] = int(payload["jump"])
        results["segment"] = None if kp.segment is None else [int(v) for v in kp.segment]
    return make_bundle(results, kp, name, payload.get("still"))


# ---------------------------------------------------------------- bundles from earlier runs

def _read_series(csv_path):
    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise ValueError(f"{csv_path} has no rows")
    return {k: np.array([float(r[k]) for r in rows]) for k in rows[0] if k in SERIES_KEYS}


def bundle_from_files(results_json):
    """Bundle an earlier run from its saved files (no re-analysis): <stem>_results.json,
    <stem>_keypoints_and_angles.csv and <stem>_keypoints.npz in the same folder."""
    folder, base = os.path.split(results_json)
    stem = base[: -len("_results.json")]
    with open(results_json) as f:
        results = json.load(f)
    results["series"] = _read_series(os.path.join(folder, f"{stem}_keypoints_and_angles.csv"))
    kp = Keypoints.load(os.path.join(folder, f"{stem}_keypoints.npz"))
    return make_bundle(results, kp, os.path.basename(str(results.get("video") or stem)))


def find_results(target):
    """Every *_results.json in a folder (and its subfolders), or the one file given."""
    if os.path.isfile(target):
        return [target]
    return sorted(glob.glob(os.path.join(target, "**", "*_results.json"), recursive=True))


# ---------------------------------------------------------------- shared by both servers

MAX_UPLOAD_BYTES = 800 * 1024 * 1024


def options_from_query(q):
    """The upload's settings from the URL query: name, fps, scale, event_method (all optional)."""
    def number(key):
        v = q.get(key)
        return None if v in (None, "", "auto") else float(v)
    return {"name": os.path.basename(str(q.get("name") or "video.mp4"))[:120] or "video.mp4",
            "fps": number("fps"), "scale": number("scale"), "event_method": q.get("event_method") or "ankle"}


def handle(kind, video_path=None, payload=None, options=None):
    """Run one request -> (HTTP status, JSON-able body). Problems the visitor can fix come back as
    422 with a plain message; anything else is a 500 without internals."""
    from .events import NoJumpFound

    try:
        if kind == "analyze":
            return 200, analyze_upload(video_path, **options)
        if kind == "recompute":
            return 200, recompute(payload)
        return 404, {"error": "Unknown request."}
    except (NoJumpFound, ValueError, KeyError, TypeError) as e:
        return 422, {"error": visitor_message(e, about_video=kind == "analyze")}


# Why no jump was found, for the visitor: the analysis's own reasons are worded for us ("the
# clip/window", "check the tracking"), so each becomes what to change when filming.
NO_JUMP_HINTS = (
    ("start of the clip", "The video seems to start mid-jump: start filming before the jumper crouches."),
    ("end of the clip", "The video seems to end before the landing, or the phone isn't level: keep filming "
                        "until the jumper has landed, with the phone level."),
)
NO_JUMP_HINT = ("Check that the whole jump is in the picture, side-on, from the standing start to the landing, "
                "with nobody else in front of the camera.")


def no_jump_hint(reason):
    return next((hint for key, hint in NO_JUMP_HINTS if key in reason), NO_JUMP_HINT)


def visitor_message(e, about_video=True):
    """A problem the visitor can fix, in plain words. Our own checks ("... must be ...") are worded
    for the visitor; anything else from reading a video (which can mention server paths) becomes
    one plain message."""
    from .events import NoJumpFound

    if isinstance(e, NoJumpFound):
        return f"No complete jump was found in this video. {no_jump_hint(str(e))}"
    if "must be" in str(e) or (not about_video and not isinstance(e, TypeError)):
        return str(e)
    return "This video couldn't be read. Try the original MP4 or MOV straight from the phone."
