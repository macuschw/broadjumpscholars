// Science: the worked example. Fits a parabola to the sample flight's tracked hip (simulated
// tracking noise) and fills in every number from that fit.
import { fmt } from "../lib/dom.js";
import { fitFlight, polyval } from "../lib/fit.js";
import { fitChart } from "../components/fit-chart.js";
import { initTabs } from "../components/tabs.js";
import { SAMPLE, trackedFlight } from "../data/mock-data.js";
import { formatNumber, lengthAxis, onUnitsChange } from "../lib/units.js";

// Four tabs keep the page to about two screens; #example, #math and #calibration link straight to a tab
const tablist = document.getElementById("science-tabs"), linked = location.hash.slice(1);
if (["example", "math", "calibration"].includes(linked)) {
  tablist.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === linked)));
}
initTabs(tablist, {
  onChange: (id) => history.replaceState(null, "", id === "steps" ? location.pathname + location.search : `#${id}`),
});
// A link to #math (or another tab) on this page opens that tab
addEventListener("hashchange", () => document.getElementById(`tab-${location.hash.slice(1)}`)?.click());

const points = trackedFlight(SAMPLE);
const fit = fitFlight(points);
const set = (id, text) => { document.getElementById(id).textContent = text; };
const chart = fitChart(document.getElementById("fit-chart"), { points, fit });

/** Every number from the fit, in the visitor's units (the unit words beside them swap in lib/units.js). */
function renderNumbers() {
  const L = lengthAxis();
  set("fit-vy", formatNumber("speed", fit.vy));
  set("fit-g", formatNumber("accel", fit.g));
  set("fit-g2", formatNumber("accel", fit.g));
  set("fit-gerr", `${fmt((Math.abs(fit.g - 9.81) / 9.81) * 100, 1)}%`);
  set("fit-vx", formatNumber("speed", fit.vx));
  set("fit-speed", formatNumber("speed", fit.speed));
  set("fit-angle", fmt(fit.angle, 1));
  set("fit-peak", formatNumber("short", fit.peak));
  set("fit-rms", formatNumber("tiny", fit.rms));

  // Table view: every tracked frame with the fitted height beside it
  const wasOpen = document.querySelector("#fit-table details")?.open;
  const rows = points.map((p) => `<tr><td class="num-cell">${p.frame}</td><td class="num-cell">${fmt(p.t, 3)}</td>`
    + `<td class="num-cell">${fmt(p.y * L.scale, 3)}</td><td class="num-cell">${fmt(polyval([fit.y0, fit.vy, -fit.g / 2], p.t) * L.scale, 3)}</td></tr>`).join("");
  document.getElementById("fit-table").innerHTML = `
    <details class="disclose chart-table"${wasOpen ? " open" : ""}><summary>Show the tracked points</summary>
      <div class="disclose__body"><div class="table-wrap"><table class="data">
        <caption>Tracked hip height in each flight frame (simulated noise) and the fitted parabola</caption>
        <thead><tr><th scope="col" class="num-cell">Frame</th><th scope="col" class="num-cell">Time (s)</th>
          <th scope="col" class="num-cell">Tracked (${L.unit})</th><th scope="col" class="num-cell">Fitted (${L.unit})</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div></details>`;
}
renderNumbers();
onUnitsChange(() => { renderNumbers(); chart.redraw(); });
