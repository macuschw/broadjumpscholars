"""Plots for pipeline results."""
from __future__ import annotations

import numpy as np


def plot_events(r, path=None, show=False):
    """4 panels (hip, ankle/toe/heel, trunk, shin) with flight shaded and events marked."""
    import matplotlib.pyplot as plt

    s, ev = r["series"], r["events"]
    t = s["time_s"]
    to, la = ev["takeoff"]["time_s"], ev["landing"]["time_s"]
    bo, on = ev["countermovement_bottom"]["time_s"], ev["movement_onset"]["time_s"]

    fig, axes = plt.subplots(4, 1, figsize=(10, 10), sharex=True)
    axes[0].plot(t, s["hip_y_px_up"], color="tab:orange")
    axes[0].set_ylabel("Hip height (px)")
    axes[1].plot(t, s["ankle_y_px_up"], color="tab:blue", label="ankle")
    axes[1].plot(t, s["toe_y_px_up"], color="tab:cyan", linewidth=1, label="toe")
    axes[1].plot(t, s["heel_y_px_up"], color="tab:purple", linewidth=1, label="heel")
    axes[1].axhline(r["_thresholds"]["takeoff"], color="gray", linestyle=":", linewidth=1)
    axes[1].set_ylabel("Foot height (px)")
    axes[1].legend(loc="upper left", fontsize=8)
    axes[2].plot(t, s["trunk_angle_deg"], color="tab:green")
    axes[2].set_ylabel("Trunk angle (deg)")
    axes[3].plot(t, s["shin_angle_deg"], color="tab:red")
    axes[3].set_ylabel("Shin angle (deg)")
    axes[3].set_xlabel("Time (s)")
    for ax in axes:
        ax.axvspan(to, la, color="gray", alpha=0.15)
        ax.axvline(to, color="k", linestyle="--", linewidth=1)
        ax.axvline(la, color="k", linestyle="--", linewidth=1)
        ax.axvline(bo, color="purple", linestyle=":", linewidth=1)
        ax.axvline(on, color="gray", linestyle=":", linewidth=1)
        ax.grid(alpha=0.3)
    axes[0].set_title("Shaded = flight. Dashed = takeoff/landing. Purple dotted = countermovement "
                      "bottom. Gray dotted = movement onset.", fontsize=9)
    plt.tight_layout()
    if path:
        fig.savefig(path, dpi=150)
    if show:
        plt.show()
    plt.close(fig)


def plot_trajectory(r, path=None, show=False):
    """Path of the fitted point (center of mass or hip; image x vs height) with the
    fitted parabola over the flight phase."""
    import matplotlib.pyplot as plt

    s, tr = r["series"], r["trajectory"]
    point = tr.get("point", "hip")
    label = "center of mass" if point == "com" else "hip"
    x, y = s[f"{point}_x_px_raw"], s[f"{point}_y_px_up_raw"]
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(x, y, ".", color="lightgray", label=f"{label} (all frames)")
    to, la = r["events"]["takeoff"]["frame"], r["events"]["landing"]["frame"]
    ax.plot(x[to:la], y[to:la], "o", color="tab:orange", label=f"{label} in flight")
    if "fit_px" in tr:
        f = tr["fit_px"]
        tt = np.linspace(0, s["time_s"][la] - f.get("t0_s", s["time_s"][to]), 100)
        ax.plot(f["x0"] + f["vx"] * tt, f["y0"] + f["vy"] * tt - 0.5 * f["g"] * tt ** 2, "-",
                color="k", label=f"parabola fit (launch {tr.get('launch_angle_deg', float('nan')):.1f} deg)")
    ax.set_xlabel("x (px)")
    ax.set_ylabel("height (px, up)")
    ax.set_aspect("equal", adjustable="datalim")
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    plt.tight_layout()
    if path:
        fig.savefig(path, dpi=150)
    if show:
        plt.show()
    plt.close(fig)
