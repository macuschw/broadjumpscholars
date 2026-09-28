import os
import cv2
import numpy as np
import mediapipe as mp
import matplotlib.pyplot as plt
from scipy.signal import butter, filtfilt

# CHANGE THIS to your video's filename
INPUT_VIDEO = "/Users/macuswu/Desktop/Scholars Math 26-27/testskeleton2.mp4"
OUTPUT_DIR = "output"

# Smoothing cutoff in Hz. ~10 Hz is typical for jumping. Lower = smoother.
CUTOFF_HZ = 10

os.makedirs(OUTPUT_DIR, exist_ok=True)

mp_pose = mp.solutions.pose
L = mp_pose.PoseLandmark

# Landmarks we need, for both sides of the body
NAMES = ["SHOULDER", "HIP", "KNEE", "ANKLE", "HEEL", "FOOT_INDEX"]


def lm_index(side, name):
    return getattr(L, f"{side}_{name}").value


# ---------- 1. Run pose estimation and collect raw keypoints ----------
cap = cv2.VideoCapture(INPUT_VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

if fps <= 0:
    print(f"Could not read {INPUT_VIDEO}. Check the filename/path.")
    raise SystemExit

pose = mp_pose.Pose(static_image_mode=False, model_complexity=1)

# raw[side][name] = list of (x_px, y_px, visibility) per frame (NaN if not detected)
raw = {s: {n: [] for n in NAMES} for s in ["LEFT", "RIGHT"]}

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break
    results = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    for side in ["LEFT", "RIGHT"]:
        for n in NAMES:
            if results.pose_landmarks:
                p = results.pose_landmarks.landmark[lm_index(side, n)]
                raw[side][n].append((p.x * width, p.y * height, p.visibility))
            else:
                raw[side][n].append((np.nan, np.nan, 0.0))
cap.release()

n_frames = len(raw["LEFT"]["HIP"])
t = np.arange(n_frames) / fps
print(f"Video: {INPUT_VIDEO}  |  FPS: {fps:.1f}  |  Frames: {n_frames}")
if fps < 100:
    print("NOTE: this video is under 100 fps. Angles will be fine, but ground contact "
          "time needs 120-240 fps to be meaningful.")

# ---------- 2. Pick the side of the body facing the camera ----------
def mean_visibility(side):
    vis = [np.array(raw[side][n])[:, 2] for n in NAMES]
    return float(np.mean(vis))

side = "LEFT" if mean_visibility("LEFT") >= mean_visibility("RIGHT") else "RIGHT"
print(f"Using the {side} side of the body (higher tracking confidence).")

# ---------- 3. Fill gaps and smooth ----------
def fill_and_smooth(values):
    """Interpolate over missing frames, then apply a zero-lag low-pass filter."""
    v = np.array(values, dtype=float)
    idx = np.arange(len(v))
    good = ~np.isnan(v)
    if good.sum() < 2:
        return v
    v = np.interp(idx, idx[good], v[good])
    cutoff = min(CUTOFF_HZ, 0.4 * fps)          # must stay below Nyquist (fps/2)
    b, a = butter(2, cutoff / (fps / 2), btype="low")
    if len(v) > 3 * max(len(a), len(b)):
        v = filtfilt(b, a, v)
    return v


pts = {}
for n in NAMES:
    arr = np.array(raw[side][n])
    x = fill_and_smooth(arr[:, 0])
    y = fill_and_smooth(arr[:, 1])
    pts[n] = (x, -y)   # flip y so UP is positive (image y points down)

# ---------- 4. Angles ----------
def angle_from_vertical(x1, y1, x2, y2):
    """Angle (degrees) of the vector point1 -> point2 measured from straight up.
    0 = pointing straight up, positive = leaning toward +x (the right of the image)."""
    dx, dy = x2 - x1, y2 - y1
    return np.degrees(np.arctan2(dx, dy))


# Trunk: hip -> shoulder
trunk = angle_from_vertical(*pts["HIP"], *pts["SHOULDER"])
# Shin: ankle -> knee
shin = angle_from_vertical(*pts["ANKLE"], *pts["KNEE"])

# NOTE: if the person jumps toward the LEFT of the image, angle signs are mirrored.
# Flip them so "forward lean" is always positive.
hip_x = pts["HIP"][0]
if hip_x[-1] < hip_x[0]:
    trunk = -trunk
    shin = -shin
    print("Jump direction is toward the left of the image; angle signs flipped so forward lean is positive.")

# ---------- 5. Save CSV ----------
csv_path = os.path.join(OUTPUT_DIR, "keypoints_and_angles.csv")
header = "frame,time_s,hip_x_px,hip_y_px_up,ankle_x_px,ankle_y_px_up,trunk_angle_deg,shin_angle_deg"
data = np.column_stack([
    np.arange(n_frames), t,
    pts["HIP"][0], pts["HIP"][1],
    pts["ANKLE"][0], pts["ANKLE"][1],
    trunk, shin,
])
np.savetxt(csv_path, data, delimiter=",", header=header, comments="", fmt="%.4f")
print(f"Saved data to {csv_path}")

# ---------- 6. Plot ----------
fig, axes = plt.subplots(4, 1, figsize=(10, 10), sharex=True)

axes[0].plot(t, pts["HIP"][1], color="tab:orange")
axes[0].set_ylabel("Hip height (px)")
axes[0].set_title("Hip height: dips during countermovement, arcs during flight")

axes[1].plot(t, pts["ANKLE"][1], color="tab:blue")
axes[1].set_ylabel("Ankle height (px)")
axes[1].set_title("Ankle height: rises at takeoff, returns at landing")

axes[2].plot(t, trunk, color="tab:green")
axes[2].set_ylabel("Trunk angle (deg)")
axes[2].set_title("Trunk angle from vertical (forward lean = positive)")

axes[3].plot(t, shin, color="tab:red")
axes[3].set_ylabel("Shin angle (deg)")
axes[3].set_title("Shin angle from vertical")
axes[3].set_xlabel("Time (s)")

for ax in axes:
    ax.grid(alpha=0.3)

plt.tight_layout()
plot_path = os.path.join(OUTPUT_DIR, "angles_plot.png")
plt.savefig(plot_path, dpi=150)
print(f"Saved plot to {plot_path}")
plt.show()
