// Projectile-fit figure for the Science page: tracked hip heights during the flight (grey
// dots, one per frame) and the parabola fitted through them (accent line). The first time
// it scrolls into view, the dots appear in time order and then the curve draws through
// them - data first, then the model. Hover, touch or arrow keys move a crosshair that
// snaps to the nearest frame; a table view carries every value.
import { el, fmt, svg } from "../lib/dom.js";
import { prefersReducedMotion } from "../lib/motion.js";

function ticks(min, max, step) {
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

export function fitChart(host, { points, fit }) {
  const tEnd = points[points.length - 1].t;
  const ys = points.map((p) => p.y);
  const yMin = Math.floor((Math.min(...ys) - 0.02) * 20) / 20, yMax = Math.ceil((Math.max(...ys) + 0.04) * 20) / 20;
  const peakT = fit.vy / fit.g, peakY = fit.height(peakT);

  const frame = el("div", { class: "fit-chart__frame" });
  const tip = el("div", { class: "fit-tip", "aria-hidden": "true", hidden: true });
  const live = el("p", { class: "visually-hidden", "aria-live": "polite" });
  host.append(frame, tip, live);

  let revealed = prefersReducedMotion(), lastW = 0, api = null, active = null;

  function draw(W) {
    const H = Math.round(Math.min(340, Math.max(240, W * 0.56)));
    const M = { l: 46, r: 14, t: 26, b: 38 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const X = (t) => M.l + (t / (tEnd * 1.04)) * iw;
    const Y = (y) => M.t + (1 - (y - yMin) / (yMax - yMin)) * ih;

    const root = svg("svg", {
      viewBox: `0 0 ${W} ${H}`, class: "chart fit-chart", tabindex: "0", role: "img",
      "aria-label": `Hip height against time during the flight: ${points.length} tracked frames following a parabola. `
        + `The fit gives a vertical takeoff velocity of ${fmt(fit.vy, 2)} metres per second and g of ${fmt(fit.g, 2)}. `
        + "Use the left and right arrow keys to step through the frames.",
    });
    const grid = svg("g", { class: "chart-grid" });
    for (const v of ticks(yMin, yMax, 0.1)) {
      grid.append(svg("line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v) }),
        svg("text", { class: "chart-tick", x: M.l - 8, y: Y(v) + 4, "text-anchor": "end", text: v.toFixed(1) }));
    }
    for (const v of ticks(0, tEnd, 0.1)) {
      grid.append(svg("text", { class: "chart-tick", x: X(v), y: H - M.b + 18, "text-anchor": "middle", text: v.toFixed(1) }));
    }
    grid.append(svg("line", { class: "chart-axis", x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }));
    grid.append(
      svg("text", { class: "chart-axis-label", x: M.l, y: 14, text: "Hip height (m)" }),
      svg("text", { class: "chart-axis-label", x: W - M.r, y: H - 4, "text-anchor": "end", text: "Time since takeoff (s)" }),
    );

    // The fitted parabola, as a smooth path
    const samples = 80, curve = [];
    for (let k = 0; k <= samples; k++) { const t = (k / samples) * tEnd; curve.push(`${k ? "L" : "M"}${X(t).toFixed(1)},${Y(fit.height(t)).toFixed(1)}`); }
    const line = svg("path", { class: "fit-chart__line", d: curve.join("") });

    // Tracked points, then the peak marker and its label on top
    const dots = svg("g", { class: "fit-chart__dots" });
    const r = W < 480 ? 3.25 : 4;                               // 52 frames get crowded on a phone
    points.forEach((p, k) => dots.append(svg("circle", { cx: X(p.t), cy: Y(p.y), r, style: `--k:${k}` })));
    const peak = svg("g", { class: "fit-chart__peak" },
      svg("line", { x1: X(peakT), x2: X(peakT), y1: Y(peakY) + 8, y2: H - M.b, class: "fit-chart__drop" }),
      svg("circle", { cx: X(peakT), cy: Y(peakY), r: 5 }),
      svg("text", { x: X(peakT), y: Y(peakY) - 12, "text-anchor": "middle", class: "fit-chart__note",
        text: `Peak +${Math.round(fit.peak * 100)} cm at ${fmt(peakT, 2)} s` }));

    const cursor = svg("g", { class: "chart-cursor", visibility: "hidden" },
      svg("line", { y1: M.t, y2: H - M.b }),
      svg("circle", { class: "fit-chart__on-fit", r: 4 }),
      svg("circle", { class: "fit-chart__on-dot", r: 6 }));
    const hit = svg("rect", { x: M.l, y: M.t, width: iw, height: ih, fill: "transparent" });
    root.append(grid, line, dots, peak, cursor, hit);
    frame.replaceChildren(root);

    if (!revealed) {
      root.classList.add("is-waiting");
      const length = line.getTotalLength();
      line.style.setProperty("--len", length);
    }

    // ---- crosshair: snaps to the nearest frame ----
    const nearest = (px) => points.reduce((best, p, k) => (Math.abs(X(p.t) - px) < Math.abs(X(points[best].t) - px) ? k : best), 0);
    function setActive(k, { announce = false } = {}) {
      active = k;
      root.classList.toggle("is-inspecting", k != null);
      if (k == null) { cursor.setAttribute("visibility", "hidden"); tip.hidden = true; return; }
      const p = points[k], fy = fit.height(p.t);
      cursor.setAttribute("visibility", "visible");
      const [ln, onFit, onDot] = cursor.children;
      ln.setAttribute("x1", X(p.t)); ln.setAttribute("x2", X(p.t));
      onFit.setAttribute("cx", X(p.t)); onFit.setAttribute("cy", Y(fy));
      onDot.setAttribute("cx", X(p.t)); onDot.setAttribute("cy", Y(p.y));
      tip.replaceChildren(
        el("div", { class: "fit-tip__head", text: `${fmt(p.t, 3)} s · frame ${p.frame}` }),
        el("div", { class: "fit-tip__row" }, el("span", { class: "fit-tip__key fit-tip__key--dot" }), el("strong", { text: `${fmt(p.y, 3)} m` }), el("span", { text: "Tracked" })),
        el("div", { class: "fit-tip__row" }, el("span", { class: "fit-tip__key fit-tip__key--line" }), el("strong", { text: `${fmt(fy, 3)} m` }), el("span", { text: "Fitted" })));
      tip.hidden = false;
      // Beside the crosshair, in the empty space: under the arch when the point is high, above it when low
      const scale = frame.clientWidth / W;
      const left = X(p.t) * scale, flip = left > frame.clientWidth * 0.62;
      const high = Y(Math.max(p.y, fy)) < M.t + ih * 0.5;
      const top = high ? Y(Math.min(p.y, fy)) * scale + 16 : Y(Math.max(p.y, fy)) * scale - tip.offsetHeight - 12;
      tip.style.transform = `translate(${flip ? left - tip.offsetWidth - 14 : left + 14}px, ${Math.max(0, top)}px)`;
      if (announce) live.textContent = `${fmt(p.t, 2)} seconds: tracked ${fmt(p.y, 3)} metres, fitted ${fmt(fy, 3)} metres.`;
    }
    const toLocal = (e) => (e.clientX - root.getBoundingClientRect().left) * (W / root.getBoundingClientRect().width);
    hit.addEventListener("pointermove", (e) => setActive(nearest(toLocal(e))));
    hit.addEventListener("pointerdown", (e) => setActive(nearest(toLocal(e))));
    root.addEventListener("pointerleave", () => { if (document.activeElement !== root) setActive(null); });
    root.addEventListener("focus", () => setActive(active ?? 0, { announce: true }));
    root.addEventListener("blur", () => setActive(null));
    root.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 1, ArrowDown: -1 }[e.key] * (e.shiftKey ? 5 : 1);
      const to = e.key === "Home" ? 0 : e.key === "End" ? points.length - 1 : Number.isFinite(step) ? (active ?? 0) + step : null;
      if (to == null) return;
      e.preventDefault();
      setActive(Math.max(0, Math.min(points.length - 1, to)), { announce: true });
    });
    return { root };
  }

  const render = () => {
    const W = Math.max(300, Math.min(820, Math.round(host.clientWidth || 640)));
    if (Math.abs(W - lastW) < 24 && api) return;
    lastW = W;
    api = draw(W);
  };
  render();
  if ("ResizeObserver" in window) {
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }).observe(host);
  }

  // First time on screen: points, then the curve, then the peak note
  if (!revealed && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      revealed = true;
      api.root.classList.replace("is-waiting", "is-revealing");
    }, { threshold: 0.35 });
    io.observe(host);
  } else if (!revealed) {
    revealed = true;
    api.root.classList.remove("is-waiting");
  }
}
