"""One MediaPipe pass over a video -> raw keypoints (+ optional skeleton overlay video).

Requires mediapipe==0.10.14 (newer versions removed the mp.solutions.pose API).
mediapipe is only imported inside track_video(), so the rest of the package
(and the tests) work without it.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

N_LANDMARKS = 33

# MediaPipe Pose landmark indices (mp.solutions.pose.PoseLandmark). Hard-coded so the
# analysis code doesn't need to import mediapipe.
LANDMARKS = {
    "LEFT": {"EAR": 7, "SHOULDER": 11, "ELBOW": 13, "WRIST": 15, "INDEX": 19,
             "HIP": 23, "KNEE": 25, "ANKLE": 27, "HEEL": 29, "FOOT_INDEX": 31},
    "RIGHT": {"EAR": 8, "SHOULDER": 12, "ELBOW": 14, "WRIST": 16, "INDEX": 20,
              "HIP": 24, "KNEE": 26, "ANKLE": 28, "HEEL": 30, "FOOT_INDEX": 32},
}
# The landmarks used for angles and events (center_of_mass.py also uses the arms and head)
BODY_PARTS = ["SHOULDER", "HIP", "KNEE", "ANKLE", "HEEL", "FOOT_INDEX"]


@dataclass
class Keypoints:
    """Raw per-frame landmarks for all 33 MediaPipe points.

    xyv[frame, landmark] = (x_px, y_px, visibility) in IMAGE coordinates
    (y points DOWN). Frames with no person detected are (NaN, NaN, 0).
    settings: how MediaPipe was run (so a cache made differently isn't reused).
    frame_times: each frame's timestamp in seconds from the video file, if known.
    sharpness: how sharp the athlete looks in each frame (athlete_sharpness), if measured.
    others: (n_frames, 4) box [x0, y0, x1, y1] px of ANOTHER person found in the frame
        (scan_for_others: about 10 frames a second, around the jump only), zeros where a frame
        was checked and nobody was found, NaN where it wasn't checked; None if never checked.
    segment: (first, last) frames, if only that part of the video was tracked (track_segments); the
        other frames are then like frames with nobody in them, and the analysis stays inside."""
    xyv: np.ndarray
    fps: float
    width: int
    height: int
    video_path: str = ""
    settings: dict = field(default_factory=dict)
    frame_times: Optional[np.ndarray] = None
    sharpness: Optional[np.ndarray] = None
    others: Optional[np.ndarray] = None
    segment: Optional[tuple] = None

    @property
    def n_frames(self):
        return self.xyv.shape[0]

    @property
    def time(self):
        return np.arange(self.n_frames) / self.fps

    @property
    def detected(self):
        return ~np.isnan(self.xyv[:, 0, 0])

    def part(self, side, name):
        """(x_px, y_px, visibility) arrays for one landmark, e.g. part("LEFT", "HIP")."""
        p = self.xyv[:, LANDMARKS[side][name], :]
        return p[:, 0], p[:, 1], p[:, 2]

    def save(self, path):
        times = np.array([]) if self.frame_times is None else np.asarray(self.frame_times)
        sharp = np.array([]) if self.sharpness is None else np.asarray(self.sharpness)
        others = np.array([]) if self.others is None else np.asarray(self.others)
        segment = np.array([]) if self.segment is None else np.asarray(self.segment, dtype=int)
        np.savez_compressed(path, xyv=self.xyv, fps=self.fps, width=self.width,
                            height=self.height, video_path=self.video_path,
                            settings=json.dumps(self.settings, sort_keys=True),
                            frame_times=times, sharpness=sharp, others=others, segment=segment)

    @classmethod
    def load(cls, path):
        d = np.load(path, allow_pickle=False)
        settings = json.loads(str(d["settings"])) if "settings" in d.files else {}
        times = d["frame_times"] if "frame_times" in d.files and d["frame_times"].size else None
        sharp = d["sharpness"] if "sharpness" in d.files and d["sharpness"].size else None
        others = d["others"] if "others" in d.files and d["others"].size else None
        segment = tuple(int(v) for v in d["segment"]) if "segment" in d.files and d["segment"].size else None
        return cls(d["xyv"], float(d["fps"]), int(d["width"]), int(d["height"]),
                   str(d["video_path"]), settings, times, sharp, others, segment)


def tracking_settings(model_complexity=1, smooth_landmarks=True):
    """What a keypoints cache must match to be reused."""
    try:
        from importlib.metadata import version
        mp_version = version("mediapipe")
    except Exception:
        mp_version = "unknown"
    return {"mediapipe": mp_version, "model_complexity": model_complexity,
            "smooth_landmarks": smooth_landmarks, "static_image_mode": False}


def open_video(video_path):
    """Open a video with OpenCV; returns (cap, fps, width, height)."""
    import cv2

    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        cap.release()
        raise ValueError(f"Could not read {video_path}. Check the filename/path.")
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    return cap, fps, width, height


def body_box(xy, pad_x=0.0, pad_y=0.0):
    """[x0, y0, x1, y1] around a body's landmarks (pixels), padded by a share of its width /
    height; None if fewer than 5 landmarks were found."""
    ok = ~np.isnan(xy[:, 0])
    if ok.sum() < 5:
        return None
    (x0, y0), (x1, y1) = np.nanmin(xy[ok], 0), np.nanmax(xy[ok], 0)
    pw, ph = pad_x * (x1 - x0), pad_y * (y1 - y0)
    return np.array([x0 - pw, y0 - ph, x1 + pw, y1 + ph])


# How often to look for other people: 10 checks a second of video is plenty to see someone
# walk through, and costs ~25 ms each
OTHERS_PER_SECOND = 10


def _every(fps):
    return max(1, round(fps / OTHERS_PER_SECOND))


def others_checked(others, first, last, fps):
    """Whether frames first..last were already scanned (a scan covers one unbroken stretch)."""
    if others is None or last < first:
        return False
    k = _every(fps)
    return bool(np.isfinite(others[first:first + k, 0]).any() and np.isfinite(others[max(first, last - k + 1):last + 1, 0]).any())


def _grab_at_or_before(cap, target, times):
    """Grab frame `target` or a little before it; returns the index of the frame grabbed.
    Seeking by frame number is exact for most phone videos but lands late on some (uneven frame
    timing), so the frame reached is identified by its timestamp (`times`, recorded while tracking)
    and the seek retried earlier if it overshot. Falls back to the first frame."""
    import cv2

    aim = target
    for _ in range(4 if times is not None and target > 0 else 0):
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, aim))
        if not cap.grab():
            break
        got = int(np.argmin(np.abs(times - cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)))
        if got <= target:
            return got
        aim -= 2 * (got - target) + 1
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    return 0 if cap.grab() else -1


def scan_for_others(video_path, kp, first, last, model_complexity=1):
    """Look for other people (find_other_person) about 10 times a second between frames first and
    last (the stretch around the jump, from a first analysis): a second, short pass over the video,
    so it costs about a second however long the clip is. Returns kp.others with that stretch filled
    in (box, or zeros for nobody); frames scanned before are kept."""
    import cv2
    import mediapipe as mp

    others = np.full((kp.n_frames, 4), np.nan) if kp.others is None else np.array(kp.others, dtype=float)
    first, last = max(0, int(first)), min(kp.n_frames - 1, int(last))
    every = _every(kp.fps)
    times = None if kp.frame_times is None or len(kp.frame_times) != kp.n_frames else np.asarray(kp.frame_times)
    cap, _, _, _ = open_video(video_path)
    with mp.solutions.pose.Pose(static_image_mode=True, model_complexity=model_complexity) as detector:
        i = _grab_at_or_before(cap, first, times)
        while 0 <= i <= last:
            if i >= first and (i - first) % every == 0:
                ok, frame = cap.retrieve()
                box = find_other_person(frame, kp.xyv[i, :, :2], detector) if ok else None
                others[i] = np.zeros(4) if box is None else box
            if not cap.grab():
                break
            i += 1
    cap.release()
    return others


def find_other_person(frame, xy, detector):
    """Look for someone else in the frame: cover the athlete (box around their landmarks + 15% /
    10%) in gray and ask MediaPipe (`detector`: a Pose in static_image_mode) for another body.
    Returns that body's box [x0, y0, x1, y1] (landmarks with visibility > 0.5), or None.

    MediaPipe can also "see" a body in clutter (a building corner, a tree); those hits are small or
    brief, so checks.check_other_people only trusts bodies at least 30% of the athlete's height,
    found in at least 3 checks around the jump."""
    other = _other_body(frame, xy, detector)
    return None if other is None else other[0]


def _other_body(frame, xy, detector):
    """find_other_person's work: (box, landmark xy (33, 2), visibility (33,)) of the other body."""
    import cv2

    box = body_box(xy, 0.15, 0.10)
    if box is None:
        return None
    h, w = frame.shape[:2]
    x0, y0 = int(max(0, box[0])), int(max(0, box[1]))
    x1, y1 = int(min(w, box[2])), int(min(h, box[3]))
    covered = frame.copy()
    covered[y0:y1, x0:x1] = 128
    found = detector.process(cv2.cvtColor(covered, cv2.COLOR_BGR2RGB))
    if not found.pose_landmarks:
        return None
    lm = found.pose_landmarks.landmark
    oxy, vis = np.array([(p.x * w, p.y * h) for p in lm]), np.array([p.visibility for p in lm])
    pts = oxy[vis > 0.5]
    if len(pts) < 8:
        return None
    return np.array([pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()]), oxy, vis


def athlete_sharpness(frame, xy):
    """How sharp the athlete looks in one frame: the variance of the Laplacian over the box around
    their landmarks, scaled to a fixed 240 px height (so 4K and 1080p compare). Sharp phone footage
    of our tape-checked jumps scores ~800-4400 in the air; the same frames blurred score 20-310.
    NaN when the athlete wasn't found."""
    import cv2

    box = body_box(xy, 0.15, 0.10)
    if box is None:
        return np.nan
    h, w = frame.shape[:2]
    x0, x1 = int(max(0, box[0])), int(min(w, box[2]))
    y0, y1 = int(max(0, box[1])), int(min(h, box[3]))
    if x1 - x0 < 10 or y1 - y0 < 10:
        return np.nan
    gray = cv2.cvtColor(frame[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    k = 240 / gray.shape[0]
    gray = cv2.resize(gray, (max(8, round(gray.shape[1] * k)), 240), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def track_video(video_path, skeleton_video_path=None, model_complexity=1, smooth_landmarks=True):
    """Run MediaPipe Pose once over every frame.

    Returns Keypoints. If skeleton_video_path is given, also writes a copy of the
    video with the skeleton drawn on it (check this, especially the feet)."""
    import cv2
    import mediapipe as mp

    mp_pose = mp.solutions.pose
    mp_drawing = mp.solutions.drawing_utils

    cap, fps, _, _ = open_video(video_path)
    out = None
    width = height = None
    frames, times, sharp = [], [], []
    missing = np.full((N_LANDMARKS, 3), np.nan)
    missing[:, 2] = 0.0
    with mp_pose.Pose(static_image_mode=False, model_complexity=model_complexity,
                      smooth_landmarks=smooth_landmarks) as pose:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            if width is None:
                # Size of the frames actually delivered (phone videos can carry rotation
                # metadata, so the header's width/height may be swapped)
                height, width = frame.shape[:2]
                if skeleton_video_path:
                    os.makedirs(os.path.dirname(skeleton_video_path) or ".", exist_ok=True)
                    out = cv2.VideoWriter(skeleton_video_path, cv2.VideoWriter_fourcc(*"mp4v"),
                                          fps, (width, height))
            times.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)
            results = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if results.pose_landmarks:
                lms = results.pose_landmarks.landmark
                frames.append([(p.x * width, p.y * height, p.visibility) for p in lms])
                sharp.append(athlete_sharpness(frame, np.array([(p.x * width, p.y * height) for p in lms])))
                if out is not None:
                    mp_drawing.draw_landmarks(frame, results.pose_landmarks,
                                              mp_pose.POSE_CONNECTIONS)
            else:
                frames.append(missing)
                sharp.append(np.nan)
            if out is not None:
                out.write(frame)
    cap.release()
    if out is not None:
        out.release()

    xyv = np.array(frames, dtype=float).reshape(-1, N_LANDMARKS, 3)
    return Keypoints(xyv, fps, width or 0, height or 0, os.path.abspath(video_path),
                     tracking_settings(model_complexity, smooth_landmarks), np.array(times), np.array(sharp, dtype=float))



# The quick look for jumps (find_jumps): MediaPipe on ~5 frames a second of video
LOOK_PER_SECOND = 5
LOOK_CROUCH = 0.8             # the dip: the body's height under this share of standing height...
LOOK_SPAN_S = 1.0             # ...then within this long, the hips travel sideways...
LOOK_MIN_TRAVEL = 0.5         # ...at least this far (x standing height; our jumps: 0.8-1.4)
JUMP_GAP_S = 1.5              # crouches closer than this are one jump (the dip, then the landing squat)
TRIM_BEFORE_S = 2.5           # track from this long before the jump (standing still, the dip)...
TRIM_AFTER_S = 1.8            # ...to this long after it (landing, settling, other people)
MIN_CLIP_TO_TRIM_S = 6.5      # shorter clips are mostly the ~5 s tracked anyway: no gain


def _look_at(lm_xy, lm_vis):
    """(hip x, visible body height) for one frame's 33 landmarks, or None. The hips' midpoint:
    side-on, the far hip is marked hidden but still placed next to the near one."""
    ys = lm_xy[lm_vis > 0.5, 1]
    if len(ys) < 8 or not np.isfinite(lm_xy[[23, 24], 0]).all():
        return None
    return float(lm_xy[[23, 24], 0].mean()), float(ys.max() - ys.min())


def jump_moments(looks, fps, slow=1.0, with_travel=False, tall=None):
    """looks: [(frame, hip x, body height)], about 5 a second -> [(a, b)] frames for each jump: the
    athlete crouches (the dip: visible height under 80% of standing) and, within the next second,
    the hips travel sideways at least half a standing height. Walking travels as far but never
    crouches. Crouches within 1.5 s of each other (the dip, then the landing squat, then perhaps
    walking off from it) are one jump, and its furthest travel counts."""
    if len(looks) < 2 or (tall is None and len(looks) < 4):
        return []
    tall = tall or float(np.percentile([h for _, _, h in looks], 80))   # standing up straight
    span, gap = LOOK_SPAN_S * slow * fps, JUMP_GAP_S * slow * fps
    found = []                                               # (a, b, travel), one per crouched look
    for i, (a, xa, ha) in enumerate(looks):
        if ha >= LOOK_CROUCH * tall:
            continue
        best = None
        for b, xb, _ in looks[i + 1:]:
            if b - a > span:
                break
            if best is None or abs(xb - xa) > best[2]:
                best = (a, b, abs(xb - xa))
        if best:
            found.append((best[0], best[1], best[2] / tall))
    jumps, group = [], []
    for c in found:
        if group and c[0] - group[-1][0] > gap:
            jumps.append(max(group, key=lambda g: g[2]))
            group = []
        group.append(c)
    if group:
        jumps.append(max(group, key=lambda g: g[2]))
    return [(a, b) for a, b, travel in jumps if travel >= LOOK_MIN_TRAVEL] if not with_travel else \
        [j for j in jumps if j[2] >= LOOK_MIN_TRAVEL]


def _around(moment, fps, slow, n_frames):
    a, b = moment
    return max(0, a - int(TRIM_BEFORE_S * slow * fps)), min(n_frames - 1, b + int(TRIM_AFTER_S * slow * fps))


def find_jumps(video_path, real_fps=None, model_complexity=1, progress=None):
    """A quick first look for every jump in a video (jump_moments, from MediaPipe on about 5 frames
    a second, following up to two people, so an athlete walking back behind the jumper can't hide
    a jump). Every frame is still decoded, for its timestamp, but decoding is cheap next to
    MediaPipe. Returns (frame_times, [(first, last), ...]): the timestamps of all frames and, for
    each jump, the frames to track (2.5 s before its dip to 1.8 s after); [] if no clear jump.
    real_fps: the real frame rate of a slow-motion file saved for slowed-down playback.
    progress(frames_done, frames_total) is called about once a second of video."""
    import cv2
    import mediapipe as mp

    cap, fps, _, _ = open_video(video_path)
    slow = max(1.0, (real_fps or fps) / fps)                 # file seconds per real second
    every = max(1, round(fps / LOOK_PER_SECOND))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    times, people = [], []                                   # per look: [(hip x, body height), ...]
    with mp.solutions.pose.Pose(static_image_mode=False, model_complexity=model_complexity) as pose, \
            mp.solutions.pose.Pose(static_image_mode=True, model_complexity=model_complexity) as detector:
        while cap.grab():
            i = len(times)
            times.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)
            if progress and i % max(1, round(fps)) == 0:
                progress(i, total)
            if i % every:
                continue
            ok, frame = cap.retrieve()
            found = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)) if ok else None
            if found is None or not found.pose_landmarks:
                continue
            h, w = frame.shape[:2]
            lm = found.pose_landmarks.landmark
            xy = np.array([(p.x * w, p.y * h) for p in lm])
            look = _look_at(xy, np.array([p.visibility for p in lm]))
            if not look:
                continue
            bodies = [look]
            other = _other_body(frame, xy, detector)              # someone else, e.g. walking back
            if other is not None:
                second = _look_at(other[1], other[2])
                if second and second[1] >= 0.3 * look[1]:         # not a far-off speck
                    bodies.append(second)
            people.append((i, bodies))
    cap.release()
    times = np.array(times)
    return times, [_around(m, fps, slow, len(times)) for m in _moments_of_people(people, fps, slow)]


