"""Synthetic data with KNOWN answers, for testing the analysis without real video."""
import numpy as np

from jumplab.physics import G
from jumplab.pose_tracking import LANDMARKS, N_LANDMARKS, Keypoints


class Truth:
    fps = 120.0
    scale = 0.004                 # m/px (250 px/m)
    width, height = 1920, 1080
    leg = 0.90                    # standing hip height (m)
    cm_depth = 0.20               # countermovement depth (m)
    t_takeoff = 1.2               # s (frame 144 exactly)
    vx, vy = 2.5, 2.2             # m/s at takeoff
    trunk_deg, shin_deg = 20.0, 30.0
    toe_dx, heel_dx = 0.18, -0.06  # foot markers relative to the hip, forward = +
    x_start = 0.5                 # m

    @property
    def flight_time(self):
        return 2 * self.vy / G

    @property
    def t_landing(self):
        return self.t_takeoff + self.flight_time

    @property
    def launch_angle_deg(self):
        return float(np.degrees(np.arctan2(self.vy, self.vx)))

    @property
    def jump_distance(self):
        return (self.vx * self.flight_time + self.heel_dx) - self.toe_dx


def jumper_keypoints(direction=1, noise_px=0.0, seed=0, duration=2.2, truth=None):
    """A stick-figure broad jump: stand, countermovement, takeoff, symmetric flight, land.
    direction=+1 jumps toward the right of the image, -1 toward the left."""
    T = truth or Truth()
    t = np.arange(int(duration * T.fps)) / T.fps
    n = len(t)

    # Hip (m, forward x, y up)
    hip_y = np.full(n, T.leg)
    down = (t >= 0.5) & (t < 0.9)
    hip_y[down] = T.leg - T.cm_depth * (1 - np.cos(np.pi * (t[down] - 0.5) / 0.4)) / 2
    up = (t >= 0.9) & (t < T.t_takeoff)
    hip_y[up] = T.leg - T.cm_depth * (1 + np.cos(np.pi * (t[up] - 0.9) / 0.3)) / 2
    tau = np.clip(t - T.t_takeoff, 0, T.flight_time)
    air = (t > T.t_takeoff) & (t < T.t_landing)
    hip_y[air] = T.leg + T.vy * tau[air] - 0.5 * G * tau[air] ** 2
    hip_x = T.x_start + T.vx * tau

    # Foot moves rigidly with the hip in the air, sits on the ground otherwise
    foot_y = np.where(air, hip_y - T.leg, 0.0)
    parts = {
        "HIP": (hip_x, hip_y),
        "ANKLE": (hip_x, foot_y + 0.08),
        "HEEL": (hip_x + T.heel_dx, foot_y + 0.02),
        "FOOT_INDEX": (hip_x + T.toe_dx, foot_y + 0.02),
    }
    a, s = np.radians(T.shin_deg), np.radians(T.trunk_deg)
    parts["KNEE"] = (parts["ANKLE"][0] + 0.45 * np.sin(a), parts["ANKLE"][1] + 0.45 * np.cos(a))
    parts["SHOULDER"] = (hip_x + 0.5 * np.sin(s), hip_y + 0.5 * np.cos(s))

    rng = np.random.default_rng(seed)
    xyv = np.full((n, N_LANDMARKS, 3), np.nan)
    xyv[:, :, 2] = 0.0
    xyv[:, 0, :] = (1.0, 1.0, 0.9)          # nose: just so every frame counts as "detected"
    for side, vis in (("LEFT", 0.9), ("RIGHT", 0.5)):
        for name, (x_m, y_m) in parts.items():
            x_px = T.width / 2 + direction * (x_m - 1.0) / T.scale
            y_img = T.height - 100 - y_m / T.scale
            i = LANDMARKS[side][name]
            xyv[:, i, 0] = x_px + rng.normal(0, noise_px, n) if noise_px else x_px
            xyv[:, i, 1] = y_img + rng.normal(0, noise_px, n) if noise_px else y_img
            xyv[:, i, 2] = vis
    return Keypoints(xyv, T.fps, T.width, T.height, "synthetic")


def write_projectile_video(path, x0, y0, vx, vy, fps=120.0, duration=0.6, scale=0.005,
                           size=(640, 480), radius=8):
    """Draw a ball following ideal projectile motion (meters, y up from the bottom edge).
    Returns the true (t, x_px, y_px_up) of the ball center, with y as negated image y
    (the same convention track_ball uses)."""
    import cv2

    w, h = size
    t = np.arange(int(duration * fps)) / fps
    x_px = (x0 + vx * t) / scale
    y_up = (y0 + vy * t - 0.5 * G * t ** 2) / scale
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    shift = 4                                   # draw with 1/16 px precision
    for xi, yi in zip(x_px, y_up):
        frame = np.full((h, w, 3), 200, np.uint8)
        center = (int(round(xi * 16)), int(round((h - yi) * 16)))
        cv2.circle(frame, center, radius * 16, (30, 30, 200), -1, cv2.LINE_AA, shift)
        out.write(frame)
    out.release()
    return t, x_px, y_up - h
