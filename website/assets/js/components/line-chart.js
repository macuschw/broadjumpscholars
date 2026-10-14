// Accessible SVG line chart.
// Series are told apart by line STYLE (solid / dashed / dotted) and direct labels, not
// colour alone. Keyboard: focus the chart, then Left/Right (Shift = bigger steps),
// Home/End move a cursor; values are announced in a live readout.
import { el, fmt, svg } from "../lib/dom.js";

const DASH = { solid: null, dashed: "9 6", dotted: "1.5 6" };

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10));
  const decimals = Math.min(3, ((+step.toFixed(10)).toString().split(".")[1] || "").length);
  return { ticks, step, decimals };
}

export function lineChart(host, opts) {
  // Render at the host's real width so text stays legible on phones; re-render on resize.
  let api = null, lastW = 0, cursorX = null;
  const render = () => {
    const W = Math.max(300, Math.min(900, Math.round(host.clientWidth || 640)));
    if (Math.abs(W - lastW) < 24 && api) return;
    lastW = W;
    host.replaceChildren();
    api = draw(host, opts, W, (x) => { cursorX = x; });
    if (cursorX != null) api.setCursor(cursorX, { announce: false });
  };
  render();
  if ("ResizeObserver" in window) {
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }).observe(host);
  }
  return {
    setCursor: (x, o) => { cursorX = x; api.setCursor(x, o); },
    get element() { return api.element; },
  };
}

