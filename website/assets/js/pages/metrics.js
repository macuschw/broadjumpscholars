// Metrics explorer: one athlete figure (sample jump, at takeoff). Hovering or focusing a
// metric previews it on the body; clicking selects it and updates the explanation.
import { fmt, svg } from "../lib/dom.js";
import { Athlete } from "../components/athlete.js";
import { createScene, pathFrom } from "../components/scene.js";
import { statHTML } from "../components/stat.js";
import { SAMPLE, headline } from "../data/mock-data.js";
import { formatQuantity, isImperial, onUnitsChange, quantityHTML } from "../lib/units.js";

const { frames, events, metrics: m } = SAMPLE;
const TO = frames[events.takeoff], LAND = frames[events.landing], PEAK = frames[events.peak];
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

// ---------------------------------------------------------------- scene
// On phones the drawing's labels are set larger (pages.css), so the timeline labels sit further out
const PHONE = window.matchMedia("(max-width: 560px)").matches, gap = PHONE ? 1.6 : 1;
const scene = createScene(document.getElementById("metric-scene"), {
  xRange: [-0.6, 2.72], yMax: 2.02, below: PHONE ? 124 : 104, theme: "light",
  label: "The sample athlete at takeoff, with a faint outline of the landing position.",
});
const { map, layers, pxPerM } = scene;
const ghost = new Athlete(layers.back, map, { pxPerM });
ghost.update(LAND.pose);
ghost.g.classList.add("ath--ghost");
const flightPath = svg("path", { class: "metric-path", d: pathFrom(map, frames.slice(events.takeoff, events.landing + 1).map((f) => f.hip)) });
layers.back.append(flightPath);
const athlete = new Athlete(layers.mid, map, { pxPerM });
athlete.update(TO.pose);

// Drawing helpers (inputs in metres, output SVG)
const line = (a, b, cls = "mx-line") => { const [x1, y1] = map(a), [x2, y2] = map(b); return svg("line", { x1, y1, x2, y2, class: cls }); };
function arrow(a, b, cls = "mx-arrow") {
  const [x1, y1] = map(a), [x2, y2] = map(b), ang = Math.atan2(y2 - y1, x2 - x1), s = 13;
  const pt = (d, o) => `${x2 - s * Math.cos(ang + o)},${y2 - s * Math.sin(ang + o)}`;
  const end = { x1, y1, x2: x2 - 9 * Math.cos(ang), y2: y2 - 9 * Math.sin(ang) };
  return svg("g", { class: cls },
    svg("line", { ...end, class: "mx-halo" }),                    // keeps the arrow readable over the body
    svg("line", end),
    svg("polygon", { points: `${x2},${y2} ${pt(0, 0.42)} ${pt(0, -0.42)}` }));
}
function arc(c, r, a0, a1, cls = "mx-arc") {
  const pts = Array.from({ length: 25 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / 24; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; });
  return svg("path", { d: pathFrom(map, pts), class: cls });
}
const text = (p, t, { dx = 8, dy = -8, anchor = "start", cls = "mx-label" } = {}) => {
  const [x, y] = map(p); return svg("text", { x: x + dx, y: y + dy, "text-anchor": anchor, class: cls, text: t });
};
const ticks = (x, y, h = 0.07) => [line([x, y - h], [x, y + h], "mx-line mx-line--solid")];
const angleOf = (v) => Math.atan2(v[1], v[0]);
const V90 = Math.PI / 2;

const H = TO.hip, S = TO.pose.near.shoulder, A = TO.pose.near.ankle, K = TO.pose.near.knee;
const k = 0.2;                                         // metres of arrow per m/s
const vEnd = [H[0] + m.vx * k, H[1] + m.vy * k];
const yDim = -0.16, yTime = -0.36;
const tx = (t) => -0.5 + (t / LAND.t) * 2.75;          // time -> x position for the contact timeline

