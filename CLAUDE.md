# JumpLab: project notes for collaborators (and their Claude)

Scholars Math 2026–27 project: measure a **standing broad jump** from one phone video. Two parts in
this repo (GitHub: macuschw/broadjumpscholars):

1. **Analysis (Python, `jumplab/`, `scripts/`, `tests/`)**: MediaPipe pose tracking → smoothing →
   takeoff/landing events → parabola fit of the center of mass → distance, velocity, launch angle,
   trunk/shin/knee angles, contact times → warnings + five reliability ratings.
2. **Website (`website/`)**: static site on GitHub Pages: https://macuschw.github.io/broadjumpscholars/
   Vanilla HTML/CSS/ES modules, no build step. Republishes automatically on every push that changes
   `website/` (`.github/workflows/pages.yml`).

## Run things

```bash
python3 -m pip install -r requirements.txt          # mediapipe==0.10.14 is required (newer removed the API)
python3 -m pytest -q                                 # 197 tests should pass
python scripts/run_analysis.py "../test videos/IMG_6199.MOV" --calibration output/calibration.json
python scripts/run_session.py "../test videos/IMG_6233.MOV"     # a video with many jumps: a verdict table
python scripts/summarize.py "../test videos/IMG_6199.MOV"
node scripts/replay_live.mjs jumplab-live-track-*.json          # Measure live vs tape, from saved tracking
node scripts/check_live.mjs                          # Measure live vs the full analysis on 20 test jumps, + fouls (2 = a slow phone)
cd website && python3 -m http.server 8000           # then http://localhost:8000
```
Outputs go to `output/<video name>/` (gitignored, as are all videos). Each run writes `_results.json`,
`_keypoints_and_angles.csv`, `_keypoints.npz` (tracking cache), plots, and `_web.json` (for the website).

## Accuracy: what we know (tape-checked, Oct 2026)

- Feet-together landing: within ~0.3 in of the tape. Staggered feet: off by 1.5–5 in, because one
  side-on camera can't see the far foot. The code flags it (`checks.check_stagger`, SERIOUS) as a big
  banner + "APPROXIMATE" marker + final "CHECK THIS JUMP" line (`jumplab/alerts.py`).
- Tried and rejected: both-feet correction, measuring from the takeoff line (both made errors worse).
  A real fix needs a second camera or ~10 more tape-measured staggered jumps. (Oct 27: the both-feet
  number was pulled ~10 cm short by perspective, below; worth re-testing now that's removed.)
- **Perspective** (Oct 27, `feet.perspective_shift`, also `live/detect.js`): the far foot is ~a stance
  width (`DEPTH_M` 0.25 m) further from the camera, so it shows up shifted toward the picture's middle by
  (x - cx) * DEPTH_M / Z, Z = focal (0.73 x the long side, a phone's ~69 degree lens) x scale. Away from
  the middle that read as staggered feet: the Oct 27 live session (takeoff 650 px off center, feet side by
  side) had toes "12-17 cm apart" while standing, and every left-right body pair (heels, ankles, knees,
  hips, shoulders) shifted the same way. The far foot is now moved back by the shift before comparing,
  and gaps within 30% of it (`PERSPECTIVE_SLACK`) aren't called staggered. Real data: 19 of 20 jumps
  flagged -> 4 (step-forward foul, stumble foul, tracker on someone behind, one ~7 cm landing gap);
  live "feet apart" on the 20 test jumps 18 -> 9; distances unchanged. Trade-off: a small takeoff
  stagger (< ~8-9 cm) near the frame's edge can't be told from perspective with one camera. The
  synthetic jumper now sees through a lens too (`perspective=True`). Hip-based estimates of the shift
  were tried and rejected: baggy dark clothes hide the hips (IMG_6233).
- Blur: tracking records each frame's athlete sharpness (Laplacian variance of a 240 px crop around
  the body). `checks.check_blur`: median during the jump < 250 → SERIOUS, < 500 → CAUTION. Our real
  clips score 780–4400; the same clip Gaussian-blurred scores 20–310. Older `_keypoints.npz` files
  have no sharpness, so the blur check only runs on newly tracked videos.
- Other people in the shot: after tracking and a first analysis, a short second pass over the
  video (0.5 s before the dip to 1 s after landing, ~10 checks a second, ~1 s in all) covers the
  athlete in gray and asks MediaPipe for another body (`pose_tracking.scan_for_others`,
  `pipeline.look_for_others`). `checks.check_other_people` ignores bodies under 30% of the athlete's
  height or seen in fewer than 3 checks (false hits on a building corner / a speck). SERIOUS if
  they come within 0.25x the athlete's height, or switch sides unseen (= passed right behind the
  jumper while covered), between the dip and 0.5 s after landing; otherwise CAUTION. On our 15
  videos it flags exactly the 3 with someone walking behind (Jump 7, bjbd1, bjbg2). Seeking uses
  the tracked frame timestamps, because it lands late on files with uneven frame timing.