function draw(host, opts, W, remember) {
  const {
    title, desc, series, xLabel, yLabel, xUnit = "", yUnit = "", events = [], height = 260,
    equal = false, xDigits = 2, yDigits = 1, onScrub, directLabels = true,
  } = opts;
  const M = { l: 54, r: directLabels ? (W < 520 ? 70 : 96) : 20, t: 22, b: 44 };
  const H = height;
  const all = series.flatMap((s) => s.points);
  let [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  let [y0, y1] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  const padY = (y1 - y0) * 0.12 || 1;
  y0 -= padY; y1 += padY;
  if (opts.yMin != null) y0 = Math.min(y0, opts.yMin);
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  if (equal) {                                       // same metres-per-pixel on both axes
    const k = Math.max((x1 - x0) / iw, (y1 - y0) / ih);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    [x0, x1] = [cx - (k * iw) / 2, cx + (k * iw) / 2];
    [y0, y1] = [cy - (k * ih) / 2, cy + (k * ih) / 2];
  }
  const X = (v) => M.l + ((v - x0) / (x1 - x0)) * iw;
  const Y = (v) => M.t + ih - ((v - y0) / (y1 - y0)) * ih;

  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-labelledby": "" });
  const tId = `t${Math.random().toString(36).slice(2, 8)}`;
  chart.append(svg("title", { id: `${tId}-t`, text: title }), svg("desc", { id: `${tId}-d`, text: desc }));
  chart.setAttribute("aria-labelledby", `${tId}-t ${tId}-d`);

  // Grid + axes
  const grid = svg("g", { class: "chart-grid" });
  const { ticks: yt, decimals: yd } = niceTicks(y0, y1, 4);
  yt.forEach((v) => {
    grid.append(svg("line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v) }));
    grid.append(svg("text", { x: M.l - 8, y: Y(v) + 4, "text-anchor": "end", class: "chart-tick", text: fmt(v, yd) }));
  });
  const { ticks: xt, decimals: xd } = niceTicks(x0, x1, 6);
  xt.forEach((v) => grid.append(svg("text", { x: X(v), y: H - M.b + 18, "text-anchor": "middle", class: "chart-tick", text: fmt(v, xd) })));
  grid.append(svg("line", { class: "chart-axis", x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih }));
  grid.append(svg("text", { x: M.l + iw / 2, y: H - 6, "text-anchor": "middle", class: "chart-axis-label", text: `${xLabel}${xUnit ? ` (${xUnit})` : ""}` }));
  grid.append(svg("text", { x: 14, y: M.t + ih / 2, "text-anchor": "middle", class: "chart-axis-label", transform: `rotate(-90 14 ${M.t + ih / 2})`, text: `${yLabel}${yUnit ? ` (${yUnit})` : ""}` }));
  chart.append(grid);

  // Event markers (takeoff, landing ...)
  const ev = svg("g", { class: "chart-events" });
  const shown = events.filter((e) => e.x >= x0 && e.x <= x1);
  shown.forEach((e, k) => {
    ev.append(svg("line", { x1: X(e.x), x2: X(e.x), y1: M.t, y2: M.t + ih }));
    // Labels sit right of their line; if the next event is close, this one moves to the left so they never collide
    const crowded = k < shown.length - 1 && X(shown[k + 1].x) - X(e.x) < 70;
    ev.append(svg("text", { x: X(e.x) + (crowded ? -4 : 4), y: M.t + 10, "text-anchor": crowded ? "end" : false, text: e.label }));
  });
  chart.append(ev);

  // Series, with a direct label at the end of each line
  const lines = svg("g", { class: "chart-lines" });
  series.forEach((s) => {
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    lines.append(svg("path", {
      d, class: `chart-line${s.emphasis ? " is-emphasis" : ""}`,
      "stroke-dasharray": DASH[s.style || "solid"] || false,
    }));
    if (directLabels) {
      const last = s.points[s.points.length - 1];
      lines.append(svg("text", { x: X(last[0]) + 8, y: Y(last[1]) + 4, class: `chart-label${s.emphasis ? " is-emphasis" : ""}`, text: s.label }));
    }
  });
  chart.append(lines);

  // Cursor
  const cursor = svg("g", { class: "chart-cursor", visibility: "hidden" });
  const cLine = svg("line", { y1: M.t, y2: M.t + ih });
  cursor.append(cLine);
  const dots = series.map(() => { const c = svg("circle", { r: 5 }); cursor.append(c); return c; });
  chart.append(cursor);

  const readout = el("p", { class: "chart-readout", "aria-live": "polite" });
  const wrap = el("div", { class: "chart-wrap", tabindex: "0", role: "group", "aria-label": `${title}. Use left and right arrow keys to read values.` }, chart);
  host.append(wrap, readout);

  let cx = null;
  const nearest = (pts, x) => pts.reduce((b, p) => (Math.abs(p[0] - x) < Math.abs(b[0] - x) ? p : b), pts[0]);
  function setCursor(x, { announce = true, fromUser = false } = {}) {
    if (x == null) { cursor.setAttribute("visibility", "hidden"); return; }
    cx = Math.min(x1, Math.max(x0, x));
    remember(cx);
    cursor.setAttribute("visibility", "visible");
    cLine.setAttribute("x1", X(cx)); cLine.setAttribute("x2", X(cx));
    const parts = series.map((s, i) => {
      const p = nearest(s.points, cx);
      dots[i].setAttribute("cx", X(p[0])); dots[i].setAttribute("cy", Y(p[1]));
      return `${s.label} ${fmt(p[1], yDigits)}${yUnit}`;
    });
    if (announce) readout.textContent = `${xLabel} ${fmt(cx, xDigits)}${xUnit}: ${parts.join(" · ")}`;
    if (fromUser && onScrub) onScrub(cx);
  }

  const toX = (evt) => {
    const r = chart.getBoundingClientRect();
    return x0 + (((evt.clientX - r.left) / r.width) * W - M.l) / iw * (x1 - x0);
  };
  chart.addEventListener("pointermove", (e) => setCursor(toX(e), { fromUser: true }));
  wrap.addEventListener("keydown", (e) => {
    const step = (x1 - x0) / (e.shiftKey ? 10 : 60);
    const keys = { ArrowRight: (cx ?? x0) + step, ArrowLeft: (cx ?? x0) - step, Home: x0, End: x1 };
    if (e.key in keys) { e.preventDefault(); setCursor(keys[e.key], { fromUser: true }); }
  });
  return { setCursor, element: wrap };
}
