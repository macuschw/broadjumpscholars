// What the phone measuring live and its remote screen show the same way: the big result, the list
// of jumps (with the tape check), each distance said out loud, the setup guide, full screen, and the
// tracked skeleton.
import { FOOT, INCH, formatQuantity, isImperial } from "../lib/units.js";
import { correction, setCorrection, shown } from "./tapelog.js";

export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]];
// Feet apart: the two toes at takeoff or the two heels at landing more than 5 cm apart along the jump,
// the full analysis's rule (jumplab/checks.py check_stagger). The tape runs from the front toe to the
// rear heel; one camera measures the near foot, so feet apart read long (our tape checks: 1.5-5 in).
export const APART_M = 0.05;

/** j.toeGapPx / heelGapPx (from live/detect.js) -> { toe, heel } (cm, rounded) and which were apart, when either was. */
export function feetApart(j, scale) {
  const toe = (j.toeGapPx ?? 0) * scale, heel = (j.heelGapPx ?? 0) * scale;
  return toe > APART_M || heel > APART_M
    ? { toe: Math.round(toe * 100), heel: Math.round(heel * 100), toeApart: toe > APART_M, heelApart: heel > APART_M } : null;
}
// (judged before rounding: 5.3 cm is apart though it shows as "5 cm"; older messages have only toe and heel)
const apartWords = (a) => [(a.toeApart ?? a.toe * 0.01 > APART_M) ? `the toes were ${formatQuantity("short", a.toe / 100)} apart at takeoff` : "",
  (a.heelApart ?? a.heel * 0.01 > APART_M) ? `the heels were ${formatQuantity("short", a.heel / 100)} apart at landing` : ""].filter(Boolean).join(" and ") || "the feet were apart";

/** The big result over the picture. j: { n, meters (as measured), unsure, apart, tape }. */
export function resultHTML(j) {
  const c = correction();
  return `<span class="live__result-label">Jump ${j.n} · live estimate${c.on ? " · corrected" : ""}</span>
  <span class="live__result-value">${formatQuantity("distance", shown(j.meters))}</span>
  ${j.apart ? `<span class="live__result-note live__result-note--warn">Feet apart: ${esc(apartWords(j.apart))}. The tape
    measures from the front toe to the back heel, so this may read long.</span>` : ""}
  ${j.unsure ? `<span class="live__result-note">Unsure: ${esc(typeof j.unsure === "string" ? j.unsure : "the tracker may have followed someone else.")}</span>` : ""}`;
}

/** One jump in the list under the picture, with its tape check (a button to add it, or the tape and the difference). */
export function jumpItemHTML(j) {
  const m = shown(j.meters);
  const off = Math.abs(m - j.tape) < 0.005 ? "matches" : `${m > j.tape ? "+" : "−"}${formatQuantity("short", Math.abs(m - j.tape))}`;
  const tape = j.tape > 0 ? `<span class="live__jump-tape">tape ${formatQuantity("distance", j.tape)} · live ${off}</span>`
    : `<button type="button" class="live__jump-add" data-n="${j.n}">Add the tape</button>`;
  return `<li class="live__jump${j.unsure ? " live__jump--unsure" : ""}" data-n="${j.n}">
  <span class="live__jump-n">Jump ${j.n}</span><span class="live__jump-d">${formatQuantity("distance", m)}</span>
  ${j.unsure ? '<span class="live__jump-note">unsure</span>' : ""}${j.apart ? '<span class="live__jump-note">feet apart</span>' : ""}
  ${tape}</li>`;
}

