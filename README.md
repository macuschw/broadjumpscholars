# JumpLab

Standing broad jump biomechanics from a single side-on phone video: jump distance,
launch angle, takeoff velocity (vx, vy), peak hip rise, trunk/shin/knee/hip angles,
flight time and ground contact time. MediaPipe Pose tracks the body; projectile physics
and vector geometry do the rest.

## Setup
1. Install Python 3.9-3.12
2. `pip install -r requirements.txt` (mediapipe is pinned to 0.10.14 on purpose)
3. Run the tests: `python -m pytest tests`

## Recording tips
- Camera on a tripod, side-on, perpendicular to the jump, whole jump in frame. Don't zoom or move it.
- Record at **120-240 fps** (slow-mo). At 30 fps every event time is only good to +/-33 ms.
- For calibration, film a tape measure or two floor marks a known distance apart,
  **along the line of the jump** (same distance from the camera as the athlete).

## Usage
```
# 1. Calibrate once per camera setup: click two points a known distance apart
python scripts/calibrate.py calibration_clip.mp4 --distance 2.0

# 2. Analyze a jump
python scripts/run_analysis.py jump.mp4 --calibration output/calibration.json

# Options: --start/--end (s) to pick one jump, --events toe_heel, --show, --retrack
python scripts/run_analysis.py --help

# 3. (Recommended) check the calibration with physics: toss or drop a ball in the
#    same setup - the fit should give g close to 9.81 m/s^2
python scripts/validate_ball_toss.py ball.mp4 --calibration output/calibration.json
```
Without a calibration you still get angles, times, launch angle, and estimates
from gravity alone.

MediaPipe runs **once** per video; keypoints are cached in `output/<video>_keypoints.npz`, so
re-running with a different window or calibration is instant. Outputs in `output/`:
`<video>_skeleton.mp4` (check the tracking, especially the feet), `_keypoints_and_angles.csv`,
`_results.json`, `_events_plot.png`, `_trajectory_plot.png`.

## Package layout
| Module | What it does |
|---|---|
| `jumplab/pose_tracking.py` | single MediaPipe pass -> raw keypoints (+ skeleton video), caching |
| `jumplab/calibration.py` | click-to-calibrate, meters per pixel, save/load JSON |
| `jumplab/smoothing.py` | gap interpolation + zero-lag Butterworth low-pass (10 Hz default) |
| `jumplab/angles.py` | trunk and shin angle from vertical, joint angle from 3 points |
| `jumplab/events.py` | takeoff, landing, countermovement bottom, movement onset |
| `jumplab/physics.py` | projectile fit (vx, vy, launch angle, g check), flight-time formulas |
| `jumplab/ball_tracking.py` | tracks a ball, for the ball-toss physics check |
| `jumplab/pipeline.py` | video / keypoints in -> results dict out |
| `jumplab/report.py`, `plotting.py` | printed table, CSV, JSON, plots |

## Conventions and physics notes
- Coordinates: image y is flipped so **up is positive**.
- Segment angles (trunk = hip->shoulder, shin = ankle->knee): **0 = vertical, positive =
  forward lean**. The sign is flipped automatically by jump direction, which is taken from
  the hip's movement between takeoff and landing.
- Joint angles (knee = hip-knee-ankle, hip = shoulder-hip-knee): 180 = straight.
- `takeoff` is the first airborne frame and `landing` the first frame back on the ground, so
  flight time = (landing - takeoff) / fps.
- Ground contact time = movement onset -> takeoff; push-off time = countermovement bottom -> takeoff.
- Jump distance is measured like the real test: takeoff toe -> landing heel.
- Trajectory: `x = x0 + vx t`, `y = y0 + vy t - g t^2 / 2`, least-squares fitted to the
  (unsmoothed) hip during flight. With calibration, g is fixed at 9.81 and a free fit's g is
  reported as a check. Without calibration, the free fit's g in px/s^2 gives a
  gravity-implied scale (m/px) to compare with your tape measure.
- The hip is an approximation of the center of mass.
- Flight-time-only formulas `vy = gT/2`, `h = gT^2/8` assume equal takeoff and landing height.

### Takeoff/landing detection (`--events`)
- `ankle` (default, the original method): the ankle must rise 15% of its jump height above
  the ground. On clean synthetic data this detects takeoff about 3 frames late and landing
  early, which shortens flight time and lowers vy / launch angle. On real video the ankle
  also rises during heel lift, *before* the toes leave the ground, which pushes the other way.
- `toe_heel`: detects with the toe (last contact at takeoff) and heel (first contact at
  landing), then walks each event back to where the marker is within noise of the ground.
  Within 1 frame on synthetic data, but it depends on MediaPipe's foot markers, which
  can glitch at 30 fps. Check the skeleton video and the foot panel of the events plot.
- Both flight times are printed so you can compare.
