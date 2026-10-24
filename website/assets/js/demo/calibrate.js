// Calibration: on a still from the visitor's video (sent back by the analysis server, so it is
// exactly the frame the tracking saw), put markers A and B on the two ends of the tape measure and
// enter its length. meters per pixel = length / distance between the markers (in full-resolution
// pixels), the same rule as jumplab.calibration.scale_from_points.
//
// Built for a finger as much as a mouse: the markers are dragged (they move with the finger, never
// jump under it), a close-up under the picture shows the selected marker four times bigger while
// it moves (so a finger never hides what it's placing), and arrow buttons nudge it one pixel at a time. Tapping the picture away from the markers
// moves the selected one there first. The markers start where they were last time on this device
// (the camera is often in the same place). Keyboard: arrow keys move the selected marker (Shift =
// faster), Enter switches between A and B. The tape length can be typed in meters or feet and
// inches, with a comma or a point; Skip asks twice.
import { store } from "../lib/dom.js";
import { FOOT, INCH, isImperial } from "../lib/units.js";

const GRAB = { mouse: 18, touch: 34, pen: 22 };   // px: a press this close to a marker drags it
const ZOOM = 4;                                    // the close-up's magnification
const icon = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const ARROWS = { left: "m15 5-7 7 7 7", up: "m5 15 7-7 7 7", down: "m5 9 7 7 7-7", right: "m9 5 7 7-7 7" };

/** "3,66" or "3.66" -> 3.66; "" or nonsense -> NaN. */
const number = (text) => (String(text).trim() === "" ? NaN : Number(String(text).trim().replace(",", ".")));

