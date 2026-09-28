import os
import numpy as np
import matplotlib.pyplot as plt

# Reads the CSV that analyze_angles.py saved, so you don't need to re-run MediaPipe.
CSV_PATH = "output/keypoints_and_angles.csv"
OUTPUT_DIR = "output"

# If your clip has more than one jump (or lots of standing around), analyze just
# one time window, in seconds. Leave as None to use the whole clip.
START_S = None
END_S = None

# How far the ankle must rise (as a fraction of the total jump rise) to count as "off the ground".
# Raise it if takeoff/landing fire too early on noise; lower it if they fire too late.
THRESHOLD_FRACTION = 0.15

G = 9.81  # m/s^2

# ---------- Load ----------
d = np.genfromtxt(CSV_PATH, delimiter=",", names=True)
t = d["time_s"]
mask = np.ones(len(t), dtype=bool)
if START_S is not None:
    mask &= t >= START_S
if END_S is not None:
    mask &= t <= END_S

t = t[mask]
hip_x = d["hip_x_px"][mask]
hip_y = d["hip_y_px_up"][mask]
ankle_y = d["ankle_y_px_up"][mask]
trunk = d["trunk_angle_deg"][mask]
shin = d["shin_angle_deg"][mask]

fps = 1.0 / np.median(np.diff(t))
print(f"Loaded {len(t)} frames at ~{fps:.0f} fps ({t[0]:.2f}s to {t[-1]:.2f}s)")

# ---------- Detect takeoff and landing from the ankle ----------
baseline = np.percentile(ankle_y, 20)          # roughly "foot on the ground"
peak_i = int(np.argmax(ankle_y))
rise = ankle_y[peak_i] - baseline

if rise < 20:
    print("The ankle barely rises in this window, so no jump was found.")
    print("Check START_S / END_S, or look at the plot from analyze_angles.py.")
    raise SystemExit

thr = baseline + THRESHOLD_FRACTION * rise

# Walk outward from the peak until the ankle drops back to ground level
i = peak_i
while i > 0 and ankle_y[i - 1] > thr:
    i -= 1
takeoff_i = i

j = peak_i
while j < len(t) - 1 and ankle_y[j] > thr:
    j += 1
landing_i = j

# Bottom of the countermovement: lowest hip point in the second before takeoff
lo = max(0, takeoff_i - int(1.0 * fps))
bottom_i = lo + int(np.argmin(hip_y[lo:takeoff_i + 1]))

# Hip rise during flight
flight_hip = hip_y[takeoff_i:landing_i + 1]
hip_rise_px = float(flight_hip.max() - hip_y[takeoff_i])
hip_peak_i = takeoff_i + int(np.argmax(flight_hip))
hip_travel_px = abs(float(hip_x[landing_i] - hip_x[takeoff_i]))

# Countermovement depth relative to the start of the window (assumes you start standing)
stand_hip = np.median(hip_y[: max(3, int(0.3 * fps))])
cm_depth_px = float(stand_hip - hip_y[bottom_i])

# ---------- Physics that needs NO calibration ----------
flight_time = (landing_i - takeoff_i) / fps
vy = G * flight_time / 2                # takeoff vertical speed, if takeoff/landing heights are similar
peak_height_m = G * flight_time**2 / 8  # rise of the center of mass during flight
frame_ms = 1000 / fps

# ---------- Print table ----------
def row(label, value):
    print(f"  {label:<44}{value}")

print("\n=========== RESULTS ===========")
print("Events")
row("Countermovement bottom", f"{t[bottom_i]:.3f} s  (frame {bottom_i})")
row("Takeoff", f"{t[takeoff_i]:.3f} s  (frame {takeoff_i})")
row("Landing", f"{t[landing_i]:.3f} s  (frame {landing_i})")

print("\nTiming")
row("Flight time", f"{flight_time:.3f} s")
row("Timing uncertainty per event", f"+/- {frame_ms:.0f} ms (1 frame)")

print("\nAngles (degrees, forward lean = positive)")
row("Trunk at countermovement bottom", f"{trunk[bottom_i]:.1f}")
row("Trunk at takeoff", f"{trunk[takeoff_i]:.1f}")
row("Trunk at landing", f"{trunk[landing_i]:.1f}")
row("Shin at countermovement bottom", f"{shin[bottom_i]:.1f}")
row("Shin at takeoff", f"{shin[takeoff_i]:.1f}")
row("Shin at landing", f"{shin[landing_i]:.1f}")

print("\nEstimated from flight time + gravity (no calibration, approximate)")
row("Takeoff vertical speed (vy)", f"{vy:.2f} m/s")
row("Peak height of hips above takeoff", f"{peak_height_m:.2f} m")

print("\nIn pixels (need calibration to become meters)")
row("Countermovement depth", f"{cm_depth_px:.0f} px")
row("Hip rise during flight", f"{hip_rise_px:.0f} px")
row("Hip horizontal travel, takeoff to landing", f"{hip_travel_px:.0f} px")

if hip_rise_px > 5:
    implied = peak_height_m / hip_rise_px
    print("\nRough cross-check")
    row("Implied scale from gravity", f"{implied:.5f} m/px")
    row("Hip travel at that scale (rough)", f"{hip_travel_px * implied:.2f} m")
    print("  (Treat these as a sanity check only. Once you calibrate with a tape")
    print("   measure, compare the two scales. If they disagree a lot, something")
    print("   in the tracking or event detection needs a closer look.)")

print("================================")

# ---------- Plot with events marked ----------
fig, axes = plt.subplots(4, 1, figsize=(10, 10), sharex=True)
series = [
    (hip_y, "Hip height (px)", "tab:orange"),
    (ankle_y, "Ankle height (px)", "tab:blue"),
    (trunk, "Trunk angle (deg)", "tab:green"),
    (shin, "Shin angle (deg)", "tab:red"),
]
for ax, (y, label, color) in zip(axes, series):
    ax.plot(t, y, color=color)
    ax.axvspan(t[takeoff_i], t[landing_i], color="gray", alpha=0.15)
    ax.axvline(t[takeoff_i], color="k", linestyle="--", linewidth=1)
    ax.axvline(t[landing_i], color="k", linestyle="--", linewidth=1)
    ax.axvline(t[bottom_i], color="purple", linestyle=":", linewidth=1)
    ax.set_ylabel(label)
    ax.grid(alpha=0.3)

axes[1].axhline(thr, color="gray", linestyle=":", linewidth=1)
axes[0].set_title("Shaded = flight. Dashed = takeoff and landing. Purple dotted = countermovement bottom.")
axes[3].set_xlabel("Time (s)")
plt.tight_layout()
plot_path = os.path.join(OUTPUT_DIR, "events_plot.png")
plt.savefig(plot_path, dpi=150)
print(f"\nSaved plot to {plot_path}")
plt.show()
