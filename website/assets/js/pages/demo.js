// The jump dashboard, on two pages (<body data-page>):
//   Analyze (analyze.html), your own jumps:
//     1. A video -> the JumpLab analysis server (demo/server.js) -> click the tape to set the scale
//        (demo/calibrate.js) -> results. Real numbers, the same analysis as the command line.
//     2. A results file from the JumpLab app (<video>_web.json, with the video if available) -> results.
//     Every real jump is also kept in this browser ("My jumps", demo/history.js) to open again later.
//   Demo (demo.html): the sample jump, three simulated attempts (data/mock-data.js), clearly marked
//     as demo data, shown straight away.
// The dashboard itself (progress, calibration, results) is shared: demo/dashboard-html.js.
// Real jumps play back as the video with the tracked skeleton (demo/video-playback.js); the sample
// plays on the 3D stage. Charts, key moments and the comparison are shared.
import { fmt } from "../lib/dom.js";
import { icon } from "../components/icons.js";
import { countUp, statHTML, statValues } from "../components/stat.js";
import { initTabs } from "../components/tabs.js";
import { ATTEMPTS, DEMO_NOTICE, SAMPLE, headline, keyMoments } from "../data/mock-data.js";
import { createSteps } from "../demo/analysis.js";
import { DASHBOARD_HTML } from "../demo/dashboard-html.js";
import { Playback, readoutsHTML } from "../demo/playback.js";
import { VideoPlayback } from "../demo/video-playback.js";
import { buildCharts } from "../demo/charts.js";
import { buildCompare } from "../demo/compare.js";
import { STAT_NAMES, bundleToAttempt, checkBundle, downloadBundle, issues, readResults, realHeadline } from "../demo/real.js";
import { calibrate } from "../demo/calibrate.js";
import { analyzeSession, recompute, serverURL, wake } from "../demo/server.js";
import { MAX_LABEL, canSave, clearJumps, listJumps, loadJump, removeJumps, renameJump, saveJump } from "../demo/history.js";
import { formatQuantity, onUnitsChange } from "../lib/units.js";
import { addFull, clear as clearTapeLog, csv as tapeCSV, entries as tapeEntries } from "../live/tapelog.js";
import { renderTapeCheck } from "../live/shared.js";

const $ = (id) => document.getElementById(id);
const PAGE = document.body.dataset.page === "demo" ? "demo" : "analyze";
$("dashboard").outerHTML = DASHBOARD_HTML;
const views = { start: $("demo-start"), live: $("demo-live"), remote: $("demo-remote"), progress: $("demo-progress"), calibrate: $("demo-calibrate"), results: $("demo-results") };
const show = (name) => Object.entries(views).forEach(([k, v]) => { if (v) v.hidden = k !== name; });   // Demo: no start
const MAX_REAL = 6;                                            // saved jumps to compare at once (My jumps)
const MAX_SESSION = 24;                                        // real jumps on screen (one video can hold many)

document.querySelectorAll("[data-icon]").forEach((n) => { n.innerHTML = icon(n.dataset.icon); });
function setNotice(mode) {
  $("demo-notice").innerHTML = mode === "sample"
    ? `${icon("info")}<p><strong>Demo data.</strong> ${DEMO_NOTICE}</p>`
    : mode === "real"
      ? `${icon("info")}<p><strong>Your jump.</strong> Analyzed with the same pose tracking and physics as the JumpLab app; see the Science page for how.</p>`
      : `${icon("info")}<p>Want to see what you get first? <a href="demo.html">Try the demo</a> with a simulated sample jump.</p>`;
}
setNotice(PAGE === "demo" ? "sample" : "start");

// The start card says what this site can do right now
if (PAGE === "demo") {
  // nothing to upload here
} else if (serverURL) {
  $("drop-privacy").textContent = "Your video is sent to the JumpLab analysis server, analyzed, and deleted straight away. Your results are kept only in this browser, under My jumps.";
  wake();                                                      // start a sleeping server while the visitor gets the video
} else {
  $("drop-title").textContent = "Open your results";
  $("drop-lede").innerHTML = "Analyzing videos on this site is being set up. Meanwhile, run the JumpLab app on a computer and open the <code>_web.json</code> it saves, with the video if you have it.";
  $("drop-button").textContent = "Open results";
  $("drop-fps").hidden = true;
  $("drop-help").textContent = "or drag the files here";
  $("drop-privacy").textContent = "Files open in your browser and are never uploaded.";
}

// ---------------------------------------------------------------- results
let mode = "sample", session = ATTEMPTS, current = SAMPLE, charts = null, chartsFor = null, compare = null, activeTab = "playback";
const realSession = [];
const headlineOf = (a) => (a.real ? realHeadline(a) : headline(a));
const onFrame = (f) => {
  $("pb-readouts").innerHTML = readoutsHTML(f);
  if (charts && activeTab === "charts") charts.setFrame(f);
};
const simPlayback = new Playback($("playback"), { onFrame });
let realPlayback = null;
const playback = () => (current.real ? realPlayback : simPlayback);

