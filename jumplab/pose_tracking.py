"""One MediaPipe pass over a video -> raw keypoints (+ optional skeleton overlay video).

Requires mediapipe==0.10.14 (newer versions removed the mp.solutions.pose API).
mediapipe is only imported inside track_video(), so the rest of the package
(and the tests) work without it.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import numpy as np

N_LANDMARKS = 33

# MediaPipe Pose landmark indices (mp.solutions.pose.PoseLandmark). Hard-coded so the
# analysis code doesn't need to import mediapipe.
LANDMARKS = {
    "LEFT": {"SHOULDER": 11, "HIP": 23, "KNEE": 25, "ANKLE": 27, "HEEL": 29, "FOOT_INDEX": 31},
    "RIGHT": {"SHOULDER": 12, "HIP": 24, "KNEE": 26, "ANKLE": 28, "HEEL": 30, "FOOT_INDEX": 32},
}
BODY_PARTS = ["SHOULDER", "HIP", "KNEE", "ANKLE", "HEEL", "FOOT_INDEX"]


@dataclass
class Keypoints:
    """Raw per-frame landmarks for all 33 MediaPipe points.

    xyv[frame, landmark] = (x_px, y_px, visibility) in IMAGE coordinates
    (y points DOWN). Frames with no person detected are (NaN, NaN, 0)."""
    xyv: np.ndarray
    fps: float
    width: int
    height: int
    video_path: str = ""

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
        np.savez_compressed(path, xyv=self.xyv, fps=self.fps, width=self.width,
                            height=self.height, video_path=self.video_path)

    @classmethod
    def load(cls, path):
        d = np.load(path, allow_pickle=False)
        return cls(d["xyv"], float(d["fps"]), int(d["width"]), int(d["height"]),
                   str(d["video_path"]))


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


def track_video(video_path, skeleton_video_path=None, model_complexity=1):
    """Run MediaPipe Pose once over every frame.

    Returns Keypoints. If skeleton_video_path is given, also writes a copy of the
    video with the skeleton drawn on it (check this, especially the feet)."""
    import cv2
    import mediapipe as mp

    mp_pose = mp.solutions.pose
    mp_drawing = mp.solutions.drawing_utils

    cap, fps, width, height = open_video(video_path)
    out = None
    if skeleton_video_path:
        os.makedirs(os.path.dirname(skeleton_video_path) or ".", exist_ok=True)
        out = cv2.VideoWriter(skeleton_video_path, cv2.VideoWriter_fourcc(*"mp4v"),
                              fps, (width, height))

    frames = []
    missing = np.full((N_LANDMARKS, 3), np.nan)
    missing[:, 2] = 0.0
    with mp_pose.Pose(static_image_mode=False, model_complexity=model_complexity) as pose:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
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
    return Keypoints(xyv, fps, width, height, os.path.abspath(video_path))


def load_or_track(video_path, cache_path, skeleton_video_path=None, retrack=False):
    """Reuse saved keypoints if they are newer than the video, otherwise run MediaPipe
    (once) and save them. Returns (Keypoints, ran_mediapipe)."""
    if (not retrack and os.path.exists(cache_path)
            and os.path.getmtime(cache_path) >= os.path.getmtime(video_path)
            and (not skeleton_video_path or os.path.exists(skeleton_video_path))):
        kp = Keypoints.load(cache_path)
        if kp.video_path == os.path.abspath(video_path):
            return kp, False
    kp = track_video(video_path, skeleton_video_path)
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    kp.save(cache_path)
    return kp, True
