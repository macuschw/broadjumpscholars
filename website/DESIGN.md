# JumpLab design notes

Direction: a bold athletic sports brand that stays credible enough for an athletics
department or sports-science lab. Built from the brief, with the *UI UX Pro Max* skill
as the foundation for layout, typography, accessibility and chart rules.

## From the UI/UX skill
- **Typography:** Barlow Condensed (display, numbers) + Barlow (body). The skill's
  sports/athletic pairing.
- **Pattern:** hero-centric home with one primary action, a sticky nav action, and a static
  hero under reduced motion.
- **Charts:** SVG line charts, series told apart by line style and direct labels (not color
  alone), keyboard cursor, visible data-table fallback.
- **UX:** skip link, full keyboard navigation, no content hidden by the sticky nav, 44 px
  targets (the hero timeline's Takeoff / Peak / Landing shortcuts are 24 px, the WCAG 2.2
  minimum, because the slider and play button already cover them), 4.5:1 text contrast,
  SVG icons (no emoji), 150–300 ms transitions.
- **Refinement pass (skill review):** every page was audited at 1280 px and 375 px for heading
  order, text contrast, target size and horizontal scroll. Fixes from it: timeline phase labels
  raised to 7.6:1 with an underline for the current phase (not color alone), clickable key-moment
  buttons as a one-tap alternative to dragging (WCAG 2.5.7), a small drag threshold so taps don't
  jump the timeline, reserved height for the timeline (no layout shift), a "Loading 3D view…"
  status shown only if loading takes over half a second, playback that pauses off-screen or in a
  hidden tab, menus that close faster than they open, 50 ms list stagger, and three.js cleanup
  plus a fallback to the flat view if the graphics context is lost.
- **Overridden:** the skill's suggested palette (bright red on pink) and "vibrant/playful"
  style conflicted with the brief (charcoal/off-white base, one restrained accent, no
  pastels). The brief wins; no palette in the skill database matched, so colors below
  come from the brief.

## Responsive rules (checked at 1440, 1280, 1024, 768, 414, 375, 360 px)
- No horizontal scroll and no layout shift on load at any width: page scripts render before first
  paint (`blocking="render"`), and space is reserved for anything drawn later (the hero timeline).
- Drawings that scale down on phones (Metrics figure, setup diagram, demo playback) set their labels
  larger at <=560 px so text stays ~11-15 px; label spacing scales with it.
- Phone hero: the phase readout and the 3D/Side toggle sit in their own strip above a 3:2 view, so
  they never cover the athlete.
- Demo stats: 6 across, 3 + 3 on tablets, 2 + 2 + 2 on phones, with 1 px rules between cards.
  All four result tabs fit on a phone ("Compare attempts" shows as "Compare"; the full name stays
  for screen readers).
- Scrolling tables keep their caption at the visible width; chart event labels never overlap.

- Science is three tabs (Pipeline / Worked example / Calibration & FAQ) to stay near two screens:
  about 1.1-1.6 screens on desktop and 1.7-2.3 on a phone.
- Pipeline steps all have the same five parts (number, title, description, one formula box, one note)
  and line up across the row, so boxes match in size and notes share a baseline. Derived formulas
  (launch angle, peak height, center of mass) live in the note line. Every formula on the site uses
  the same dark box; `formula--small` only makes it smaller.
- Formulas are typeset from LaTeX with KaTeX (`data-tex` on the element, `lib/math.js`): displayed
  equations centered in full-width dark boxes, inline maths in the text and notes. The plain HTML
  inside each element is the fallback if KaTeX can't load.

## Home: call to action
- **Call to action** ("Try it", off-white, just above the footer): one main action, "Explore the sample
  analysis" (`demo.html`, straight into the results), with three short reassurances under it. Beside
  it, a card answering "Filming your own jumps?" with the three things needed and a link to the setup guide.
  It promises nothing the demo can't do: uploaded videos aren't analyzed yet, so the main action is the sample.
- The home page: charcoal hero, then the problem and the call to action on off-white, then the charcoal
  footer. (A testimonials band was removed in Oct 2026: no real quotes planned.)

## Units switch
- A small m / ft segmented control in the header, after the nav links (the same look as the 3D / Side toggle);
  in the phone menu it is its own "Units" row. The header folds into the Menu button below 1080 px, so the
  links, the switch and Open demo always fit on one row.
- Imperial shows jump distances as feet and inches to the nearest half inch (6 ft 11½ in, as a tape is
  read), body heights in inches (36.8 in), small lengths in inches (+5.9 in), speeds in ft/s with one
  decimal, and chart axes in feet. In the scoreboard both numbers of 6 ft 11½ in are full size, each unit small.
- Switching redraws numbers in place with no animation; the values haven't changed, only how they're written.

