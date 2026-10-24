// Measure live: the phone's camera on the Analyze page. MediaPipe's pose tracker runs in the
// browser on every camera frame (nothing is uploaded while measuring); live/detect.js spots each
// jump and its distance is shown the moment the jumper lands. The whole session is recorded at the
// same time, so the full analysis (angles, timing, the checks for steps, hands, someone in the
// shot...) can follow, now or later, from that recording, like any uploaded video.
//
//   const live = createLive(host, { onNeedScale(still), onAnalyze(file, info), onClose() });
//   live.setScale(metersPerPixel)   after the visitor has marked the tape on onNeedScale's still
import { formatQuantity } from "../lib/units.js";
import { createDetector } from "./detect.js";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let trackerPromise = null;                                   // loaded once per visit (~10 MB, then cached)
function loadTracker() {
  trackerPromise ??= (async () => {
    const vision = await import(`${VISION}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    const make = (delegate) => vision.PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numPoses: 1,
    });
    try { return await make("GPU"); } catch { return make("CPU"); }   // older phones: slower, still works
  })();
  trackerPromise.catch(() => { trackerPromise = null; });   // a failed load can be tried again
  return trackerPromise;
}

export function createLive(host, { onNeedScale, onAnalyze, onClose, stream: given = null }) {
  host.innerHTML = `
    <div class="live">
      <div class="live__head">
        <h2 id="live-title" tabindex="-1">Measure live</h2>
        <p class="live__lede">Put the phone on a tripod, <strong>turned sideways</strong>, side-on to the jump, with the whole jump and
          the tape measure in the picture. The distance appears as soon as the jumper lands.</p>
      </div>
      <div class="live__stage">
        <video class="live__video" playsinline muted autoplay></video>
        <canvas class="live__overlay" aria-hidden="true"></canvas>
        <p class="live__badge" hidden></p>
        <div class="live__result" role="status" aria-live="assertive" hidden></div>
        <p class="live__turn" hidden>Turn the phone sideways: a jump needs a wide picture.</p>
      </div>
      <p class="live__status" aria-live="polite">Starting the camera…</p>
      <div class="live__actions">
        <button type="button" class="btn btn--primary live__scale" hidden>Set the scale</button>
        <button type="button" class="btn btn--primary live__stop" hidden>Stop</button>
        <button type="button" class="btn btn--quiet btn--sm live__close">Back</button>
      </div>
      <ol class="live__jumps" role="list" aria-label="Jumps measured live"></ol>
      <div class="live__done" hidden></div>
    </div>`;
  const q = (s) => host.querySelector(s);
  const video = q(".live__video"), overlay = q(".live__overlay"), octx = overlay.getContext("2d");
  const status = (text) => { q(".live__status").textContent = text; };
  let stream = null, tracker = null, scale = null, recorder = null, chunks = [], recStart = 0, mime = "", clock0 = 0;
  let running = false, busy = false, lastSeen = 0, wake = null, frames = 0, closed = false;
  const jumps = [];
  const detector = createDetector({ onJump: (j) => showJump(j), onState: (s) => { q(".live__badge").textContent = s === "air" ? "In the air" : ""; q(".live__badge").hidden = s !== "air"; } });

  // ---- camera and tracker
  async function start() {
    try {
      stream = given || await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
      });
    } catch (e) {
      status(e?.name === "NotAllowedError"
        ? "The camera wasn't allowed. Allow camera access for this site in the browser's settings, then try again."
        : "No camera could be opened on this device.");
      return;
    }
    if (closed) { stop(); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    status("Loading the tracker (the first time takes a few seconds)…");
    try { tracker = await loadTracker(); } catch {
      status("The tracker couldn't be loaded. Check the connection and try again.");
      return;
    }
    if (closed) return;
    running = true;
    loop();
    try { wake = await navigator.wakeLock?.request("screen"); } catch { /* the screen may dim; fine */ }
    status("Step 1: set the scale. Have the tape measure on the floor in the picture.");
    q(".live__scale").hidden = false;
  }

  /** The current camera frame as a still for calibration (the same shape the server sends). */
  function snapshot() {
    const w = video.videoWidth, h = video.videoHeight, k = Math.min(1, 1600 / w);
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    return { frame: 0, width: c.width, height: c.height, full_width: w, full_height: h,
      jpeg: c.toDataURL("image/jpeg", 0.88).split(",")[1] };
  }

  // ---- every frame: track, feed the jump detector, draw the skeleton
  function loop() {
    if (!running) return;
    const next = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick));
    function tick() {
      if (!running) return;
      if (!busy && video.readyState >= 2) {
        busy = true;
        const now = performance.now();
        let pts = null;
        try {
          const r = tracker.detectForVideo(video, now);
          const lm = r.landmarks?.[0];
          if (lm) pts = lm.map((p) => [p.x * video.videoWidth, p.y * video.videoHeight, p.visibility ?? 1]);
        } catch { /* a dropped frame */ }
        if (pts) lastSeen = now;
        frames++;
        if (scale) detector.feed((now - clock0) / 1000, pts);       // seconds since measuring began
        draw(pts);
        busy = false;
      }
      q(".live__turn").hidden = !(video.videoHeight > video.videoWidth);
      next();
    }
    next();
  }
  function draw(pts) {
    const w = overlay.clientWidth, h = overlay.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (overlay.width !== Math.round(w * dpr)) { overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr); }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, w, h);
    if (!pts || !video.videoWidth) return;
    const k = Math.min(w / video.videoWidth, h / video.videoHeight);                  // the video fits the stage
    const ox = (w - video.videoWidth * k) / 2, oy = (h - video.videoHeight * k) / 2;
    const P = (i) => [pts[i][0] * k + ox, pts[i][1] * k + oy];
    octx.lineWidth = 3; octx.lineCap = "round"; octx.strokeStyle = "rgba(243,241,236,0.9)";
    for (const [a, b] of BONES) {
      if (pts[a][2] < 0.5 || pts[b][2] < 0.5) continue;
      octx.beginPath(); octx.moveTo(...P(a)); octx.lineTo(...P(b)); octx.stroke();
    }
    octx.fillStyle = "#e8665a";
    for (const i of [29, 30, 31, 32]) if (pts[i][2] >= 0.5) { octx.beginPath(); octx.arc(...P(i), 4, 0, Math.PI * 2); octx.fill(); }
  }

  // ---- the scale, then measuring (and recording)
  q(".live__scale").addEventListener("click", () => {
    if (!video.videoWidth) return;
    onNeedScale(snapshot());
  });
  function setScale(metersPerPixel) {
    scale = metersPerPixel;
    q(".live__scale").hidden = true;
    q(".live__stop").hidden = false;
    detector.reset();
    clock0 = performance.now();
    record();
    status("Ready: jump whenever you like. Keep the phone still. Tap Stop when you're done.");
    q("#live-title").focus();
  }
  // The recording: video only. Some browsers say they can record MP4 and then record nothing (no
  // H.264 encoder), so a format that has produced almost nothing after 1.5 s is swapped for the next
  const FORMATS = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  function record(from = 0) {
    recStart = performance.now();
    chunks = [];
    if (!("MediaRecorder" in window)) return;                 // the live distances still work
    const tries = FORMATS.slice(from).filter((m) => MediaRecorder.isTypeSupported?.(m));
    mime = tries[0] || "";
    try {
      recorder = new MediaRecorder(new MediaStream(stream.getVideoTracks()), { mimeType: mime || undefined, videoBitsPerSecond: 8_000_000 });
    } catch { recorder = null; return; }
    const mine = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size && recorder === mine) chunks.push(e.data); };
    recorder.start(500);
    recStart = performance.now();
    setTimeout(() => {
      const bytes = chunks.reduce((n, c) => n + c.size, 0);
      if (recorder === mine && mine.state === "recording" && bytes < 20_000 && tries.length > 1) {
        mine.ondataavailable = null;
        mine.stop();
        record(FORMATS.indexOf(tries[1]));
      }
    }, 1500);
  }

  function showJump(j) {
    const m = j.distancePx * scale;
    jumps.push({ ...j, meters: m });
    const box = q(".live__result");
    box.innerHTML = `<span class="live__result-label">Jump ${j.n} · live</span>
      <span class="live__result-value">${formatQuantity("distance", m)}</span>
      ${j.unsure ? `<span class="live__result-note">Unsure: ${esc(j.unsure)}</span>` : ""}`;
    box.hidden = false;
    clearTimeout(showJump.timer);
    showJump.timer = setTimeout(() => { box.hidden = true; }, 6000);
    q(".live__jumps").insertAdjacentHTML("beforeend", `<li class="live__jump${j.unsure ? " live__jump--unsure" : ""}">
      <span class="live__jump-n">Jump ${j.n}</span><span class="live__jump-d">${formatQuantity("distance", m)}</span>
      ${j.unsure ? '<span class="live__jump-note">unsure</span>' : ""}</li>`);
  }

  // ---- stop: the recording, for the full analysis now or saved for later
  q(".live__stop").addEventListener("click", finish);
  async function finish() {
    q(".live__stop").hidden = true;
    const file = await stopRecording();
    stop();
    const n = jumps.length;
    const fps = stream?.getVideoTracks?.()[0]?.getSettings?.().frameRate;
    status(n ? `${n} jump${n === 1 ? "" : "s"} measured live.` : "No jumps were measured.");
    const done = q(".live__done");
    done.hidden = false;
    done.innerHTML = `
      ${file ? `<p>The session was recorded (${(file.size / 1e6).toFixed(0)} MB). The full analysis adds the angles, the timing and the
        checks (steps after landing, hands, someone in the shot), and confirms each distance.</p>
      <div class="live__done-actions">
        <button type="button" class="btn btn--primary live__full">Get the full data</button>
        <a class="btn btn--quiet live__save" href="${URL.createObjectURL(file)}" download="${file.name}">Save the video</a>
      </div>
      <p class="live__save-note">Saved videos can be uploaded here any time later, like any other video.</p>`
        : "<p>This browser couldn't record the session, so only the live distances are available.</p>"}
      <button type="button" class="btn btn--quiet btn--sm live__again">Measure again</button>`;
    const inFile = (recStart - clock0) / 1000;                 // the recording began this long after measuring
    done.querySelector(".live__full")?.addEventListener("click", () => onAnalyze(file, {
      scale, fps: fps ? Math.round(fps) : null,
      jumps: jumps.map(({ n, meters, tTakeoff, unsure }) => ({ n, meters, tTakeoff: tTakeoff - inFile, unsure })) }));
    done.querySelector(".live__again").addEventListener("click", () => { dispose(); onClose("again"); });
  }
  function stopRecording() {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === "inactive") { resolve(chunks.length ? toFile() : null); return; }
      recorder.onstop = () => resolve(chunks.length ? toFile() : null);
      recorder.stop();
    });
  }
  function toFile() {
    const type = (mime || chunks[0]?.type || "video/mp4").split(";")[0];
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return new File(chunks, `jumplab-live-${stamp}.${type.includes("webm") ? "webm" : "mp4"}`, { type });
  }

  // ---- leaving: camera off, screen allowed to sleep
  function stop() {
    running = false;
    wake?.release?.().catch?.(() => {});
    if (!given) stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  function dispose() {
    closed = true;
    if (recorder && recorder.state !== "inactive") { recorder.ondataavailable = null; recorder.stop(); }
    stop();
    host.replaceChildren();
  }
  q(".live__close").addEventListener("click", () => { dispose(); onClose("back"); });

  start();
  return { setScale, dispose, get jumps() { return jumps; }, get frames() { return frames; } };
}
