// Measure live: the phone's camera on the Analyze page. MediaPipe's pose tracker runs in the
// browser on every camera frame (nothing is uploaded while measuring); live/detect.js spots each
// jump, and its distance is shown and said once the landing is held (about 1.5 s after landing; a
// step, a hand down or a fall is said instead: that jump doesn't count). The whole session is
// recorded at the same time, so the full analysis (angles, timing, someone in the shot...) can
// follow, now or later, from that recording, like any uploaded video.
// With a remote screen (live/room.js, live/remote.js), a laptop or another phone shows the
// distances and runs this one, so nobody has to touch the phone on the tripod; after Stop it can
// ask for the recording (sent through the analysis server) to save it or analyze it there.
// "Save tracking data" downloads every tracked frame of the session (with the scale, the calibration
// picture, the live jumps and any tape measurements typed in), so the live detector can be replayed
// and checked against the tape away from the field.
//
//   const live = createLive(host, { onNeedScale(still), onAnalyze(file, info), onClose(why, { room }), room, onScaleSet });
//   live.setScale(metersPerPixel)   after the visitor has marked the tape on onNeedScale's still
import { createDetector } from "./detect.js";
import { cleanCode, isCode, linkPhone, read } from "./room.js";
import { bindUnits, createVoice, esc, feetApart, fileStamp, fullScreen, guardLeaving, jumpItemHTML, jumpWords, paintSkeleton, parseTapeText,
  renderTapeCheck, resultsCSV, saveFile, setupHTML, showResult, tapeEntry, unitsHTML } from "./shared.js";