function renderPicker() {
  const best = bestValid(session);
  const mark = (a) => (!a.real ? "" : a.valid
    ? `<span class="attempt-btn__mark" aria-hidden="true">${icon("check")}</span>`
    : `<span class="attempt-btn__mark attempt-btn__mark--void" aria-hidden="true">${icon("close")}</span>`);
  const said = (a) => (!a.real ? "" : a.valid ? (a === best ? ", counts, best" : ", counts") : ", doesn't count");
  $("attempt-pick").innerHTML = session.map((a) =>
    `<button type="button" class="attempt-btn${a.real && !a.valid ? " attempt-btn--void" : ""}${a === best && session.length > 1 ? " attempt-btn--best" : ""}" data-attempt="${a.id}" aria-pressed="${a === current}"
      title="${esc(a.name || a.label)}${a.sub ? ` · ${esc(a.sub)}` : ""}" aria-label="${esc(a.label + said(a))}">${mark(a)}${esc(a.label)}</button>`).join("");
  $("attempt-pick").setAttribute("aria-label", mode === "sample" ? "Attempt" : "Jump");
  $("attempt-pick").querySelectorAll(".attempt-btn").forEach((b) => b.addEventListener("click", () => setAttempt(session.find((a) => a.id === b.dataset.attempt))));
}

function ensureCharts() {
  if (chartsFor === current) return;
  charts = buildCharts($("charts"), current, { onSeekTime: (t) => playback().seek(Math.round(t * current.fps)) });
  chartsFor = current;
}

function renderStats({ animate = true, prev = null } = {}) {
  const stats = $("results-stats");
  stats.innerHTML = headlineOf(current).map((s, i) => statHTML(s, { key: i === 0 })).join("");
  if (animate) countUp(stats, { from: prev, ms: prev ? 450 : 700, delay: prev ? 0 : 150 });
}

