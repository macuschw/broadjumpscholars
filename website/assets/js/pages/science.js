// Science: the worked example. Fits a parabola to the sample flight's tracked hip (simulated
// tracking noise) and fills in every number from that fit.
import { fmt } from "../lib/dom.js";
import { fitFlight, polyval } from "../lib/fit.js";
import { fitChart } from "../components/fit-chart.js";
import { initTabs } from "../components/tabs.js";
import { SAMPLE, trackedFlight } from "../data/mock-data.js";

// Three tabs keep the page to about two screens; #example and #calibration link straight to a tab
const tablist = document.getElementById("science-tabs"), linked = location.hash.slice(1);
if (["example", "calibration"].includes(linked)) {
  tablist.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === linked)));
}
initTabs(tablist, {
  onChange: (id) => history.replaceState(null, "", id === "steps" ? location.pathname + location.search : `#${id}`),
});

const points = trackedFlight(SAMPLE);
const fit = fitFlight(points);
const set = (id, text) => { document.getElementById(id).textContent = text; };

set("fit-vy", fmt(fit.vy, 2));
set("fit-g", fmt(fit.g, 2));
set("fit-g2", fmt(fit.g, 2));
set("fit-gerr", `${fmt((Math.abs(fit.g - 9.81) / 9.81) * 100, 1)}%`);
set("fit-vx", fmt(fit.vx, 2));
set("fit-speed", fmt(fit.speed, 2));
set("fit-angle", fmt(fit.angle, 1));
set("fit-peak", fmt(fit.peak * 100, 0));
set("fit-rms", fmt(fit.rms * 1000, 0));

fitChart(document.getElementById("fit-chart"), { points, fit });

// Table view: every tracked frame with the fitted height beside it
const rows = points.map((p) => `<tr><td class="num-cell">${p.frame}</td><td class="num-cell">${fmt(p.t, 3)}</td>`
  + `<td class="num-cell">${fmt(p.y, 3)}</td><td class="num-cell">${fmt(polyval([fit.y0, fit.vy, -fit.g / 2], p.t), 3)}</td></tr>`).join("");
document.getElementById("fit-table").innerHTML = `
  <details class="disclose chart-table"><summary>Show the tracked points</summary>
    <div class="disclose__body"><div class="table-wrap"><table class="data">
      <caption>Tracked hip height in each flight frame (simulated noise) and the fitted parabola</caption>
      <thead><tr><th scope="col" class="num-cell">Frame</th><th scope="col" class="num-cell">Time (s)</th>
        <th scope="col" class="num-cell">Tracked (m)</th><th scope="col" class="num-cell">Fitted (m)</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div></details>`;
