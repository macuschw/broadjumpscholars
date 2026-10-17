// Compare tab: choose attempts, overlay their hip paths, and compare the headline metrics.
import { el, fmt } from "../lib/dom.js";
import { lineChart } from "../components/line-chart.js";
import { headline } from "../data/mock-data.js";
import { formatQuantity, lengthAxis } from "../lib/units.js";

const STYLES = ["solid", "dashed", "dotted"];

export function buildCompare(host, attempts, { headlineOf = headline } = {}) {
  const style = (a) => STYLES[attempts.indexOf(a) % STYLES.length];
  host.innerHTML = `
    <fieldset class="compare__pick">
      <legend>Attempts to compare</legend>
      ${attempts.map((a, i) => `<label class="compare__opt"><input type="checkbox" value="${a.id}" checked>
        <span class="compare__swatch compare__swatch--${STYLES[i % STYLES.length]}" aria-hidden="true"></span>${a.label}</label>`).join("")}
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
    const far = (a) => a.metrics.distance ?? -Infinity;
    const best = chosen.reduce((b, a) => (far(a) > far(b) ? a : b), chosen[0]);
    const L = lengthAxis();
    lineChart(chartHost, {
      title: "Hip paths of the selected attempts",
      desc: `Hip height against forward position. ${best.label} went furthest.`,
      series: chosen.map((a) => ({
        label: a.label, emphasis: a === best, style: style(a),
        points: a.frames.slice(a.events.onset, a.events.landing + 30).map((f) => [f.hip[0] * L.scale, f.hip[1] * L.scale]),
      })),
      xLabel: "Forward", yLabel: "Height", xUnit: L.unit, yUnit: L.unit, equal: true, height: 240, yDigits: 2,
      directLabels: false,                       // the attempt picker above is the legend
    });

    const rows = headlineOf(chosen[0]).map((h) => h.id);
    const cell = (a, id) => headlineOf(a).find((h) => h.id === id);
    tableHost.innerHTML = `<table class="data">
      <caption>Headline metrics. ${best.label} is the longest jump; Δ is the difference in distance from it.${chosen.some((a) => headlineOf(a).some((h) => h.flag)) ? " ⚠ marks a number that isn't reliable (see the warning above the results)." : ""}</caption>
      <thead><tr><th scope="col">Metric</th>${chosen.map((a) => `<th scope="col" class="num-cell${a === best ? " best" : ""}">${a.label}${a === best ? '<span class="best-label">Best</span>' : ""}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((id) => `<tr><th scope="row">${cell(chosen[0], id).label}</th>${chosen.map((a) => {
          const c = cell(a, id);
          const text = c.value == null ? "—" : c.kind ? formatQuantity(c.kind, c.value, c.digits) : `${fmt(c.value, c.digits)}${c.unit === "°" ? "°" : ` ${c.unit}`}`;
          const flag = c.flag ? ` <span class="flag-mark" title="Not reliable: ${c.flag}">⚠<span class="visually-hidden">not reliable</span></span>` : "";
          return `<td class="num-cell${a === best && id === "distance" ? " best" : ""}${c.flag ? " flagged" : ""}">${text}${flag}</td>`;
        }).join("")}</tr>`).join("")}
        <tr><th scope="row">Δ distance</th>${chosen.map((a) => `<td class="num-cell">${a === best || a.metrics.distance == null || best.metrics.distance == null ? "—" : formatQuantity("short", a.metrics.distance - best.metrics.distance)}</td>`).join("")}</tr>
      </tbody></table>`;
  }
  boxes.forEach((b) => b.addEventListener("change", render));
  render();
  return { render };                                         // called again when the units change
}
