// Units: metric (meters, m/s) or imperial (feet and inches, ft/s), chosen with the switch in the
// header and remembered on this device. All data stays in SI (meters, seconds); only what is shown
// changes. Every page reads the choice before it first draws, so there is no flash of the other
// units, and redraws its numbers when the choice changes (onUnitsChange).
//
// Fixed text in the HTML gives its imperial wording in data-imperial, e.g.
//   <span data-imperial="13–16 ft">4–5 m</span>
// and is swapped here. Typeset maths uses data-tex-imperial (see lib/math.js).
import { fmt, store } from "./dom.js";

const KEY = "jl-units", EVENT = "jl-units-change";
export const FOOT = 0.3048, INCH = 0.0254;
let current = store.get(KEY, "metric") === "imperial" ? "imperial" : "metric";
document.documentElement.dataset.units = current;

export const getUnits = () => current;
export const isImperial = () => current === "imperial";

export function setUnits(units) {
  if (units === current || !["metric", "imperial"].includes(units)) return;
  current = units;
  store.set(KEY, units);
  document.documentElement.dataset.units = units;
  swapStaticText();
  window.dispatchEvent(new CustomEvent(EVENT, { detail: units }));
}

/** Call fn(units) whenever the units change (here or in another tab). Returns an unsubscribe function. */
export function onUnitsChange(fn) {
  const handler = (e) => fn(e.detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
window.addEventListener("storage", (e) => { if (e.key === KEY) setUnits(store.get(KEY, "metric")); });

// ---------------------------------------------------------------- formatting
// Each kind returns parts [[number, unit], ...] so text and scoreboard HTML share one rule.
const half = (inches) => {                                   // nearest half inch, written 3½
  const h = Math.round(inches * 2) / 2, whole = Math.floor(h);
  return h === whole ? String(whole) : whole ? `${whole}½` : "½";
};
const KINDS = {
  /** Jump distances: 2.21 m, or 7 ft 3½ in (to the nearest half inch, as a tape is read). */
  distance(m, digits = 2) {
    if (current === "metric") return [[fmt(m, digits), "m"]];
    const inches = Math.round((Math.abs(m) / INCH) * 2) / 2, ft = Math.floor(inches / 12), rest = inches - ft * 12;
    const sign = m < 0 ? "−" : "";
    return ft ? [[sign + ft, "ft"], [half(rest), "in"]] : [[sign + half(rest), "in"]];
  },
  /** Body heights and positions: 0.95 m, or 37.4 in. */
  height: (m, digits = 2) => (current === "metric" ? [[fmt(m, digits), "m"]] : [[fmt(m / INCH, Math.max(0, digits - 1)), "in"]]),
  /** Small lengths and differences: 38 cm, or 15.0 in. */
  short: (m) => (current === "metric" ? [[fmt(m * 100, 0), "cm"]] : [[fmt(m / INCH, 1), "in"]]),
  /** Tracking noise: 5 mm, or 0.20 in. */
  tiny: (m) => (current === "metric" ? [[fmt(m * 1000, 0), "mm"]] : [[fmt(m / INCH, 2), "in"]]),
  /** Speeds: 3.33 m/s, or 10.9 ft/s (one decimal fewer: a foot is about a third of a meter). */
  speed: (v, digits = 2) => (current === "metric" ? [[fmt(v, digits), "m/s"]] : [[fmt(v / FOOT, Math.max(0, digits - 1)), "ft/s"]]),
  /** Accelerations (gravity): 9.81 m/s², or 32.2 ft/s². */
  accel: (a, digits = 2) => (current === "metric" ? [[fmt(a, digits), "m/s²"]] : [[fmt(a / FOOT, Math.max(0, digits - 1)), "ft/s²"]]),
};

/** "2.21 m" / "7 ft 3½ in". */
export const formatQuantity = (kind, value, digits) => KINDS[kind](value, digits).map(([n, u]) => `${n} ${u}`).join(" ");
/** Just the number(s), for text that already names the unit: "2.21" / "10.9". */
export const formatNumber = (kind, value, digits) => KINDS[kind](value, digits).map(([n]) => n).join(" ");
/** The unit alone: "m/s" / "ft/s" (for a kind with a single part). */
export const unitOf = (kind) => KINDS[kind](1)[0][1];
/** Scoreboard HTML: each number at full size, each unit small (class `unitClass`). */
export const quantityHTML = (kind, value, digits, unitClass = "stat__unit") =>
  KINDS[kind](value, digits).map(([n, u], i, all) => `${n}<span class="${unitClass}${i < all.length - 1 ? ` ${unitClass}--mid` : ""}">${u}</span>`).join("");

/** Chart axes for lengths: meters, or feet. scale converts meters to the shown unit. */
export const lengthAxis = () => (current === "metric" ? { scale: 1, unit: "m", word: "meters" } : { scale: 1 / FOOT, unit: "ft", word: "feet" });

// ---------------------------------------------------------------- fixed text in the HTML
function swapStaticText() {
  for (const node of document.querySelectorAll("[data-imperial]")) {
    if (!("metric" in node.dataset)) node.dataset.metric = node.textContent;
    node.textContent = current === "imperial" ? node.dataset.imperial : node.dataset.metric;
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", swapStaticText, { once: true });
else swapStaticText();