import { record as logTape } from "./tapelog.js";
import { forgetVideo, uploadVideo } from "../demo/server.js";
import { formatQuantity, isImperial, onUnitsChange } from "../lib/units.js";

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
          the tape measure in the picture. The distance appears, and is said out loud, once the jumper has held the
          landing (a step, a hand down or a fall is said instead). It's a quick estimate: for the measured distance,
          use <strong>Get the full data</strong> when you stop.</p>
        ${setupHTML()}
      </div>
      <div class="live__stage">
        <video class="live__video" playsinline muted autoplay></video>
        <canvas class="live__overlay" aria-hidden="true"></canvas>
        <p class="live__badge" hidden></p>
        <div class="live__result" role="status" aria-live="assertive" hidden></div>
        <p class="live__turn" hidden>Turn the phone sideways: a jump needs a wide picture.</p>
      </div>
      <div class="live__options">
        ${unitsHTML()}
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
      <p class="live__rate" hidden></p>
      <div class="live__actions">
        <button type="button" class="btn btn--primary live__scale" hidden>Set the scale</button>
        <button type="button" class="btn btn--primary live__stop" hidden>Stop</button>
        <button type="button" class="btn btn--quiet btn--sm live__close">Back</button>
      </div>
      <ol class="live__jumps" role="list" aria-label="Jumps measured live"></ol>
      <p class="live__tapecheck" hidden></p>
      <div class="live__done" hidden></div>
    </div>`;
  const q = (s) => host.querySelector(s);
  const video = q(".live__video"), overlay = q(".live__overlay"), octx = overlay.getContext("2d");
  const status = (text) => { q(".live__status").textContent = text; link?.soon(); };
  let stream = null, tracker = null, scale = null, recorder = null, chunks = [], recStart = 0, mime = "", clock0 = 0;
  let running = false, busy = false, lastSeen = 0, wake = null, frames = 0, closed = false, mediaBase = null, lastTs = 0;
  let stage = "starting", air = false, lastPts = null, link = null, file = null, kept = false, rate = 0, recFps = null;
  let handoff = null, remoteTook = false;                      // the recording, sent to the remote screen (on its request)
  const tracked = [];                                          // when each recent frame was tracked: the tracking rate
  let trackingSince = 0;
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
  const offUnitSwitch = bindUnits(q(".live__options"));
  const detector = createDetector({ onLanded: (j) => landed(j), onJump: (j) => showJump(j), onState: (s) => {
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
    trackingSince = performance.now();
    loop();
    try { wake = await navigator.wakeLock?.request("screen"); } catch { /* the screen may dim; fine */ }
    setStage("ready");
    stageStatus();
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
    const k = 400 / video.videoWidth;
    small.width = 400; small.height = Math.round(video.videoHeight * k);
    const ctx = small.getContext("2d");
    ctx.drawImage(video, 0, 0, small.width, small.height);
    if (lastPts && performance.now() - lastSeen < 500) paintSkeleton(ctx, lastPts, k, 0, 0, 2);
    return small.toDataURL("image/jpeg", 0.55).split(",")[1];
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
        tracked.push(performance.now());
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

  // How many frames a second the tracker manages: fewer than ~12 and jumps get missed or measured
  // roughly (our replay: 1.3% worst at 15 frames/s, a missed jump at 7.5)
  const rateTimer = setInterval(() => {
    const now = performance.now();
    while (tracked.length && now - tracked[0] > 2000) tracked.shift();
    const el = q(".live__rate"), span = Math.min(2000, now - trackingSince);   // the last 2 s, or since tracking began
    // only while measuring (or about to), and not in the first second of tracking: too soon to tell
    el.hidden = !running || (stage !== "ready" && stage !== "measuring") || span < 900;
    if (el.hidden) return;
    rate = Math.round(tracked.length / (span / 1000));
    const slow = rate < 12;
    el.classList.toggle("live__rate--slow", slow);
    el.textContent = slow ? `Tracking only ${rate} frame${rate === 1 ? "" : "s"} a second: jumps may be missed or measured roughly. Close other apps, or try a newer phone.`
      : `Tracking ${rate} frames a second.`;
  }, 1000);

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
    detector.setGeometry({ width: camInfo.width, height: camInfo.height, metersPerPixel });   // feet-apart allows for perspective
    clock0 = performance.now();
    record();
    setStage("measuring");
    stageStatus();
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

  /** Just landed: shown as "checking the landing" (no number yet), not said. */
  function landed(j) {
    const jump = { ...j, meters: j.distancePx * scale, apart: feetApart(j, scale), fps: rate, checking: true };
    jumps.push(jump);
    showResult(q(".live__result"), jump);
    q(".live__result").classList.remove("live__result--old");
    renderList();
    link?.soon();
  }
  /** Judged: the distance, or why it doesn't count; said out loud. Stays up until the next jump. */
  function showJump(j) {
    const jump = { ...j, meters: j.distancePx * scale, apart: feetApart(j, scale), fps: jumps.find((x) => x.n === j.n)?.fps ?? rate };
    const at = jumps.findIndex((x) => x.n === j.n);
    if (at >= 0) jumps[at] = jump; else jumps.push(jump);
    const box = q(".live__result");
    if (jumps.at(-1) === jump) { showResult(box, jump); box.classList.toggle("live__result--old", air); }
    voice.say(jumpWords(jump));
    renderList();
    link?.soon();
  }
  /** The jumps as the remote screen gets them, and as the results file lists them. */
  const sharedJumps = () => jumps.map(({ n, meters, unsure, apart, tape, toeGapPx, heelGapPx, fps, checking, foul, tTakeoff, flight }) => ({
    n, meters: Math.round(meters * 1e4) / 1e4, unsure: unsure || null, apart, tape: tape || null, fps,
    checking: !!checking, foul: foul || null, flight: Math.round(flight * 100) / 100,
    t: Math.round((tTakeoff - (recStart - clock0) / 1000) * 100) / 100,      // seconds into the recording
    toeGapCm: Math.round((toeGapPx ?? 0) * scale * 1000) / 10, heelGapCm: Math.round((heelGapPx ?? 0) * scale * 1000) / 10 }));
  // The list, with each jump's tape check: typed here or on the remote screen, kept in the tape log
  const list = q(".live__jumps");
  const tape = tapeEntry(list, (n, m) => setTape(n, m, "phone"), () => renderList());
  function renderList() {
    if (tape.busy()) return;                                   // not under someone typing a tape measurement
    list.innerHTML = jumps.map(jumpItemHTML).join("");
  }
  function setTape(n, meters, device) {
    const j = jumps.find((x) => x.n === n);
    if (!j || !(meters > 0)) return;
    j.tape = meters;
    logTape(session, n, { live_m: j.meters, tape_m: meters, toe_gap_cm: Math.round((j.toeGapPx ?? 0) * scale * 1000) / 10,
      heel_gap_cm: Math.round((j.heelGapPx ?? 0) * scale * 1000) / 10, fps: j.fps, unsure: !!j.unsure, device });
    list.querySelector(`.live__tapeform[data-n="${n}"]`)?.remove();
    renderList();                                              // (not while another jump's tape is being typed here)
    link?.soon();
  }
  const redraw = () => {                                       // units or the correction changed
    renderList();
    renderTapeCheck(q(".live__tapecheck"));
    const last = jumps.at(-1);
    if (last && !q(".live__result").hidden) showResult(q(".live__result"), last);
  };
  const offUnits = onUnitsChange(redraw);
  window.addEventListener("jl-tape-change", redraw);
  renderTapeCheck(q(".live__tapecheck"));

  // ---- stop: the recording, for the full analysis now or saved for later
  q(".live__stop").addEventListener("click", finish);
  async function finish() {
    if (stage !== "measuring") return;
    setStage("stopping");
    q(".live__stop").hidden = true;
    detector.flush();                                          // a landing still being checked: judged now
    file = await stopRecording();
    const fps = recFps = stream?.getVideoTracks?.()[0]?.getSettings?.().frameRate || null;
    stop();
    const n = jumps.length, counted = jumps.filter((j) => !j.foul).length;
    setStage("done");
    status(n ? `${n} jump${n === 1 ? "" : "s"} measured live${counted < n ? ` (${n - counted} didn't count)` : ""}.` : "No jumps were measured.");
    const done = q(".live__done");
    done.hidden = false;
    done.innerHTML = `
      ${file ? `<p>The session was recorded (${Math.max(1, Math.round(file.size / 1e6))} MB). The full analysis adds the angles, the timing and the
        checks (steps after landing, hands, someone in the shot), and confirms each distance.</p>
      <div class="live__done-actions">
        <button type="button" class="btn btn--primary live__full">Get the full data</button>
        <a class="btn btn--quiet live__save" href="${URL.createObjectURL(file)}" download="${file.name}">Save the video</a>
        ${n ? '<button type="button" class="btn btn--quiet live__results">Save the results</button>' : ""}
      </div>
      <p class="live__save-note">Saved videos can be uploaded here any time later, like any other video. The results file is a
        spreadsheet (CSV) of every jump.${link ? " The remote screen can bring the video and the results over too." : ""}</p>`
        : `<p>This browser couldn't record the session, so only the live distances are available.</p>
      ${n ? '<div class="live__done-actions"><button type="button" class="btn btn--quiet live__results">Save the results</button></div>' : ""}`}
      ${track.length ? `<details class="disclose live__check">
        <summary>Checking accuracy? Save the tracking data</summary>
        <div class="disclose__body">
          <p>Type what the tape measure said for each jump (any way you like: 7 ft 2 in, 7' 2", 2.18 m), then save. The file
            holds the tracked body points from every frame, the scale and these distances, so the live measurement can be
            checked against the tape later. It doesn't contain the video.</p>
          ${n ? `<ol class="live__tapes" role="list">${jumps.map((j) => `<li><label>Jump ${j.n}
            <span class="live__tape-live">(live ${esc(formatQuantity("distance", j.meters))})</span>
            <input type="text" class="live__tape" data-n="${j.n}" autocomplete="off" placeholder="tape" value="${j.tape > 0 ? esc(formatQuantity("distance", j.tape).replace("½", ".5")) : ""}"></label></li>`).join("")}</ol>` : ""}
          <button type="button" class="btn btn--quiet btn--sm live__save-track">Save tracking data</button>
        </div>
      </details>` : ""}
      <button type="button" class="btn btn--quiet btn--sm live__again">Measure again</button>`;
    done.querySelector(".live__save-track")?.addEventListener("click", () => saveTrack(done, fps));
    const inFile = (recStart - clock0) / 1000;                 // the recording began this long after measuring
    done.querySelector(".live__full")?.addEventListener("click", () => {
      kept = true;
      onAnalyze(file, { scale, fps: fps ? Math.round(fps) : null, session,
        jumps: jumps.map(({ n, meters, tTakeoff, unsure, foul }) => ({ n, meters, tTakeoff: tTakeoff - inFile, unsure, foul })) });
    });
    done.querySelector(".live__save")?.addEventListener("click", () => { kept = true; });
    done.querySelector(".live__results")?.addEventListener("click", () => saveFile(new Blob([resultsCSV(sharedJumps())], { type: "text/csv" }),
      `${file ? file.name.replace(/\.\w+$/, "") : `jumplab-live-${fileStamp(session)}`}-results.csv`));
    done.querySelector(".live__again").addEventListener("click", () => { if (sureToLeave()) again(); });
  }
  /** The session's tracking, the live jumps and the tape measurements, as a JSON file to download. */
  function saveTrack(done, fps) {
    const tapes = Object.fromEntries([...done.querySelectorAll(".live__tape")].map((i) => [i.dataset.n, i.value.trim()]));
    for (const [n, text] of Object.entries(tapes)) {             // typed here: in the tape check as well
      const m = parseTapeText(text);
      if (m >= 0.3 && m <= 4 && jumps.find((j) => j.n === +n)?.tape !== m) setTape(+n, m, "phone");
    }
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
      download: `jumplab-live-track-${fileStamp()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function again() { const code = link?.code || null; dispose("again"); onClose("again", { room: code }); }
  // The remote screen asked for the recording: it goes up to the analysis server as a job not yet
  // started, the remote downloads it from there (and may start the analysis on it)
  async function sendVideo() {
    if (!file || handoff?.state === "sending" || handoff?.state === "sent") return;
    handoff = { state: "sending", sent: 0, size: file.size, name: file.name, type: file.type };
    const note = () => status(`Sending the recording to the remote screen (${Math.round((100 * handoff.sent) / file.size)}%). Keep this page open.`);
    note();
    const up = uploadVideo(file, { fps: recFps ? Math.round(recFps) : null, scale, onProgress: (sent) => {
      const before = Math.round((100 * handoff.sent) / file.size);
      handoff.sent = sent;
      if (Math.round((100 * sent) / file.size) !== before) note();
    } });
    handoff.abort = up.abort;
    try {
      Object.assign(handoff, await up.promise, { state: "sent", sent: file.size });
      status("Sent to the remote screen. It can save the video or get the full data now.");
    } catch (e) {
      if (closed) return;
      Object.assign(handoff, { state: "error", error: e.message });
      status(`The recording couldn't be sent to the remote screen: ${e.message}`);
    }
    link?.soon();
  }
  // Leaving would lose the session: measuring, or a recording not yet saved or sent for the full analysis
  const unsaved = () => running && !!scale || (stage === "done" && !!file && !kept);
  const sureToLeave = () => !unsaved() || confirm(stage === "done"
    ? "Leave without keeping this session's recording? Save the video or get the full data first to keep it."
    : "Stop measuring and leave? This session's recording will be lost.");
  const offGuard = guardLeaving(unsaved);
  function stopRecording() {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === "inactive") { resolve(chunks.length ? toFile() : null); return; }
      recorder.onstop = () => resolve(chunks.length ? toFile() : null);
      recorder.stop();
    });
  }
  function toFile() {
    const type = (mime || chunks[0]?.type || "video/mp4").split(";")[0];
    const stamp = fileStamp();
    return new File(chunks, `jumplab-live-${stamp}.${type.includes("webm") ? "webm" : "mp4"}`, { type });
  }

  /** What to do now, while setting the scale or measuring (it depends on whether a remote screen runs this phone). */
  function stageStatus() {
    if (stage === "ready") status(link ? "Step 1: set the scale (on the remote screen, or here). Have the tape measure on the floor in the picture."
      : "Step 1: set the scale. Have the tape measure on the floor in the picture.");
    else if (stage === "measuring") status(link ? "Measuring: jump whenever you like. The remote screen shows each distance and has the Stop button."
      : "Ready: jump whenever you like. Keep the camera still. Stop when you're done.");
  }

  // ---- a remote screen: it shows the distances and sends the scale, Stop and Measure again
  const LINK_TEXT = {
    watching: (c) => `Connected to the remote screen (${c}). It shows each distance and runs this phone.`,
    waiting: (c) => `Linked to remote screen ${c}: waiting for it to open… Until it does, this phone says each result.`,
    lost: () => "Lost the connection to the remote screen. Still trying…",
  };
  function connect(code) {
    link?.stop(null);
    voice.mute();                                              // the remote screen does the talking (while it's there)
    q(".live__remote-form").hidden = true;
    q(".live__remote-open").hidden = true;
    q(".live__remote").hidden = false;
    q(".live__remote-text").textContent = LINK_TEXT.waiting(code);
    link = linkPhone(code, {
      state: () => ({ session, stage, status: q(".live__status").textContent, air, rate, scale, fps: recFps ? Math.round(recFps) : null,
        jumps: sharedJumps(), recording: file ? { name: file.name, size: file.size, type: file.type } : null,
        video: handoff && { state: handoff.state, sent: handoff.sent, size: handoff.size, name: handoff.name, type: handoff.type,
          job: handoff.job || null, chunks: handoff.chunks || null, error: handoff.error || null } }),
      picture, still: () => (scaleStill = snapshot()),
      onCommand(c) {
        if (c.type === "scale" && stage === "ready" && c.scale > 0) { setScale(c.scale); onScaleSet(); }
        else if (c.type === "stop") finish();
        else if (c.type === "again" && stage === "done") again();      // (the remote screen asked first)
        else if (c.type === "tape") setTape(c.n, c.meters, "remote");
        else if (c.type === "video" && stage === "done") sendVideo();
        else if (c.type === "kept" && stage === "done") {          // the recording is on the remote screen now
          kept = remoteTook = true;
          status("The remote screen has the recording. You can measure again, or leave.");
        }
      },
      onLink(how) {
        if (how === "gone") { disconnect(`The remote screen ${code} has closed (or the code was wrong).`); return; }
        if (how === "watching") voice.mute(); else voice.unmute();   // nobody watching there: this phone says each result
        q(".live__remote-text").textContent = LINK_TEXT[how](code);
      },
    });
    stageStatus();
  }
  function disconnect(note = "") {
    link?.stop(note ? null : "disconnected");
    link = null;
    voice.unmute();                                            // this phone talks again
    q(".live__remote").hidden = true;
    q(".live__remote-open").hidden = false;
    if (note) status(note); else stageStatus();
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
    clearInterval(rateTimer);
    offUnits(); offGuard(); offUnitSwitch();
    handoff?.abort?.();
    if (handoff?.job && !remoteTook) forgetVideo(handoff.job);   // sent, but the remote never took it
    window.removeEventListener("jl-tape-change", redraw);
    link?.stop(why === "again" ? null : why);
    link = null;
    wide.exit();
    voice.stop();
    if (recorder && recorder.state !== "inactive") { recorder.ondataavailable = null; recorder.stop(); }
    stop();
    host.replaceChildren();
  }
  q(".live__close").addEventListener("click", () => { if (!sureToLeave()) return; dispose(); onClose("back", { room: null }); });

  if (room) connect(room);
  start();
  return { setScale, dispose, get jumps() { return jumps; }, get frames() { return frames; }, get room() { return link?.code || null; } };
}