export function calibrate(host, still, { onDone, onSkip }) {
  const lastM = store.get("jl-tape-m", null);
  let unit = store.get("jl-tape-unit", null) || (isImperial() ? "ft" : "m");
  host.innerHTML = `
    <div class="cal">
      <div class="cal__head">
        <h2 id="cal-title" tabindex="-1">Set the scale</h2>
        <p>Drag marker <strong>A</strong> onto one end of the tape measure and <strong>B</strong> onto the other, then
          type the length between them. That turns pixels into real distances.</p>
      </div>
      <div class="cal__grid">
        <div class="cal__picture">
          <div class="cal__frame">
            <canvas class="cal__canvas" tabindex="0" role="application"
              aria-label="Still from your video with markers A and B. Drag a marker onto an end of the tape measure. With the keyboard, arrow keys move the selected marker and Enter switches marker."></canvas>
          </div>
          <div class="cal__zoom-box">
            <canvas class="cal__zoom" aria-hidden="true"></canvas>
            <span class="cal__zoom-label" aria-hidden="true">Close-up of A</span>
          </div>
          <p class="cal__restored" hidden>The markers are where you put them last time. Check they're still on the tape's ends.</p>
          <div class="cal__tools">
            <div class="cal__which" role="group" aria-label="Marker to move">
              <button type="button" class="cal__chip" data-pick="0" aria-pressed="true">A</button>
              <button type="button" class="cal__chip" data-pick="1" aria-pressed="false">B</button>
            </div>
            <div class="cal__nudge" role="group" aria-label="Nudge the selected marker one pixel">
              ${Object.entries(ARROWS).map(([dir, d]) => `<button type="button" class="cal__arrow" data-dir="${dir}" aria-label="Move the marker ${dir}">${icon(d)}</button>`).join("")}
            </div>
          </div>
        </div>
        <div class="cal__side">
          <ol class="cal__steps" role="list">
            <li data-step="a"><span class="cal__dot" aria-hidden="true">1</span>A on one end of the tape</li>
            <li data-step="b"><span class="cal__dot" aria-hidden="true">2</span>B on the other end</li>
            <li data-step="len"><span class="cal__dot" aria-hidden="true">3</span>The length between them</li>
          </ol>
          <fieldset class="cal__length">
            <legend>Tape length</legend>
            <div class="cal__units" role="group" aria-label="Units for the tape length">
              <button type="button" class="cal__unit" data-unit="m">m</button>
              <button type="button" class="cal__unit" data-unit="ft">ft + in</button>
            </div>
            <div class="cal__fields"></div>
          </fieldset>
          <p class="cal__readout" aria-live="polite"></p>
          <button type="button" class="btn btn--primary cal__use" disabled>Use this scale</button>
          <p class="cal__hint" aria-live="polite"></p>
          <div class="cal__skip-box">
            <p class="cal__skip-note">No tape in the shot? Distances and speeds will then be rough, estimated from
              gravity, and marked as such.</p>
            <button type="button" class="btn btn--quiet btn--sm cal__skip">Skip: no tape in the shot</button>
          </div>
        </div>
      </div>
    </div>`;
  const q = (s) => host.querySelector(s);
  const canvas = q(".cal__canvas"), ctx = canvas.getContext("2d"), zoom = q(".cal__zoom"), zctx = zoom.getContext("2d");
  const toFull = still.full_width / still.width;              // still pixels -> the video's own pixels
  const img = new Image();
  img.src = `data:image/jpeg;base64,${still.jpeg}`;

  // Markers: where they were last time (as fractions of the picture), or a first guess along the floor
  const saved = store.get("jl-tape-pts", null);
  const restored = Array.isArray(saved) && saved.length === 2 && saved.every((p) => p.length === 2 && p.every((v) => v >= 0 && v <= 1));
  const pts = (restored ? saved : [[0.3, 0.86], [0.7, 0.86]]).map(([fx, fy]) => [fx * still.width, fy * still.height]);
  const moved = [restored, restored];                         // a marker counts once it has been put somewhere
  q(".cal__restored").hidden = !restored;
  let selected = 0, drag = null;

  // ---- the tape length, in meters or feet + inches
  const fields = q(".cal__fields");
  let lengthM = typeof lastM === "number" && lastM > 0 ? lastM : null;
  function renderFields() {
    host.querySelectorAll(".cal__unit").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.unit === unit)));
    const ft = lengthM == null ? null : lengthM / FOOT;
    fields.innerHTML = unit === "m"
      ? `<label><input type="text" inputmode="decimal" autocomplete="off" class="cal__in-m" aria-label="Tape length in meters"
           value="${lengthM == null ? "" : +lengthM.toFixed(3)}" placeholder="3.66"> m</label>`
      : `<label><input type="text" inputmode="numeric" autocomplete="off" class="cal__in-ft" aria-label="Feet"
           value="${ft == null ? "" : Math.floor(ft + 1e-9)}" placeholder="12"> ft</label>
         <label><input type="text" inputmode="decimal" autocomplete="off" class="cal__in-in" aria-label="Inches"
           value="${ft == null ? "" : +((ft - Math.floor(ft + 1e-9)) * 12).toFixed(2)}" placeholder="0"> in</label>`;
    fields.querySelectorAll("input").forEach((i) => i.addEventListener("input", () => { lengthM = readLength(); status(); }));
  }
  function readLength() {
    if (unit === "m") { const m = number(q(".cal__in-m").value); return m > 0 ? m : null; }
    const blank = (el) => el.value.trim() === "";
    const f = blank(q(".cal__in-ft")) ? 0 : number(q(".cal__in-ft").value), i = blank(q(".cal__in-in")) ? 0 : number(q(".cal__in-in").value);
    if (!(f >= 0) || !(i >= 0) || f + i === 0) return null;
    return f * FOOT + i * INCH;
  }
  host.querySelectorAll(".cal__unit").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.unit === unit) return;
    unit = b.dataset.unit;
    store.set("jl-tape-unit", unit);
    renderFields();                                           // the length typed so far, converted
    status();
  }));

  // ---- drawing: the picture fitted to the width, the line between the markers, A and B
  let k = 1, zw = 0, zh = 0;                                  // still pixels -> canvas CSS pixels; close-up size
  function fit() {
    const w = canvas.parentElement.clientWidth, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!w) return;
    k = w / still.width;
    canvas.style.height = `${Math.round(still.height * k)}px`;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(still.height * k * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    zw = zoom.clientWidth; zh = zoom.clientHeight;
    zoom.width = Math.round(zw * dpr); zoom.height = Math.round(zh * dpr);
    zctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function marker(c, x, y, label, active, s = 1) {
    const r = (active ? 11 : 9) * s, arm = (active ? 20 : 15) * s;
    c.lineWidth = 5 * s; c.strokeStyle = "rgba(18,19,21,0.8)";
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.moveTo(x - arm, y); c.lineTo(x + arm, y); c.moveTo(x, y - arm); c.lineTo(x, y + arm); c.stroke();
    c.lineWidth = (active ? 2.5 : 2) * s; c.strokeStyle = active ? "#ffffff" : "#e8665a";
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.moveTo(x - arm, y); c.lineTo(x + arm, y); c.moveTo(x, y - arm); c.lineTo(x, y + arm); c.stroke();
    if (label) {
      c.font = `700 ${Math.round(15 * s)}px Barlow Condensed, sans-serif`;
      const tx = x + r + 4 * s, ty = y - r - 4 * s, tw = c.measureText(label).width;
      c.fillStyle = active ? "#ffffff" : "#e8665a"; c.fillRect(tx - 3 * s, ty - 13 * s, tw + 6 * s, 16 * s);
      c.fillStyle = "#121315"; c.fillText(label, tx, ty);
    }
  }
  function draw() {
    if (!img.complete || !img.naturalWidth) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
    ctx.drawImage(img, 0, 0, still.width * k, still.height * k);
    ctx.lineWidth = 5; ctx.strokeStyle = "rgba(18,19,21,0.55)";
    ctx.beginPath(); ctx.moveTo(pts[0][0] * k, pts[0][1] * k); ctx.lineTo(pts[1][0] * k, pts[1][1] * k); ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = "#e8665a"; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(pts[0][0] * k, pts[0][1] * k); ctx.lineTo(pts[1][0] * k, pts[1][1] * k); ctx.stroke();
    ctx.setLineDash([]);
    [1 - selected, selected].forEach((i) => marker(ctx, pts[i][0] * k, pts[i][1] * k, i ? "B" : "A", i === selected));
    drawZoom();
    status();
  }

  // The close-up under the picture: the selected marker, four times bigger, live while it moves,
  // so a finger on the picture never hides what it's placing
  function drawZoom() {
    if (!zw || !zh) return;
    const p = pts[selected], sx = zw / (ZOOM * k), sy = zh / (ZOOM * k);   // still pixels shown
    zctx.imageSmoothingEnabled = false;
    zctx.fillStyle = "#121315"; zctx.fillRect(0, 0, zw, zh);
    zctx.drawImage(img, p[0] - sx / 2, p[1] - sy / 2, sx, sy, 0, 0, zw, zh);
    const o = pts[1 - selected];                              // the other marker, if it's in view
    const ox = (o[0] - p[0]) * ZOOM * k + zw / 2, oy = (o[1] - p[1]) * ZOOM * k + zh / 2;
    if (ox > -30 && ox < zw + 30 && oy > -30 && oy < zh + 30) marker(zctx, ox, oy, "", false, 1.2);
    marker(zctx, zw / 2, zh / 2, "", true, 1.2);
    q(".cal__zoom-label").textContent = `Close-up of ${selected ? "B" : "A"}`;
  }

  // ---- steps, readout, the button and what's still missing
  function status() {
    const px = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) * toFull;
    const len = lengthM;
    host.querySelector('[data-step="a"]').classList.toggle("is-done", moved[0]);
    host.querySelector('[data-step="b"]').classList.toggle("is-done", moved[1]);
    host.querySelector('[data-step="len"]').classList.toggle("is-done", len > 0);
    const scale = len > 0 && px > 0 ? len / px : null;
    const ok = moved[0] && moved[1] && scale > 0 && scale < 1 && px >= 30;
    q(".cal__readout").textContent = `${Math.round(px)} px between the markers` + (scale
      ? `: 1 px = ${unit === "ft" ? `${(scale / INCH).toFixed(3)} in` : `${(scale * 1000).toFixed(2)} mm`}.` : ".");
    q(".cal__use").disabled = !ok;
    q(".cal__hint").textContent = ok ? ""
      : !moved[0] ? "Next: drag marker A onto one end of the tape."
        : !moved[1] ? "Next: drag marker B onto the other end of the tape."
          : px < 30 ? "The markers are too close together: put them on the two ends of the tape."
            : !(len > 0) ? "Next: type the tape's length."
              : "That length doesn't fit these markers. Check the number and the units (m or ft).";
    return ok ? scale : null;
  }

  // ---- pointer: drag a marker (it moves with the finger, it doesn't jump under it); tap elsewhere
  // to bring the selected marker there
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; };
  const clamp = (p) => [Math.max(0, Math.min(still.width, p[0])), Math.max(0, Math.min(still.height, p[1]))];
  function pick(i) {
    selected = i;
    host.querySelectorAll(".cal__chip").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.pick === i)));
    draw();
  }
  canvas.addEventListener("pointerdown", (e) => {
    const p = at(e), grab = (GRAB[e.pointerType] || GRAB.mouse) / k;
    const d = pts.map((m) => Math.hypot(m[0] - p[0], m[1] - p[1]));
    let i = d[0] <= d[1] ? 0 : 1;
    if (d[i] > grab) { i = selected; pts[i] = clamp(p); moved[i] = true; }   // tap: bring the selected marker here
    drag = { i, dx: pts[i][0] - p[0], dy: pts[i][1] - p[1], touch: e.pointerType !== "mouse" };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
    pick(i);
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) {                                              // a mouse over a marker: it can be grabbed
      if (e.pointerType === "mouse") {
        const p = at(e);
        canvas.style.cursor = pts.some((m) => Math.hypot(m[0] - p[0], m[1] - p[1]) * k < GRAB.mouse) ? "grab" : "crosshair";
      }
      return;
    }
    const p = at(e);
    pts[drag.i] = clamp([p[0] + drag.dx, p[1] + drag.dy]);
    moved[drag.i] = true;
    draw();
  });
  const release = () => {
    if (!drag) return;
    drag = null;
    remember();
    draw();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  // ---- nudging: one still pixel per press (about one video pixel), repeating while held
  function nudge(dir, n = 1) {
    const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
    pts[selected] = clamp([pts[selected][0] + dx * n, pts[selected][1] + dy * n]);
    moved[selected] = true;
    draw();
  }
  host.querySelectorAll(".cal__arrow").forEach((b) => {
    let hold = 0, rep = 0;
    const stop = () => { clearTimeout(hold); clearInterval(rep); remember(); };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      nudge(b.dataset.dir);
      hold = setTimeout(() => { rep = setInterval(() => nudge(b.dataset.dir), 55); }, 380);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((t) => b.addEventListener(t, stop));
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nudge(b.dataset.dir); remember(); } });
  });
  host.querySelectorAll(".cal__chip").forEach((b) => b.addEventListener("click", () => { pick(+b.dataset.pick); draw(); }));
  canvas.addEventListener("keydown", (e) => {
    const dir = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[e.key];
    if (dir) { e.preventDefault(); nudge(dir, e.shiftKey ? 10 : 1); remember(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(1 - selected); draw(); }
  });

  // The markers' places, for next time (same camera spot, same tape)
  function remember() {
    if (moved[0] && moved[1]) store.set("jl-tape-pts", pts.map(([x, y]) => [+(x / still.width).toFixed(4), +(y / still.height).toFixed(4)]));
  }

  q(".cal__use").addEventListener("click", () => {
    const scale = status();
    if (!scale) return;
    store.set("jl-tape-m", lengthM);
    store.set("jl-tape-unit", unit);
    remember();
    onDone({ scale, p1: pts[0].map((v) => v * toFull), p2: pts[1].map((v) => v * toFull), distance_m: lengthM });
  });
  // Skip asks twice: it's right under the main button, and a slip would lose the calibration
  const skip = q(".cal__skip");
  let armed = 0;
  skip.addEventListener("click", () => {
    if (armed) { clearTimeout(armed); onSkip(); return; }
    skip.textContent = "Tap again to skip (rough distances)";
    skip.classList.add("is-armed");
    armed = setTimeout(() => { armed = 0; skip.textContent = "Skip: no tape in the shot"; skip.classList.remove("is-armed"); }, 4000);
  });

  if (!onSkip) q(".cal__skip-box").hidden = true;              // live measuring: the scale is needed
  renderFields();
  img.onload = fit;
  const ro = "ResizeObserver" in window ? new ResizeObserver(() => fit()) : null;
  ro?.observe(canvas.parentElement);
  q("#cal-title").focus();
  return { dispose() { ro?.disconnect(); clearTimeout(armed); host.replaceChildren(); } };
}
