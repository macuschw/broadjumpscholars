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
    frame_times: each frame's timestamp in seconds from the video file, if known."""
    xyv: np.ndarray
    fps: float
    width: int
    height: int
    video_path: str = ""
    settings: dict = field(default_factory=dict)
    frame_times: Optional[np.ndarray] = None

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
        np.savez_compressed(path, xyv=self.xyv, fps=self.fps, width=self.width,
                            height=self.height, video_path=self.video_path,
                            settings=json.dumps(self.settings, sort_keys=True),
                            frame_times=times)

    @classmethod
    def load(cls, path):
        d = np.load(path, allow_pickle=False)
        settings = json.loads(str(d["settings"])) if "settings" in d.files else {}
        times = d["frame_times"] if "frame_times" in d.files and d["frame_times"].size else None
        return cls(d["xyv"], float(d["fps"]), int(d["width"]), int(d["height"]),
                   str(d["video_path"]), settings, times)


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
    frames, times = [], []
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
                if out is not None:
                    mp_drawing.draw_landmarks(frame, results.pose_landmarks,
                                              mp_pose.POSE_CONNECTIONS)
            else:
                frames.append(missing)
            if out is not None:
                out.write(frame)
    cap.release()
    if out is not None:
        out.release()

    xyv = np.array(frames, dtype=float).reshape(-1, N_LANDMARKS, 3)
    return Keypoints(xyv, fps, width or 0, height or 0, os.path.abspath(video_path),
                     tracking_settings(model_complexity, smooth_landmarks), np.array(times))


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