- Fouls (`checks.check_landing`, in every analysis: `results["valid"]`, `results["fouls"]`, kept apart
  from the reliability warnings): a foot lands > 0.22 standing heights **ahead of the front foot's**
  landing spot within 1 s (stumbled forward), or > 0.20 **behind the rear foot's** within 1.5 s (stepped
  back: it moves the mark); a hand within 0.04 of floor level for >= 0.25 s while barely moving (put
  down, not swung past); a knee within 0.07 or the hips within 0.09 of the floor for >= 0.15 s (fell:
  `foul_fell`; our deepest valid landing squats reach 0.17 / 0.14, but no real fall has been filmed yet).
  Bringing the back foot up to the front one is fine. Tuned on one example of each (the session video
  below) against 22 valid landings, so provisional: more fault videos wanted.
- Sessions (one video, many jumps; `jumplab/session.py`): every jump is found (the quick look, below),
  then analyzed on its own stretch with the other jumps blanked out, so two athletes taking turns never
  mix. A candidate with an impossible flight time and no downward-curving path is skipped as "not a
  jump" (walking off fast from the landing squat). Benchmark: `tests/data/multi_jump_120fps_*`
  (IMG_6233, 8 jumps by Reece and Macus, the last 3 failed; answer key by eye) -> all 8 found, every
  verdict and foul right.
- **Uneven frame timing** (phone browsers record live video at a variable rate): when
  `check_frame_timing` finds drift over half a frame, every time, duration and the flight fit use the
  frames' own timestamps (`pipeline._real_times`) and the note is information. Oct 27 session: effect
  under 1%. `low_fps` is information too (the ground-contact rating already says rough), and no
  `fps_override` note when the set rate matches the file. Live jumps went from 3-6 cautions each to 0-1.
- **Open: early takeoff at 30 fps.** With the default `ankle` events, takeoff is sometimes found at the
  heel raise, 6-8 frames before the toes leave (Oct 27 jumps 6-7: flight 0.70-0.77 s, launch angle up to
  54 deg, a gravity "scale mismatch" and a false "slow motion suspected"). Distance is unaffected. The
  `toe_heel` method fixes jump 6 (0.43 s) and jump 1's mismatch; switching the default needs a check
  against tape-measured jumps first.
- Every warning code has plain words in `alerts.PLAIN` (headline / what happened / how to fix);
  a test fails if a new code is added without them. On the website, serious problems show as a red
  panel right above the numbers, and the stats they affect (the warning's `affects`) get a
  "Not reliable" tag.

## Website state

- Pages: Home (3D draggable hero, the problem, call to action; no testimonials), How it works,
  Metrics (3D sculpted mannequin, drag 360°, in-scene metric overlays + callout labels), Setup,
  Science (KaTeX formulas, tabs; "The math" tab: every formula with a worked example from the Oct 27
  session and the file that does it: keep it in step with the code), About (team: Reece, Macus), Analyze
  (upload your own video; the header's "Upload a video" button), Demo (the simulated sample jump, its own
  page). Both use one script (`pages/demo.js`, picks by `<body data-page>`) and one shared dashboard
  markup (`demo/dashboard-html.js`).
- Spelling: American throughout (analyze, meter, center, color), site and analysis messages alike.
- Units switch m / ft in the header (`assets/js/lib/units.js`); all lengths/speeds go through it.
- Design rules are in `website/DESIGN.md` (one accent color, flat buttons, motion tokens, reduced motion).
- Shared 3D code: `assets/js/components/scene-3d.js` (lane, lights, studio light, both mannequins).

### Analyze page: real analyses
- **Open results** works now: drop a `_web.json` (+ the video) → real numbers, video with tracked
  skeleton, ratings/warnings, charts, compare. `python scripts/export_web.py output` rebuilds these
  for old runs.
- **Upload a video** needs the analysis server: `server/modal_app.py` (Modal, free while idle).
  Deploy: `python3 -m pip install modal && python3 -m modal setup && python3 -m modal deploy server/modal_app.py`,
  then put the printed `.modal.run` URL into `website/assets/js/config.js` → `ANALYSIS_URL`.
  **Status: deployed and live** at https://macuschw--jumplab-analysis-web.us-east.modal.run (Modal workspace
  "macuschw", free Starter plan: $1 credit until a payment method is added, ~400-500 analyses). Redeploy after
  changing `jumplab/` or `server/`. Cloud results can differ from a Mac run by a few mm / ~2% (MediaPipe on Linux).
  Local test server: `python scripts/serve_local.py`, then open the local site's
  `analyze.html?server=http://localhost:8765`.
