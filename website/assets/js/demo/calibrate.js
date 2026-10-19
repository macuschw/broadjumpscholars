// Calibration: on a still from the visitor's video (sent back by the analysis server, so it is
// exactly the frame the tracking saw), click both ends of the tape measure and enter its length.
// meters per pixel = length / distance between the clicks (in full-resolution pixels), the same
// rule as jumplab.calibration.scale_from_points. A loupe magnifies around the pointer; points can be
// dragged; keyboard: arrow keys move a cross (Shift = faster), Enter or Space places a point.
import { store } from "../lib/dom.js";
import { FOOT, INCH, isImperial } from "../lib/units.js";

const NEAR = 16;                 // px: a press this close to a point drags it
const LOUPE = 140, ZOOM = 3;     // loupe size (px) and magnification

export function calibrate(host, still, { onDone, onSkip }) {
  const imperial = isImperial(), last = store.get("jl-tape-m", null);
  host.innerHTML = `
    <div class="cal">
      <div class="cal__head">
        <h2 id="cal-title" tabindex="-1">Set the scale</h2>
        <p>Click one end of the tape measure, then the other, and enter the length between them. That turns pixels into
          real distances. A zoomed view follows your pointer, and you can drag a point to fine-tune it.</p>
      </div>
      <div class="cal__grid">
        <div class="cal__frame">
          <canvas class="cal__canvas" tabindex="0" role="application"
            aria-label="Still from your video. Click the two ends of the tape measure. With the keyboard, arrow keys move a cross and Enter places a point."></canvas>
          <canvas class="cal__loupe" width="${LOUPE}" height="${LOUPE}" aria-hidden="true" hidden></canvas>
        </div>
        <div class="cal__side">
          <ol class="cal__steps" role="list">
            <li data-step="a"><span class="cal__dot" aria-hidden="true">1</span>Click one end of the tape</li>
            <li data-step="b"><span class="cal__dot" aria-hidden="true">2</span>Click the other end</li>
            <li data-step="len"><span class="cal__dot" aria-hidden="true">3</span>Enter the length between them</li>
          </ol>
          <fieldset class="cal__length">
            <legend>Tape length</legend>
            ${imperial
              ? `<label><input type="number" min="0" step="1" inputmode="numeric" class="cal__ft" aria-label="Feet"> ft</label>
                 <label><input type="number" min="0" max="11.99" step="0.25" inputmode="decimal" class="cal__in" aria-label="Inches"> in</label>`
              : `<label><input type="number" min="0" step="0.01" inputmode="decimal" class="cal__m" aria-label="Meters"> m</label>`}
          </fieldset>
          <p class="cal__readout" aria-live="polite"></p>
          <div class="cal__actions">
            <button type="button" class="btn btn--primary cal__use" disabled>Use this scale</button>
            <button type="button" class="btn btn--quiet btn--sm cal__clear">Clear points</button>
          </div>
          <p class="cal__skip-note">No tape in the shot? You can skip this: distances and speeds are then rough,
            estimated from gravity, and marked as such.</p>
          <button type="button" class="btn btn--quiet btn--sm cal__skip">Skip: no tape in the shot</button>
        </div>
      </div>
    </div>`;
  const q = (s) => host.querySelector(s);
  const canvas = q(".cal__canvas"), ctx = canvas.getContext("2d"), loupe = q(".cal__loupe"), lctx = loupe.getContext("2d");
  const toFull = still.full_width / still.width;              // still pixels -> the video's own pixels
  const img = new Image();
  img.src = `data:image/jpeg;base64,${still.jpeg}`;
  const pts = [];                                             // in still-image pixels
  let cross = null, dragging = -1, hover = null;

  // Length inputs (remember the last tape length on this device)
  const lenIn = imperial ? [q(".cal__ft"), q(".cal__in")] : [q(".cal__m")];
  if (last) {
    if (imperial) { const inches = last / INCH; lenIn[0].value = Math.floor(inches / 12); lenIn[1].value = +(inches % 12).toFixed(2); }
    else lenIn[0].value = +last.toFixed(3);
  }
  const meters = () => {
    const v = lenIn.map((i) => parseFloat(i.value) || 0);
    return imperial ? v[0] * FOOT + v[1] * INCH : v[0];
  };

  // Drawing: the still fitted to the width, the points and the line between them
  let k = 1;                                                  // still pixels -> canvas CSS pixels
  function fit() {
    const w = canvas.parentElement.clientWidth, dpr = Math.min(2, window.devicePixelRatio || 1);
    k = w / still.width;
    canvas.style.height = `${Math.round(still.height * k)}px`;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(still.height * k * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function marker(c, p, label) {
    const x = p[0] * k, y = p[1] * k;
    c.lineWidth = 4; c.strokeStyle = "rgba(18,19,21,0.75)";
    c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.moveTo(x - 15, y); c.lineTo(x + 15, y); c.moveTo(x, y - 15); c.lineTo(x, y + 15); c.stroke();
    c.lineWidth = 2; c.strokeStyle = "#e8665a";
    c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.moveTo(x - 15, y); c.lineTo(x + 15, y); c.moveTo(x, y - 15); c.lineTo(x, y + 15); c.stroke();
    if (label) { c.font = "700 14px Barlow Condensed, sans-serif"; c.fillStyle = "#e8665a"; c.fillText(label, x + 12, y - 12); }
  }
  function draw() {
    if (!img.complete) return;
    const w = canvas.width, h = canvas.height;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h); ctx.restore();
    ctx.drawImage(img, 0, 0, still.width * k, still.height * k);
    if (pts.length === 2) {
      ctx.lineWidth = 5; ctx.strokeStyle = "rgba(18,19,21,0.6)";
      ctx.beginPath(); ctx.moveTo(pts[0][0] * k, pts[0][1] * k); ctx.lineTo(pts[1][0] * k, pts[1][1] * k); ctx.stroke();
      ctx.lineWidth = 2.5; ctx.strokeStyle = "#e8665a"; ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(pts[0][0] * k, pts[0][1] * k); ctx.lineTo(pts[1][0] * k, pts[1][1] * k); ctx.stroke();
      ctx.setLineDash([]);
    }
    pts.forEach((p, i) => marker(ctx, p, i ? "B" : "A"));
    if (cross) {
      ctx.lineWidth = 1.5; ctx.strokeStyle = "#f3f1ec";
      ctx.beginPath(); ctx.moveTo(cross[0] * k - 20, cross[1] * k); ctx.lineTo(cross[0] * k + 20, cross[1] * k);
      ctx.moveTo(cross[0] * k, cross[1] * k - 20); ctx.lineTo(cross[0] * k, cross[1] * k + 20); ctx.stroke();
    }
    drawLoupe();
    status();
  }
  // The loupe: a magnified view around the pointer (or the keyboard cross), in the corner away from it
  function drawLoupe() {
    const at = hover || cross;
    loupe.hidden = !at;
    if (!at) return;
    const src = LOUPE / ZOOM / k;                              // still pixels shown across the loupe
    lctx.imageSmoothingEnabled = false;
    lctx.clearRect(0, 0, LOUPE, LOUPE);
    lctx.drawImage(img, at[0] - src / 2, at[1] - src / 2, src, src, 0, 0, LOUPE, LOUPE);
    lctx.save();
    lctx.translate(LOUPE / 2 - at[0] * k * ZOOM, LOUPE / 2 - at[1] * k * ZOOM);
    lctx.scale(ZOOM, ZOOM);
    pts.forEach((p, i) => marker(lctx, p, ""));
    lctx.restore();
    lctx.strokeStyle = "#f3f1ec"; lctx.lineWidth = 1;
    lctx.beginPath(); lctx.moveTo(LOUPE / 2, LOUPE / 2 - 12); lctx.lineTo(LOUPE / 2, LOUPE / 2 + 12);
    lctx.moveTo(LOUPE / 2 - 12, LOUPE / 2); lctx.lineTo(LOUPE / 2 + 12, LOUPE / 2); lctx.stroke();
    const left = at[0] * k > canvas.clientWidth / 2;
    loupe.style.left = left ? "8px" : "auto";
    loupe.style.right = left ? "auto" : "8px";
  }

  // Steps, readout and the button follow the state
  function status() {
    const len = meters(), px = pts.length === 2 ? Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) * toFull : 0;
    host.querySelector('[data-step="a"]').classList.toggle("is-done", pts.length >= 1);
    host.querySelector('[data-step="b"]').classList.toggle("is-done", pts.length >= 2);
    host.querySelector('[data-step="len"]').classList.toggle("is-done", len > 0);
    const scale = px > 0 && len > 0 ? len / px : null;
    q(".cal__readout").textContent = px
      ? `${Math.round(px)} px between the points${scale ? `: 1 px = ${(scale * (imperial ? 1 / INCH : 1000)).toFixed(imperial ? 3 : 2)} ${imperial ? "in" : "mm"}` : ""}.`
      : "";
    q(".cal__use").disabled = !(scale && scale > 0 && scale < 1 && px >= 30);
    return scale;
  }

  // Pointer: place A, then B; press near a point to drag it; hover shows the loupe
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; };
  const clamp = (p) => [Math.max(0, Math.min(still.width, p[0])), Math.max(0, Math.min(still.height, p[1]))];
  const nearest = (p) => {                                    // the point within NEAR px of p, closest first; -1 if none
    let best = -1, bestD = NEAR;
    pts.forEach((q2, i) => { const d = Math.hypot((q2[0] - p[0]) * k, (q2[1] - p[1]) * k); if (d < bestD) { bestD = d; best = i; } });
    return best;
  };
  const place = (p) => {
    if (pts.length < 2) pts.push(p);
    else { const d0 = Math.hypot(pts[0][0] - p[0], pts[0][1] - p[1]), d1 = Math.hypot(pts[1][0] - p[0], pts[1][1] - p[1]); pts[d0 <= d1 ? 0 : 1] = p; }
  };
  canvas.addEventListener("pointerdown", (e) => {
    const p = clamp(at(e));
    dragging = nearest(p);
    if (dragging < 0) { place(p); dragging = pts.length - 1; }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
    cross = null; hover = p; draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    hover = clamp(at(e));
    if (dragging >= 0) pts[dragging] = hover;
    draw();
  });
  const release = () => { dragging = -1; draw(); };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => { if (dragging < 0) { hover = null; draw(); } });
  canvas.addEventListener("keydown", (e) => {
    const step = (e.shiftKey ? 10 : 1) / k, move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (move) { e.preventDefault(); cross = clamp([(cross || [still.width / 2, still.height / 2])[0] + move[0], (cross || [still.width / 2, still.height / 2])[1] + move[1]]); hover = null; draw(); }
    else if ((e.key === "Enter" || e.key === " ") && cross) { e.preventDefault(); place(cross); draw(); }
  });
  canvas.addEventListener("focus", () => { if (!cross) { cross = [still.width / 2, still.height / 2]; draw(); } });
  canvas.addEventListener("blur", () => { cross = null; draw(); });
  lenIn.forEach((i) => i.addEventListener("input", status));
  q(".cal__clear").addEventListener("click", () => { pts.length = 0; draw(); canvas.focus(); });
  q(".cal__use").addEventListener("click", () => {
    const scale = status();
    if (!scale) return;
    store.set("jl-tape-m", meters());
    onDone({ scale, p1: pts[0].map((v) => v * toFull), p2: pts[1].map((v) => v * toFull), distance_m: meters() });
  });
  q(".cal__skip").addEventListener("click", () => onSkip());

  img.onload = fit;
  const ro = "ResizeObserver" in window ? new ResizeObserver(() => fit()) : null;
  ro?.observe(canvas.parentElement);
  q("#cal-title").focus();
  return { dispose() { ro?.disconnect(); host.replaceChildren(); } };
}