## Metrics figure (3D)
- The sample athlete at takeoff on the same charcoal lane as the home hero, in a charcoal panel like the
  demo playback. The athlete is a sculpted sports mannequin, modeled on studio renders of athletic
  display mannequins: every body part is one smooth, continuous surface whose cross-section changes along
  its length (separate front, back and side radii), so quads, hamstrings, calves high on the back of the
  shin, a deltoid cap over each shoulder, a ribcage, glutes and a narrow waist under broad shoulders are
  all part of the silhouette rather than added lumps. Joints are the body's own color and blend in;
  featureless egg head, mitten hands; a warm, matte off-white, the far side a shade darker for depth.
  Lit like a product shot: a studio environment built in code (a dim room with an overhead softbox, a key
  softbox ~60° off the camera, a weak fill and a strip light behind) gives long, soft gradients that show
  the forms, with one key light for the shadow. An earlier version added muscle shapes as separate
  ellipsoids; it read as lumpy, so it was replaced.
  Shoes are neutral here so the accent only ever marks the metric. (The home hero and demo keep the
  simpler capsule mannequin; both come from `scene-3d.js`.)
- Each metric is drawn in the scene where it comes from: a dimension line on the floor from the takeoff
  toe to the landing heel (with a landing ghost); forward, upward and resultant arrows from the hips with
  their parallelogram; the launch angle against the horizontal plus the peak height; trunk and shin lean
  as arcs from a dotted vertical; for ground contact, a ghost at the lowest point and a timeline strip.
  Lines sit over the body like a diagram, each with a dark outline so it reads on the light body.
- Callouts, not loose text: a dark tag (value in display type, name in small caps; key values in the
  accent with an accent edge), joined to its exact point by a thin leader with a dot. Tags stay inside the
  figure and move with the camera; some move to a better side on narrow figures.
- Choosing a metric glides the camera (~1 s) to frame it, three-quarter by default and flatter for the
  angle metrics; "Side" is level and side-on, where every angle reads true. Hover and focus preview after
  a 140 ms pause, so sweeping the pointer down the list doesn't swing the camera. Highlighted body parts
  take an accent tint, not full accent, so the accent lines stay distinct on them. Nothing moves under
  reduced motion, and the scene stops drawing once it is still.
- Look around: drag the figure (one figure width = a full turn; tilt with a mouse or pen), use the rotate
  buttons beside 3D / Side, or the arrow keys when it has focus. The chosen angle holds as metrics change;
  3D or Side glides back the short way round. A one-line hint under the figure says so.
- Labels from any angle: each callout's side is a world direction (behind, ahead, above or below the
  athlete), so turning the camera round keeps "behind" behind. Callouts push apart instead of overlapping,
  keep clear of the buttons and the contact timeline, and stay inside the figure (checked at four angles
  for every metric, desktop and phone: no overlaps). Lines drawn in the side-on plane fade back as the
  camera turns edge-on to them, so they never collapse into misleading slivers; the values stay crisp.
- Phones: the 3D / Side and rotate buttons get their own strip above the scene. Without WebGL or three.js the flat
  side-view drawing (`metrics-2d.js`) takes over, as before.

## Analyze: real analyses
- One drop area takes a video (sent for analysis) or a `_web.json` from the JumpLab app (opened in the
  browser, with the video if dropped too); a "Recorded at" choice covers slow-motion files whose own
  frame rate is wrong. Without a configured server the card becomes "Open your results".
- Progress is honest: the upload percentage, then the tracking step with a running clock, then done.
  Errors read as a sentence the visitor can act on, with "Try another video".
- Calibration happens after tracking, on a still the server sends back (exactly the frame the tracking
  saw, whatever the browser can decode): click both ends of the tape, enter its length (meters or feet
  and inches, remembered), with a 3x loupe, draggable points and keyboard placement. "Skip" gives
  rough results from the gravity check, marked as such.
- Real results reuse the dashboard. The tag says "Your jump" (or "Rough: no calibration"); the line
  under the title gives file, frame rate, scale and the camera side. Serious warnings (e.g. staggered
  feet) sit above the tabs in an accent-edged box with their headline, followed by the five ratings
  (✓ reliable, dashed ~ use with care, accent ✗ rough only) and a "Why these ratings" disclosure.