TELEPORT = 4.0               # standing heights per second: nobody moves this fast (jumps: under 2.3)


def _moments_of_people(people, fps, slow):
    """people: [(frame, [look, look?])], the tracked body and perhaps someone else (found with the
    tracked one covered) -> the jumps of either, in time order. Each of the two is cut into pieces
    wherever it moves impossibly fast between two looks (the tracker switched to another person, or
    "someone else" is now someone, or something, else) or goes unseen for over a second; each piece
    is searched with jump_moments, and a jump seen twice counts once. So an athlete walking back
    behind the jumper can't hide the jump, whichever of them the tracker follows."""
    found = []
    for t in (0, 1):
        track = [(frame, *bodies[t]) for frame, bodies in people if len(bodies) > t]
        if len(track) < 4:
            continue
        tall = float(np.percentile([h for _, _, h in track], 80))
        piece = [track[0]]
        for prev, look in zip(track, track[1:]):
            dt = (look[0] - prev[0]) / (slow * fps)
            if dt > 1.0 or abs(look[1] - prev[1]) / tall > TELEPORT * dt:
                found += jump_moments(piece, fps, slow, with_travel=True, tall=tall)
                piece = []
            piece.append(look)
        found += jump_moments(piece, fps, slow, with_travel=True, tall=tall)
    merged = []
    for m in sorted(found):
        if merged and m[0] - merged[-1][0] <= JUMP_GAP_S * slow * fps:
            merged[-1] = max(merged[-1], m, key=lambda j: j[2])
        else:
            merged.append(m)
    return [(a, b) for a, b, _ in merged]

