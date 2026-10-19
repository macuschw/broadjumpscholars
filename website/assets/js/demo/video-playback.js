// Playback of a real jump: the visitor's own video with the tracked skeleton drawn over it, frame
// by frame, or the skeleton on its own when only the results file is open (or this browser can't
// decode the video). Same controls and readouts as the sample's playback. The skeleton is the
// MediaPipe landmarks the analysis used, in the video's own pixels; the camera-side limbs are
// bright, the far side dim, and points the tracker was unsure of are drawn faint and dashed.
import { icon } from "../components/icons.js";

const SPEEDS = [0.1, 0.25, 0.5, 1];
const SIDES = { LEFT: [7, 11, 13, 15, 23, 25, 27, 29, 31], RIGHT: [8, 12, 14, 16, 24, 26, 28, 30, 32] };
const LIMBS = { LEFT: [[11, 13], [13, 15], [23, 25], [25, 27], [27, 29], [29, 31], [31, 27]],
  RIGHT: [[12, 14], [14, 16], [24, 26], [26, 28], [28, 30], [30, 32], [32, 28]] };
const TRUNK = [[11, 12], [23, 24], [11, 23], [12, 24]];
const C = { near: "#f3f1ec", far: "#8a8e95", accent: "#e8665a", halo: "rgba(18,19,21,0.7)" };

