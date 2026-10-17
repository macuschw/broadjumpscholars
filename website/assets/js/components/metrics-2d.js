// Metrics figure, flat: the sample athlete at takeoff as a side-view drawing, with the selected
// metric drawn on it. The fallback for the 3D figure (metrics-3d.js) when three.js or WebGL is
// unavailable; same interface: show(id), and refresh() after the units change.
import { svg } from "../lib/dom.js";
import { Athlete } from "./athlete.js";
import { createScene, pathFrom } from "./scene.js";
import { formatQuantity } from "../lib/units.js";

export function createMetricsFigure2D(host, attempt, { partsOf }) {
  const { frames, events, metrics: m } = attempt;
  const TO = frames[events.takeoff], LAND = frames[events.landing], PEAK = frames[events.peak];
  // On phones the drawing's labels are set larger (pages.css), so the timeline labels sit further out
  const PHONE = window.matchMedia("(max-width: 560px)").matches, gap = PHONE ? 1.6 : 1;
  const scene = createScene(host, {
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

  return {
    show(id) {
      Object.entries(groups).forEach(([gid, g]) => g.classList.toggle("is-on", gid === id));
      athlete.highlight(partsOf(id));
      ghost.g.classList.toggle("is-focus", id === "distance");
      flightPath.classList.toggle("is-hot", id === "launch" || id === "velocity");
    },
    refresh: drawOverlays,                                    // the overlays carry numbers in the visitor's units
  };
}
