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
import { STAT_NAMES, bundleToAttempt, checkBundle, downloadBundle, issues, realHeadline } from "../demo/real.js";
import { calibrate } from "../demo/calibrate.js";
import { analyzeVideo, recompute, serverURL, wake } from "../demo/server.js";
import { clearJumps, listJumps, loadJump, removeJumps, saveJump } from "../demo/history.js";
import { formatQuantity, onUnitsChange } from "../lib/units.js";

const $ = (id) => document.getElementById(id);
const PAGE = document.body.dataset.page === "demo" ? "demo" : "analyze";
$("dashboard").outerHTML = DASHBOARD_HTML;
const views = { start: $("demo-start"), progress: $("demo-progress"), calibrate: $("demo-calibrate"), results: $("demo-results") };
const show = (name) => Object.entries(views).forEach(([k, v]) => { if (v) v.hidden = k !== name; });   // Demo: no start
const MAX_REAL = 6;                                            // real jumps kept for comparing

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
  $("attempt-pick").innerHTML = session.map((a) =>
    `<button type="button" class="attempt-btn" data-attempt="${a.id}" aria-pressed="${a === current}" title="${a.name || a.label}">${a.label}</button>`).join("");
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
  const kept = a.historyId ? " · saved in My jumps" : "";
  $("results-source").textContent = `${a.name} · ${fps} · ${scale} · ${r.side === "LEFT" ? "left" : "right"} side to the camera${kept}`;
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
  show("results");
  $("results-stats").replaceChildren();
  setAttempt(which);
  if (focus) $("results-title").focus();
}

function addReal(attempt) {
  realSession.push(attempt);
  if (realSession.length > MAX_REAL) realSession.shift();
  showResults(realSession.slice(), attempt, "real");
  remember(attempt);
}

/** Keep a real jump in My jumps; the source line says so once it's saved. */
async function remember(attempt) {
  if (attempt.historyId) return;
  const id = await saveJump(attempt.bundle);
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
async function startUpload(file) {
  const fps = Number($("fps-select").value) || null;
  $("progress-source").textContent = `“${file.name}”`;
  $("analysis-error").hidden = true;
  $("analysis-cancel").hidden = false;
  show("progress");
  $("progress-title").focus();
  const steps = createSteps($("analysis"), ["Uploading the video", "Tracking 33 body landmarks in every frame", "Finding takeoff and landing, fitting the flight"]);
  steps.active(0);
  job = analyzeVideo(file, {
    fps,
    onProgress: (stage, f) => {
      if (stage === "upload") steps.label(0, `Uploading the video (${Math.round(f * 100)}%)`);
      else { steps.label(0, "Uploading the video"); steps.done(0); steps.active(1, "Tracking 33 body landmarks in every frame (usually under a minute)"); }
    },
  });
  let bundle;
  try {
    bundle = checkBundle(await job.promise);
  } catch (e) {
    steps.fail();
    if (e.canceled) { show("start"); return; }
    return fail(e.message);
  } finally {
    job = null;
    $("analysis-cancel").hidden = true;
  }
  steps.done(1);
  steps.done(2);
  if (bundle.still) calibrateThen(bundle, file);
  else addReal(bundleToAttempt(bundle, { video: file }));
}

function fail(text) {
  $("analysis-error-text").textContent = text;
  $("analysis-error").hidden = false;
  $("analysis-error").querySelector("[data-icon]").innerHTML = icon("info");
}
$("analysis-retry").addEventListener("click", () => { show("start"); $("file-input").value = ""; });
$("analysis-cancel").addEventListener("click", () => job?.abort());

function calibrateThen(bundle, file) {
  show("calibrate");
  const cal = calibrate($("demo-calibrate"), bundle.still, {
    onDone: async ({ scale }) => {
      cal.dispose();
      $("progress-source").textContent = `“${file.name}”`;
      $("analysis-error").hidden = true;
      show("progress");
      const steps = createSteps($("analysis"), ["Applying the scale"]);
      steps.active(0);
      try {
        const calibrated = checkBundle(await recompute(bundle, { scale }));
        steps.done(0);
        addReal(bundleToAttempt(calibrated, { video: file }));
      } catch (e) {
        steps.fail();
        fail(`${e.message} Showing the uncalibrated results instead.`);
        setTimeout(() => addReal(bundleToAttempt(bundle, { video: file })), 2500);
      }
    },
    onSkip: () => { cal.dispose(); addReal(bundleToAttempt(bundle, { video: file })); },
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
      let last = null;
      for (const f of results) {
        const bundle = checkBundle(JSON.parse(await f.text()));
        // The matching video: same name as the one analyzed, or the only one given
        const video = videos.find((v) => stem(v.name) === stem(bundle.name)) || (videos.length === 1 && results.length === 1 ? videos[0] : null);
        last = bundleToAttempt(bundle, { video });
        realSession.push(last);
        if (realSession.length > MAX_REAL) realSession.shift();
      }
      showResults(realSession.slice(), last, "real");
      for (const a of realSession) remember(a);
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
$("download-results").addEventListener("click", () => current.real && downloadBundle(current));

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
  box.hidden = !saved.length;
  $("my-jumps-rows").innerHTML = saved.map((j) => `
    <tr data-id="${esc(j.id)}">
      <td class="my-jumps__pick"><input type="checkbox" aria-label="Select ${esc(j.name)}"></td>
      <th scope="row" class="my-jumps__name"><button type="button" class="my-jumps__open">${esc(j.name)}</button>
        <span class="my-jumps__rough my-jumps__date-sub">${dateText(j.savedAt)}</span>
        <span class="my-jumps__check-sub">${checkCell(j)}</span></th>
      <td class="my-jumps__date my-jumps__date-col">${dateText(j.savedAt)}</td>
      <td class="num-cell">${j.distance == null ? "—" : formatQuantity("distance", j.distance)}${j.calibrated ? "" : `<span class="my-jumps__rough">${j.distance == null ? "not measured" : "rough"}</span>`}</td>
      <td class="my-jumps__check-col">${checkCell(j)}</td>
      <td><button type="button" class="btn btn--quiet btn--sm my-jumps__delete" aria-label="Delete ${esc(j.name)}"><span>Delete</span>${icon("close")}</button></td>
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
    try { list.push(Object.assign(bundleToAttempt(checkBundle(b)), { historyId: id, fromHistory: true })); } catch { /* skip a damaged entry */ }
  }
  if (!list.length) { $("my-jumps-status").textContent = "That jump couldn't be opened. It may have been cleared from this browser."; renderMyJumps(); return; }
  $("my-jumps-status").textContent = "";
  realSession.length = 0;
  realSession.push(...list);
  showResults(realSession.slice(), list[0], "real");
}
if ($("my-jumps")) {
  const rows = $("my-jumps-rows");
  rows.addEventListener("change", updateCompare);
  rows.addEventListener("click", async (e) => {
    const id = e.target.closest("tr")?.dataset.id;
    if (!id) return;
    if (e.target.closest(".my-jumps__open")) openSaved([id]);
    else if (e.target.closest(".my-jumps__delete")) {
      const j = saved.find((x) => x.id === id);
      await removeJumps([id]);
      realSession.forEach((a) => { if (a.historyId === id) delete a.historyId; });
      await renderMyJumps();
      $("my-jumps-status").textContent = `Deleted ${j ? `“${j.name}”` : "the jump"}.`;
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
  if ($("my-jumps") && !$("my-jumps").hidden) renderMyJumps();
});

if (PAGE === "demo") showSample();
else if (location.hash === "#sample") location.replace("demo.html");   // old links to the sample