export class VideoPlayback {
  constructor(host, { onFrame } = {}) {
    this.onFrame = onFrame;
    this.speed = 0.25;
    this.playing = false;
    this.skeleton = true;
    host.innerHTML = `
      <div class="vpb">
        <div class="vpb__stage" role="group" aria-label="Playback of your jump with the tracked skeleton. Use the controls below to move through it.">
          <video class="vpb__video" muted playsinline preload="auto" aria-hidden="true"></video>
          <canvas class="vpb__overlay" aria-hidden="true"></canvas>
          <div class="jump-stage__hud vpb__hud" aria-hidden="true">
            <span class="jump-stage__phase pb__phase"></span><span class="jump-stage__time pb__time"></span>
          </div>
          <p class="vpb__note" role="status"></p>
        </div>
        <div class="pb__controls">
          <button type="button" class="btn btn--primary btn--sm pb__play" aria-label="Play">${icon("play")}<span>Play</span></button>
          <button type="button" class="btn btn--quiet btn--sm pb__step" data-step="-1" aria-label="Back one frame">${icon("stepBack")}</button>
          <button type="button" class="btn btn--quiet btn--sm pb__step" data-step="1" aria-label="Forward one frame">${icon("stepFwd")}</button>
          <label class="visually-hidden" for="vpb-scrub">Playback position</label>
          <input class="pb__scrub" id="vpb-scrub" type="range" min="0" step="1" value="0">
          <label class="pb__speed">Speed
            <select>${SPEEDS.map((s) => `<option value="${s}"${s === this.speed ? " selected" : ""}>${s}×</option>`).join("")}</select>
          </label>
          <label class="vpb__check"><input type="checkbox" checked> Skeleton</label>
        </div>
        <div class="pb__events" role="group" aria-label="Jump to a key moment">
          <span>Jump to</span>
          <button type="button" class="btn btn--quiet btn--sm" data-event="bottom">Lowest point</button>
          <button type="button" class="btn btn--quiet btn--sm" data-event="takeoff">Takeoff</button>
          <button type="button" class="btn btn--quiet btn--sm" data-event="peak">Peak</button>
          <button type="button" class="btn btn--quiet btn--sm" data-event="landing">Landing</button>
        </div>
      </div>`;
    const q = (s) => host.querySelector(s);
    this.q = q;
    this.stageEl = q(".vpb__stage");
    this.video = q(".vpb__video");
    this.canvas = q(".vpb__overlay");
    this.ctx = this.canvas.getContext("2d");
    this.note = q(".vpb__note");
    this.scrub = q(".pb__scrub");
    this.playBtn = q(".pb__play");
    this.playBtn.addEventListener("click", () => (this.playing ? this.pause() : this.play()));
    host.querySelectorAll(".pb__step").forEach((b) => b.addEventListener("click", () => { this.pause(); this.seek(this.i + Number(b.dataset.step)); }));
    this.scrub.addEventListener("input", () => { this.pause(); this.seek(Number(this.scrub.value)); });
    q(".pb__speed select").addEventListener("change", (e) => { this.speed = Number(e.target.value); this.applyRate(); });
    q(".vpb__check input").addEventListener("change", (e) => { this.skeleton = e.target.checked; this.draw(); });
    host.querySelectorAll("[data-event]").forEach((b) => b.addEventListener("click", () => { this.pause(); this.seek(this.a.events[b.dataset.event]); }));
    this.video.addEventListener("seeked", () => this.draw());
    this.video.addEventListener("ended", () => this.pause());
    this.video.addEventListener("error", () => this.noVideo("This browser can't play this video's format (often iPhone “High Efficiency” video), so the skeleton is shown on its own."));
    if ("ResizeObserver" in window) new ResizeObserver(() => this.draw()).observe(this.stageEl);
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.pause(); });
  }

  /** Show a real attempt (demo/real.js). */
  load(attempt) {
    this.pause();
    this.a = attempt;
    const lm = (this.lm = attempt.bundle.landmarks), r = attempt.bundle.results;
    this.near = r.side === "LEFT" ? "LEFT" : "RIGHT";
    // Someone else in the shot: outlined only when the analysis trusted the sighting enough to warn
    this.others = attempt.warnings.some((w) => /^person_/.test(w.code)) ? lm.others || null : null;
    this.times = lm.frame_times && lm.frame_times.every((t) => t != null) ? lm.frame_times : null;
    this.rate = (r.fps || lm.fps) / lm.fps;                      // real frame rate / the file's own (slow motion)
    this.stageEl.style.aspectRatio = `${lm.width} / ${lm.height}`;
    this.scrub.min = String(this.first);                         // a trimmed upload: only the tracked part
    this.scrub.max = String(this.last);
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.hasVideo = false;
    this.note.textContent = "";
    if (attempt.video) {
      this.url = URL.createObjectURL(attempt.video);
      this.video.hidden = false;
      this.video.src = this.url;
      this.hasVideo = true;
      this.video.addEventListener("loadeddata", () => this.seek(this.i ?? 0), { once: true });
    } else {
      this.noVideo("Skeleton only: open the video together with the results file to see it underneath.");
    }
    this.fit = this.fitAthlete();
    this.i = -1;
    this.seek(attempt.events.takeoff);
  }

  /** Without the video, frame the athlete: the box around every tracked point from just before the
   *  dip to just after landing, and the floor under the standing feet (both in video pixels). */
  fitAthlete() {
    const { onset, landing } = this.a.events, xyv = this.lm.xyv, fps = this.lm.fps;
    const from = Math.max(0, onset - Math.round(0.5 * fps)), to = Math.min(this.lm.n_frames - 1, landing + Math.round(0.5 * fps));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = from; i <= to; i++) {
      const row = xyv[i] || [];
      for (let j = 11; j < 33; j++) {
        const x = row[j * 3], y = row[j * 3 + 1];
        if (x == null || y == null) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    if (!Number.isFinite(x0)) return null;
    const pad = 0.12 * Math.max(x1 - x0, y1 - y0);
    return { x0: x0 - pad, x1: x1 + pad, y0: y0 - pad, y1: y1 + pad * 0.6, floor: y1 };
  }

  noVideo(text) {
    this.hasVideo = false;
    this.video.removeAttribute("src");
    this.video.load();
    this.video.hidden = true;
    this.note.textContent = text;
    this.draw();
  }

  get first() { return this.lm.segment ? this.lm.segment[0] : 0; }
  get last() { return this.lm.segment ? this.lm.segment[1] : this.lm.n_frames - 1; }
  timeOf(i) { return this.times ? this.times[i] : i / this.lm.fps; }
  frameAt(t) {                                                   // the frame shown at file time t
    if (!this.times) return Math.round(t * this.lm.fps);
    let lo = 0, hi = this.times.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.times[mid] <= t + 1e-4) lo = mid; else hi = mid - 1; }
    return lo;
  }

  /** Show an exact frame: the video seeks to it and the skeleton is drawn for it. */
  seek(i) {
    this.show(Math.max(this.first, Math.min(this.last, Math.round(i))));
    if (this.hasVideo && this.video.readyState >= 1) this.video.currentTime = this.timeOf(this.i) + 0.3 / this.lm.fps;   // inside the frame
  }

  show(i) {
    if (i === this.i) return;
    this.i = i;
    const f = this.a.frames[Math.min(i, this.a.frames.length - 1)];
    const phase = this.q(".pb__phase");
    if (phase.textContent !== f.phase) {
      phase.textContent = f.phase;
      phase.classList.remove("is-new");
      void phase.offsetWidth;
      phase.classList.add("is-new");
    }
    this.q(".pb__time").textContent = `${f.t.toFixed(3)} s · frame ${i}`;
    this.scrub.value = String(i);
    this.scrub.setAttribute("aria-valuetext", `${f.t.toFixed(2)} seconds, frame ${i}, ${f.phase}`);
    this.onFrame?.(f, i);
    this.draw();
  }

  applyRate() {
    this.video.playbackRate = Math.min(4, Math.max(0.0625, this.speed * this.rate));
  }

  play() {
    this.pause();
    if (this.i >= this.last) this.seek(this.first);
    this.playing = true;
    this.playBtn.innerHTML = `${icon("pause")}<span>Pause</span>`;
    this.playBtn.setAttribute("aria-label", "Pause");
    if (this.hasVideo) {
      this.applyRate();
      this.video.play().catch(() => this.pause());
      // Follow the frames the video actually presents
      const follow = (_, meta) => {
        if (!this.playing) return;
        const i = this.frameAt(meta ? meta.mediaTime : this.video.currentTime);
        if (i >= this.last) { this.show(this.last); this.pause(); return; }
        this.show(i);
        this.cb = this.video.requestVideoFrameCallback ? this.video.requestVideoFrameCallback(follow) : requestAnimationFrame(() => follow());
      };
      this.cb = this.video.requestVideoFrameCallback ? this.video.requestVideoFrameCallback(follow) : requestAnimationFrame(() => follow());
    } else {
      let prev = performance.now(), pos = this.i;
      const tick = (now) => {
        if (!this.playing) return;
        pos += ((now - prev) / 1000) * (this.a.fps || this.lm.fps) * this.speed;
        prev = now;
        if (pos >= this.last) { this.show(this.last); this.pause(); return; }
        this.show(Math.floor(pos));
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
  }

  pause() {
    const was = this.playing;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    if (this.cb && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.cb);
    if (!this.video.paused) this.video.pause();
    if (was && this.hasVideo) this.seek(this.i);               // settle exactly on the frame shown
    if (this.playBtn && this.a) {
      const atEnd = this.i >= this.last;
      this.playBtn.innerHTML = `${icon("play")}<span>${atEnd ? "Replay" : "Play"}</span>`;
      this.playBtn.setAttribute("aria-label", atEnd ? "Replay" : "Play");
    }
  }

  /** The other person's box [x0, y0, x1, y1] (video px) at the check nearest frame i, if any. */
  otherAt(i) {
    if (!this.others) return null;
    const reach = Math.max(1, Math.round(this.lm.fps / 10));
    for (let d = 0; d <= reach; d++) {
      const box = this.others[i - d] || this.others[i + d];
      if (box && box.every((v) => v != null)) return box;
    }
    return null;
  }

  /** The skeleton for the current frame, scaled from video pixels to the stage. */
  draw() {
    if (!this.lm || this.i == null || this.i < 0) return;
    const w = this.stageEl.clientWidth, h = this.stageEl.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (!this.skeleton) return;
    // Video pixels -> stage: the whole frame over the video; zoomed to the athlete without it
    let s = w / this.lm.width, ox = 0, oy = 0;
    const f = !this.hasVideo && this.fit;
    if (f) {
      s = Math.min(w / (f.x1 - f.x0), h / (f.y1 - f.y0));
      ox = (w - (f.x1 - f.x0) * s) / 2 - f.x0 * s;
      oy = (h - (f.y1 - f.y0) * s) / 2 - f.y0 * s;
      c.strokeStyle = "#5a5e65"; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, f.floor * s + oy); c.lineTo(w, f.floor * s + oy); c.stroke();   // the floor
    }
    // The other person, from the nearest check (about 10 a second): a dashed box, labeled
    const other = this.otherAt(this.i);
    if (other) {
      const [x0, y0, x1, y1] = other.map((v, k) => v * s + (k % 2 ? oy : ox)), pad = 8;
      c.setLineDash([7, 5]); c.lineWidth = 2; c.strokeStyle = C.accent;
      c.strokeRect(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
      c.setLineDash([]);
      c.font = "600 13px Barlow, system-ui, sans-serif";
      const text = "Someone else", tw = c.measureText(text).width;
      c.fillStyle = C.accent; c.fillRect(x0 - pad - 1, y0 - pad - 22, tw + 12, 22);
      c.fillStyle = "#121315"; c.fillText(text, x0 - pad + 5, y0 - pad - 6);
    }
    const row = this.lm.xyv[this.i] || [];
    const P = (j) => (row[j * 3] == null ? null : { x: row[j * 3] * s + ox, y: row[j * 3 + 1] * s + oy, v: row[j * 3 + 2] ?? 0 });

    // The hip's path through the air, lit up to the current frame
    const { takeoff, landing } = this.a.events;
    c.fillStyle = C.accent;
    for (let k = takeoff; k <= Math.min(this.i, landing); k += 2) {
      const rk = this.lm.xyv[k];
      if (!rk || rk[69] == null || rk[72] == null) continue;
      c.beginPath(); c.arc(((rk[69] + rk[72]) / 2) * s + ox, ((rk[70] + rk[73]) / 2) * s + oy, 2.2, 0, Math.PI * 2); c.fill();
    }
    const far = this.near === "LEFT" ? "RIGHT" : "LEFT";
    const bone = (a, b, color, width) => {
      const pa = P(a), pb = P(b);
      if (!pa || !pb) return;
      const sure = Math.min(pa.v, pb.v) >= 0.5;
      c.setLineDash(sure ? [] : [5, 5]);
      c.globalAlpha = sure ? 1 : 0.55;
      c.lineCap = "round";
      c.strokeStyle = C.halo; c.lineWidth = width + 3;
      c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
      c.strokeStyle = color; c.lineWidth = width;
      c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
    };
    LIMBS[far].forEach(([a, b]) => bone(a, b, C.far, 2.5));
    TRUNK.forEach(([a, b]) => bone(a, b, C.near, 2.5));
    LIMBS[this.near].forEach(([a, b]) => bone(a, b, C.near, 3.5));
    c.setLineDash([]);
    for (const side of [far, this.near]) {
      for (const j of SIDES[side]) {
        const p = P(j);
        if (!p) continue;
        c.globalAlpha = p.v >= 0.5 ? 1 : 0.55;
        c.fillStyle = C.halo; c.beginPath(); c.arc(p.x, p.y, side === this.near ? 5 : 4, 0, Math.PI * 2); c.fill();
        c.fillStyle = side === this.near ? ([29, 30, 31, 32].includes(j) ? C.accent : C.near) : C.far;   // the feet the distance is measured from, in the accent
        c.beginPath(); c.arc(p.x, p.y, side === this.near ? 3.2 : 2.6, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalAlpha = 1;
  }
}
