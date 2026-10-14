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
