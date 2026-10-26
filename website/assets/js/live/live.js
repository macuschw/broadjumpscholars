// Measure live: the phone's camera on the Analyze page. MediaPipe's pose tracker runs in the
// browser on every camera frame (nothing is uploaded while measuring); live/detect.js spots each
// jump and its distance is shown the moment the jumper lands. The whole session is recorded at the
// same time, so the full analysis (angles, timing, the checks for steps, hands, someone in the
// shot...) can follow, now or later, from that recording, like any uploaded video.
// With a remote screen (live/room.js, live/remote.js), a laptop or another phone shows the
// distances and runs this one, so nobody has to touch the phone on the tripod.
// "Save tracking data" downloads every tracked frame of the session (with the scale, the calibration
// picture, the live jumps and any tape measurements typed in), so the live detector can be replayed
// and checked against the tape away from the field.
//
//   const live = createLive(host, { onNeedScale(still), onAnalyze(file, info), onClose(why, { room }), room, onScaleSet });
//   live.setScale(metersPerPixel)   after the visitor has marked the tape on onNeedScale's still
import { createDetector } from "./detect.js";
import { cleanCode, isCode, linkPhone, read } from "./room.js";
import { createVoice, esc, fullScreen, jumpItemHTML, jumpWords, paintSkeleton, resultHTML } from "./shared.js";
import { formatQuantity, isImperial } from "../lib/units.js";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

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

