// Metrics explorer: the sample athlete at takeoff, in 3D (a flat drawing if 3D can't load).
// Hovering or focusing a metric previews it on the body; clicking selects it and updates the
// explanation. In 3D the camera glides to frame the metric, so previews wait a moment for the
// pointer to settle instead of swinging the camera on every button it passes over.
import { fmt } from "../lib/dom.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { statHTML } from "../components/stat.js";
import { addViewToggle } from "../components/jump-stage.js";
import { createMetricsFigure2D } from "../components/metrics-2d.js";
import { SAMPLE, headline } from "../data/mock-data.js";
import { formatQuantity, isImperial, onUnitsChange, quantityHTML } from "../lib/units.js";

const statsNow = () => Object.fromEntries(headline(SAMPLE).map((s) => [s.id, s]));   // in the visitor's units
let STATS = statsNow();

// Plain-language copy for each metric (what it is, how it's measured, which body parts)
const INFO = {
  distance: { parts: ["foot"],
    what: "How far the athlete travelled, measured like the official test: from the toe at takeoff to the back of the heel at landing.",
    how: () => `Foot landmarks at takeoff and landing, converted from pixels to ${isImperial() ? "feet and inches" : "metres"} using a tape measure filmed along the jump line.` },
  velocity: { parts: [],
    what: "How fast the body was moving the instant the feet left the ground, split into a forward (horizontal) and an upward (vertical) part.",
    how: "A projectile path is fitted to the body during flight; its slope at takeoff gives both components." },
  launch: { parts: [],
    what: "The direction of takeoff, as an angle above horizontal. With speed, it sets how high the body rises (peak height) and how far it travels.",
    how: "θ = atan2(vertical, horizontal velocity). Peak height = v² / 2g using the vertical velocity." },
  trunk: { parts: ["trunk"],
    what: "How far the torso leans forward from vertical, hip to shoulder. Lean directs force forward; too much costs height.",
    how: "The angle of the hip→shoulder line from vertical. 0° is upright, positive is leaning forward." },
  shin: { parts: ["shin"],
    what: "How far the lower leg leans forward from vertical, ankle to knee. It shows how the knees travel over the feet during push-off.",
    how: "The angle of the ankle→knee line from vertical, positive when the knee is ahead of the ankle." },
  contact: { parts: ["foot"],
    what: "Time on the ground from the start of the dip to takeoff. Push-off is the explosive part, from the lowest point to takeoff.",
    how: "Frames counted between events. At 120 fps each frame is 8.3 ms." },
};

// ---------------------------------------------------------------- the metric list
const list = document.getElementById("metric-list");
const detail = document.getElementById("metric-detail");
const ORDER = ["distance", "velocity", "launch", "trunk", "shin", "contact"];
const valueHTML = (s) => (s.kind ? quantityHTML(s.kind, s.value, s.digits, "metric-btn__unit") : `${fmt(s.value, s.digits)}<span class="metric-btn__unit">${s.unit}</span>`);
list.innerHTML = ORDER.map((id) => {
  const s = STATS[id];
  return `<button type="button" class="metric-btn" data-metric="${id}" aria-pressed="false" aria-controls="metric-detail">
    <span class="metric-btn__value">${valueHTML(s)}</span>
    <span class="metric-btn__label">${s.label}</span></button>`;
}).join("");
const buttons = [...list.querySelectorAll(".metric-btn")];

// ---------------------------------------------------------------- figure
const sceneHost = document.getElementById("metric-scene"), figureEl = sceneHost.closest(".metrics__figure");
const statusEl = document.getElementById("metric-status");
let figure = null, shown = null, previewTimer = 0;

/** Show a metric on the figure (now, or once the figure has loaded). */
function show(id) {
  clearTimeout(previewTimer);
  shown = id;
  figure?.show(id);
}
/** Hover/focus preview: immediate on the flat figure, after a short pause in 3D. */
const preview = (id) => {
  clearTimeout(previewTimer);
  if (!figure?.setView) { show(id); return; }
  previewTimer = setTimeout(() => show(id), 140);
};

function describe(id) {
  const s = STATS[id];
  const value = s.kind ? formatQuantity(s.kind, s.value, s.digits) : `${fmt(s.value, s.digits)}${s.unit === "°" ? "°" : ` ${s.unit}`}`;
  sceneHost.setAttribute("aria-label", `The sample athlete at takeoff, showing the ${s.label.toLowerCase()}: ${value}.`);
}

function useFlat() {
  figure?.dispose?.();
  sceneHost.querySelector(".jump-stage__views")?.remove();
  figureEl.classList.remove("is-3d");
  sceneHost.className = "";
  figure = createMetricsFigure2D(sceneHost, SAMPLE, { partsOf: (id) => INFO[id].parts });
  if (shown) figure.show(shown);
}

async function boot() {
  sceneHost.setAttribute("aria-busy", "true");
  const slowNote = setTimeout(() => { statusEl.textContent = "Loading 3D view…"; }, 500);   // only if it isn't near-instant
  try {
    const slow = new Promise((_, reject) => setTimeout(() => reject(new Error("3D took too long")), 5000));
    const mod = await Promise.race([import("../components/metrics-3d.js"), slow]);
    figure = mod.createMetricsFigure3D(sceneHost, SAMPLE, { reducedMotion: prefersReducedMotion(), onContextLost: useFlat });
    addViewToggle(sceneHost, () => figure);
    if (shown) figure.show(shown);
  } catch {
    useFlat();
  }
  clearTimeout(slowNote);
  statusEl.textContent = "";
  sceneHost.removeAttribute("aria-busy");
}

// ---------------------------------------------------------------- choosing a metric
let selected = "distance";
function select(id) {
  selected = id;
  buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.metric === id)));
  const s = STATS[id], info = INFO[id];
  detail.innerHTML = `
    <div class="metric-detail__head">${statHTML(s, { key: true })}</div>
    <h2 class="visually-hidden">${s.label}</h2>
    <dl class="metric-detail__body">
      <dt>What it is</dt><dd>${info.what}</dd>
      <dt>How it's measured</dt><dd>${typeof info.how === "function" ? info.how() : info.how}</dd>
    </dl>`;
  detail.classList.remove("is-swapping");                  // restart the cross-fade
  void detail.offsetWidth;
  detail.classList.add("is-swapping");
  describe(id);
  show(id);
}

buttons.forEach((b, i) => {
  b.addEventListener("click", () => select(b.dataset.metric));
  b.addEventListener("mouseenter", () => preview(b.dataset.metric));
  b.addEventListener("mouseleave", () => preview(selected));
  b.addEventListener("focus", () => preview(b.dataset.metric));
  b.addEventListener("blur", () => preview(selected));
  b.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) { e.preventDefault(); buttons[(i + step + buttons.length) % buttons.length].focus(); }
  });
});
select(new URLSearchParams(location.search).get("m") in INFO ? new URLSearchParams(location.search).get("m") : "distance");
boot();

// New units: the buttons, the explanation and the labels on the figure all redraw in place
onUnitsChange(() => {
  STATS = statsNow();
  buttons.forEach((b) => { b.querySelector(".metric-btn__value").innerHTML = valueHTML(STATS[b.dataset.metric]); });
  figure?.refresh?.();                                       // the 3D figure follows the units by itself
  select(selected);
});