- Uploads are background jobs (`jumplab/jobs.py`), because Modal caps one web request at 150 s (and
  its redirect workaround doesn't work cross-origin): the page sends the video in 8 MB pieces
  (`PUT /jobs/<id>/<i>`, each retried), starts the job, then polls `GET /jobs/<id>` every 2 s for
  progress and the result. On Modal the pieces and result live in the Volume "jumplab-jobs", states in
  the Dict "jumplab-job-states", and the analysis runs in `process_job`; locally, a temp folder and a
  thread. The video is deleted when the analysis ends, the result once collected. Responses are
  gzipped. The old one-request `POST /analyze` still works (first jump only). A job's pieces can also be
  read back before it starts (`GET /jobs/<id>/<i>`) and deleted (`DELETE /jobs/<id>`): how Measure live's
  phone hands its recording to a remote screen. Leftovers go after an hour (`tidy_jobs`, hourly on Modal:
  the app's only scheduled function; the free plan allows 5).
- Every upload is a session: the quick look (clips over 6.5 s; MediaPipe on 5 frames/s, following up
  to two people, so someone walking behind can't hide a jump) finds every crouch followed by fast
  sideways hip travel; only 2.5 s before to 1.8 s after each is tracked (`find_jumps`,
  `track_segments`; `Keypoints.segment`). Shorter clips, or if nothing is found, are tracked whole.
  Each jump's bundle keeps only its own stretch (`landmarks.offset`; the site pads it back out).
  IMG_6233 (71 s, 8 jumps): ~2 min on a Mac. On Modal earlier: 38 s clip 34 s → 11.5 s.
- Flow: upload → jobs → session (every jump's bundle, each with its verdict, + one still) → visitor
  clicks the tape once → `/recompute` for every jump with that scale (keeps the jump number).
  The site lists the jumps (✓ counts, ✗ crossed out, best that counts marked), a red "This jump
  doesn't count" panel and a "Doesn't count" tag on the distance for fouls. Download saves the
  whole session (`jumplab-session/1`); each jump also goes into My jumps ("<video> · jump N").
- Shared server logic: `jumplab/web.py` (`make_bundle`, `analyze_session_upload`, `recompute`, `handle`).
- **Measure live** (`live/live.js`, `live/detect.js`; Analyze page card "Measure live"): the phone's camera
  in the browser. MediaPipe Tasks for Web (`@mediapipe/tasks-vision@0.10.14` from jsDelivr, the
  pose_landmarker_full model from Google's model storage, ~10 MB on first use) tracks every frame on the
  phone; nothing is uploaded while measuring. Set the scale on a camera frame (same calibration screen,
  no Skip), then each jump's distance (toe planted before takeoff -> heel just after landing, as in the
  full analysis) shows once the landing is held: "Checking the landing…" for up to 1.5 s, then the
  distance, or, said instead of it, why it doesn't count (the full analysis's foul rules, in `detect.js`:
  stepped forward / back, hand down, fell; red box, distance struck through, in the list too). On our
  20 test jumps (3 fouls) every verdict is right at 30, 15 and 10 frames/s. Stop during the check: the jump
  counts but is marked unsure ("stopped"), as when the jumper wasn't tracked for most of the landing
  ("unseen"). A m / ft switch sits on the live screen and the remote (the header's setting). "Save the
  results" (after Stop, phone or remote) downloads a CSV: each jump, counts / why not, m and ft-in, feet
  apart, unsure, tape, its time in the recording. File names use local time. A jump = a dip (< 85% standing height in the 1.2 s
  before), both feet > 6% of body height off the floor, the hips rising >= 6% and moving forward >= 0.3,
  0.15-1.0 s in the air. Marked "unsure" when the tracked body teleports (tracker switched to someone
  else). The session is recorded (MediaRecorder, video only; a format that records nothing is swapped:
  some browsers claim MP4 and write nothing): "Get the full data" uploads it with the scale already set
  (no second calibration; each jump shows its live result next to the full one), "Save the video"
  downloads it for later. Checked on our videos at 30 fps: all 21 jumps found, no false ones; live vs
  full analysis within ~1% typically, 5% worst (browser tracker), Jump 2 of IMG_6233 (person behind)
  -14% and marked unsure. Phone cameras give 30-60 fps in a browser (no slow motion): fine for the
  distance, not for timing. Used on real phones since Oct 26 (later tests with the setup guide: about spot on).
  Hands-off use (a phone on a tripod is hard to tap): a Camera picker (shown when there are 2+
  cameras; locked once the scale is set; remembered by label in `jl-live-camera`). On a laptop an
  iPhone camera is picked automatically the first time (Mac Continuity Camera: the iPhone on the
  tripod, everything clicked on the laptop; the live card says so on non-touch screens). Each distance
  is said out loud (`speechSynthesis`, toggle remembered in `jl-live-speak`; "Ready" is spoken on the
  "Use this scale" tap, which also unlocks speech on iPhones). The result stays up until the next jump
  (faded while that one is in the air), Full screen button / double-click for reading it from afar.
  Accuracy (Oct 26): first real test read ~3 in long, often over. Replaying the live detector on our
  own Python tracking (IMG_6233 at 24-120 fps, two single jumps) gave the same distances as the full
  analysis within ~1-2%, no long bias, so the over-reading is likely the browser tracker or the live
  camera picture (blur at 30 fps, exposure), not the measuring method: next test with tape + "Get the
  full data" on the same recording. The live distance is labeled a "live estimate".
  **Save tracking data** (on the phone after Stop, under "Checking accuracy?"): type each jump's tape
  reading, then download `jumplab-live-track-*.json` (every tracked frame, scale, calibration still,
  live jumps, tapes; no video). `node scripts/replay_live.mjs FILE...` replays it through `detect.js`
  and prints live vs tape per jump plus mean error and spread (`--detector` to try a changed one).
  Tracker switches are also caught by the body growing/shrinking 30% within 0.1 s while moving fast
  (`RESIZE`): at 30 fps IMG_6233 jump 2 (person behind, -15%) wasn't marked unsure before.
- **Live accuracy (Oct 26)**: `scripts/check_live.mjs` replays what the browser tracker saw on our 13 test
  videos (`tests/data/live_frames.json`, 30 fps) through `detect.js` and compares each jump with the full
  analysis (`tests/data/live_reference.json`). The toe is now its median while planted from the bottom of
  the dip to takeoff, the heel over the first 0.25 s down: mean -0.2%, worst 1.2% at 30 fps; 1.3% at 15;
  2.6% at 10 (was -0.7% / 3.4%: the last 0.2 s caught the toe already rolling). The live method doesn't
  read long; a real-world "3-5 in too far" points at the setup (tape further from the camera than the
  feet) or feet apart: one camera measures the near foot, the tape rule the front toe and back heel. On
  the test jumps the toes were 6-18 cm apart at takeoff by the tracker (live and full agree within a few
  px), which would read 2-7 in long, but the October tape check found the far foot unreliable, so the
  tape check below is how to find out. (Both live checks agree: replaying our own Python tracking at
  24-120 fps also matched the full analysis within ~1-2%; see the paragraph above.)
- Live also: **feet apart** (toes or heels > 5 cm apart along the jump, the full analysis's rule) is shown
  on the result, said, and marked in the list; the **tracking rate** is shown (warning under 12 frames/s);
  a **setup guide** (diagram: tape on the camera side of the feet, camera square, 4-5 m back, toes level,
  land together) sits in Measure live, the remote screen and their calibration screen (`tips: true`).
- **Tape check** (`live/tapelog.js`): "Add the tape" on any live jump, on the phone or the remote (sent to
  the other side), logs live, tape, feet gaps and tracking rate on that device (localStorage
  `jl-tape-log`); "Get the full data" adds the full analysis's distance. The Analyze page's Tape check panel
  lists them, downloads a CSV, clears. From 5 checks on, "Correct live distances by X" (the median of
  tape - live, a constant offset) can be switched on per device; corrected values say "corrected".
  The "Save tracking data" boxes after Stop start with these tapes, and readings typed there join the log.
- **Leaving**: closing or reloading the tab asks first while measuring, while a finished session's
  recording hasn't been saved or sent for the full analysis, while a remote screen is running a phone,
  and during an upload. Back / Measure again ask too (the remote's Measure again: the phone's recording
  would be lost). If "Get the full data" fails or is canceled, the error offers "Save the video" (the recording
  exists only in that tab) and asks before "Try another video" or closing the tab.
- **Remote screen** (`live/remote.js`, `live/room.js`, server `jumplab/rooms.py`; the Measure live card's
  "Remote screen" button): a laptop or second phone shows the distances (big, said out loud) and runs the
  phone on the tripod: Set the scale (the phone sends a full frame, the tape is marked on the remote),
  Stop, Measure again. It shows a 6-character code + QR code (qrcode-generator@1.4.4 from jsDelivr) for
  `analyze.html?camera=CODE`; scanning it opens Measure live already linked (or type the code under
  "Use a remote screen"). No accounts or Apple IDs involved. The two never talk directly: each writes its
  own slot in a room on the server and reads the other's (~1/s): "phone" {session, stage, status, air,
  jumps}, "preview" (480 px picture + skeleton, every 1 s, 3 s while measuring, only while the remote
  is there), "still", "remote" {cmds}. A jump reaches the remote ~0.5-1 s after it's judged. The linked
  phone goes quiet while the remote is watching (it talks again when the remote has been gone 15 s).
  After Stop the remote can **Get the full data here** / **Save the video here** / **Save the results**:
  it sends "video", the phone uploads its recording as an unstarted job (`demo/server.js` `uploadVideo`;
  progress in its "phone" slot), the remote downloads the pieces (`downloadVideo`), tells the phone "kept",
  then either starts that same job (no second upload; `analyzeSession({ uploaded })`, results on the
  laptop) or saves the file and deletes the server copy (`forgetVideo`; also when the remote leaves, and
  by the phone on leaving if the remote never took it). Rooms are forgotten an hour after the last message. On Modal it
  is its own small function `rooms` (0.25 CPU, one container, rooms in memory + saved to the Dict
  "jumplab-rooms" in the background; ~1 cent/hour while in use), URL in `config.js` ROOMS_URL; locally
  `scripts/serve_local.py` serves /rooms too. `?remote=CODE` keeps a reloaded remote on its room.
  Works with a real phone on the tripod + a remote screen (Oct 2026).
- Calibration (`demo/calibrate.js`), made for phones after a real iPhone test: drag markers A and B
  (they move with the finger, never jump under it; tapping elsewhere brings the selected one), a 4x
  close-up of the selected marker under the picture, arrow buttons that nudge it one pixel, the
  markers starting where they were last time on this device. Tape length in m or ft + in (remembered;
  "3,66" works too). The button says what's missing; Skip needs a second tap.
- **My jumps** (`demo/history.js`): every real jump (upload or opened `_web.json`) is saved as its bundle in
  this browser's IndexedDB, listed under the upload card on Analyze (open, rename, compare up to 6, delete,
  clear). Comparing 2+ opens straight on the Compare tab; each jump gets one of six line styles
  (`line-chart.js` DASH), and pointing at a jump in the list picks out its path.
  No accounts, nothing on a server; videos aren't kept (playback offers "Add the video"). Same analysis
  twice isn't listed twice. Always shown: "Jumps you analyze will appear here." while empty, or a note
  pointing to Download results if the browser blocks storage.

## How we work

- **Both of us work in this repo now. Run `git pull` before editing anything**, and push soon after
  finishing, so the two of us rarely change the same file at once.
- Edit the site in `website/` directly. (The old separate `jumplab-site` folder is retired: copying
  it over `website/` would undo the other person's changes.)
- Keep placeholders as placeholders until real ones are supplied.
- Verify UI changes in a browser at desktop and phone widths; run `pytest` after Python changes.

## Open to-dos / ideas
- Test an upload from a real phone (large 4K slow-motion files; iPhone HEVC playback).
- Pick a final project name if "JumpLab" changes.
- Accuracy page (parked in `website/_parked/`) could return with the tape-check data.
- Collect more tape-measured jumps (esp. staggered) to validate / correct.
