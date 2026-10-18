"""Results for the website, and the analysis service behind its upload.

A *bundle* is one JSON file holding everything the website shows for a real jump:
  results    the saved results (as in _results.json), with local file paths removed
  ratings    the summary's five category ratings (summary.ratings)
  warnings   each with its short headline (alerts.headline)
  series     per-frame curves for the charts (hip, toe, heel, angles), image pixels with y up
  landmarks  all 33 MediaPipe points per frame (x, y in image pixels with y DOWN, visibility) and
             each frame's timestamp in the file, for drawing the skeleton over the video
  still      (uploads only) one frame from before the jump, for clicking the tape to calibrate
The website converts pixels to metres with the bundle's own scale, so every number it shows is the
one the Python summary prints.

The same functions serve the site's upload, on a laptop (scripts/serve_local.py) or in the cloud
(server/modal_app.py): analyze_upload() tracks a video and analyses it; recompute() analyses saved
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
    series = {k: [_num(v, 3 if k == "time_s" else 2) for v in np.asarray(s[k], dtype=float)] for k in SERIES_KEYS if k in s}
    xyv = np.asarray(keypoints.xyv, dtype=float)
    frames = [None if np.isnan(row[:, 0]).all() else [_num(v, 2 if (j % 3) == 2 else 1) for j, v in enumerate(row.reshape(-1))]
              for row in xyv]                                    # None: nobody found, or not tracked
    times = keypoints.frame_times
    bundle = {
        "format": FORMAT,
        "name": name,
        "results": saved,
        "ratings": summary.ratings(saved),
        "warnings": [{**as_warning(w), **alerts.plain(w)} for w in saved.get("warnings", [])],
        "series": series,
        "landmarks": {
            "fps": float(keypoints.fps), "width": int(keypoints.width), "height": int(keypoints.height),
            "n_frames": int(xyv.shape[0]), "per_frame": N_LANDMARKS * 3,
            "frame_times": None if times is None or not len(times) else [_num(t, 4) for t in times],
            "sharpness": None if keypoints.sharpness is None else [_num(v, 0) for v in keypoints.sharpness],
            # Other people found in the shot: {frame: [x0, y0, x1, y1]}, {} if nobody, None if not checked
            "others": None if keypoints.others is None else {
                str(i): [_num(v, 0) for v in box] for i, box in enumerate(np.asarray(keypoints.others, dtype=float))
                if np.all(np.isfinite(box)) and box[2] > box[0] and box[3] > box[1]},
            "segment": None if keypoints.segment is None else [int(v) for v in keypoints.segment],
            "xyv": frames,
        },
    }
    if still:
        bundle["still"] = still
    return bundle


def keypoints_from_bundle(landmarks, name="jump"):
    """Rebuild Keypoints from a bundle's "landmarks" (to analyse them again)."""
    n = int(landmarks["n_frames"])
    empty = [np.nan, np.nan, 0.0] * N_LANDMARKS
    flat = np.array([empty if row is None else [np.nan if v is None else v for v in row] for row in landmarks["xyv"]], dtype=float)
    if flat.shape != (n, N_LANDMARKS * 3):
        raise ValueError(f"Expected {n} frames of {N_LANDMARKS * 3} values, got {flat.shape}.")
    times, sharp = landmarks.get("frame_times"), landmarks.get("sharpness")
    as_array = lambda xs: None if not xs else np.array([np.nan if v is None else v for v in xs], dtype=float)   # noqa: E731
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


def analyze_tracked(kp: Keypoints, name, fps=None, scale=None, event_method="ankle", still=None):
    """Analyse tracked keypoints (the same analyze_keypoints the command line uses) -> bundle."""
    if scale is not None and not (0 < scale < 1):
        raise ValueError("scale (metres per pixel) must be between 0 and 1.")
    if fps is not None and not (1 <= fps <= 1000):
        raise ValueError("fps must be between 1 and 1000.")
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


def analyze_upload(video_path, name, fps=None, scale=None, event_method="ankle"):
    """A visitor's video: track it with MediaPipe, analyse it, and include a still from before the
    jump for calibrating. Raises NoJumpFound / ValueError with a message meant for the visitor.

    Clips over 6.5 s are trimmed automatically: a quick look finds the jump and only the 4-5 s around
    it are tracked (pose_tracking.track_jump), so standing around before and after costs little.
    If that stretch turns out not to hold the whole jump, the whole video is tracked instead."""
    from .events import NoJumpFound
    from .pose_tracking import track_jump, track_video

    kp = replace(track_jump(video_path, fps) or track_video(video_path), video_path=name)
    try:
        bundle = analyze_tracked(kp, name, fps, scale, event_method)
    except NoJumpFound:
        if kp.segment is None:
            raise
        kp = replace(track_video(video_path), video_path=name)    # the quick look picked the wrong moment
        bundle = analyze_tracked(kp, name, fps, scale, event_method)
    if look_for_others(video_path, kp, bundle["results"]):    # other people around the jump it found
        bundle = analyze_tracked(kp, name, fps, scale, event_method)
    onset = bundle["results"]["events"]["movement_onset"]["frame"]
    bundle["still"] = still_frame(video_path, max(0, onset - int(0.3 * kp.fps)))
    return bundle


def recompute(payload):
    """Analyse a bundle's landmarks again (no video needed): {"landmarks", "name", "fps", "scale",
    "event_method", "still"} -> bundle. This is how a scale clicked on the still is applied."""
    kp = keypoints_from_bundle(payload["landmarks"], payload.get("name") or "jump")
    return analyze_tracked(kp, payload.get("name") or "jump", payload.get("fps"), payload.get("scale"),
                           payload.get("event_method") or "ankle", payload.get("still"))


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
ALLOWED_ORIGINS = ("https://macuschw.github.io", "http://localhost:4321", "http://127.0.0.1:4321",
                   "http://localhost:8000", "http://127.0.0.1:8000")


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
    except NoJumpFound as e:
        return 422, {"error": f"No complete jump was found in this video. {e}"}
    except (ValueError, KeyError, TypeError) as e:
        # Our own checks ("... must be ...") are worded for the visitor; anything else from reading a
        # video (which can mention server paths) becomes one plain message
        if "must be" in str(e) or (kind == "recompute" and not isinstance(e, TypeError)):
            return 422, {"error": str(e)}
        return 422, {"error": "This video couldn't be read. Try the original MP4 or MOV straight from the phone."}
