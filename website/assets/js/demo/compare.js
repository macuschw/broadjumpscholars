// Compare tab: choose attempts, overlay their hip paths, and compare the headline metrics.
// Up to six attempts, each with its own line style (never color alone); pointing at or focusing an
// attempt in the list picks out its path on the chart.
import { el, fmt } from "../lib/dom.js";
import { DASH, lineChart } from "../components/line-chart.js";
import { headline } from "../data/mock-data.js";
import { formatQuantity, lengthAxis } from "../lib/units.js";

const STYLES = ["solid", "dashed", "dotted", "dashdot", "long", "short"];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** A short line in an attempt's own style, drawn exactly like its path on the chart. */
const swatch = (style) => `<svg class="compare__swatch" viewBox="0 0 40 6" aria-hidden="true" focusable="false">
  <line x1="2" y1="3" x2="38" y2="3"${DASH[style] ? ` stroke-dasharray="${DASH[style]}"` : ""}/></svg>`;

export function buildCompare(host, attempts, { headlineOf = headline } = {}) {
  const style = (a) => STYLES[attempts.indexOf(a) % STYLES.length];
  host.innerHTML = `
    <fieldset class="compare__pick">
      <legend>${attempts.some((a) => a.real) ? "Jumps" : "Attempts"} to compare</legend>
      ${attempts.map((a, i) => `<label class="compare__opt" data-key="${a.id}" title="${esc(a.name || a.label)}${a.sub ? ` · ${esc(a.sub)}` : ""}">
        <input type="checkbox" value="${a.id}" checked>${swatch(STYLES[i % STYLES.length])}
        <span>${esc(a.label)}${a.sub ? `<span class="compare__sub">${esc(a.sub)}</span>` : ""}</span></label>`).join("")}
    </fieldset>
    <div class="compare__grid">
      <section class="panel"><div class="panel__head"><h3 class="panel__title">Hip paths</h3><span class="chart-card__sub">line styles match the list above</span></div>
        <div class="panel__body" id="compare-chart"></div></section>
      <div class="table-wrap" id="compare-table"></div>
    </div>`;
  const boxes = [...host.querySelectorAll("input[type=checkbox]")];
  const chartHost = host.querySelector("#compare-chart");

  // Point at (or tab to) an attempt: its path stands out, the others fade
  const spotlight = (key) => {
    chartHost.classList.toggle("is-spotlit", key != null);
    chartHost.querySelectorAll(".chart-line").forEach((p) => p.classList.toggle("is-spot", p.dataset.series === key));
  };
  host.querySelectorAll(".compare__opt").forEach((opt) => {
    const on = () => spotlight(opt.dataset.key), off = () => spotlight(null);
    opt.addEventListener("pointerenter", on);
    opt.addEventListener("pointerleave", off);
    opt.addEventListener("focusin", on);
    opt.addEventListener("focusout", off);
  });

  function render() {
    const chosen = attempts.filter((a) => boxes.find((b) => b.value === a.id).checked);
    const tableHost = host.querySelector("#compare-table");
    chartHost.replaceChildren();
    if (chosen.length === 0) {
      chartHost.append(el("p", { class: "compare__empty", text: "Select at least one attempt." }));
      tableHost.replaceChildren();
      return;
    }
    const far = (a) => a.metrics.distance ?? -Infinity;
    const counting = chosen.filter((a) => a.valid !== false);   // a jump that doesn't count can't be best
    const best = (counting.length ? counting : chosen).reduce((b, a) => (far(a) > far(b) ? a : b), counting[0] || chosen[0]);
    const L = lengthAxis();
    lineChart(chartHost, {
      title: "Hip paths of the selected attempts",
      desc: `Hip height against forward position. ${best.label} went furthest.`,
      series: chosen.map((a) => ({
        label: a.label, key: a.id, emphasis: a === best, style: style(a),
        points: a.frames.slice(a.events.onset, a.events.landing + 30).map((f) => [f.hip[0] * L.scale, f.hip[1] * L.scale]),
      })),
      xLabel: "Forward", yLabel: "Height", xUnit: L.unit, yUnit: L.unit, equal: true, height: 240, yDigits: 2,
      directLabels: false,                       // the attempt picker above is the legend
    });

    const rows = headlineOf(chosen[0]).map((h) => h.id);
    const cell = (a, id) => headlineOf(a).find((h) => h.id === id);
    tableHost.innerHTML = `<table class="data">
      <caption>Headline metrics. ${esc(best.label)} is the longest jump${counting.length < chosen.length ? " that counts" : ""}; Δ is the difference in distance from it.${chosen.some((a) => headlineOf(a).some((h) => h.flag)) ? " ⚠ marks a number that isn't reliable (see the warning above the results)." : ""}</caption>
      <thead><tr><th scope="col">Metric</th>${chosen.map((a) => `<th scope="col" class="num-cell${a === best ? " best" : ""}">${swatch(style(a))}${esc(a.label)}${a === best ? '<span class="best-label">Best</span>' : ""}${a.sub ? `<span class="compare__sub">${esc(a.sub)}</span>` : ""}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((id) => `<tr><th scope="row">${cell(chosen[0], id).label}</th>${chosen.map((a) => {
          const c = cell(a, id);
          const text = c.value == null ? "—" : c.kind ? formatQuantity(c.kind, c.value, c.digits) : `${fmt(c.value, c.digits)}${c.unit === "°" ? "°" : ` ${c.unit}`}`;
          const flag = c.flag ? ` <span class="flag-mark" title="Not reliable: ${esc(c.flag)}">⚠<span class="visually-hidden">not reliable</span></span>` : "";
          return `<td class="num-cell${a === best && id === "distance" ? " best" : ""}${c.flag ? " flagged" : ""}">${text}${flag}</td>`;
        }).join("")}</tr>`).join("")}
        <tr><th scope="row">Δ distance</th>${chosen.map((a) => `<td class="num-cell">${a === best || a.metrics.distance == null || best.metrics.distance == null ? "—" : formatQuantity("short", a.metrics.distance - best.metrics.distance)}</td>`).join("")}</tr>
      </tbody></table>`;
  }
  boxes.forEach((b) => b.addEventListener("change", render));
  render();
  return { render };                                         // called again when the units change
}
