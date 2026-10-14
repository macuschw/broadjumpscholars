// The jump stage shared by the home hero and the demo playback: the 3D athlete when three.js
// and WebGL are available, otherwise the flat 2D one. Also the view controls, drag-to-orbit
// (look around the athlete) and drag-to-scrub (move through the jump).
import { prefersReducedMotion } from "../lib/motion.js";
import { icon } from "./icons.js";

/** The flat 2D stage (fallback). */
export const createFlatStage = async (host, attempt) => (await import("./jump-stage-2d.js")).createStage2D(host, attempt);

/**
 * The best stage available. Resolves to { element, setPos(pos), dispose(), setView?(view) }.
 * Falls back to the flat stage if three.js can't load within `timeout` ms or WebGL is missing.
 */
export async function createJumpStage(host, attempt, { onContextLost, timeout = 5000 } = {}) {
  try {
    const slow = new Promise((_, reject) => setTimeout(() => reject(new Error("3D took too long")), timeout));
    const mod = await Promise.race([import("./jump-stage-3d.js"), slow]);
    return mod.createStage3D(host, attempt, { onContextLost, reducedMotion: prefersReducedMotion() });
  } catch {
    return createFlatStage(host, attempt);
  }
}

/** 3D / Side toggle in the stage's corner (3D stages only). Side is level at hip height, like the phone. */
export function addViewToggle(host, getStage) {
  const wrap = document.createElement("div");
  wrap.className = "jump-stage__views";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Camera view");
  wrap.innerHTML = `<button type="button" class="jump-stage__view" data-view="3d" aria-pressed="true">3D</button>`
    + `<button type="button" class="jump-stage__view" data-view="side" aria-pressed="false" title="Level, side-on: what the phone camera sees">Side</button>`;
  const buttons = [...wrap.querySelectorAll("button")];
  buttons.forEach((b) => b.addEventListener("click", () => {
    buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    getStage()?.setView?.(b.dataset.view);
  }));
  host.append(wrap);
  return wrap;
}

/**
 * Drag sideways on the stage to scrub: a full stage width moves through the whole clip
 * (`frames` long: a number, or a function when the clip can change). A few pixels of movement
 * are needed before it counts, so a tap never jumps the timeline; vertical drags still scroll
 * the page (touch-action: pan-y in CSS).
 */
export function enableStageDrag(host, { frames, from, onStart, onMove, when = () => true }) {
  host.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button") || !when()) return;
    const x0 = e.clientX, w = host.clientWidth || 1, n = typeof frames === "function" ? frames() : frames;
    let p0 = null;
    const move = (ev) => {
      if (p0 === null) {
        if (Math.abs(ev.clientX - x0) < 4) return;
        onStart?.();
        p0 = from();
        try { host.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        host.classList.add("is-dragging");
      }
      onMove(Math.max(0, Math.min(n - 1, p0 + ((ev.clientX - x0) / w) * (n - 1))));
    };
    const end = () => {
      host.classList.remove("is-dragging");
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", end);
      host.removeEventListener("pointercancel", end);
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", end);
    host.addEventListener("pointercancel", end);
  });
}

/**
 * View controls for a stage that can orbit: the 3D / Side toggle (top corner) and two rotate
 * buttons (bottom corner, a one-click alternative to dragging). While the camera is free, neither
 * view button is pressed; pressing one returns to that guided view.
 */
export function addViewControls(host, getStage) {
  const views = addViewToggle(host, getStage);
  const viewButtons = [...views.querySelectorAll("button")];
  const rotate = document.createElement("div");
  rotate.className = "jump-stage__views jump-stage__rotate";
  rotate.setAttribute("role", "group");
  rotate.setAttribute("aria-label", "Rotate the view");
  rotate.innerHTML = `<button type="button" class="jump-stage__view jump-stage__view--icon" data-turn="-1" aria-label="Rotate left">${icon("rotateLeft")}</button>`
    + `<button type="button" class="jump-stage__view jump-stage__view--icon" data-turn="1" aria-label="Rotate right">${icon("rotateRight")}</button>`;
  const free = () => viewButtons.forEach((b) => b.setAttribute("aria-pressed", "false"));
  rotate.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    getStage()?.orbit?.((Number(b.dataset.turn) * Math.PI) / 4);
    free();
  }));
  host.append(rotate);
  return { free, remove() { views.remove(); rotate.remove(); } };
}

/**
 * Drag on the stage to look around the athlete: sideways turns the camera all the way round,
 * up and down tilts it (mouse and pen; on touch, vertical drags keep scrolling the page).
 * Arrow keys do the same when the stage has focus. The moment in the jump never changes.
 */
export function enableStageOrbit(host, getStage, { onOrbit } = {}) {
  host.addEventListener("pointerdown", (e) => {
    const stage = getStage();
    if (e.button !== 0 || e.target.closest("button") || !stage?.orbit) return;
    let last = null;
    const x0 = e.clientX, y0 = e.clientY, w = host.clientWidth || 1, h = host.clientHeight || 1, tilt = e.pointerType !== "touch";
    const move = (ev) => {
      if (last === null) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;   // a tap is not a drag
        last = [ev.clientX, ev.clientY];
        try { host.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        host.classList.add("is-dragging");
        onOrbit?.();
        return;
      }
      const dx = ev.clientX - last[0], dy = ev.clientY - last[1];
      last = [ev.clientX, ev.clientY];
      stage.orbit((-dx / w) * 2 * Math.PI, tilt ? (dy / h) * (Math.PI / 2) : 0);   // one stage width = one full turn
    };
    const end = () => {
      host.classList.remove("is-dragging");
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", end);
      host.removeEventListener("pointercancel", end);
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", end);
    host.addEventListener("pointercancel", end);
  });
  host.addEventListener("keydown", (e) => {
    const stage = getStage();
    if (e.target !== host || !stage?.orbit) return;
    const turn = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!turn) return;
    e.preventDefault();
    stage.orbit((turn[0] * Math.PI) / 12, (turn[1] * Math.PI) / 24);   // 15° turns, 7.5° tilts
    onOrbit?.();
  });
}
