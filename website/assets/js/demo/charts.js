// Charts tab: hip trajectory, trunk angle over time, shin angle over time.
// Each has an accessible data table. Cursors follow playback; scrubbing a chart seeks it.
import { el, fmt } from "../lib/dom.js";
import { lineChart } from "../components/line-chart.js";
import { lengthAxis } from "../lib/units.js";

function tableHTML(caption, cols, rows) {
  return `<details class="disclose chart-table"><summary>Show data table</summary>
    <div class="disclose__body"><div class="table-wrap"><table class="data"><caption>${caption}</caption>
    <thead><tr>${cols.map((c) => `<th scope="col" class="num-cell">${c}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td class="num-cell">${v}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div></div></details>`;
}

export function buildCharts(host, attempt, { onSeekTime } = {}) {
  host.replaceChildren();
  // A real clip also has standing about and walking off; chart the jump itself (attempt.window)
  const { events } = attempt, frames = attempt.window ? attempt.frames.slice(attempt.window[0], attempt.window[1] + 1) : attempt.frames;
  const ev = (k, label) => ({ x: attempt.frames[events[k]].t, label });
  const timeEvents = [ev("takeoff", "Takeoff"), ev("landing", "Landing")];
  const every = Math.max(1, Math.round(0.05 * (attempt.fps || 120)));
  const sample = frames.filter((_, i) => i % every === 0);      // every 0.05 s for the tables
  const nearestByX = (x) => frames.reduce((b, f) => (Math.abs(f.hip[0] - x) < Math.abs(b.hip[0] - x) ? f : b), frames[0]);
  const L = lengthAxis(), at = (p) => [p[0] * L.scale, p[1] * L.scale];   // positions in metres or feet

  const card = (title, sub) => {
    const c = el("section", { class: "panel chart-card" },
      el("div", { class: "panel__head" }, el("h3", { class: "panel__title", text: title }), el("span", { class: "chart-card__sub", text: sub })));
    const body = el("div", { class: "panel__body" });
    c.append(body); host.append(c);
    return body;
  };

  const traj = card("Hip trajectory", `side view, ${L.word}`);
  const trajChart = lineChart(traj, {
    title: "Hip trajectory", desc: "Hip height against horizontal position for the whole jump; the flight is an arc.",
    series: [{ label: "Hip", points: frames.map((f) => at(f.hip)), emphasis: true }],
    xLabel: "Forward", yLabel: "Height", xUnit: L.unit, yUnit: L.unit, equal: true, height: 250, xDigits: 2, yDigits: 2,
    events: [{ x: attempt.frames[events.takeoff].hip[0] * L.scale, label: "Takeoff" }, { x: attempt.frames[events.landing].hip[0] * L.scale, label: "Landing" }],
    onScrub: (x) => onSeekTime?.(nearestByX(x / L.scale).t),
  });
  traj.insertAdjacentHTML("beforeend", tableHTML("Hip position every 0.05 s", ["Time (s)", `Forward (${L.unit})`, `Height (${L.unit})`],
    sample.map((f) => [fmt(f.t, 2), fmt(f.hip[0] * L.scale, 2), fmt(f.hip[1] * L.scale, 2)])));

  const trunk = card("Trunk angle", "from vertical, forward +");
  const trunkChart = lineChart(trunk, {
    title: "Trunk angle over time", desc: "Forward lean of the trunk from vertical; it peaks at the bottom of the dip and drops through takeoff.",
    series: [{ label: "Trunk", points: frames.map((f) => [f.t, f.trunk]), emphasis: true }],
    xLabel: "Time", yLabel: "Angle", xUnit: "s", yUnit: "°", events: timeEvents, height: 230, yDigits: 0,
    onScrub: (t) => onSeekTime?.(t),
  });
  trunk.insertAdjacentHTML("beforeend", tableHTML("Trunk angle every 0.05 s", ["Time (s)", "Trunk (°)"], sample.map((f) => [fmt(f.t, 2), fmt(f.trunk, 0)])));

  const shin = card("Shin angle", "from vertical, forward +");
  const shinChart = lineChart(shin, {
    title: "Shin angle over time", desc: "Forward lean of the shin from vertical; positive while the knees drive forward, negative at landing as the feet reach ahead.",
    series: [{ label: "Shin", points: frames.map((f) => [f.t, f.shin]), emphasis: true }],
    xLabel: "Time", yLabel: "Angle", xUnit: "s", yUnit: "°", events: timeEvents, height: 230, yDigits: 0,
    onScrub: (t) => onSeekTime?.(t),
  });
  shin.insertAdjacentHTML("beforeend", tableHTML("Shin angle every 0.05 s", ["Time (s)", "Shin (°)"], sample.map((f) => [fmt(f.t, 2), fmt(f.shin, 0)])));

  return {
    setFrame(f) {
      trajChart.setCursor(f.hip[0] * L.scale, { announce: false });
      trunkChart.setCursor(f.t, { announce: false });
      shinChart.setCursor(f.t, { announce: false });
    },
  };
}
