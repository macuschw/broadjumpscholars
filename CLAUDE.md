# JumpLab: project notes for collaborators (and their Claude)

Scholars Math 2026–27 project: measure a **standing broad jump** from one phone video. Two parts in
this repo (GitHub: macuschw/broadjumpscholars):

1. **Analysis (Python, `jumplab/`, `scripts/`, `tests/`)**: MediaPipe pose tracking → smoothing →
   takeoff/landing events → parabola fit of the centre of mass → distance, velocity, launch angle,
   trunk/shin/knee angles, contact times → warnings + five reliability ratings.
2. **Website (`website/`)**: static site on GitHub Pages: https://macuschw.github.io/broadjumpscholars/
   Vanilla HTML/CSS/ES modules, no build step. Republishes automatically on every push that changes
   `website/` (`.github/workflows/pages.yml`).

## Run things

```bash
python3 -m pip install -r requirements.txt          # mediapipe==0.10.14 is required (newer removed the API)
python3 -m pytest -q                                 # 160 tests should pass
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

## Website state

- Pages: Home (3D draggable hero, testimonials = **placeholder quotes**, call to action), How it works,
  Metrics (3D sculpted mannequin, drag 360°, in-scene metric overlays + callout labels), Setup,
  Science (KaTeX formulas, tabs), About (team names are placeholders `[NAME 1]`/`[NAME 2]`), Demo.
- Units switch m / ft in the header (`assets/js/lib/units.js`); all lengths/speeds go through it.
- Design rules are in `website/DESIGN.md` (one accent colour, flat buttons, motion tokens, reduced motion).
- Shared 3D code: `assets/js/components/scene-3d.js` (lane, lights, studio light, both mannequins).

### Demo page: real analyses
- **Open results** works now: drop a `_web.json` (+ the video) → real numbers, video with tracked
  skeleton, ratings/warnings, charts, compare. `python scripts/export_web.py output` rebuilds these
  for old runs.
- **Upload a video** needs the analysis server: `server/modal_app.py` (Modal, free while idle).
  Deploy: `python3 -m pip install modal && python3 -m modal setup && python3 -m modal deploy server/modal_app.py`,
  then put the printed `.modal.run` URL into `website/assets/js/config.js` → `ANALYSIS_URL`.
  **Status: code done and tested locally; not yet deployed (needs the team's Modal account).**
  Local test server: `python scripts/serve_local.py`, then open the local site's
  `demo.html?server=http://localhost:8765`.
- Flow: upload → server tracks (MediaPipe) + analyses → returns bundle + a still → visitor clicks the
  tape ends → `/recompute` with the scale (re-analyses saved landmarks, < 1 mm difference).
- Shared server logic: `jumplab/web.py` (`make_bundle`, `analyze_upload`, `recompute`, `handle`).

## How we work

- The original author edits the site in a separate local folder and copies it into `website/` with
  `rsync` before pushing. **Agree on one place to edit the site** (e.g. everyone edits `website/`
  directly from now on) or changes can be overwritten. Always `git pull` before starting.
- Keep placeholders as placeholders (names, testimonial quotes) until real ones are supplied.
- Verify UI changes in a browser at desktop and phone widths; run `pytest` after Python changes.

## Open to-dos / ideas
- Deploy the Modal server and set `ANALYSIS_URL`.
- Replace placeholder testimonials and team names; pick a final project name ("JumpLab" is a working name).
- Accuracy page (parked in `website/_parked/`) could return with the tape-check data.
- Collect more tape-measured jumps (esp. staggered) to validate / correct.
