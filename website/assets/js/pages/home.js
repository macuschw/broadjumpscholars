// Home: the hero is an interactive jump. A 3D athlete (the flat 2D one if 3D can't load)
// performs the simulated sample jump. Drag the athlete to look all the way around it at the
// current moment; drag the timeline or pick a key moment to move through the jump. The view
// you choose stays as time moves. On load it plays once into a freeze-frame at the peak.
// Under reduced motion it starts at the peak and only moves when the visitor moves it.
import { prefersReducedMotion } from "../lib/motion.js";
import { createScrubber } from "../components/scrubber.js";
import { addViewControls, createFlatStage, createJumpStage, enableStageDrag, enableStageOrbit } from "../components/jump-stage.js";
import { SAMPLE } from "../data/mock-data.js";

const attempt = SAMPLE, { frames, events, fps } = attempt, last = frames.length - 1;
const SPEED = 0.5;                                          // play at half real speed
const stageEl = document.getElementById("hero-stage");
const phaseEl = stageEl.querySelector(".jump-stage__phase");
const timeEl = stageEl.querySelector(".jump-stage__time");
const statusEl = stageEl.querySelector(".jump-stage__status");
let stage = null, controls = null, pos = prefersReducedMotion() ? events.peak : 0, raf = 0, state = "idle", onScreen = true;

const scrub = createScrubber(document.getElementById("hero-scrubber"), attempt, {
  onInput: (v) => follow(v),
  onPlay: () => (state === "playing" ? stop() : play()),
  onJump: (frame) => glideTo(frame),
  describedBy: "hero-hint",
});

/** Draw the athlete and readout at position p (frames, may be fractional). */
function draw(p) {
  pos = Math.max(0, Math.min(last, p));
  stage?.setPos(pos);
  const f = frames[Math.round(pos)];
  if (phaseEl.textContent !== f.phase) {
    phaseEl.textContent = f.phase;
    phaseEl.classList.remove("is-new");                     // restart the label's slide-in
    void phaseEl.offsetWidth;
    phaseEl.classList.add("is-new");
  }
  timeEl.textContent = `${f.t.toFixed(3)} s`;
}

/** Draw p and move the timeline there too. */
function show(p) {
  draw(p);
  scrub.set(pos);
  if (state !== "playing") scrub.setState(pos >= last ? "ended" : "idle");
}

/**
 * Follow the visitor's hand: the timeline jumps straight to `target`, and the athlete catches
 * up over a few frames (critically damped), so a click far along the bar becomes a quick glide
 * and a fast drag stays fluid. Instant under reduced motion.
 */
let aimAt = 0;
function follow(target) {
  aimAt = Math.max(0, Math.min(last, target));
  if (prefersReducedMotion()) { stop(); show(aimAt); return; }
  scrub.set(aimAt);
  scrub.setState(aimAt >= last ? "ended" : "idle");
  if (state === "follow") return;                            // already chasing: the loop picks up the new aim
  stop();
  state = "follow";
  let prev = performance.now();
  const tick = (now) => {
    if (state !== "follow") return;
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    const gap = aimAt - pos;
    if (Math.abs(gap) < 0.05) { draw(aimAt); state = "idle"; return; }
    draw(pos + gap * (1 - Math.exp(-dt / 0.06)));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Stop any motion (playback, intro or glide); every user input calls this first. */
function stop() {
  cancelAnimationFrame(raf);
  state = "idle";
  scrub.setState(pos >= last ? "ended" : "idle");
}

function play() {
  stop();
  if (pos >= last) show(0);
  state = "playing";
  scrub.setState("playing");
  let prev = performance.now();
  const tick = (now) => {
    const next = pos + ((now - prev) / 1000) * fps * SPEED;
    prev = now;
    if (next >= last) { state = "idle"; show(last); return; }
    show(next);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Move quickly to a key moment: a short eased scrub (instant under reduced motion). */
function glideTo(target) {
  stop();
  const from = pos, to = Math.max(0, Math.min(last, target));
  if (prefersReducedMotion() || Math.abs(to - from) < 1) { show(to); return; }
  const ms = Math.min(700, 280 + Math.abs(to - from) * 2.2), t0 = performance.now();
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  state = "glide";
  const tick = (now) => {
    if (state !== "glide") return;
    const u = Math.min(1, (now - t0) / ms);
    show(from + (to - from) * ease(u));
    if (u < 1) raf = requestAnimationFrame(tick); else state = "idle";
  };
  raf = requestAnimationFrame(tick);
  setTimeout(() => { if (state === "glide") { state = "idle"; show(to); } }, ms + 80);   // even if frames are paused
}

/** Opening move: start of the clip to the peak at half speed, easing into a freeze-frame. */
function intro() {
  const a = 0.7, k = 2 / (1 + a), c = k / (2 * (1 - a));    // linear, then a smooth stop (no jolt)
  const ease = (u) => (u <= a ? k * u : 1 - c * (1 - u) ** 2);
  const ms = ((events.peak / fps) * k * 1000) / SPEED, t0 = performance.now() + 300;
  state = "intro";
  const tick = (now) => {
    if (state !== "intro") return;
    const u = Math.min(1, Math.max(0, (now - t0) / ms));
    show(events.peak * ease(u));
    if (u < 1) raf = requestAnimationFrame(tick); else state = "idle";
  };
  raf = requestAnimationFrame(tick);
  setTimeout(() => { if (state === "intro") { state = "idle"; show(events.peak); } }, 300 + ms + 100);   // even if frames are paused
}

// Drag the athlete to look around it (3D). The flat fallback can't turn, so there a drag scrubs instead.
enableStageOrbit(stageEl, () => stage, { onOrbit: () => controls?.free() });
enableStageDrag(stageEl, { frames: last + 1, from: () => (state === "follow" ? aimAt : pos), onMove: follow, when: () => !stage?.orbit });

// Don't keep animating what nobody can see
const pauseIfPlaying = () => { if (state === "playing" || state === "glide") stop(); };
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseIfPlaying(); });
if ("IntersectionObserver" in window) {
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; if (!onScreen) pauseIfPlaying(); }, { threshold: 0.2 }).observe(stageEl);
}

async function useFlatStage() {
  stage?.dispose?.();
  controls?.remove();
  controls = null;
  stage = await createFlatStage(stageEl, attempt);
  stageEl.classList.replace("is-3d", "is-2d") || stageEl.classList.add("is-2d");
  show(pos);
}

async function boot() {
  stageEl.setAttribute("aria-busy", "true");
  const slowNote = setTimeout(() => { statusEl.textContent = "Loading 3D view…"; }, 500);   // only if it isn't near-instant
  stage = await createJumpStage(stageEl, attempt, { onContextLost: useFlatStage });
  clearTimeout(slowNote);
  statusEl.textContent = "";
  stageEl.removeAttribute("aria-busy");
  const is3d = Boolean(stage.setView);
  stageEl.classList.add(is3d ? "is-3d" : "is-2d");
  if (is3d) controls = addViewControls(stageEl, () => stage);
  show(pos);
  if (!prefersReducedMotion() && state === "idle" && pos === 0 && onScreen) intro();
}

show(pos);
boot();
