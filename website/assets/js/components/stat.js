// Scoreboard stat: big digit, small label underneath.
import { fmt } from "../lib/dom.js";
import { prefersReducedMotion } from "../lib/motion.js";

export function statHTML({ label, value, unit, digits = 2, sub }, { key = false, tag = "div" } = {}) {
  const unitHTML = unit === "°" ? `<span class="stat__unit stat__unit--deg">°</span>` : `<span class="stat__unit">${unit}</span>`;
  return `<${tag} class="stat${key ? " stat--key" : ""}">
    <span class="stat__value"><span class="stat__num" data-value="${value}" data-digits="${digits}">${fmt(value, digits)}</span>${unitHTML}</span>
    <span class="stat__label">${label}</span>
    ${sub ? `<span class="stat__sub">${sub}</span>` : ""}
  </${tag}>`;
}

/** Current values of the stats inside `root`, in order (to count on from them later). */
export const statValues = (root) => [...root.querySelectorAll(".stat__num")].map((n) => Number(n.dataset.value));

/**
 * Scoreboard tick: count the numbers in `root` up to their values, from zero or from
 * `from` (the previous values). The final text is always the exact formatted value.
 */
export function countUp(root, { from = null, ms = 650, delay = 0 } = {}) {
  const nums = [...root.querySelectorAll(".stat__num")];
  if (!nums.length || prefersReducedMotion()) return;
  const token = (root.countToken = (root.countToken || 0) + 1);
  const items = nums.map((n, i) => ({ n, to: Number(n.dataset.value), from: from?.[i] ?? 0, d: Number(n.dataset.digits) }));
  const t0 = performance.now() + delay;
  const tick = (now) => {
    if (root.countToken !== token) return;                     // a newer count took over
    const u = Math.min(1, Math.max(0, (now - t0) / ms)), e = 1 - (1 - u) ** 3;
    items.forEach(({ n, to, from: f, d }) => { n.textContent = fmt(u < 1 ? f + (to - f) * e : to, d); });
    if (u < 1) requestAnimationFrame(tick);
  };
  tick(performance.now());
  setTimeout(() => tick(t0 + ms), delay + ms + 60);              // land on the values even if frames are paused
}
