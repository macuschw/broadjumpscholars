# JumpLab

Standing broad jump biomechanics from a single side-on phone video: jump distance,
launch angle, takeoff velocity (vx, vy), peak hip rise, trunk/shin/knee/hip angles,
flight time and ground contact time. MediaPipe Pose tracks the body; projectile physics
and vector geometry do the rest.

## Setup
1. Install Python 3.9-3.12
2. `pip install -r requirements.txt` (mediapipe is pinned to 0.10.14 on purpose)
3. Run the tests: `python -m pytest tests`
   - `tests/test_real_footage.py` is the **accuracy benchmark**: it runs the pipeline on
     keypoints from a real 120 fps jump (`tests/data/`) and checks takeoff/landing against
     frames labelled by eye (+/-2 frames). Add more labelled jumps with
     `tests/data/make_benchmark_clip.py`.
   - `tests/test_limb_snap.py` also uses real footage: a 30 fps jump with a bystander
     walking behind the jumper, where the far leg snaps onto the bystander at frame 36
     (`tests/data/bystander_jump_30fps_*`).
   - Tests marked `xfail` are known, documented inaccuracies (e.g. the default ankle
     method's early takeoff), not broken tests.

## Recording tips
- Camera on a tripod, side-on, perpendicular to the jump, whole jump in frame. Don't zoom or move it.
- Record at **120-240 fps** (slow-mo). At 30 fps every event time is only good to +/-33 ms.
- **Transfer slow-motion videos unconverted**: AirDrop with "All Photos Data" turned on, or
  Photos -> File -> Export -> "Export Unmodified Original". Otherwise the phone may save the
  clip for slowed-down playback at 30 fps, and every time comes out 4-8x too long (g ~ 0.6).
  The analysis spots this (`slow_motion_suspected`) and suggests `--fps 120`.
- **For faster processing, record at 1080p rather than 4K** (same fps). MediaPipe shrinks
  every frame to a small size internally, so 4K mostly adds decoding time: on a 5.7 s 4K
  120 fps clip, decoding alone took 7.9 of the 17 s. Recalibrate if you change resolution.
- **Keep other people out of the frame**, especially behind the jumper during the jump:
  MediaPipe tracks one person, and limbs can briefly snap onto someone overlapping them.
  Have the line wait behind the camera or well off to the side.
- For calibration, film a tape measure or two floor marks a known distance apart,
  **along the line of the jump** (same distance from the camera as the athlete).
  If the reference has to be somewhere else (e.g. in front of the jump line), measure the
  camera->reference and camera->jump line distances and pass both to `calibrate.py`
  (`--camera-to-reference 4.0 --camera-to-jump 5.0`); the scale is corrected for depth,
  because things twice as far away look half as big.

## Usage
```
# 1. Calibrate once per camera setup: click two points a known distance apart
python scripts/calibrate.py calibration_clip.mp4 --distance 2.0

# 2. Analyze a jump
python scripts/run_analysis.py jump.mp4 --calibration output/calibration.json

# Options: --start/--end (s) to pick one jump, --events toe_heel, --show, --retrack,
#          --fps 120 (the real frame rate, if the file's own is wrong)
python scripts/run_analysis.py --help

# 3. (Recommended) check the calibration with physics: toss or drop a ball in the
#    same setup - the fit should give g close to 9.81 m/s^2
python scripts/validate_ball_toss.py ball.mp4 --calibration output/calibration.json
```
Without a calibration you still get angles, times, launch angle, and estimates
from gravity alone.

Each video gets its own folder, `output/<video name>/` (or the folder you pass with `--output`).
MediaPipe runs **once** per video; keypoints are cached there as `<video>_keypoints.npz`, so
re-running with a different window or calibration is instant. Outputs in that folder:
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
| `jumplab/center_of_mass.py` | whole-body center of mass from body segments (Dempster/Winter table) |
| `jumplab/ball_tracking.py` | tracks a ball, for the ball-toss physics check |
| `jumplab/pipeline.py` | video / keypoints in -> results dict out |
| `jumplab/report.py`, `plotting.py` | printed table, CSV, JSON, plots |
| `jumplab/feet.py` | both feet: front-most takeoff toe and rearmost landing heel (official rule), label-swap safe |
| `jumplab/checks.py` | sanity checks: stops on an incomplete jump, warns (with severity and affected results) about anything suspicious |
| `jumplab/summary.py` | plain-language summary by category with reliability ratings (`scripts/summarize.py`) |

## Conventions and physics notes
- Coordinates: image y is flipped so **up is positive**.
- Segment angles (trunk = hip->shoulder, shin = ankle->knee): **0 = vertical, positive =
  forward lean**. The sign is flipped automatically by jump direction, which is taken from
  the hip's movement between takeoff and landing.
- Joint angles (knee = hip-knee-ankle, hip = shoulder-hip-knee): 180 = straight.
- `takeoff` is the first airborne frame and `landing` the first frame back on the ground, so
  flight time = (landing - takeoff) / fps.
- Ground contact time = movement onset -> takeoff; push-off time = countermovement bottom -> takeoff.
- Jump distance (the main number) uses the camera-side foot: its toe at takeoff to its heel
  at landing. The official rule uses the front-most toe and the rearmost heel of EITHER foot;
  that is reported as `jump_distance_both_feet_m`, using the hidden far foot only when
  MediaPipe sees it clearly enough (visibility >= 0.5, clearly lower than the near foot's,
  and steady to within 2 cm). A `staggered_feet` warning appears when the two distances
  differ by more than 5 cm (10% of trunk length uncalibrated). Feet are compared by position
  and visibility, never by left/right label, so MediaPipe swapping the labels can't break it.
  These thresholds are provisional until checked against tape-measured staggered landings.
- Frame rate: taken from the frames' own timestamps when the file header disagrees by more
  than 1% (one 120 fps phone clip said 116.55), noted as `fps_corrected` without lowering
  any rating.
- Trajectory: `x = x0 + vx t`, `y = y0 + vy t - g t^2 / 2`, least-squares fitted to the
  (unsmoothed) whole-body **center of mass** during flight (`--trajectory-point hip` for the
  old behaviour). CoM = sum(m_i r_i) / sum(m_i) over 14 body segments, using segment mass
  fractions and CoM locations from Dempster via Winter. By default the camera-side limbs
  are used for both sides (`--com-mode symmetric`), because MediaPipe mostly guesses the
  hidden far-side limbs. One free fit (g is fitted, not forced to 9.81) gives every
  trajectory number, read at the estimated takeoff instant (half a frame before the first
  airborne frame), so calibrated and uncalibrated runs report the same launch angle. With
  calibration, the fitted g in m/s^2 is the quality check; without it, the fitted g in
  px/s^2 gives a gravity-implied scale (m/px) to compare with your tape measure.
- The segment table is for an average (mostly male) adult body, so the CoM is an estimate.
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
- On the real-footage benchmark: `toe_heel` is within the +/-2 frame tolerance; the default
  `ankle` method finds takeoff ~7 frames early (heel lift). The default stays until the
  accuracy study.

### Warnings
The analysis **stops** if the jump isn't fully inside the clip (starts or ends mid-air, or
no landing is found). Anything else suspicious - frames where the person wasn't detected,
landmarks MediaPipe is unsure of or that leave the frame, an implausible flight time or
distance, a jump that isn't side-on, a moving start, uneven frame timing, a limb snapping
onto something else - is listed under Warnings, marked caution or serious. The summary
lowers the rating of each result the warning affects.

**Limb snapping** (`limb_snap`): a leg, hip or shoulder landmark that leaps more than 30% of
the trunk length away from where its neighbouring frames put it (40% over two frames) -
usually a limb attaching to a person behind the jumper. It is **warn-only: the data is not
changed**. The thresholds are provisional (set from 2 clean and 2 bystander clips, with one
snap confirmed by eye); once they're validated on more real videos, automatically
replacing snapped landmarks by interpolation can be reconsidered. Only the legs the results
use are warned about. Snaps on the hidden far leg are listed in `results.json` under
`tracking_quality.far_leg_snap_frames` without a warning, because no default result uses
that leg (they are warned about with `--com-mode both`, which does).
