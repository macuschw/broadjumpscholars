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
python3 -m pytest -q                                 # 173 tests should pass
python scripts/run_analysis.py "../test videos/IMG_6199.MOV" --calibration output/calibration.json
python scripts/summarize.py "../test videos/IMG_6199.MOV"
cd website && python3 -m http.server 8000           # then http://localhost:8000
```
Outputs go to `output/<video name>/` (gitignored, as are all videos). Each run writes `_results.json`,
`_keypoints_and_angles.csv`, `_keypoints.npz` (tracking cache), plots, and `_web.json` (for the website).

## Accuracy: what we know (tape-checked, Oct 2026)

- Feet-together landing: within ~0.3 in of the tape. Staggered feet: off by 1.5–5 in, because one
  side-on camera can't see the far foot. The code flags it (`checks.check_stagger`, SERIOUS) as a big
  banner + "APPROXIMATE" marker + final "CHECK THIS JUMP" line (`jumplab/alerts.py`).
- Tried and rejected: both-feet correction, measuring from the takeoff line (both made errors worse).
  A real fix needs a second camera or ~10 more tape-measured staggered jumps.
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
- Every warning code has plain words in `alerts.PLAIN` (headline / what happened / how to fix);
  a test fails if a new code is added without them. On the website, serious problems show as a red
  panel right above the numbers, and the stats they affect (the warning's `affects`) get a
  "Not reliable" tag.

## Website state

- Pages: Home (3D draggable hero, testimonials = **placeholder quotes**, call to action), How it works,
  Metrics (3D sculpted mannequin, drag 360°, in-scene metric overlays + callout labels), Setup,
  Science (KaTeX formulas, tabs), About (team names are placeholders `[NAME 1]`/`[NAME 2]`), Analyze
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
- Auto-trim (uploads only, clips over 6.5 s): a quick look (MediaPipe on 5 frames/s) finds the crouch
  followed by fast sideways hip travel, then only 2.5 s before to 1.8 s after it is tracked
  (`pose_tracking.track_jump`; `Keypoints.segment`, and the analysis stays inside it). If that stretch
  doesn't hold a whole jump, the whole video is tracked. On Modal: 38 s clip 34 s → 11.5 s, 11 s
  slow-mo clip 35 s → 20 s. Found the jump in all 14 test videos. Results move by MediaPipe's own
  run-to-run noise (~1 px, a few mm), and the "standing" reference is now just before the jump
  (fixed Jump 7's contact time and a false "not side-on"). The command line still tracks everything.
- Flow: upload → server tracks (MediaPipe) + analyzes → returns bundle + a still → visitor clicks the
  tape ends → `/recompute` with the scale (re-analyzes saved landmarks, < 1 mm difference).
- Shared server logic: `jumplab/web.py` (`make_bundle`, `analyze_upload`, `recompute`, `handle`).

## How we work

- **Both of us work in this repo now. Run `git pull` before editing anything**, and push soon after
  finishing, so the two of us rarely change the same file at once.
- Edit the site in `website/` directly. (The old separate `jumplab-site` folder is retired: copying
  it over `website/` would undo the other person's changes.)
- Keep placeholders as placeholders (names, testimonial quotes) until real ones are supplied.
- Verify UI changes in a browser at desktop and phone widths; run `pytest` after Python changes.

## Open to-dos / ideas
- Test an upload from a real phone (large 4K slow-motion files; iPhone HEVC playback).
- Replace placeholder testimonials and team names; pick a final project name ("JumpLab" is a working name).
- Accuracy page (parked in `website/_parked/`) could return with the tape-check data.
- Collect more tape-measured jumps (esp. staggered) to validate / correct.