function setAttempt(a) {
  const stats = $("results-stats"), prev = stats.children.length ? statValues(stats) : null;
  simPlayback.pause();
  realPlayback?.pause();
  current = a;
  $("attempt-pick").querySelectorAll(".attempt-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.attempt === a.id)));
  renderStats({ prev });
  $("playback").hidden = a.real;
  $("playback-real").hidden = !a.real;
  if (a.real) {
    realPlayback ??= new VideoPlayback($("playback-real"), { onFrame });
    realPlayback.load(a);
  } else {
    simPlayback.load(a);
    simPlayback.seek(a.events.takeoff);
  }
  renderMoments(a);
  renderFoul(a);
  renderAlert(a);
  renderChecks(a);
  renderSource(a);
  chartsFor = null;
  if (activeTab === "charts") { ensureCharts(); charts.setFrame(a.frames[Math.max(0, playback().i ?? 0)]); }
}

function renderSource(a) {
  const tag = $("results-tag");
  if (!a.real) {
    tag.textContent = "Demo data";
    $("results-source").textContent = "Sample session: three attempts by a simulated athlete.";
    return;
  }
  tag.textContent = a.calibrated ? "Your jump" : a.rough ? "Rough: no calibration" : "Not calibrated";
  const r = a.bundle.results;
  const fps = `${Math.round(r.fps)} fps${r.fps_source === "override" ? " (as you set)" : ""}`;
  const scale = a.calibrated ? `calibrated, 1 px = ${formatQuantity("tiny", r.scale_m_per_px)}` : "no tape calibration";
  const kept = (a.live ? ` · live result ${formatQuantity("distance", a.live.meters)}` : "") + (a.historyId ? " · saved in My jumps" : "");
  const file = a.custom ? `${a.label} (${a.name})` : a.name;
  $("results-source").textContent = `${file} · ${fps} · ${scale} · ${r.side === "LEFT" ? "left" : "right"} side to the camera${kept}`;
}

// Does it count? The longest jump that does, and each jump's fouls
const distanceOf = (a) => a.metrics.distance ?? -Infinity;
const bestValid = (list) => list.filter((a) => a.real && a.valid).reduce((b, a) => (b && distanceOf(b) >= distanceOf(a) ? b : a), null);
function renderSummary() {
  const box = $("session-summary"), real = session.filter((a) => a.real);
  box.hidden = real.length < 2;
  if (box.hidden) return;
  const counts = real.filter((a) => a.valid), best = bestValid(real);
  box.innerHTML = `<strong>${plural(real.length, "jump")}</strong> · ${counts.length} ${counts.length === 1 ? "counts" : "count"}`
    + (real.length - counts.length ? ` · ${real.length - counts.length} ${real.length - counts.length === 1 ? "doesn't" : "don't"}` : "")
    + (best ? ` · best that counts: <button type="button" class="results__best" data-attempt="${best.id}">${esc(best.label)}, ${best.metrics.distance == null ? "not measured" : formatQuantity("distance", best.metrics.distance)}${best.calibrated ? "" : " (rough)"}</button>` : "");
  box.querySelector(".results__best")?.addEventListener("click", () => setAttempt(best));
}
/** The attempt doesn't count (stepped forward or back after landing, hand on the ground): said
 *  first and loudest, above the numbers, which are still shown. */
function renderFoul(a) {
  const host = $("jump-foul");
  host.hidden = !a.real || a.valid;
  if (host.hidden) { host.replaceChildren(); return; }
  host.innerHTML = `
    <div class="jump-foul__head">
      <span class="jump-foul__icon">${icon("close")}</span>
      <div><h3 class="jump-foul__title">This jump doesn't count</h3>
        <p>${esc(a.fouls.map((f) => f.headline).join(" and "))}. The numbers below are shown for interest, not as a result.</p></div>
    </div>
    <ul class="issues" role="list">${a.fouls.map((f) => `<li class="issue issue--serious">
      <span class="issue__icon">${icon("close")}</span>
      <div class="issue__body"><h4 class="issue__title">${esc(f.headline)}</h4><p>${esc(f.explain || f.message)}</p>
        ${f.fix ? `<p class="issue__fix"><strong>Next time:</strong> ${esc(f.fix)}</p>` : ""}
        ${f.explain ? `<details class="issue__detail"><summary>Technical detail</summary><p>${esc(f.message)}</p></details>` : ""}</div>
    </li>`).join("")}</ul>`;
}

// Problems with the video (staggered feet, someone else in the shot, blur...), in plain words,
// right above the numbers they make unreliable
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** ["distance", "launch"] -> "Jump distance and launch angle" */
const statList = (ids) => {
  const names = ids.map((id, k) => (k ? STAT_NAMES[id].toLowerCase() : STAT_NAMES[id]));
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};
function issueHTML(i) {
  return `<li class="issue issue--${i.severity}">
    <span class="issue__icon">${icon(i.icon)}</span>
    <div class="issue__body">
      <h4 class="issue__title">${esc(i.headline)}</h4>
      <p>${esc(i.explain)}</p>
      ${i.fix ? `<p class="issue__fix"><strong>How to fix it:</strong> ${esc(i.fix)}</p>` : ""}
      <p class="issue__affects">${i.stats.length === 6 ? "Affects every result" : `Affects: ${statList(i.stats)}`}</p>
      ${i.detail ? `<details class="issue__detail"><summary>Technical detail</summary><p>${esc(i.detail)}</p></details>` : ""}
    </div>
  </li>`;
}
function renderAlert(a) {
  const host = $("jump-alert");
  host.hidden = !a.real;
  host.removeAttribute("role");
  if (!a.real) { host.replaceChildren(); return; }
  const all = issues(a), serious = all.filter((i) => i.severity === "serious"), care = all.filter((i) => i.severity !== "serious");
  if (!all.length) {
    host.className = "jump-alert jump-alert--clear";
    const lm = a.bundle.landmarks || {};
    const checked = ["staggered feet", lm.others ? "other people in the shot" : null, lm.sharpness?.length ? "blur" : null,
      "lost tracking", "odd timing"].filter(Boolean);
    host.innerHTML = `${icon("check")}<p><strong>No problems found with this video.</strong>
      JumpLab checked for ${checked.slice(0, -1).join(", ")} and ${checked.at(-1)}.</p>`;
    return;
  }
  const bad = Object.keys(STAT_NAMES).filter((id) => serious.some((i) => i.stats.includes(id)));
  const title = !serious.length ? "Use these results with care"
    : bad.length === 6 ? "These results aren't reliable" : `${statList(bad)} ${bad.length > 1 ? "aren't" : "isn't"} reliable`;
  const lead = serious.length
    ? `We found ${plural(serious.length, "problem")} with this video, so ${bad.length > 1 ? "the numbers" : "the number"} marked “Not reliable” below could be wrong. Fix ${serious.length > 1 ? "them" : "it"} and film the jump again.`
    : `Nothing serious, but ${plural(care.length, "thing")} could make the numbers less exact.`;
  host.className = `jump-alert jump-alert--${serious.length ? "serious" : "caution"}`;
  if (serious.length) host.setAttribute("role", "alert");
  host.innerHTML = `
    <div class="jump-alert__head">
      <span class="jump-alert__icon">${icon("alert")}</span>
      <div><h3 class="jump-alert__title">${title}</h3><p>${lead}</p></div>
    </div>
    <ul class="issues" role="list">${(serious.length ? serious : care).map(issueHTML).join("")}</ul>
    ${serious.length && care.length ? `<details class="disclose jump-alert__more">
      <summary>${plural(care.length, "smaller note")}</summary>
      <div class="disclose__body"><ul class="issues issues--small" role="list">${care.map(issueHTML).join("")}</ul></div>
    </details>` : ""}`;
}

// Ratings for each part of the analysis, kept in view above the tabs
const RATING = { reliable: ["✓", "Reliable"], care: ["~", "Use with care"], rough: ["✗", "Rough only"] };
function renderChecks(a) {
  const host = $("real-checks");
  host.hidden = !a.real;
  if (!a.real) { host.replaceChildren(); return; }
  const notes = a.warnings.filter((w) => w.severity === "info");
  host.innerHTML = `
    <ul class="ratings" role="list" aria-label="How reliable each result is">
      ${Object.values(a.ratings).map((r) => `<li class="rating rating--${r.rating}"><span class="rating__mark" aria-hidden="true">${RATING[r.rating][0]}</span>
        <span><strong>${r.title}</strong> ${RATING[r.rating][1]}</span></li>`).join("")}
    </ul>
    <details class="disclose real-why">
      <summary>Why these ratings${notes.length ? ` · ${plural(notes.length, "note")}` : ""}</summary>
      <div class="disclose__body">
        <dl>${Object.values(a.ratings).map((r) => `<dt>${esc(r.title)}</dt><dd>${esc(r.reason)}</dd>`).join("")}</dl>
        ${notes.length ? `<ul class="real-notes">${notes.map((w) => `<li>${esc(w.message)}</li>`).join("")}</ul>` : ""}
      </div>
    </details>`;
}

function renderMoments(a) {
  const m = a.metrics, e = a.events, t = (i) => a.frames[i]?.t ?? i / a.fps;
  const phases = [
    { label: "Countermovement", value: t(e.bottom) - t(e.onset), unit: "s", digits: 2, sub: "Start of dip to lowest point" },
    { label: "Push-off", value: m.pushOff, unit: "s", digits: 2, sub: "Lowest point to takeoff" },
    { label: "Flight", value: m.flightTime, unit: "s", digits: 2, sub: "Takeoff to landing" },
  ];
  $("moments").innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <caption>Key moments of ${a.real ? a.name : `${a.label} (demo data)`}. Frames at ${Math.round(a.fps)} fps; times from the start of the clip.</caption>
        <thead><tr><th scope="col">Moment</th><th scope="col" class="num-cell">Time</th><th scope="col" class="num-cell">Frame</th>
          <th scope="col" class="num-cell">Hip height</th><th scope="col" class="num-cell">Trunk</th><th scope="col" class="num-cell">Shin</th><th scope="col" class="num-cell">Knee</th></tr></thead>
        <tbody>${keyMoments(a).map((k) => `<tr><th scope="row">${k.name}</th><td class="num-cell">${k.time.toFixed(3)} s</td><td class="num-cell">${k.frame}</td>
          <td class="num-cell">${a.measured === false ? "—" : formatQuantity("height", k.hipHeight)}</td><td class="num-cell">${fmt(k.trunk, 0)}°</td><td class="num-cell">${fmt(k.shin, 0)}°</td><td class="num-cell">${fmt(k.knee, 0)}°</td></tr>`).join("")}</tbody>
      </table>
    </div>
    <div class="scoreboard moments__phases">${phases.map((p) => statHTML(p)).join("")}</div>
    <p class="moments__note">Takeoff is the first frame with both feet off the ground; landing is the first frame a heel touches down. Each event is ±1 frame (±${(1000 / a.fps).toFixed(1)} ms).</p>`;
}

initTabs($("result-tabs"), {
  onChange: (id) => {
    activeTab = id;
    if (id !== "playback") playback()?.pause();
    if (id === "charts") { ensureCharts(); charts.setFrame(current.frames[Math.max(0, playback().i ?? 0)]); }
    if (id === "compare" && !compare) compare = buildCompare($("compare"), session, { headlineOf });
  },
});

/** Show results for a list of attempts (the sample session, or the real jumps so far). */
function showResults(list, which, m, { focus = true } = {}) {
  mode = m;
  session = list;
  current = which;
  setNotice(m);
  $("download-results").hidden = m !== "real";
  $("add-jump").hidden = m !== "real";
  $("result-tabs").querySelector("#tab-compare").hidden = list.length < 2;
  if (activeTab === "compare" && list.length < 2) $("tab-playback").click();
  compare = null;
  $("compare").replaceChildren();
  renderPicker();
  renderSummary();
  show("results");
  $("results-stats").replaceChildren();
  setAttempt(which);
  if (focus) $("results-title").focus();
}

function addReal(attempt) {
  addSession([attempt]);
}

/** Every jump of a video (or of a results file) on screen, starting with the best one that counts. */
function addSession(attempts, show = null) {
  realSession.push(...attempts);
  while (realSession.length > MAX_SESSION) realSession.shift();
  showResults(realSession.slice(), show || bestValid(attempts) || attempts[0], "real");
  for (const a of attempts) remember(a);
}

/** Keep a real jump in My jumps; the source line says so once it's saved. */
async function remember(attempt) {
  if (attempt.historyId) return;
  const id = await saveJump(attempt.saved || attempt.bundle);    // the compact bundle, as downloaded
  if (!id) return;                                             // storage off: nothing changes
  attempt.historyId = id;
  if (current === attempt) renderSource(attempt);
  renderMyJumps();
}

// ---------------------------------------------------------------- 3. the sample (Demo page)
function showSample() {
  $("start-over").hidden = true;                               // nothing to start over: it's the sample
  showResults(ATTEMPTS, SAMPLE, "sample", { focus: false });
}

// ---------------------------------------------------------------- 1. a video -> the analysis server
let job = null;
/** A video to the server. From live measuring: its scale is known (no calibration step) and each
 *  jump's live distance is shown next to the full result. */
async function startUpload(file, { scale = null, fps: liveFps = null, jumps: live = null, session = null } = {}) {
  const fps = liveFps || Number($("fps-select").value) || null;
  $("progress-source").textContent = `“${file.name}”`;
  $("analysis-error").hidden = true;
  $("analysis-cancel").hidden = false;
  show("progress");
  $("progress-title").focus();
  const steps = createSteps($("analysis"), ["Uploading the video", "Finding the jumps", "Tracking 33 body landmarks around each jump", "Measuring and checking each jump"]);
  const stage = { upload: 0, looking: 1, tracking: 2, analyzing: 3 };
  let at = 0;
  const reach = (i, label) => { while (at < i) steps.done(at++); if (label) steps.label(i, label); };
  steps.active(0);
  job = analyzeSession(file, {
    fps, scale,
    onProgress: (name, done, total) => {
      const i = stage[name] ?? at;
      if (i > at) { reach(i); steps.active(i); }
      if (name === "upload") reach(0, `Uploading the video (${Math.round((100 * done) / Math.max(1, total))}%)`);
      else if (name === "looking") reach(1, `Finding the jumps (${Math.round((100 * done) / Math.max(1, total))}% of the video)`);
      else if (name === "tracking") reach(2, total > 1 ? `Tracking 33 body landmarks around each jump (${Math.min(done + 1, total)} of ${total})` : "Tracking 33 body landmarks around the jump");
      else if (name === "analyzing") reach(3, total > 1 ? `Measuring and checking each jump (${Math.min(done + 1, total)} of ${total})` : "Measuring and checking the jump");
    },
  });
  let found;
  try {
    found = readResults(await job.promise);
  } catch (e) {
    steps.fail();
    if (e.canceled && !scale) { show("start"); return; }
    // a live session's recording exists only here: offer to save it rather than lose it
    return fail(e.canceled ? "Canceled. This session's recording isn't saved anywhere yet: save the video to upload it later." : e.message,
      scale ? file : null);
  } finally {
    job = null;
    $("analysis-cancel").hidden = true;
  }
  reach(4);
  const withLive = (a) => {                                    // the live distance of the same jump, if any
    const t = a.bundle.results.events.takeoff.time_s;
    const m = live?.find((j) => Math.abs(j.tTakeoff - t) < 0.6);
    const full = a.bundle.results.distance?.jump_distance_m;
    if (m && session && full) addFull(session, m.n, full);      // joins that jump's tape check, if there is one
    return m ? Object.assign(a, { live: m }) : a;
  };
  if (found.still && !scale) calibrateThen(found, file);
  else addSession(found.jumps.map((b) => withLive(bundleToAttempt(b, { video: file }))));
}

// ---------------------------------------------------------------- 1b. measuring live (phone camera)
let live = null, liveCal = null;
/** room: the code of a remote screen this phone works for (from its QR code, or kept for "Measure again"). */
async function openLive({ room = null } = {}) {
  live?.dispose();
  show("live");
  const { createLive } = await import("../live/live.js");
  live = createLive($("demo-live"), {
    room,
    onNeedScale: (still) => {
      show("calibrate");
      liveCal = calibrate($("demo-calibrate"), still, {
        tips: true,
        onDone: ({ scale }) => { liveCal.dispose(); liveCal = null; show("live"); live.setScale(scale); },
      });
    },
    onScaleSet: () => { if (liveCal) { liveCal.dispose(); liveCal = null; show("live"); } },   // the remote screen set it
    onAnalyze: (file, info) => { live.dispose("analyzing"); live = null; startUpload(file, info); },
    onClose: (why, { room: code } = {}) => {
      live = null;
      if (why === "again") return openLive({ room: code });
      setParam("camera", null);
      show("start");
      $("live-open")?.focus();
    },
  });
  $("live-title")?.focus();
}

// ---------------------------------------------------------------- 1c. a remote screen for a phone measuring live
let remote = null;
async function openRemote(code = null) {
  remote?.dispose();
  show("remote");
  const host = $("demo-remote");
  host.innerHTML = '<p class="live__status" role="status">Opening a remote screen…</p>';
  const [{ createRemote }, { openRoom }] = await Promise.all([import("../live/remote.js"), import("../live/room.js")]);
  if (!code) {
    try { code = await openRoom(); } catch (e) {
      host.innerHTML = `<p class="live__status" role="status">${esc(e.message)} Try again in a moment.</p>
        <button type="button" class="btn btn--quiet btn--sm">Back</button>`;
      host.querySelector("button").addEventListener("click", () => { show("start"); $("remote-open")?.focus(); });
      return;
    }
  }
  setParam("remote", code);                                    // a reload comes back to the same screen
  remote = createRemote(host, {
    code,
    onNeedScale: (still) => {
      show("calibrate");
      const cal = calibrate($("demo-calibrate"), still, {
        tips: true,
        onDone: ({ scale }) => { cal.dispose(); show("remote"); remote.setScale(scale); },
      });
    },
    onClose: () => { remote = null; setParam("remote", null); show("start"); $("remote-open")?.focus(); },
  });
  $("remote-title")?.focus();
}
// Closing the tab mid-upload loses the analysis (Measure live and the remote screen guard their own sessions)
window.addEventListener("beforeunload", (e) => { if (job || unsavedRecording) { e.preventDefault(); e.returnValue = ""; } });

// ---------------------------------------------------------------- 1d. the tape check log (live/tapelog.js)
function renderTapeLog() {
  const box = $("tape-check");
  if (!box) return;
  const list = tapeEntries().slice().reverse();
  box.hidden = !list.length;
  if (!list.length) return;
  renderTapeCheck($("tape-check-summary"));
  const d = (m) => (m > 0 ? formatQuantity("distance", m) : "–");
  const diff = (a, b) => (a > 0 && b > 0 ? `${a >= b ? "+" : "−"}${formatQuantity("short", Math.abs(a - b))}` : "–");
  // Jump and the differences first: on a phone the table scrolls sideways, and these are what matter
  $("tape-check-rows").innerHTML = list.slice(0, 30).map((e) => `<tr>
      <td>${e.n}</td><td>${d(e.live_m)}</td><td>${d(e.tape_m)}</td><td>${diff(e.live_m, e.tape_m)}</td>
      <td>${d(e.full_m)}</td><td>${diff(e.full_m, e.tape_m)}</td>
      <td>${(e.toe_gap_cm > 5 || e.heel_gap_cm > 5) ? "apart" : (e.toe_gap_cm != null ? "together" : "–")}${e.unsure ? ", unsure" : ""}</td>
      <td>${esc(new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</td></tr>`).join("");
  $("tape-check-more").hidden = list.length <= 30;
  $("tape-check-more").textContent = `Showing the latest 30 of ${list.length}; the download has them all.`;
}
if ($("tape-check")) {
  renderTapeLog();
  window.addEventListener("jl-tape-change", renderTapeLog);
  onUnitsChange(renderTapeLog);
  $("tape-check-download").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([tapeCSV()], { type: "text/csv" }));
    a.download = `jumplab-tape-check-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("tape-check-clear").addEventListener("click", () => {
    if (confirm("Delete every tape check on this device? Download them first to keep a copy.")) clearTapeLog();
  });
}

function setParam(key, value) {
  const url = new URL(location.href);
  if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  history.replaceState(history.state, "", url);
}
if ($("live-card")) {
  const camera = !!navigator.mediaDevices?.getUserMedia;                     // a camera, and a secure page
  $("live-card").hidden = false;
  $("live-open").hidden = !camera;
  const laptop = $("live-card").querySelector(".live-card__laptop");
  if (laptop) laptop.hidden = !camera || matchMedia("(pointer: coarse)").matches;   // a phone is the camera itself
  $("live-open").addEventListener("click", () => openLive());
  $("remote-open").addEventListener("click", () => openRemote());
  // ?remote=CODE: this screen was a remote screen (reloaded); ?camera=CODE: this phone scanned one's QR code
  const asked = new URLSearchParams(location.search), code = (k) => (asked.get(k) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code("remote")) openRemote(code("remote"));
  else if (code("camera") && camera) openLive({ room: code("camera") });
}

let unsavedRecording = null;                                   // a live recording whose upload failed, until saved
/** keep: a live session's recording (it exists only in this tab), offered for saving. */
function fail(text, keep = null) {
  $("analysis-error-text").textContent = text;
  $("analysis-error").hidden = false;
  $("analysis-error").querySelector("[data-icon]").innerHTML = icon("info");
  const save = $("analysis-save");
  if (save.href) URL.revokeObjectURL(save.href);
  save.hidden = !keep;
  unsavedRecording = keep;
  if (keep) Object.assign(save, { href: URL.createObjectURL(keep), download: keep.name });
  else save.removeAttribute("href");
  $("analysis-retry").classList.toggle("btn--primary", !keep);
  $("analysis-retry").classList.toggle("btn--quiet", !!keep);
}
$("analysis-save").addEventListener("click", () => { unsavedRecording = null; });
$("analysis-retry").addEventListener("click", () => {
  if (unsavedRecording && !confirm("Leave without saving this session's recording? It can't be measured again later.")) return;
  unsavedRecording = null;
  show("start"); $("file-input").value = "";
});
$("analysis-cancel").addEventListener("click", () => job?.abort());

/** Click the tape once (the camera didn't move): the scale is applied to every jump in the video. */
function calibrateThen(found, file) {
  show("calibrate");
  const all = (jumps) => addSession(jumps.map((b) => bundleToAttempt(b, { video: file })));
  const cal = calibrate($("demo-calibrate"), found.still, {
    onDone: async ({ scale }) => {
      cal.dispose();
      $("progress-source").textContent = `“${file.name}”`;
      $("analysis-error").hidden = true;
      show("progress");
      const n = found.jumps.length;
      const steps = createSteps($("analysis"), [n > 1 ? `Applying the scale to every jump (1 of ${n})` : "Applying the scale"]);
      steps.active(0);
      try {
        const calibrated = [];
        for (const b of found.jumps) {
          if (n > 1) steps.label(0, `Applying the scale to every jump (${calibrated.length + 1} of ${n})`);
          calibrated.push(checkBundle(await recompute(b, { scale })));
        }
        steps.done(0);
        all(calibrated);
      } catch (e) {
        steps.fail();
        fail(`${e.message} Showing the uncalibrated results instead.`);
        setTimeout(() => all(found.jumps), 2500);
      }
    },
    onSkip: () => { cal.dispose(); all(found.jumps); },
  });
}

// ---------------------------------------------------------------- 2. results files (+ video)
const isVideo = (f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name);
const isJSON = (f) => f.type === "application/json" || /\.json$/i.test(f.name);
const stem = (name) => String(name).replace(/\.[a-z0-9]+$/i, "").toLowerCase();

async function openFiles(fileList) {
  const files = [...fileList], error = $("file-error");
  error.hidden = true;
  const results = files.filter(isJSON), videos = files.filter(isVideo);
  try {
    if (results.length) {
      const opened = [];
      for (const f of results) {
        const found = readResults(JSON.parse(await f.text()));
        // The matching video: same name as the one analyzed, or the only one given
        const video = videos.find((v) => stem(v.name) === stem(found.name)) || (videos.length === 1 && results.length === 1 ? videos[0] : null);
        opened.push(...found.jumps.map((b) => bundleToAttempt(b, { video })));
      }
      addSession(opened, opened.at(-1).jump ? null : opened.at(-1));
    } else if (videos.length) {
      if (!serverURL) throw new Error("Analyzing videos on this site isn't switched on yet. Run the JumpLab app on a computer, then open the _web.json it saves.");
      startUpload(videos[0]);
    } else {
      throw new Error("Choose a video (MP4 or MOV), or a JumpLab results file (_web.json).");
    }
  } catch (e) {
    error.textContent = e instanceof SyntaxError ? "That file couldn't be read as JumpLab results." : e.message;
    error.hidden = false;
  }
}
const input = $("file-input"), zone = $("dropzone");
if (zone) {
  input.addEventListener("change", () => { if (input.files.length) openFiles(input.files); });
  ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, () => zone.classList.remove("is-over")));
  zone.addEventListener("drop", (e) => { e.preventDefault(); openFiles(e.dataTransfer.files); });
}

// ---------------------------------------------------------------- results actions
$("start-over").addEventListener("click", () => {
  simPlayback.pause();
  realPlayback?.pause();
  realSession.length = 0;
  $("results-stats").replaceChildren();                      // the next run counts up from zero again
  input.value = "";
  show("start");
  setNotice("start");
  renderMyJumps();
  $("drop-button").focus();
});
$("add-jump").addEventListener("click", () => {
  realPlayback?.pause();
  input.value = "";
  renderMyJumps();
  show("start");
  $("drop-button").focus();
});
$("download-results").addEventListener("click", () => current.real && downloadBundle(current, session.filter((a) => a.real && a.name === current.name)));

// ---------------------------------------------------------------- My jumps (this browser only)
const dateText = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function checkCell(j) {
  if (j.serious) return `<span class="my-jumps__check my-jumps__check--serious">${icon("alert")}${plural(j.serious, "problem")}</span>`;
  if (j.caution) return `<span class="my-jumps__check my-jumps__check--caution">${icon("info")}Use with care</span>`;
  return `<span class="my-jumps__check my-jumps__check--ok">${icon("check")}No problems</span>`;
}
let saved = [];
async function renderMyJumps() {
  const box = $("my-jumps");
  if (!box) return;
  saved = await listJumps();
  const empty = !saved.length;
  $("my-jumps-table").hidden = empty;
  $("my-jumps-actions").hidden = empty;
  $("my-jumps-empty").hidden = !empty;
  if (empty) $("my-jumps-empty").textContent = (await canSave())
    ? "Jumps you analyze will appear here."
    : "This browser isn't letting the site save jumps (often a private window or blocked site data), so they won't appear here. Use Download results after an analysis to keep a copy.";
  $("my-jumps-rows").innerHTML = saved.map((j) => `
    <tr data-id="${esc(j.id)}">
      <td class="my-jumps__pick"><input type="checkbox" aria-label="Select ${esc(j.name)}"></td>
      <th scope="row" class="my-jumps__name"><button type="button" class="my-jumps__open">${esc(j.label || j.name)}</button>
        ${j.label ? `<span class="my-jumps__rough">${esc(j.name)}</span>` : ""}
        <span class="my-jumps__rough my-jumps__date-sub">${dateText(j.savedAt)}</span>
        <span class="my-jumps__check-sub">${checkCell(j)}</span></th>
      <td class="my-jumps__date my-jumps__date-col">${dateText(j.savedAt)}</td>
      <td class="num-cell">${j.distance == null ? "—" : formatQuantity("distance", j.distance)}${j.calibrated ? "" : `<span class="my-jumps__rough">${j.distance == null ? "not measured" : "rough"}</span>`}</td>
      <td class="my-jumps__check-col">${checkCell(j)}</td>
      <td class="my-jumps__row-actions">
        <button type="button" class="btn btn--quiet btn--sm my-jumps__rename" aria-label="Rename ${esc(j.label || j.name)}"><span>Rename</span>${icon("edit")}</button>
        <button type="button" class="btn btn--quiet btn--sm my-jumps__delete" aria-label="Delete ${esc(j.label || j.name)}"><span>Delete</span>${icon("close")}</button>
      </td>
    </tr>`).join("");
  updateCompare();
}
function picked() { return [...$("my-jumps-rows").querySelectorAll("input:checked")].map((c) => c.closest("tr").dataset.id); }
function updateCompare() {
  const n = picked().length, btn = $("my-jumps-compare");
  btn.disabled = n < 1 || n > MAX_REAL;
  btn.textContent = n > MAX_REAL ? `Pick up to ${MAX_REAL}` : n > 1 ? `Compare ${n} jumps` : n === 1 ? "Open selected" : "Compare selected";
}
/** Open saved jumps as a fresh session (the video is added back from the playback, if wanted). */
async function openSaved(ids) {
  const list = [];
  for (const id of ids) {
    const b = await loadJump(id);
    if (!b) continue;
    const entry = saved.find((j) => j.id === id);
    try {
      const a = Object.assign(bundleToAttempt(checkBundle(b)), { historyId: id, fromHistory: true });
      if (entry) {
        a.sub = dateText(entry.savedAt);
        if (entry.label) Object.assign(a, { label: pickerLabel(entry.label), custom: true });
      }
      list.push(a);
    } catch { /* skip a damaged entry */ }
  }
  if (!list.length) { $("my-jumps-status").textContent = "That jump couldn't be opened. It may have been cleared from this browser."; renderMyJumps(); return; }
  $("my-jumps-status").textContent = "";
  realSession.length = 0;
  realSession.push(...list);
  showResults(realSession.slice(), list[0], "real", { focus: list.length < 2 });
  if (list.length > 1) { $("tab-compare").click(); $("tab-compare").focus(); }   // they asked to compare
}
/** A name for the jump picker and the comparison: at most 20 characters. */
const pickerLabel = (name) => (name.length > 20 ? `${name.slice(0, 19)}…` : name);

/** Rename in place: the name cell becomes a text box (Enter saves, Escape cancels). */
function startRename(row, id) {
  const j = saved.find((x) => x.id === id);
  if (!j || row.querySelector(".my-jumps__edit")) return;
  const cell = row.querySelector(".my-jumps__name");
  const before = cell.innerHTML;
  cell.innerHTML = `<form class="my-jumps__edit">
      <label class="visually-hidden" for="rename-${esc(id)}">New name for ${esc(j.label || j.name)}</label>
      <input id="rename-${esc(id)}" type="text" maxlength="${MAX_LABEL}" value="${esc(j.label || "")}" placeholder="${esc(j.name)}" autocomplete="off">
      <button type="submit" class="btn btn--primary btn--sm">Save</button>
      <button type="button" class="btn btn--quiet btn--sm" data-cancel>Cancel</button>
    </form>
    <span class="my-jumps__rough">Leave empty to use the file name.</span>`;
  const form = cell.querySelector("form"), field = form.querySelector("input");
  const cancel = () => { cell.innerHTML = before; cell.querySelector(".my-jumps__open")?.focus(); };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await renameJump(id, field.value);
    const label = field.value.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
    realSession.forEach((a) => {                                // already open: the new name shows next time it's drawn
      if (a.historyId !== id) return;
      if (label) Object.assign(a, { label: pickerLabel(label), custom: true });
      else { a.label = pickerLabel(String(a.name).replace(/\.[a-z0-9]+$/i, "")); delete a.custom; }
    });
    await renderMyJumps();
    $("my-jumps-status").textContent = label ? `Renamed to “${label}”.` : "Back to the file name.";
    $("my-jumps-rows").querySelector(`tr[data-id="${CSS.escape(id)}"] .my-jumps__open`)?.focus();
  });
  form.querySelector("[data-cancel]").addEventListener("click", cancel);
  field.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); cancel(); } });
  field.focus();
  field.select();
}
if ($("my-jumps")) {
  const rows = $("my-jumps-rows");
  rows.addEventListener("change", updateCompare);
  rows.addEventListener("click", async (e) => {
    const id = e.target.closest("tr")?.dataset.id;
    if (!id) return;
    if (e.target.closest(".my-jumps__open")) openSaved([id]);
    else if (e.target.closest(".my-jumps__rename")) startRename(e.target.closest("tr"), id);
    else if (e.target.closest(".my-jumps__delete")) {
      const j = saved.find((x) => x.id === id);
      await removeJumps([id]);
      realSession.forEach((a) => { if (a.historyId === id) delete a.historyId; });
      await renderMyJumps();
      $("my-jumps-status").textContent = `Deleted ${j ? `“${j.label || j.name}”` : "the jump"}.`;
      (rows.querySelector(".my-jumps__open") || $("drop-button")).focus();
    }
  });
  $("my-jumps-compare").addEventListener("click", () => { const ids = picked(); if (ids.length && ids.length <= MAX_REAL) openSaved(ids); });
  $("my-jumps-clear").addEventListener("click", async () => {
    if (!window.confirm(`Delete all ${plural(saved.length, "saved jump")} from this browser? This can't be undone.`)) return;
    await clearJumps();
    realSession.forEach((a) => delete a.historyId);
    await renderMyJumps();
    $("drop-button").focus();
  });
  renderMyJumps();
}

// New units: redraw every number in place (no count-up; the values themselves haven't changed)
onUnitsChange(() => {
  if ($("results-stats").children.length) renderStats({ animate: false });
  renderMoments(current);
  renderSource(current);
  const f = current.frames[Math.max(0, playback()?.i ?? 0)];
  if (f) $("pb-readouts").innerHTML = readoutsHTML(f);
  chartsFor = null;
  if (activeTab === "charts" && !views.results.hidden) { ensureCharts(); charts.setFrame(f); }
  compare?.render();
  if ($("my-jumps")) renderMyJumps();
});

if (PAGE === "demo") showSample();
else if (location.hash === "#sample") location.replace("demo.html");   // old links to the sample
