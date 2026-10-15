# JumpLab website (working name)

Front-end-only site for JumpLab: standing broad jump analysis from one phone camera.
Seven pages, a persistent nav, and an interactive demo dashboard. **All numbers are
simulated demo data**; there is no backend, login or payment.

## Run it

The scripts are ES modules, so the site needs a local web server (opening the HTML files
directly from Finder won't load them):

```bash
cd jumplab-site
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Publish it

The live site is <https://macuschw.github.io/broadjumpscholars/> (GitHub Pages, free for a public
repo). This folder is copied into `website/` in the broadjumpscholars repo, and every push that changes
`website/` republishes it within a minute or two (`.github/workflows/pages.yml`; progress shows in the
repo's Actions tab). The notes (`*.md`) and the parked Accuracy page aren't published. From the
broadjumpscholars folder:

```bash
rsync -a --exclude '.DS_Store' "../jumplab-site/" website/ && git add website && git commit -m "Update website" && git push
```

## Pages

| Route | Page |
|---|---|
| `index.html` | Home: pitch, interactive 3D jump with a timeline, the problem, testimonials (placeholder quotes), and a call to action into the sample analysis |
| `how-it-works.html` | Record → Track → Calculate → Improve |
| `metrics.html` | The six metrics on one interactive athlete figure (`?m=trunk` deep-links a metric) |
| `setup.html` | Top-down camera diagram + pre-recording checklist |
| `science.html` | Three tabs: the pipeline and its formulas; a worked example (parabola fitted live to the sample flight); calibration with depth correction and three short "why" answers (`#example` and `#calibration` link straight to a tab) |
| `demo.html` | Dashboard: upload or sample → simulated analysis → results with the 3D playback (`#sample` skips the start screen) |
| `about.html` | Team ([NAME 1], [NAME 2]), audiences, FAQ |

The home testimonials are **placeholder quotes**, marked with a "Placeholder quotes" tag. Before
sharing the site, replace each quote, `[NAME]` and role in `index.html` with a real quote from someone
who has used JumpLab (with their permission), then remove the tag.

The Accuracy page (placeholder validation table and known limitations) is parked in
`_parked/` for now, with steps to restore it in `_parked/README.md`.

## Code layout

```
assets/
  css/  tokens.css      colour, type, spacing tokens (the design system)
        base.css        reset, typography, layout primitives, reduced motion
        components.css  nav, buttons, scoreboard stats, tables, tabs, charts, footer
        pages.css       per-page layouts (one section per page)
        demo.css        dashboard
  js/   data/mock-data.js       THE ONLY SOURCE OF NUMBERS (simulated jumps, placeholders)
        lib/body.js             2-D body model (segment angles from vertical, forward +, knee IK)
        lib/fit.js              least-squares fit: the projectile fit used on the Science page
        lib/dom.js, motion.js   tiny helpers; reduced-motion awareness
        lib/reveal.js           below-the-fold blocks play their entrance when scrolled into view
        lib/units.js            metric / imperial switch: formatting, remembered choice, change events
        components/             site-chrome (header/footer), athlete figure, scene,
                                line chart, stat, tabs, icons, scrubber (jump timeline),
                                jump-stage (picks 3D or 2D; view toggle; drag-to-scrub),
                                jump-stage-3d (three.js) and jump-stage-2d (fallback)
        demo/                   playback, charts, compare, simulated analysis
        pages/                  one small script per page
```

## The 3D hero

The home page athlete and the demo playback are drawn with [three.js](https://threejs.org) r160, loaded from the
jsDelivr CDN when the page opens (about 670 KB, cached after the first visit). It's a simple
mannequin driven by the same simulated jump as the rest of the site, with near and far limbs
set apart side to side. A 3D / Side toggle switches between a three-quarter view and a level
side-on view from hip height, which is what the phone sees in a real recording. On the home page,
dragging the athlete (or the rotate buttons / arrow keys) orbits the camera around it without
changing the moment; the timeline moves time and keeps the chosen angle. If the CDN can't be reached within 5 seconds or the browser has no WebGL,
the same timeline drives the flat 2D athlete instead, so the page always works. To serve
three.js yourself, download that file into the site and change the import at the top of
`assets/js/components/jump-stage-3d.js`.

## Units (m / ft)

The switch in the header shows every distance and speed in metric (2.21 m, 3.34 m/s) or imperial
(7 ft 3½ in, 10.9 ft/s), and the choice is remembered on that device. The data stays in metres and
seconds; `assets/js/lib/units.js` formats it for display, and each page redraws its numbers, charts and
the 3D tape when the choice changes. Fixed wording in the HTML gives its imperial version in a
`data-imperial` attribute (e.g. `<span data-imperial="13–16 ft">4–5 m</span>`), and a typeset formula
with a number in it uses `data-tex-imperial`. When adding a new distance or speed to a page, format it
with `formatQuantity` / `quantityHTML` from `units.js` rather than writing "m" by hand.

## Maths typesetting

Formulas on the Science page are written in LaTeX (the `data-tex` attribute on each formula) and
typeset by [KaTeX](https://katex.org) 0.16.11 from the jsDelivr CDN. To change a formula, edit its
`data-tex` and, ideally, the plain HTML fallback inside the same element, which is what shows if
KaTeX can't load.

## How the sample jump is simulated

`mock-data.js` drives the hip (the stand-in for the centre of mass) along one smooth path:
a countermovement dip, a push-off that ends at exactly the takeoff velocity, a projectile
flight (`y = y0 + vy·t − ½gt²`), and a landing that brakes it to a stop over about 0.3 s.
The feet stay planted (toe at takeoff, heel after landing) and the knees are solved to fit,
so nothing slides, floats or jumps between frames: hip velocity is continuous through takeoff,
the knee extends all the way through push-off, and no foot ever goes below the floor.

## Replacing the demo data with real results

Everything shown comes from `assets/js/data/mock-data.js`. Each attempt has `frames`
(time, hip position, pose landmarks, trunk/shin/knee angles), `events` (onset, bottom,
takeoff, peak, landing frame numbers) and `metrics` (distance, vx, vy, launch angle,
peak height, flight/contact/push-off time, takeoff angles). These match the fields in the
analysis pipeline's `results.json` and `keypoints_and_angles.csv`, so a real attempt can be
converted to the same shape and dropped in. Remove the "Demo data" labels only then.

## Accessibility

Skip link, visible focus on every control, ARIA tabs with arrow keys, keyboard-operable
charts (focus a chart, then use the arrow keys) with data-table fallbacks, live regions for the
metric explainer and analysis progress, 44 px touch targets, contrast checked (see
DESIGN.md), and `prefers-reduced-motion` respected: the hero is a still image, numbers
appear without counting, page and tab changes are instant, and nothing autoplays.
