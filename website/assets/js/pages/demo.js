// Demo dashboard: start (upload or sample) -> simulated analysis -> results.
// All results come from the mock-data module and are labelled as demo data.
import { fmt } from "../lib/dom.js";
import { icon } from "../components/icons.js";
import { countUp, statHTML, statValues } from "../components/stat.js";
import { initTabs } from "../components/tabs.js";
import { ATTEMPTS, DEMO_NOTICE, SAMPLE, headline, keyMoments } from "../data/mock-data.js";
import { runAnalysis } from "../demo/analysis.js";
import { Playback, readoutsHTML } from "../demo/playback.js";
import { buildCharts } from "../demo/charts.js";
import { buildCompare } from "../demo/compare.js";

const $ = (id) => document.getElementById(id);
const views = { start: $("demo-start"), progress: $("demo-progress"), results: $("demo-results") };
const show = (name) => Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });

$("demo-notice").innerHTML = `${icon("info")}<p><strong>Demo data.</strong> ${DEMO_NOTICE}</p>`;
document.querySelectorAll("[data-icon]").forEach((n) => { n.innerHTML = icon(n.dataset.icon); });

// ---------------------------------------------------------------- results
let current = SAMPLE, charts = null, chartsFor = null, compareBuilt = false, activeTab = "playback";
const playback = new Playback($("playback"), {
  onFrame: (f) => {
    $("pb-readouts").innerHTML = readoutsHTML(f);
    if (charts && activeTab === "charts") charts.setFrame(f);
  },
});

$("attempt-pick").innerHTML = ATTEMPTS.map((a) =>
  `<button type="button" class="attempt-btn" data-attempt="${a.id}" aria-pressed="false">${a.label}</button>`).join("");
const attemptButtons = [...document.querySelectorAll(".attempt-btn")];
attemptButtons.forEach((b) => b.addEventListener("click", () => setAttempt(ATTEMPTS.find((a) => a.id === b.dataset.attempt))));

function ensureCharts() {
  if (chartsFor === current) return;
  charts = buildCharts($("charts"), current, {
    onSeekTime: (t) => playback.seek(Math.round(t * current.fps)),
  });
  chartsFor = current;
}

function setAttempt(a) {
  const stats = $("results-stats"), prev = stats.children.length ? statValues(stats) : null;
  current = a;
  attemptButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.attempt === a.id)));
  stats.innerHTML = headline(a).map((s, i) => statHTML(s, { key: i === 0 })).join("");
  countUp(stats, { from: prev, ms: prev ? 450 : 700, delay: prev ? 0 : 150 });   // tick over from the last attempt
  playback.load(a);
  playback.seek(a.events.takeoff);
  renderMoments(a);
  if (activeTab === "charts") { ensureCharts(); charts.setFrame(a.frames[Math.max(0, playback.i ?? 0)]); }
}

function renderMoments(a) {
  const m = a.metrics, e = a.events;
  const phases = [
    { label: "Countermovement", value: (e.bottom - e.onset) / a.fps, unit: "s", digits: 2, sub: "Start of dip to lowest point" },
    { label: "Push-off", value: m.pushOff, unit: "s", digits: 2, sub: "Lowest point to takeoff" },
    { label: "Flight", value: m.flightTime, unit: "s", digits: 2, sub: "Takeoff to landing" },
  ];
  $("moments").innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <caption>Key moments of ${a.label} (demo data). Frames at ${a.fps} fps; times from the start of the clip.</caption>
        <thead><tr><th scope="col">Moment</th><th scope="col" class="num-cell">Time</th><th scope="col" class="num-cell">Frame</th>
          <th scope="col" class="num-cell">Hip height</th><th scope="col" class="num-cell">Trunk</th><th scope="col" class="num-cell">Shin</th><th scope="col" class="num-cell">Knee</th></tr></thead>
        <tbody>${keyMoments(a).map((k) => `<tr><th scope="row">${k.name}</th><td class="num-cell">${k.time.toFixed(3)} s</td><td class="num-cell">${k.frame}</td>
          <td class="num-cell">${k.hipHeight.toFixed(2)} m</td><td class="num-cell">${fmt(k.trunk, 0)}°</td><td class="num-cell">${fmt(k.shin, 0)}°</td><td class="num-cell">${fmt(k.knee, 0)}°</td></tr>`).join("")}</tbody>
      </table>
    </div>
    <div class="scoreboard moments__phases">${phases.map((p) => statHTML(p)).join("")}</div>
    <p class="moments__note">Takeoff is the first frame with both feet off the ground; landing is the first frame a heel touches down. Each event is ±1 frame (±${(1000 / a.fps).toFixed(1)} ms).</p>`;
}

initTabs($("result-tabs"), {
  onChange: (id) => {
    activeTab = id;
    if (id !== "playback") playback.pause();
    if (id === "charts") { ensureCharts(); charts.setFrame(current.frames[Math.max(0, playback.i ?? 0)]); }
    if (id === "compare" && !compareBuilt) { buildCompare($("compare"), ATTEMPTS); compareBuilt = true; }
  },
});

// ---------------------------------------------------------------- flow
async function start(source) {
  $("progress-source").textContent = source.type === "upload" ? `“${source.name}”` : "the sample jump";
  show("progress");
  $("progress-title").focus();
  await runAnalysis($("analysis"));
  $("results-source").innerHTML = source.type === "upload"
    ? `<strong>${source.name}</strong> was not analysed: the real pipeline isn't connected to this demo yet. Showing the sample athlete's attempts instead.`
    : "Sample session: three attempts by a simulated athlete.";
  show("results");
  setAttempt(SAMPLE);
  $("results-title").focus();
}

$("use-sample").addEventListener("click", () => start({ type: "sample" }));
$("start-over").addEventListener("click", () => {
  playback.pause();
  $("results-stats").replaceChildren();                    // the next run counts up from zero again
  show("start");
  $("use-sample").focus();
});

// Upload (file stays in the browser; nothing is sent anywhere)
const input = $("video-input"), zone = $("dropzone"), error = $("video-error");
function accept(file) {
  const ok = file && (file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(file.name));
  error.hidden = ok;
  if (!ok) { error.textContent = "That file isn't a video. Choose an MP4 or MOV recording of a jump."; return; }
  const mb = (file.size / 1048576).toFixed(1);
  start({ type: "upload", name: `${file.name} (${mb} MB)` });
}
input.addEventListener("change", () => input.files[0] && accept(input.files[0]));
["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("is-over"); }));
["dragleave", "drop"].forEach((t) => zone.addEventListener(t, () => zone.classList.remove("is-over")));
zone.addEventListener("drop", (e) => { e.preventDefault(); accept(e.dataTransfer.files[0]); });

if (location.hash === "#sample") start({ type: "sample" });
