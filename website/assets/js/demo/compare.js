// Compare tab: choose attempts, overlay their hip paths, and compare the headline metrics.
import { el, fmt } from "../lib/dom.js";
import { lineChart } from "../components/line-chart.js";
import { headline } from "../data/mock-data.js";

const STYLES = ["solid", "dashed", "dotted"];

export function buildCompare(host, attempts) {
  host.innerHTML = `
    <fieldset class="compare__pick">
      <legend>Attempts to compare</legend>
      ${attempts.map((a, i) => `<label class="compare__opt"><input type="checkbox" value="${a.id}" checked>
        <span class="compare__swatch compare__swatch--${STYLES[i]}" aria-hidden="true"></span>${a.label}</label>`).join("")}
    </fieldset>
    <div class="compare__grid">
      <section class="panel"><div class="panel__head"><h3 class="panel__title">Hip paths</h3><span class="chart-card__sub">line styles match the attempt list</span></div>
        <div class="panel__body" id="compare-chart"></div></section>
      <div class="table-wrap" id="compare-table"></div>
    </div>`;
  const boxes = [...host.querySelectorAll("input[type=checkbox]")];

  function render() {
    const chosen = attempts.filter((a) => boxes.find((b) => b.value === a.id).checked);
    const chartHost = host.querySelector("#compare-chart");
    const tableHost = host.querySelector("#compare-table");
    chartHost.replaceChildren();
    if (chosen.length === 0) {
      chartHost.append(el("p", { class: "compare__empty", text: "Select at least one attempt." }));
      tableHost.replaceChildren();
      return;
    }
    const best = chosen.reduce((b, a) => (a.metrics.distance > b.metrics.distance ? a : b), chosen[0]);
    lineChart(chartHost, {
      title: "Hip paths of the selected attempts",
      desc: `Hip height against forward position. ${best.label} went furthest.`,
      series: chosen.map((a) => ({
        label: a.label, emphasis: a === best, style: STYLES[attempts.indexOf(a)],
        points: a.frames.slice(a.events.onset, a.events.landing + 30).map((f) => f.hip),
      })),
      xLabel: "Forward", yLabel: "Height", xUnit: "m", yUnit: "m", equal: true, height: 240, yDigits: 2,
      directLabels: false,                       // the attempt picker above is the legend
    });

    const rows = headline(chosen[0]).map((h) => h.id);
    const cell = (a, id) => headline(a).find((h) => h.id === id);
    tableHost.innerHTML = `<table class="data">
      <caption>Headline metrics. ${best.label} is the longest jump; Δ is the difference in distance from it.</caption>
      <thead><tr><th scope="col">Metric</th>${chosen.map((a) => `<th scope="col" class="num-cell${a === best ? " best" : ""}">${a.label}${a === best ? '<span class="best-label">Best</span>' : ""}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((id) => `<tr><th scope="row">${cell(chosen[0], id).label}</th>${chosen.map((a) => {
          const c = cell(a, id);
          return `<td class="num-cell${a === best && id === "distance" ? " best" : ""}">${fmt(c.value, c.digits)}${c.unit === "°" ? "°" : ` ${c.unit}`}</td>`;
        }).join("")}</tr>`).join("")}
        <tr><th scope="row">Δ distance</th>${chosen.map((a) => `<td class="num-cell">${a === best ? "—" : `${fmt((a.metrics.distance - best.metrics.distance) * 100, 0)} cm`}</td>`).join("")}</tr>
      </tbody></table>`;
  }
  boxes.forEach((b) => b.addEventListener("change", render));
  render();
}
