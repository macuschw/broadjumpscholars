// Playback panel: the athlete on the shared jump stage (3D when available, flat 2D otherwise),
// phase label, frame-accurate scrubber, speed and jump-to-event controls, and live readouts.
// Motion is drawn between frames, so 0.1x slow motion is as smooth as 1x; the readouts,
// scrubber and charts always show a real frame. Drag the athlete to scrub, as on the home page.
import { fmt } from "../lib/dom.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { icon } from "../components/icons.js";
import { quantityHTML } from "../lib/units.js";
import { addViewToggle, createFlatStage, createJumpStage, enableStageDrag } from "../components/jump-stage.js";

const SPEEDS = [0.1, 0.25, 0.5, 1];
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

export class Playback {
  constructor(host, { onFrame } = {}) {
    this.onFrame = onFrame;
    this.speed = 0.25;
    this.playing = false;
    this.view = "3d";
    host.innerHTML = `
      <div class="pb">
        <div class="pb__stage jump-stage is-dark" role="group" aria-label="Playback of the jump. Use the controls below to move through it.">
          <div class="jump-stage__hud" aria-hidden="true">
            <span class="jump-stage__phase pb__phase"></span><span class="jump-stage__time pb__time"></span>
          </div>
          <p class="jump-stage__status" role="status"></p>
        </div>
        <div class="pb__controls">
          <button type="button" class="btn btn--primary btn--sm pb__play" aria-label="Play">${icon("play")}<span>Play</span></button>
          <button type="button" class="btn btn--quiet btn--sm pb__step" data-step="-1" aria-label="Back one frame">${icon("stepBack")}</button>
          <button type="button" class="btn btn--quiet btn--sm pb__step" data-step="1" aria-label="Forward one frame">${icon("stepFwd")}</button>
          <label class="visually-hidden" for="pb-scrub">Playback position</label>
          <input class="pb__scrub" id="pb-scrub" type="range" min="0" step="1" value="0">
          <label class="pb__speed">Speed
            <select>${SPEEDS.map((s) => `<option value="${s}"${s === this.speed ? " selected" : ""}>${s}×</option>`).join("")}</select>
          </label>
        </div>
        <div class="pb__events" role="group" aria-label="Jump to a key moment">
          <span>Jump to</span>
          <button type="button" class="btn btn--quiet btn--sm" data-event="bottom">Lowest point</button>
          <button type="button" class="btn btn--quiet btn--sm" data-event="takeoff">Takeoff</button>
          <button type="button" class="btn btn--quiet btn--sm" data-event="peak">Peak</button>
          <button type="button" class="btn btn--quiet btn--sm" data-event="landing">Landing</button>
        </div>
      </div>`;
    this.q = (s) => host.querySelector(s);
    this.stageEl = this.q(".pb__stage");
    this.statusEl = this.q(".jump-stage__status");
    this.scrub = this.q(".pb__scrub");
    this.playBtn = this.q(".pb__play");

    this.playBtn.addEventListener("click", () => (this.playing ? this.pause() : this.play()));
    host.querySelectorAll(".pb__step").forEach((b) => b.addEventListener("click", () => { this.pause(); this.seek(this.i + Number(b.dataset.step)); }));
    this.scrub.addEventListener("input", () => { this.pause(); this.seek(Number(this.scrub.value)); });
    this.q(".pb__speed select").addEventListener("change", (e) => { this.speed = Number(e.target.value); });
    host.querySelectorAll("[data-event]").forEach((b) => b.addEventListener("click", () => this.glideTo(this.a.events[b.dataset.event])));
    enableStageDrag(this.stageEl, {
      frames: () => this.a?.frames.length ?? 1,
      from: () => this.pos ?? 0,
      onStart: () => this.pause(),
      onMove: (p) => this.render(p),
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.pause(); });
  }

  /** Show an attempt. The HUD and controls update at once; the stage follows when it's ready. */
  async load(attempt) {
    this.pause();
    this.a = attempt;
    this.scrub.max = String(attempt.frames.length - 1);
    this.i = -1;
    this.stage?.dispose?.();
    this.stage = null;
    this.seek(0);
    const token = (this.loadToken = (this.loadToken || 0) + 1);
    const slowNote = setTimeout(() => { this.statusEl.textContent = "Loading 3D view…"; }, 500);   // only if it isn't near-instant
    const stage = await createJumpStage(this.stageEl, attempt, { onContextLost: () => this.useFlat() });
    clearTimeout(slowNote);
    this.statusEl.textContent = "";
    if (token !== this.loadToken) { stage.dispose?.(); return; }          // a newer attempt took over
    this.attach(stage);
  }

