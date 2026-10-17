// Scoreboard stat: big digit, small label underneath. A stat with a `kind` (distance, speed...)
// is a length or speed in SI and is shown in the visitor's units (lib/units.js): its number and
// unit then live together in .stat__num, since 7 ft 3½ in is two numbers.
import { fmt } from "../lib/dom.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { quantityHTML } from "../lib/units.js";

const numberHTML = (value, digits, kind) => (value == null || !Number.isFinite(value) ? "—"   // not measured
  : kind ? quantityHTML(kind, value, digits) : fmt(value, digits));

export function statHTML({ label, value, unit, digits = 2, sub, kind }, { key = false, tag = "div" } = {}) {
  const missing = value == null || !Number.isFinite(value);
  const unitHTML = kind || missing ? "" : unit === "°" ? `<span class="stat__unit stat__unit--deg">°</span>` : `<span class="stat__unit">${unit}</span>`;
  return `<${tag} class="stat${key ? " stat--key" : ""}">
    <span class="stat__value"><span class="stat__num"${missing ? "" : ` data-value="${value}"`} data-digits="${digits}"${kind ? ` data-kind="${kind}"` : ""}>${numberHTML(value, digits, kind)}</span>${unitHTML}</span>
    <span class="stat__label">${label}</span>
    ${sub ? `<span class="stat__sub">${sub}</span>` : ""}
  </${tag}>`;
}

/** Current values of the stats inside `root`, in order (to count on from them later). */
export const statValues = (root) => [...root.querySelectorAll(".stat__num")].map((n) => (n.dataset.value == null ? null : Number(n.dataset.value)));

/**
 * Scoreboard tick: count the numbers in `root` up to their values, from zero or from
 * `from` (the previous values). The final text is always the exact formatted value.
 */
export function countUp(root, { from = null, ms = 650, delay = 0 } = {}) {
  const nums = [...root.querySelectorAll(".stat__num[data-value]")];
  if (!nums.length || prefersReducedMotion()) return;
  const token = (root.countToken = (root.countToken || 0) + 1);
  const items = nums.map((n, i) => ({ n, to: Number(n.dataset.value), from: from?.[i] ?? 0, d: Number(n.dataset.digits), kind: n.dataset.kind }));
  const t0 = performance.now() + delay;
  const tick = (now) => {
    if (root.countToken !== token) return;                     // a newer count took over
    const u = Math.min(1, Math.max(0, (now - t0) / ms)), e = 1 - (1 - u) ** 3;
    items.forEach(({ n, to, from: f, d, kind }) => {
      const v = u < 1 ? f + (to - f) * e : to;
      if (kind) n.innerHTML = numberHTML(v, d, kind); else n.textContent = fmt(v, d);
    });
    if (u < 1) requestAnimationFrame(tick);
  };
  tick(performance.now());
  setTimeout(() => tick(t0 + ms), delay + ms + 60);              // land on the values even if frames are paused
}