/** The tape-check form for jump n: meters, or feet + inches (as the header's units). */
export function tapeFormHTML(n) {
  return `<form class="live__tapeform" data-n="${n}" novalidate>
    ${isImperial()
    ? `<label><input type="text" inputmode="decimal" autocomplete="off" class="live__tape-ft" aria-label="Feet (tape, jump ${n})" placeholder="7"> ft</label>
       <label><input type="text" inputmode="decimal" autocomplete="off" class="live__tape-in" aria-label="Inches (tape, jump ${n})" placeholder="4.5"> in</label>`
    : `<label><input type="text" inputmode="decimal" autocomplete="off" class="live__tape-m" aria-label="Meters (tape, jump ${n})" placeholder="2.25"> m</label>`}
    <button type="submit" class="btn btn--primary btn--sm">Save</button>
    <button type="button" class="btn btn--quiet btn--sm live__tape-cancel">Cancel</button>
    <span class="live__tape-error" role="alert"></span></form>`;
}
/** The form's tape length in meters, or null if it isn't a sensible jump (0.3-4 m). */
export function readTape(form) {
  const num = (el) => (el && el.value.trim() !== "" ? Number(el.value.trim().replace(",", ".")) : 0);
  const m = form.querySelector(".live__tape-m")
    ? num(form.querySelector(".live__tape-m"))
    : num(form.querySelector(".live__tape-ft")) * FOOT + num(form.querySelector(".live__tape-in")) * INCH;
  return Number.isFinite(m) && m >= 0.3 && m <= 4 ? m : null;
}
/** "7 ft 2 in", "7' 2\"", "7-2", "86 in", "2.18 m", "218 cm", "2,18" -> meters, or null (as scripts/replay_live.mjs reads them). */
export function parseTapeText(text) {
  const s = String(text || "").trim().toLowerCase().replace(",", ".");
  let m;
  if (!s) return null;
  if ((m = s.match(/^([\d.]+)\s*cm$/))) return +m[1] / 100;
  if ((m = s.match(/^([\d.]+)\s*m$/))) return +m[1];
  if ((m = s.match(/^([\d.]+)\s*(?:in|inches|"|'')$/))) return +m[1] * INCH;
  if ((m = s.match(/^(\d+)\s*(?:ft|feet|foot|')\s*(?:([\d.]+)\s*(?:in|inches|"|'')?)?\s*$/))) return +m[1] * FOOT + (+m[2] || 0) * INCH;
  if ((m = s.match(/^(\d+)\s*-\s*([\d.]+)$/))) return +m[1] * FOOT + +m[2] * INCH;
  if ((m = s.match(/^([\d.]+)$/))) return +m[1] < 4 ? +m[1] : +m[1] * INCH;   // a bare number: meters if small, else inches
  return null;
}

/**
 * The jump list's tape checks: "Add the tape" opens the form in place, Save calls onTape(n, meters).
 * Returns busy(): true while a form is open (the list shouldn't be redrawn under someone typing).
 */
export function tapeEntry(list, onTape, onCancel = () => {}) {
  list.addEventListener("click", (e) => {
    const add = e.target.closest(".live__jump-add");
    if (add) {
      add.outerHTML = tapeFormHTML(add.dataset.n);
      list.querySelector(`.live__tapeform[data-n="${add.dataset.n}"] input`)?.focus();
    }
    if (e.target.closest(".live__tape-cancel")) {
      e.target.closest(".live__tapeform").outerHTML = `<button type="button" class="live__jump-add" data-n="${e.target.closest(".live__tapeform").dataset.n}">Add the tape</button>`;
      onCancel();                                              // jumps that landed while it was open can show now
    }
  });
  list.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target.closest(".live__tapeform"), m = readTape(form);
    if (m == null) { form.querySelector(".live__tape-error").textContent = "Type this jump's tape measurement (0.3–4 m)."; return; }
    form.remove();                                             // closed first, so the list can redraw with the tape
    onTape(Number(form.dataset.n), m);
  });
  return { busy: () => !!list.querySelector(".live__tapeform") };
}

/** The tape check so far, in one line (null until there's one). */
export function tapeSummaryText(s) {
  if (!s) return null;
  const by = formatQuantity("short", Math.abs(s.median));
  const dir = Math.abs(s.median) < 0.005 ? "matches the tape" : s.median < 0 ? `reads ${by} long` : `reads ${by} short`;
  return `Tape check: ${s.count} jump${s.count === 1 ? "" : "s"} so far. Live ${dir} on average (typical spread ${formatQuantity("short", s.sd)}).`;
}

/**
 * The tape check line under the jumps: the summary so far and, once there are enough, the choice to
 * correct live distances by the typical difference (stored on this device; the list redraws itself).
 */
export function renderTapeCheck(el) {
  const c = correction();
  const text = tapeSummaryText(c.summary);
  el.hidden = !text;
  if (!text) return;
  el.innerHTML = `<span>${esc(text)}</span>${c.available ? `<label class="live__fix"><input type="checkbox"${c.on ? " checked" : ""}>
    Correct live distances by ${c.offset >= 0 ? "+" : "−"}${formatQuantity("short", Math.abs(c.offset))}</label>` : ""}`;
  el.querySelector("input")?.addEventListener("change", (e) => setCorrection(e.target.checked));
}

/** How to set up so the live distance matches the tape (shown in Measure live, the remote screen, and calibration). */
export function setupHTML() {
  return `<details class="live__setup">
    <summary>How to set up for distances that match the tape</summary>
    <div class="live__setup-body">
      <svg class="live__setup-map" viewBox="0 0 320 176" role="img" aria-label="Seen from above: the camera side-on to the jump, the tape along the camera side of the feet">
        <rect x="20" y="20" width="280" height="56" rx="4" class="map-lane"/>
        <line x1="60" y1="20" x2="60" y2="76" class="map-line"/>
        <text x="60" y="14" text-anchor="middle" class="map-text">takeoff line</text>
        <rect x="44" y="40" width="14" height="7" rx="3" class="map-foot"/><rect x="44" y="52" width="14" height="7" rx="3" class="map-foot"/>
        <rect x="214" y="40" width="14" height="7" rx="3" class="map-foot"/><rect x="214" y="52" width="14" height="7" rx="3" class="map-foot"/>
        <path d="M64 50 C120 26 170 26 208 50" class="map-arc"/>
        <line x1="40" y1="66" x2="290" y2="66" class="map-tape"/>
        <text x="300" y="94" text-anchor="end" class="map-text">tape, on the camera side of the feet</text>
        <rect x="146" y="112" width="28" height="18" rx="3" class="map-cam"/>
        <line x1="160" y1="110" x2="160" y2="100" class="map-sight"/>
        <text x="160" y="148" text-anchor="middle" class="map-text">camera, square to the tape,</text>
        <text x="160" y="166" text-anchor="middle" class="map-text">4–5 m back</text>
      </svg>
      <ul>
        <li><strong>Tape on the floor along the camera side of the feet</strong>, straight down the jump. The scale comes
          from the tape: a tape further from the camera than the feet makes every jump read long (and closer, short).</li>
        <li><strong>Camera side-on, square to the tape</strong>, level with the middle of the jump, 4–5 m away if the whole
          jump still fits.</li>
        <li><strong>Toes level on the line, land with the feet together.</strong> The tape runs from the front toe to the
          back heel; one camera sees the near foot, so feet apart read long. Measure live says when it sees it.</li>
        <li>When marking the tape, use the close-up to put each marker exactly on a number mark.</li>
        <li>Then <strong>add the tape</strong> to a few jumps: the tape check shows how close live is with your setup.</li>
      </ul>
    </div>
  </details>`;
}

/** 2.34 m -> "2.34 meters"; in feet: "7 feet 8 and a half inches" (to the half inch, like a tape). */
export function spoken(m) {
  if (!isImperial()) return `${m.toFixed(2)} meters`;
  const halves = Math.round((m / INCH) * 2), ft = Math.floor(halves / 24), inches = (halves - ft * 24) / 2;
  const whole = Math.floor(inches), half = inches % 1 > 0;
  if (!whole) return `${ft} feet${half ? " and half an inch" : ""}`;
  return `${ft} feet ${whole}${half ? " and a half inches" : whole === 1 ? " inch" : " inches"}`;
}
export const jumpWords = (j) =>
  `Jump ${j.n}: ${j.unsure ? "about " : ""}${spoken(shown(j.meters))}.${j.apart ? " Feet apart: may read long." : ""}${j.unsure ? " Not sure: someone else may be in the picture." : ""}`;

/** Each distance said out loud (the button turns it on and off, remembered on this device). */
export function createVoice(button) {
  const setting = () => { try { return localStorage.getItem("jl-live-speak") !== "off"; } catch { return true; } };   // (storage blocked: on)
  let on = setting();
  const render = () => {
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "Saying each distance out loud" : "Say each distance out loud";
  };
  const say = (text) => {
    if (!on || !("speechSynthesis" in window)) return;
    try { speechSynthesis.cancel(); speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text), { rate: 1.05 })); } catch { /* no voice: fine */ }
  };
  button.addEventListener("click", () => {
    on = !on;
    try { localStorage.setItem("jl-live-speak", on ? "on" : "off"); } catch { /* fine */ }
    render();
    if (on) say("Sound on.");
  });
  render();
  return {
    say,
    /** Quiet on this device for now (another screen does the talking), without changing the setting. */
    mute() { on = false; render(); },
    /** Back to this device's own setting (the other screen is gone). */
    unmute() { on = setting(); render(); },
    stop() { if ("speechSynthesis" in window) speechSynthesis.cancel(); },
  };
}

/** A Full screen button (hidden where the browser can't) and double-click, for the stage. */
export function fullScreen(stage, button) {
  button.hidden = !document.fullscreenEnabled || !stage.requestFullscreen;
  button.addEventListener("click", () => stage.requestFullscreen().catch(() => {}));
  stage.addEventListener("dblclick", () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen?.())?.catch?.(() => {}));
  return { exit() { if (document.fullscreenElement === stage) document.exitFullscreen().catch(() => {}); } };
}

/** "Leave site?" when the tab is closed or reloaded while busy() says something would be lost. */
export function guardLeaving(busy) {
  const guard = (e) => { if (busy()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", guard);
  return () => window.removeEventListener("beforeunload", guard);
}

/** The tracked skeleton on a 2D canvas: pts in video pixels, drawn at scale k from (ox, oy). */
export function paintSkeleton(ctx, pts, k, ox = 0, oy = 0, width = 3) {
  const P = (i) => [pts[i][0] * k + ox, pts[i][1] * k + oy];
  ctx.lineWidth = width; ctx.lineCap = "round"; ctx.strokeStyle = "rgba(243,241,236,0.9)";
  for (const [a, b] of BONES) {
    if (pts[a][2] < 0.5 || pts[b][2] < 0.5) continue;
    ctx.beginPath(); ctx.moveTo(...P(a)); ctx.lineTo(...P(b)); ctx.stroke();
  }
  ctx.fillStyle = "#e8665a";
  for (const i of [29, 30, 31, 32]) if (pts[i][2] >= 0.5) { ctx.beginPath(); ctx.arc(...P(i), width + 1, 0, Math.PI * 2); ctx.fill(); }
}
