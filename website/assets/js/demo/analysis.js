// Simulated analysis sequence. It does NOT analyse anything: it walks through the real
// pipeline's steps so the demo flow feels like the finished tool. Instant under reduced motion.
import { wait } from "../lib/motion.js";

export const STEPS = [
  "Reading video frames",
  "Tracking 33 body landmarks",
  "Smoothing the motion",
  "Finding takeoff and landing",
  "Fitting the flight parabola",
  "Measuring angles and timing",
];

/** Render the step list into `host` and play through it. Resolves when finished. */
export async function runAnalysis(host, { stepMs = 420 } = {}) {
  host.innerHTML = `
    <div class="analysis__bar" role="progressbar" aria-label="Analysis progress" aria-valuemin="0" aria-valuemax="${STEPS.length}" aria-valuenow="0">
      <span class="analysis__fill"></span>
    </div>
    <ol class="analysis__steps" role="list">
      ${STEPS.map((s) => `<li class="analysis__step"><span class="analysis__mark" aria-hidden="true"></span>${s}</li>`).join("")}
    </ol>
    <p class="visually-hidden" aria-live="polite" id="analysis-status"></p>`;
  const bar = host.querySelector(".analysis__bar");
  const fill = host.querySelector(".analysis__fill");
  const items = [...host.querySelectorAll(".analysis__step")];
  const status = host.querySelector("#analysis-status");

  for (let i = 0; i < STEPS.length; i++) {
    items[i].classList.add("is-active");
    status.textContent = `${STEPS[i]}…`;
    await wait(stepMs);
    items[i].classList.replace("is-active", "is-done");
    bar.setAttribute("aria-valuenow", String(i + 1));
    fill.style.transform = `scaleX(${(i + 1) / STEPS.length})`;
  }
  status.textContent = "Analysis complete.";
  await wait(250);
}

/**
 * Progress for a REAL analysis: the same step list, driven by what the server reports.
 * Returns { active(i, label?), done(i), fail() }; a running clock shows on the active step.
 */
export function createSteps(host, steps) {
  host.innerHTML = `
    <div class="analysis__bar" role="progressbar" aria-label="Analysis progress" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="0">
      <span class="analysis__fill"></span>
    </div>
    <ol class="analysis__steps" role="list">
      ${steps.map((s) => `<li class="analysis__step"><span class="analysis__mark" aria-hidden="true"></span><span class="analysis__label">${s}</span><span class="analysis__clock" aria-hidden="true"></span></li>`).join("")}
    </ol>
    <p class="visually-hidden" aria-live="polite"></p>`;
  const items = [...host.querySelectorAll(".analysis__step")], bar = host.querySelector(".analysis__bar");
  const fill = host.querySelector(".analysis__fill"), status = host.querySelector("[aria-live]");
  let timer = 0;
  const stopClock = () => { clearInterval(timer); timer = 0; };
  return {
    active(i, label) {
      stopClock();
      items.forEach((li, k) => li.classList.toggle("is-active", k === i));
      if (label) items[i].querySelector(".analysis__label").textContent = label;
      status.textContent = `${items[i].querySelector(".analysis__label").textContent}…`;
      const t0 = Date.now(), clock = items[i].querySelector(".analysis__clock");
      timer = setInterval(() => {
        const s = Math.round((Date.now() - t0) / 1000);
        clock.textContent = s >= 3 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "";
      }, 1000);
    },
    label(i, text) { items[i].querySelector(".analysis__label").textContent = text; },
    done(i) {
      stopClock();
      items[i].classList.remove("is-active");
      items[i].classList.add("is-done");
      bar.setAttribute("aria-valuenow", String(i + 1));
      fill.style.transform = `scaleX(${(i + 1) / steps.length})`;
    },
    fail() { stopClock(); items.forEach((li) => li.classList.remove("is-active")); },
  };
}