- Playback is the visitor's own video with the tracked skeleton: camera-side limbs bright, the far side
  dim, unsure points faint and dashed, the hip's flight lit in the accent, feet marked. Without the
  video (or if the browser can't decode iPhone HEVC) the skeleton plays alone, framed and with a floor.
- Charts focus on the jump (half a second before the dip to just after landing); Compare appears when
  two or more of your jumps are open; "Download results" saves the `_web.json` to reopen later.

## Page headings, step links, checklist
- Every inner page heading (not the demo) has the logo's flight arc - takeoff dot, dotted path, landing
  tick - drawn faintly in its empty top-right corner (accent at 32%, 50% on phones where it's small).
  It's decoration only, behind the text, and the same on every page.
- How it works: each step ends with a link to the page that covers it (Camera setup, the pipeline,
  the six metrics, the demo's comparison), a 48 px row whose arrow leans in on hover.
- Setup: with all seven items ticked, the count becomes "All 7 ready" (accent rule) and a "Ready to
  film" note appears under the list.

## Interaction states
Every control has hover, visible focus (3 px ring) and a press state: buttons and the menu button
press down 1 px; toggles and segmented buttons tint; text links thicken their underline; the logo
dims slightly. The mobile menu closes when focus leaves it, so focus never lands on hidden content.

## Color (one accent, used sparingly)
| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--ink` | #121315 | dark sections | |
| `--text` | #16171A | body text on light | 15.9:1 on paper |
| `--paper` | #F3F1EC | page background | 16.5:1 on ink |
| `--muted` | #575B62 | secondary text on light | 6.0:1 |
| `--muted-dark` | #A2A6AD | secondary text on dark | 7.6:1 |
| `--accent` | #A3262A | buttons, active states, key numbers | 6.5:1 on paper; white on it 7.3:1 |
| `--accent-on-dark` | #E8665A | the same hue lifted for charcoal | 5.7:1 on ink |
| `--line-strong` | #74787F | chart axes | ≥3:1 non-text |

## Motion
Restrained and functional: motion shows where something came from or where it went, never
decorates. Nothing loops, bounces or autoplays.
- **Tokens:** `--ease` (ease-out) for things arriving, `--ease-in-out` for things moving between
  two places; 150 ms (hover, press), 240 ms (state changes), 420 ms (entrances).
- **Pages:** a 180 ms cross-fade between pages (browsers with view transitions); content
  rises 12 px into place on load, top block first. Dark bands stay solid; only their content moves.
  On the home page, blocks that start below the fold hold that same entrance until they scroll into view
  (`lib/reveal.js`), so it isn't spent off-screen; nothing waits under reduced motion, without
  IntersectionObserver, or when printing.
- **Buttons:** color changes in 150 ms, a 1 px press on click, arrows lean 3 px on hover. Still flat:
  no shadows, no scaling.
- **Nav:** the underline draws in from the left on hover; the mobile menu slides down 8 px and fades.
- **Tabs:** one accent underline slides to the selected tab; the panel fades in.
- **Numbers:** demo scoreboard values count up once, and tick from the old to the new value
  when switching attempts.
- **Hero jump:** a 3D athlete on a dark jump lane (tape measure, takeoff and landing lines, its own
  shadow, the flight path lighting up as it passes), with a 3D / Side camera toggle: Side is level at
  hip height, what the phone sees, and the camera glides between the two. On load it plays the jump at half speed and eases
  into a freeze-frame at the peak; after that it moves only when the visitor drags the timeline or the
  athlete. The camera eases from a three-quarter view toward side-on as the jump progresses. The floor
  dissolves into the charcoal hero instead of sitting in a box.
- **Smoothness (hero):** the athlete is always drawn at the exact moment requested. When the visitor
  drags or clicks the timeline, the athlete catches up with a short critically damped follow (~60 ms),
  so a click far along the bar becomes a quick glide. The camera, the 3D/Side change and the landing
  line each ease toward their targets (time constants 0.12-0.3 s) and the renderer stops drawing once
  the remaining change is too small to see. A soft contact shadow under the feet spreads and fades
  with height, and the phase label slides in when the phase changes.
- **Science chart:** the first time it scrolls into view, the tracked points appear in time order and
  then the fitted parabola draws through them: data first, then the model. A crosshair (pointer or
  arrow keys) reads out tracked and fitted heights, and the tooltip sits in the empty space under the arc.
- **Looking around (hero):** dragging the athlete orbits the camera around it - a full turn per stage
  width, tilting up to 60° with a mouse - without changing the moment in the jump. The chosen angle
  holds while the timeline, the key-moment buttons or Play move time, and the camera keeps the athlete
  centered. Rotate buttons (bottom corner) and the arrow keys do the same; 3D or Side returns to a
  guided view. (The demo playback still drags to scrub.)
- **Timeline:** a scrub bar with the five phases shaded along the track, ticks at takeoff, peak and
  landing, the current phase highlighted, and a play / pause / replay button. It is a real slider
  underneath (arrow keys, screen readers).
- **Demo playback:** the same 3D athlete, 3D / Side toggle and drag-to-scrub as the home hero (shared
  `jump-stage.js`), with the demo's frame-accurate controls. Draws between frames, so slow motion stays
  smooth, and "Jump to" glides there. The chosen view carries over when switching attempts.
- **Reduced motion:** all of the above is off; every page shows its final state immediately, and the
  hero starts at the peak and only moves when the visitor moves it.

## Rules
- The accent is never a large background: it marks buttons, the active nav item, focus,
  key numbers and highlighted body parts.
- All-caps only in small eyebrow labels and demo tags.
- At most one angled section break (home hero). Bold charcoal bands alternate with calm
  off-white sections.
- Buttons: flat fills, 2 px radius, no shadows.
- Numbers use the scoreboard pattern: big tabular digit, small label underneath.
- Every simulated number carries a "Demo data" / "Placeholder" marker.