export function createLive(host, { onNeedScale, onAnalyze, onClose, onScaleSet = () => {}, room = null, stream: given = null }) {
  host.innerHTML = `
    <div class="live">
      <div class="live__head">
        <h2 id="live-title" tabindex="-1">Measure live</h2>
        <p class="live__lede">Put the phone on a tripod, <strong>turned sideways</strong>, side-on to the jump, with the whole jump and
          the tape measure in the picture. The distance appears, and is said out loud, as soon as the jumper lands.
          It's a quick estimate: for the measured distance, use <strong>Get the full data</strong> when you stop.</p>
      </div>
      <div class="live__stage">
        <video class="live__video" playsinline muted autoplay></video>
        <canvas class="live__overlay" aria-hidden="true"></canvas>
        <p class="live__badge" hidden></p>
        <div class="live__result" role="status" aria-live="assertive" hidden></div>
        <p class="live__turn" hidden>Turn the phone sideways: a jump needs a wide picture.</p>
      </div>
      <div class="live__options">
        <label class="live__camera" hidden>Camera <select class="live__camera-select"></select></label>
        <button type="button" class="btn btn--quiet btn--sm live__speak" aria-pressed="true">Say each distance out loud</button>
        <button type="button" class="btn btn--quiet btn--sm live__full-screen" hidden>Full screen</button>
        <button type="button" class="btn btn--quiet btn--sm live__remote-open">Use a remote screen</button>
      </div>
      <form class="live__remote-form" hidden>
        <label>Code on the remote screen
          <input class="live__remote-code" type="text" inputmode="text" autocapitalize="characters" autocomplete="off"
            spellcheck="false" maxlength="9" placeholder="K7P2QX" aria-describedby="live-remote-help"></label>
        <button type="submit" class="btn btn--primary btn--sm">Connect</button>
        <p class="live__remote-help" id="live-remote-help">On a laptop or another phone, open the Analyze page and choose
          <strong>Remote screen</strong>: it shows a code (or a QR code to scan with this phone's camera).</p>
      </form>
      <p class="live__remote" hidden><span class="live__remote-text"></span>
        <button type="button" class="btn btn--quiet btn--sm live__remote-off">Disconnect</button></p>
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
  const status = (text) => { q(".live__status").textContent = text; link?.soon(); };
  let stream = null, tracker = null, scale = null, recorder = null, chunks = [], recStart = 0, mime = "", clock0 = 0;
  let running = false, busy = false, lastSeen = 0, wake = null, frames = 0, closed = false, mediaBase = null, lastTs = 0;
  let stage = "starting", air = false, lastPts = null, link = null;
  const session = Date.now();                                  // tells the remote screen a new session began
  const jumps = [];
  // Every tracked frame while measuring, for "Save tracking data": [seconds, 33 x [x, y, visibility] | null]
  const track = [], MAX_TRACK = 20 * 60 * 60;                  // up to 20 minutes at 60 fps
  let scaleStill = null, camInfo = null;
  const round = (v, k) => Math.round(v * k) / k;
  const IS_TOUCH = matchMedia("(pointer: coarse)").matches;   // a phone or tablet, not a laptop
  const voice = createVoice(q(".live__speak"));
  const wide = fullScreen(q(".live__stage"), q(".live__full-screen"));
  const setStage = (s) => { stage = s; link?.soon(); };
  const detector = createDetector({ onJump: (j) => showJump(j), onState: (s) => {
    air = s === "air";
    q(".live__badge").textContent = air ? "In the air" : "";
    q(".live__badge").hidden = !air;
    q(".live__result").classList.toggle("live__result--old", air);   // the last result fades while the next jump flies
    link?.soon();
  } });

  // ---- camera and tracker
  async function start() {
    try {
      if (!given) await findCameras();                          // (named only once the camera was allowed before)
      stream = given || await openCamera(remembered());
    } catch (e) {
      setStage("error");
      status(e?.name === "NotAllowedError"
        ? "The camera wasn't allowed. Allow camera access for this site in the browser's settings, then try again."
        : "No camera could be opened on this device.");
      return;
    }
    if (closed) { stop(); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    if (!given) await listCameras();
    status("Loading the tracker (the first time takes a few seconds)…");
    try { tracker = await loadTracker(); } catch {
      setStage("error");
      status("The tracker couldn't be loaded. Check the connection and try again.");
      return;
    }
    if (closed) return;
    running = true;
    loop();
    try { wake = await navigator.wakeLock?.request("screen"); } catch { /* the screen may dim; fine */ }
    setStage("ready");
    status(link ? "Step 1: set the scale (on the remote screen, or here). Have the tape measure on the floor in the picture."
      : "Step 1: set the scale. Have the tape measure on the floor in the picture.");
    q(".live__scale").hidden = false;
  }

  // ---- which camera. On a laptop, an iPhone nearby can be the camera (Apple's Continuity Camera:
  // the iPhone on the tripod, everything clicked on the laptop): it's picked when it's there.
  function openCamera(deviceId) {
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } };
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: "environment" }, ...size },
    }).catch((e) => (deviceId ? openCamera(null) : Promise.reject(e)));   // a remembered camera that's gone
  }
  let cameras = [];
  function remembered() {
    const label = localStorage.getItem("jl-live-camera");
    return cameras.find((c) => c.label === label)?.deviceId || null;
  }
  async function findCameras() {
    try { cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput" && d.label); } catch { cameras = []; }
  }
  async function listCameras() {
    await findCameras();
    const box = q(".live__camera"), select = q(".live__camera-select");
    box.hidden = cameras.length < 2;
    if (box.hidden) return;
    const now = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    select.innerHTML = cameras.map((c) => `<option value="${esc(c.deviceId)}"${c.deviceId === now ? " selected" : ""}>${esc(c.label)}</option>`).join("");
    // First visit on a laptop: the iPhone, if one is offered (it's on the tripod; the laptop's own camera isn't)
    const phone = !IS_TOUCH && !localStorage.getItem("jl-live-camera") && cameras.find((c) => /iphone|continuity/i.test(c.label));
    const want = remembered() || phone?.deviceId;
    if (want && want !== now) await switchCamera(want);
  }
  async function switchCamera(id) {
    if (scale) return;                                         // a new camera needs a new scale: not mid-session
    stream.getTracks().forEach((t) => t.stop());              // (phones can't keep two cameras open)
    const next = await openCamera(id).catch(() => null);
    if (!next) { status("That camera couldn't be opened. Try another, or reload the page."); return; }
    stream = next;
    const used = stream.getVideoTracks()[0]?.getSettings?.().deviceId || id;
    q(".live__camera-select").value = used;
    const label = cameras.find((c) => c.deviceId === used)?.label;
    if (label) localStorage.setItem("jl-live-camera", label);
    video.srcObject = stream;
    await video.play().catch(() => {});
  }
  q(".live__camera-select").addEventListener("change", (e) => switchCamera(e.target.value));

  /** The current camera frame as a still for calibration (the same shape the server sends). */
  function snapshot() {
    if (!video.videoWidth) return null;
    const w = video.videoWidth, h = video.videoHeight, k = Math.min(1, 1600 / w);
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    return { frame: 0, width: c.width, height: c.height, full_width: w, full_height: h,
      jpeg: c.toDataURL("image/jpeg", 0.88).split(",")[1] };
  }
  /** A small picture for the remote screen: what the camera sees, with the tracked skeleton. */
  const small = document.createElement("canvas");
  function picture() {
    if (!video.videoWidth) return null;
    const k = 480 / video.videoWidth;
    small.width = 480; small.height = Math.round(video.videoHeight * k);
    const ctx = small.getContext("2d");
    ctx.drawImage(video, 0, 0, small.width, small.height);
    if (lastPts && performance.now() - lastSeen < 500) paintSkeleton(ctx, lastPts, k, 0, 0, 2);
    return small.toDataURL("image/jpeg", 0.6).split(",")[1];
  }

  // ---- every frame: track, feed the jump detector, draw the skeleton
  function loop() {
    if (!running) return;
    const next = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick));
    function tick(_, meta) {
      if (!running) return;
      if (!busy && video.readyState >= 2) {
        busy = true;
        // The frame's own time (when the camera caught it, or its media time anchored to this page's
        // clock), so uneven processing doesn't skew speeds; always moving forward, as the tracker needs
        let now = performance.now();
        if (meta?.captureTime > 0) now = meta.captureTime;
        else if (meta?.mediaTime > 0) { mediaBase ??= now - meta.mediaTime * 1000; now = meta.mediaTime * 1000 + mediaBase; }
        now = Math.max(now, lastTs + 1);
        lastTs = now;
        let pts = null;
        try {
          const r = tracker.detectForVideo(video, now);
          const lm = r.landmarks?.[0];
          if (lm) pts = lm.map((p) => [p.x * video.videoWidth, p.y * video.videoHeight, p.visibility ?? 1]);
        } catch { /* a dropped frame */ }
        if (pts) { lastSeen = performance.now(); lastPts = pts; }
        frames++;
        if (scale) {
          const t = (now - clock0) / 1000;                     // seconds since measuring began
          detector.feed(t, pts);
          if (track.length < MAX_TRACK) track.push([round(t, 1000), pts && pts.map(([x, y, v]) => [round(x, 10), round(y, 10), round(v, 100)])]);
        }
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
    paintSkeleton(octx, pts, k, (w - video.videoWidth * k) / 2, (h - video.videoHeight * k) / 2);
  }

  // ---- the scale, then measuring (and recording)
  q(".live__scale").addEventListener("click", () => {
    const still = snapshot();
    if (!still) { status("The camera is still starting. Try again in a moment."); return; }
    scaleStill = still;
    onNeedScale(still);
  });
  function setScale(metersPerPixel) {
    scale = metersPerPixel;
    const track0 = stream?.getVideoTracks?.()[0], set = track0?.getSettings?.() || {};
    camInfo = { label: track0?.label || "", width: video.videoWidth || set.width || null,
      height: video.videoHeight || set.height || null, fps: set.frameRate || null };   // (gone once the camera stops)
    q(".live__scale").hidden = true;
    q(".live__stop").hidden = false;
    detector.reset();
    clock0 = performance.now();
    record();
    setStage("measuring");
    status(link ? "Measuring: jump whenever you like. The remote screen shows each distance and has the Stop button."
      : "Ready: jump whenever you like. Keep the camera still. Stop when you're done.");
    q(".live__camera-select").disabled = true;                 // the scale belongs to this camera
    voice.say("Ready. Jump when you like.");                   // (also lets phones speak later: it follows a tap)
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
    box.innerHTML = resultHTML(j, m);
    box.hidden = false;                                        // stays up until the next jump replaces it
    box.classList.remove("live__result--old");
    voice.say(jumpWords(j, m));
    q(".live__jumps").insertAdjacentHTML("beforeend", jumpItemHTML(j, m));
    link?.soon();
  }

  // ---- stop: the recording, for the full analysis now or saved for later
  q(".live__stop").addEventListener("click", finish);
  async function finish() {
    if (stage !== "measuring") return;
    setStage("stopping");
    q(".live__stop").hidden = true;
    const file = await stopRecording();
    stop();
    const n = jumps.length;
    const fps = stream?.getVideoTracks?.()[0]?.getSettings?.().frameRate;
    setStage("done");
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
      ${track.length ? `<details class="disclose live__check">
        <summary>Checking accuracy? Save the tracking data</summary>
        <div class="disclose__body">
          <p>Type what the tape measure said for each jump (any way you like: 7 ft 2 in, 7' 2", 2.18 m), then save. The file
            holds the tracked body points from every frame, the scale and these distances, so the live measurement can be
            checked against the tape later. It doesn't contain the video.</p>
          ${n ? `<ol class="live__tapes" role="list">${jumps.map((j) => `<li><label>Jump ${j.n}
            <span class="live__tape-live">(live ${esc(formatQuantity("distance", j.meters))})</span>
            <input type="text" class="live__tape" data-n="${j.n}" autocomplete="off" placeholder="tape"></label></li>`).join("")}</ol>` : ""}
          <button type="button" class="btn btn--quiet btn--sm live__save-track">Save tracking data</button>
        </div>
      </details>` : ""}
      <button type="button" class="btn btn--quiet btn--sm live__again">Measure again</button>`;
    done.querySelector(".live__save-track")?.addEventListener("click", () => saveTrack(done, fps));
    const inFile = (recStart - clock0) / 1000;                 // the recording began this long after measuring
    done.querySelector(".live__full")?.addEventListener("click", () => onAnalyze(file, {
      scale, fps: fps ? Math.round(fps) : null,
      jumps: jumps.map(({ n, meters, tTakeoff, unsure }) => ({ n, meters, tTakeoff: tTakeoff - inFile, unsure })) }));
    done.querySelector(".live__again").addEventListener("click", again);
  }
  /** The session's tracking, the live jumps and the tape measurements, as a JSON file to download. */
  function saveTrack(done, fps) {
    const tapes = Object.fromEntries([...done.querySelectorAll(".live__tape")].map((i) => [i.dataset.n, i.value.trim()]));
    const data = {
      format: "jumplab-live-track/1", saved: new Date().toISOString(), userAgent: navigator.userAgent,
      camera: { ...camInfo, fps: fps || camInfo?.fps || null },
      measured_fps: track.length > 1 ? Math.round((track.length - 1) / (track.at(-1)[0] - track[0][0]) * 10) / 10 : null,
      scale_m_per_px: scale, units: isImperial() ? "imperial" : "metric", still: scaleStill,
      jumps: jumps.map((j) => ({ ...j, tape: tapes[j.n] || "" })),
      frames: track,
    };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob),
      download: `jumplab-live-track-${data.saved.slice(0, 16).replace(/[:T]/g, "-")}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function again() { const code = link?.code || null; dispose("again"); onClose("again", { room: code }); }
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

  // ---- a remote screen: it shows the distances and sends the scale, Stop and Measure again
  const LINK_TEXT = {
    watching: (c) => `Connected to the remote screen (${c}). It shows each distance and runs this phone.`,
    waiting: (c) => `Linked to remote screen ${c}: waiting for it to open…`,
    lost: () => "Lost the connection to the remote screen. Still trying…",
  };
  function connect(code) {
    link?.stop(null);
    voice.mute();                                              // the remote screen does the talking
    q(".live__remote-form").hidden = true;
    q(".live__remote-open").hidden = true;
    q(".live__remote").hidden = false;
    q(".live__remote-text").textContent = LINK_TEXT.waiting(code);
    link = linkPhone(code, {
      state: () => ({ session, stage, status: q(".live__status").textContent, air,
        jumps: jumps.map(({ n, meters, unsure }) => ({ n, meters: Math.round(meters * 1e4) / 1e4, unsure: unsure || null })) }),
      picture, still: () => (scaleStill = snapshot()),
      onCommand(c) {
        if (c.type === "scale" && stage === "ready" && c.scale > 0) { setScale(c.scale); onScaleSet(); }
        else if (c.type === "stop") finish();
        else if (c.type === "again" && stage === "done") again();
      },
      onLink(how) {
        if (how === "gone") { disconnect(`The remote screen ${code} has closed (or the code was wrong).`); return; }
        q(".live__remote-text").textContent = LINK_TEXT[how](code);
      },
    });
  }
  function disconnect(note = "") {
    link?.stop(note ? null : "disconnected");
    link = null;
    q(".live__remote").hidden = true;
    q(".live__remote-open").hidden = false;
    if (note) status(note);
  }
  q(".live__remote-open").addEventListener("click", () => {
    q(".live__remote-form").hidden = false;
    q(".live__remote-code").focus();
  });
  q(".live__remote-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = cleanCode(q(".live__remote-code").value);
    const help = q(".live__remote-help");
    if (!isCode(code)) { help.textContent = "That code doesn't look right: it's 6 letters and numbers, shown on the remote screen."; return; }
    try { await read(code, "remote"); } catch (err) { help.textContent = err.message; return; }
    connect(code);
  });
  q(".live__remote-off").addEventListener("click", () => disconnect());

  // ---- leaving: camera off, screen allowed to sleep
  function stop() {
    running = false;
    wake?.release?.().catch?.(() => {});
    if (!given) stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  /** why: "back", "analyzing" (the remote screen is told), or "again" (a new session follows on the same link). */
  function dispose(why = "back") {
    closed = true;
    link?.stop(why === "again" ? null : why);
    link = null;
    wide.exit();
    voice.stop();
    if (recorder && recorder.state !== "inactive") { recorder.ondataavailable = null; recorder.stop(); }
    stop();
    host.replaceChildren();
  }
  q(".live__close").addEventListener("click", () => { dispose(); onClose("back", { room: null }); });

  if (room) connect(room);
  start();
  return { setScale, dispose, get jumps() { return jumps; }, get frames() { return frames; }, get room() { return link?.code || null; } };
}