def jumps_in_keypoints(kp, real_fps=None):
    """The same look for jumps, over keypoints already tracked (the command line tracks every
    frame) -> [(first, last), ...] around each jump."""
    slow = max(1.0, (real_fps or kp.fps) / kp.fps)
    every = max(1, round(kp.fps / LOOK_PER_SECOND))
    looks = []
    for i in range(0, kp.n_frames, every):
        look = _look_at(kp.xyv[i, :, :2], kp.xyv[i, :, 2])
        if look:
            looks.append((i, *look))
    return [_around(m, kp.fps, slow, kp.n_frames) for m in jump_moments(looks, kp.fps, slow)]


def track_segments(video_path, segments, frame_times, model_complexity=1, progress=None):
    """Track only the given stretches of the video (find_jumps), each from a fresh start, for
    speed: on the server a 38 s clip took 11.5 s instead of 34 s. Stretches that overlap are
    tracked once. Returns Keypoints for every frame, empty outside the stretches. progress(i, n) is
    called before stretch i of n."""
    import cv2
    import mediapipe as mp

    merged = []
    for first, last in sorted(segments):
        if merged and first <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], last)
        else:
            merged.append([first, last])
    cap, fps, _, _ = open_video(video_path)
    times = np.asarray(frame_times)
    xyv = np.full((len(times), N_LANDMARKS, 3), np.nan)
    xyv[:, :, 2] = 0.0
    sharp = np.full(len(times), np.nan)
    width = height = 0
    for k, (first, last) in enumerate(merged):
        if progress:
            progress(k, len(merged))
        with mp.solutions.pose.Pose(static_image_mode=False, model_complexity=model_complexity) as pose:
            i = _grab_at_or_before(cap, first, times)
            while 0 <= i <= last:
                if i >= first:
                    ok, frame = cap.retrieve()
                    if not ok:
                        break
                    height, width = frame.shape[:2]
                    found = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                    if found.pose_landmarks:
                        xyv[i] = [(p.x * width, p.y * height, p.visibility) for p in found.pose_landmarks.landmark]
                        sharp[i] = athlete_sharpness(frame, xyv[i, :, :2])
                if not cap.grab():
                    break
                i += 1
    cap.release()
    return Keypoints(xyv, fps, width, height, os.path.abspath(video_path), tracking_settings(model_complexity), times, sharp)

def load_or_track(video_path, cache_path, skeleton_video_path=None, retrack=False):
    """Reuse saved keypoints if they are newer than the video AND were made with the same
    MediaPipe settings; otherwise run MediaPipe (once) and save them.
    Returns (Keypoints, ran_mediapipe)."""
    if (not retrack and os.path.exists(cache_path)
            and os.path.getmtime(cache_path) >= os.path.getmtime(video_path)
            and (not skeleton_video_path or os.path.exists(skeleton_video_path))):
        kp = Keypoints.load(cache_path)
        if kp.video_path == os.path.abspath(video_path) and kp.settings == tracking_settings():
            return kp, False
    kp = track_video(video_path, skeleton_video_path)
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    kp.save(cache_path)
    return kp, True