// The overlays carry numbers, so they are drawn again when the units change
const overlays = () => ({
  distance: [line([0, yDim], [m.distance, yDim], "mx-line mx-line--solid mx-line--key"), ...ticks(0, yDim), ...ticks(m.distance, yDim),
    text([m.distance / 2, yDim], formatQuantity("distance", m.distance), { anchor: "middle", dy: -10, cls: "mx-label mx-label--key" })],
  velocity: [arrow(H, [vEnd[0], H[1]]), arrow(H, [H[0], vEnd[1]]), arrow(H, vEnd, "mx-arrow mx-arrow--key"),
    text([vEnd[0], H[1]], formatQuantity("speed", m.vx), { dy: 18 }), text([H[0], vEnd[1]], formatQuantity("speed", m.vy), { dx: -10, anchor: "end" }),
    text(vEnd, formatQuantity("speed", m.speed), { cls: "mx-label mx-label--key" })],
  launch: [line(H, [H[0] + 0.8, H[1]]), arrow(H, [H[0] + 0.8 * Math.cos(angleOf([m.vx, m.vy])), H[1] + 0.8 * Math.sin(angleOf([m.vx, m.vy]))], "mx-arrow mx-arrow--key"),
    arc(H, 0.36, 0, angleOf([m.vx, m.vy]), "mx-arc mx-arc--key"),
    text([H[0] + 0.18, H[1]], `${m.launchAngle.toFixed(1)}°`, { cls: "mx-label mx-label--key", dx: 0, dy: 24 }),   // under the line, clear of the path
    line([PEAK.hip[0], TO.hip[1]], PEAK.hip, "mx-line mx-line--solid"),
    text(PEAK.hip, `+${formatQuantity("short", m.peakHeight)} peak`, { dx: 10, dy: -6 })],
  trunk: [line(H, [H[0], H[1] + 0.62]), arc(H, 0.3, V90, angleOf([S[0] - H[0], S[1] - H[1]]), "mx-arc mx-arc--key"),
    text([H[0] - 0.05, H[1] + 0.46], `${Math.round(m.trunkTakeoff)}°`, { anchor: "end", cls: "mx-label mx-label--key" })],
  shin: [line(A, [A[0], A[1] + 0.5]), arc(A, 0.25, V90, angleOf([K[0] - A[0], K[1] - A[1]]), "mx-arc mx-arc--key"),
    text([A[0] - 0.05, A[1] + 0.36], `${Math.round(m.shinTakeoff)}°`, { anchor: "end", cls: "mx-label mx-label--key" })],
  contact: [line([tx(0), yTime], [tx(LAND.t), yTime], "mx-line mx-line--solid mx-line--faint"),
    line([tx(frames[events.onset].t), yTime], [tx(TO.t), yTime], "mx-bar"),
    line([tx(frames[events.bottom].t), yTime], [tx(TO.t), yTime], "mx-bar mx-bar--key"),
    text([tx(frames[events.onset].t), yTime], `Ground contact ${m.contactTime.toFixed(2)} s`, { dx: 0, dy: -14 * gap }),
    text([tx(TO.t), yTime], `Push-off ${m.pushOff.toFixed(2)} s`, { dx: 6, dy: 22 * gap, anchor: "end", cls: "mx-label mx-label--key" }),
    text([tx(LAND.t), yTime], "Landing", { dx: 0, dy: 22 * gap, anchor: "end" })],
});
let groups = {};
function drawOverlays() {
  Object.values(groups).forEach((g) => g.remove());
  groups = Object.fromEntries(Object.entries(overlays()).map(([id, items]) => {
    const g = svg("g", { class: "mx", "data-metric": id }, ...items);
    layers.front.append(g);
    return [id, g];
  }));
}
drawOverlays();

// ---------------------------------------------------------------- list + detail
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

function show(id) {
  Object.entries(groups).forEach(([gid, g]) => g.classList.toggle("is-on", gid === id));
  athlete.highlight(INFO[id].parts);
  ghost.g.classList.toggle("is-focus", id === "distance");
  flightPath.classList.toggle("is-hot", id === "launch" || id === "velocity");
}

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
  show(id);
}

buttons.forEach((b, i) => {
  b.addEventListener("click", () => select(b.dataset.metric));
  b.addEventListener("mouseenter", () => show(b.dataset.metric));
  b.addEventListener("mouseleave", () => show(selected));
  b.addEventListener("focus", () => show(b.dataset.metric));
  b.addEventListener("blur", () => show(selected));
  b.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) { e.preventDefault(); buttons[(i + step + buttons.length) % buttons.length].focus(); }
  });
});
select(new URLSearchParams(location.search).get("m") in INFO ? new URLSearchParams(location.search).get("m") : "distance");

// New units: the buttons, the explanation and the labels on the figure all redraw in place
onUnitsChange(() => {
  STATS = statsNow();
  buttons.forEach((b) => { b.querySelector(".metric-btn__value").innerHTML = valueHTML(STATS[b.dataset.metric]); });
  drawOverlays();
  select(selected);
});
