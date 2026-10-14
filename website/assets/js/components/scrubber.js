// Jump timeline: a native range input dressed as a broadcast-style scrub bar. The jump's
// phases are shaded along the track; takeoff, peak and landing are buttons above it, so
// every moment is reachable with one click or tap as well as by dragging. The input stays
// the real control, so keyboard and screen readers get a normal slider.
import { icon } from "./icons.js";

const PHASES = ["Stance", "Countermovement", "Propulsion", "Flight", "Landing"];
const SHORT = { Stance: "Stance", Countermovement: "Dip", Propulsion: "Push", Flight: "Flight", Landing: "Landing" };

export function createScrubber(host, attempt, { onInput, onPlay, onJump, describedBy } = {}) {
  const { frames, events } = attempt, last = frames.length - 1;
  const pct = (i) => (i / last) * 100;
  const cuts = [0, events.onset, events.bottom, events.takeoff, events.landing, last];
  const span = (k) => `left:${pct(cuts[k])}%;width:${pct(cuts[k + 1]) - pct(cuts[k])}%`;
  const ticks = [["Takeoff", events.takeoff, "end"], ["Peak", events.peak, "mid"], ["Landing", events.landing, "start"]];

  host.innerHTML = `
    <div class="scrub">
      <button type="button" class="scrub__play" aria-label="Play the jump">${icon("play")}</button>
      <div class="scrub__body">
        <div class="scrub__lane scrub__ticks" role="group" aria-label="Jump to a key moment">
          ${ticks.map(([name, i, align]) => `<button type="button" class="scrub__tick scrub__tick--${align}" style="left:${pct(i)}%" data-frame="${i}" aria-label="Jump to ${name.toLowerCase()}">${name}</button>`).join("")}
        </div>
        <div class="scrub__rail">
          <div class="scrub__lane scrub__track" aria-hidden="true">
            ${PHASES.map((_, k) => `<span class="scrub__seg" style="${span(k)}"></span>`).join("")}
            <span class="scrub__fill"></span>
            ${ticks.map(([, i]) => `<span class="scrub__mark" style="left:${pct(i)}%"></span>`).join("")}
          </div>
          <input class="scrub__input" type="range" min="0" max="${last}" step="1" value="0" aria-label="Jump timeline"${describedBy ? ` aria-describedby="${describedBy}"` : ""}>
        </div>
        <div class="scrub__lane scrub__phases" aria-hidden="true">
          ${PHASES.map((name, k) => `<span class="scrub__phase" data-phase="${name}" style="${span(k)}">${SHORT[name]}</span>`).join("")}
        </div>
      </div>
    </div>`;

  const root = host.querySelector(".scrub");
  const input = host.querySelector(".scrub__input");
  const play = host.querySelector(".scrub__play");
  const phaseEls = [...host.querySelectorAll(".scrub__phase")];
  input.addEventListener("input", () => onInput?.(Number(input.value)));
  input.addEventListener("pointerdown", () => root.classList.add("is-dragging"));
  window.addEventListener("pointerup", () => root.classList.remove("is-dragging"));
  play.addEventListener("click", () => onPlay?.());
  host.querySelectorAll(".scrub__tick").forEach((b) => b.addEventListener("click", () => onJump?.(Number(b.dataset.frame))));

  let shownPhase = null;
  return {
    /** Move the bar to a (possibly fractional) frame position. */
    set(pos) {
      const i = Math.round(pos), f = frames[i];
      root.style.setProperty("--p", `${(pos / last) * 100}%`);
      if (document.activeElement !== input || !root.classList.contains("is-dragging")) input.value = String(i);
      input.setAttribute("aria-valuetext", `${f.t.toFixed(2)} seconds, ${f.phase}`);
      if (f.phase !== shownPhase) {
        shownPhase = f.phase;
        phaseEls.forEach((el) => el.classList.toggle("is-current", el.dataset.phase === f.phase));
      }
    },
    /** Show the play button as play, pause or replay. */
    setState(state) {
      play.innerHTML = icon(state === "playing" ? "pause" : state === "ended" ? "replay" : "play");
      play.setAttribute("aria-label", state === "playing" ? "Pause" : state === "ended" ? "Replay the jump" : "Play the jump");
    },
    input,
  };
}