  attach(stage) {
    this.stage = stage;
    const is3d = Boolean(stage.setView);
    this.stageEl.classList.toggle("is-3d", is3d);
    this.stageEl.classList.toggle("is-2d", !is3d);
    if (is3d && !this.toggle) {
      this.toggle = addViewToggle(this.stageEl, () => ({ setView: (v) => { this.view = v; this.stage?.setView?.(v); } }));
    } else if (!is3d && this.toggle) {
      this.toggle.remove();
      this.toggle = null;
    }
    if (is3d) stage.setView(this.view);                                   // keep the chosen view across attempts
    stage.setPos(this.pos);
  }

  async useFlat() {
    this.stage?.dispose?.();
    this.stage = null;
    this.attach(await createFlatStage(this.stageEl, this.a));
  }

  get last() { return this.a.frames.length - 1; }

  /** Show an exact frame. */
  seek(i) { this.render(Math.round(i)); }

  /** Draw a (possibly fractional) frame position. The HUD, scrubber, readouts and listeners
   *  follow the whole frame on screen. */
  render(pos) {
    const { frames } = this.a;
    this.pos = Math.max(0, Math.min(this.last, pos));
    this.stage?.setPos(this.pos);
    const i = Math.floor(this.pos);
    if (i === this.i) return;
    this.i = i;
    const f = frames[i];
    const phase = this.q(".pb__phase");
    if (phase.textContent !== f.phase) {
      phase.textContent = f.phase;
      phase.classList.remove("is-new");                      // restart the slide-in
      void phase.offsetWidth;
      phase.classList.add("is-new");
    }
    this.q(".pb__time").textContent = `${f.t.toFixed(3)} s · frame ${i}`;
    this.scrub.value = String(i);
    this.scrub.setAttribute("aria-valuetext", `${f.t.toFixed(2)} seconds, frame ${i}, ${f.phase}`);
    this.onFrame?.(f, i);
  }

  play() {
    this.pause();
    if (this.pos >= this.last) this.seek(0);
    this.playing = true;
    this.playBtn.innerHTML = `${icon("pause")}<span>Pause</span>`;
    this.playBtn.setAttribute("aria-label", "Pause");
    let prev = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      const next = this.pos + ((now - prev) / 1000) * this.a.fps * this.speed;
      prev = now;
      if (next >= this.last) { this.seek(this.last); this.pause(); return; }
      this.render(next);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Move quickly to a key moment (a short eased scrub), or jump there under reduced motion. */
  glideTo(target) {
    this.pause();
    const from = this.pos, to = Math.max(0, Math.min(this.last, target));
    if (prefersReducedMotion() || Math.abs(to - from) < 1) { this.seek(to); return; }
    const ms = Math.min(650, 260 + Math.abs(to - from) * 2.5), t0 = performance.now();
    const token = (this.glideToken = (this.glideToken || 0) + 1);
    const step = (now) => {
      if (token !== this.glideToken) return;
      const u = Math.min(1, (now - t0) / ms);
      if (u < 1) { this.render(from + (to - from) * easeInOut(u)); this.glide = requestAnimationFrame(step); } else this.seek(to);
    };
    this.glide = requestAnimationFrame(step);
    setTimeout(() => { if (token === this.glideToken && this.i !== to) step(t0 + ms); }, ms + 60);   // even if frames are paused
  }

  pause() {
    const wasPlaying = this.playing;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.glide);
    this.glideToken = (this.glideToken || 0) + 1;               // a cancelled glide stays cancelled
    if (wasPlaying && this.pos < this.last) this.seek(this.i);   // settle on the frame the readouts show
    if (this.playBtn) {
      const atEnd = this.a && this.i >= this.a.frames.length - 1;
      this.playBtn.innerHTML = `${icon("play")}<span>${atEnd ? "Replay" : "Play"}</span>`;
      this.playBtn.setAttribute("aria-label", atEnd ? "Replay" : "Play");
    }
  }
}

/** Live readouts beside the stage. */
export function readoutsHTML(f) {
  const row = (label, value, unit) => `<div class="stat"><span class="stat__value">${value}<span class="stat__unit">${unit}</span></span><span class="stat__label">${label}</span></div>`;
  return [
    `<div class="stat"><span class="stat__value">${quantityHTML("height", f.hip[1], 2)}</span><span class="stat__label">Hip height</span></div>`,
    row("Trunk angle", fmt(f.trunk, 0), "°"),
    row("Shin angle", fmt(f.shin, 0), "°"),
    row("Knee angle", fmt(f.knee, 0), "°"),
  ].join("");
}
