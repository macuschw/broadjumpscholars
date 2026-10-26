// What the phone measuring live and its remote screen show the same way: the big result, the list
// of jumps, each distance said out loud, full screen, and the tracked skeleton.
import { INCH, formatQuantity, isImperial } from "../lib/units.js";

export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]];

/** The big result over the picture (j: { n, unsure }, m: meters). */
export const resultHTML = (j, m) => `<span class="live__result-label">Jump ${j.n} · live</span>
  <span class="live__result-value">${formatQuantity("distance", m)}</span>
  ${j.unsure ? `<span class="live__result-note">Unsure: ${esc(typeof j.unsure === "string" ? j.unsure : "the tracker may have followed someone else.")}</span>` : ""}`;

/** One jump in the list under the picture. */
export const jumpItemHTML = (j, m) => `<li class="live__jump${j.unsure ? " live__jump--unsure" : ""}">
  <span class="live__jump-n">Jump ${j.n}</span><span class="live__jump-d">${formatQuantity("distance", m)}</span>
  ${j.unsure ? '<span class="live__jump-note">unsure</span>' : ""}</li>`;

/** 2.34 m -> "2.34 meters"; in feet: "7 feet 8 and a half inches" (to the half inch, like a tape). */
export function spoken(m) {
  if (!isImperial()) return `${m.toFixed(2)} meters`;
  const halves = Math.round((m / INCH) * 2), ft = Math.floor(halves / 24), inches = (halves - ft * 24) / 2;
  const whole = Math.floor(inches), half = inches % 1 > 0;
  if (!whole) return `${ft} feet${half ? " and half an inch" : ""}`;
  return `${ft} feet ${whole}${half ? " and a half inches" : whole === 1 ? " inch" : " inches"}`;
}
export const jumpWords = (j, m) =>
  `Jump ${j.n}: ${j.unsure ? "about " : ""}${spoken(m)}${j.unsure ? ". Not sure: someone else may be in the picture." : "."}`;

/** Each distance said out loud (the button turns it on and off, remembered on this device). */
export function createVoice(button) {
  let on = true;
  try { on = localStorage.getItem("jl-live-speak") !== "off"; } catch { /* storage blocked: on */ }
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
