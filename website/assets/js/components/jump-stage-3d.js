// 3D jump stage (three.js): the simulated athlete as a simple mannequin on a jump lane.
// Poses come from data/mock-data.js, which works in the side view (x forward, y up). The
// 3D model adds the side-to-side axis z: near limbs at +z, far limbs at -z. Every limb
// keeps its real length, so the motion is exactly the simulated jump.
//
// Motion: the athlete is always drawn at the exact requested moment. Everything around it
// (camera, landing line, contact shadow) eases toward its target with critically damped
// smoothing, so jumps along the timeline and view changes glide instead of snapping.
// Frames are only rendered while something is still moving.
// Two guided camera views: "3d", a three-quarter view that turns toward side-on as the jump
// goes on, and "side", level at hip height and still - what the phone on its tripod sees.
// orbit() switches to a free camera that circles the athlete (any angle, tilted up to 60°)
// and keeps that angle while the timeline moves; setView() returns to a guided view.
// The renderer, lights, lane and mannequin are shared with the Metrics figure (scene-3d.js).
import { lerpPose } from "./athlete.js";
import {
  THREE, C, TAPE_Z, addLights, aimKeyLight, createContactShadow, createLane, createMannequin, createRenderer, tapeMarks,
} from "./scene-3d.js";
import { onUnitsChange } from "../lib/units.js";

const TAU = { camera: 0.26, view: 0.3, fade: 0.12, free: 0.3, yaw: 0.07, pitch: 0.07, focus: 0.15 };   // smoothing time constants (s): ~3τ to settle
const DONE = { progress: 0.004, side: 0.004, mark: 0.02, free: 0.004, yaw: 0.002, pitch: 0.002, focus: 0.002 };   // gaps too small to see: snap and stop
const KEYS = Object.keys(TAU).map((k) => (k === "camera" ? "progress" : k === "view" ? "side" : k === "fade" ? "mark" : k));
const PITCH = [(3 * Math.PI) / 180, (60 * Math.PI) / 180];   // free camera: from just above the floor to 60° up

export function createStage3D(host, attempt, { onContextLost, reducedMotion = false } = {}) {
  const { frames, events } = attempt, last = frames.length - 1;

  const { renderer, canvas, release } = createRenderer({ className: "jump-stage__canvas", onContextLost });
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.ink, 4.5, 11);                   // the floor fades into the background
  const camera = new THREE.PerspectiveCamera(30, 16 / 10, 0.1, 60);
  const key = addLights(scene);

  // ---- floor (lane, takeoff line, tape, landing mark) and the contact shadow ----
  const { markTape, landMark } = createLane(scene, { landingX: frames[events.landing].pose.near.heel[0] });
  const shadow = createContactShadow(scene);

  // ---- flight path: dots along the hip's arc, lit up as the athlete passes them ----
  const pathIdx = [];
  for (let i = events.takeoff; i <= events.landing; i += 2) pathIdx.push(i);
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshBasicMaterial(), pathIdx.length);
  const tmp = new THREE.Matrix4(), lit = new THREE.Color(C.accent), dim = new THREE.Color(C.pathTodo);
  pathIdx.forEach((i, k) => {
    dots.setMatrixAt(k, tmp.makeTranslation(frames[i].hip[0], frames[i].hip[1], 0));
    dots.setColorAt(k, dim);
  });
  scene.add(dots);

  // ---- athlete: off-white, far limbs a shade darker, red shoes; it shades itself lightly ----
  const matNear = new THREE.MeshStandardMaterial({ color: C.body, roughness: 0.55, metalness: 0 });
  const matFar = matNear.clone(); matFar.color.set(C.bodyFar);
  const matShoe = new THREE.MeshStandardMaterial({ color: C.accent, roughness: 0.6, metalness: 0 });
  const athlete = createMannequin(scene, { near: matNear, far: matFar, shoe: matShoe });
  function pose(p) {
    athlete.pose(p);
    shadow.follow(p);
    aimKeyLight(key, p.hip[0]);
  }

  // ---- distance labels on the tape (HTML, so they use the site's type): each meter, or every 2 ft ----
  const labelLayer = document.createElement("div");
  labelLayer.className = "jump-stage__labels";
  labelLayer.setAttribute("aria-hidden", "true");
  let labels = [];
  function labelTape() {
    labels = tapeMarks().map(([x, text]) => {
      const el = document.createElement("span");
      el.className = "jump-stage__label";
      el.textContent = text;
      return { el, at: new THREE.Vector3(x, 0, TAPE_Z + 0.09) };
    });
    labelLayer.replaceChildren(...labels.map((l) => l.el));
  }
  markTape();
  labelTape();

  // ---- camera ----
  // free: 0 = guided view, 1 = free orbit. yaw/pitch: the free camera's angles. focus: athlete's x.
  const goal = { progress: 0, side: 0, mark: 0, free: 0, yaw: 0, pitch: 0, focus: 0 };   // where things are heading
  const now = { ...goal };                                                             // where they are this frame
  let fit = 5, width = 0, height = 0;
  const lerp = (a, b, t) => a + (b - a) * t;
  /** The guided camera for the current progress and view: target, azimuth, height above target. */
  function guided() {
    const s = now.progress * now.progress * (3 - 2 * now.progress), v = now.side;
    return {
      tx: lerp(0.6 + 0.95 * s, 1.05, v), ty: lerp(0.92, 0.9, v),
      az: lerp(((30 - 12 * s) * Math.PI) / 180, 0, v), h: lerp(0.5, 0.06, v),
    };
  }
  function aim() {
    const g = guided(), f = now.free, R = Math.hypot(fit, g.h);
    const tx = lerp(g.tx, now.focus, f), ty = lerp(g.ty, 0.95, f);   // free camera circles the athlete
    const az = lerp(g.az, now.yaw, f), el = lerp(Math.atan2(g.h, fit), now.pitch, f);
    camera.position.set(tx + R * Math.cos(el) * Math.sin(az), ty + R * Math.sin(el), R * Math.cos(el) * Math.cos(az));
    camera.lookAt(tx, ty, 0);
  }
  function resize() {
    // Measure the canvas's own box (on phones it sits below a readout strip), not the whole stage
    const w = Math.max(1, Math.round(canvas.clientWidth || host.clientWidth)), h = Math.max(1, Math.round(canvas.clientHeight || host.clientHeight));
    if (w === width && h === height) return;
    width = w; height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tv = Math.tan((camera.fov * Math.PI) / 360), th = tv * camera.aspect;
    fit = Math.max(1.85 / th, 1.32 / tv) + 0.3;                // keep the whole jump, arms up, in frame at any shape
    camera.updateProjectionMatrix();
  }
  const projected = new THREE.Vector3();
  function draw() {
    resize();
    aim();
    landMark.material.opacity = now.mark;
    landMark.visible = now.mark > 0.01;
    renderer.render(scene, camera);
    for (const { el, at } of labels) {
      projected.copy(at).project(camera);
      el.style.transform = `translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px) translate(-50%, 0)`;
      el.style.opacity = projected.z < 1 && Math.abs(projected.x) < 1.05 ? "" : "0";
    }
  }

  // ---- smoothing loop: runs only until everything has caught up ----
  let raf = 0, lastTime = 0, snap = true;                      // snap: first frame starts settled
  function step(time) {
    const dt = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 1 / 60;
    lastTime = time;
    const ease = (name, tau) => {
      const gap = goal[name] - now[name];
      now[name] = snap || reducedMotion || Math.abs(gap) < DONE[name] ? goal[name] : now[name] + gap * (1 - Math.exp(-dt / tau));
    };
    ease("progress", TAU.camera);
    ease("side", TAU.view);
    ease("mark", TAU.fade);
    for (const k of ["free", "yaw", "pitch", "focus"]) ease(k, TAU[k]);
    snap = false;
    draw();
    const settled = KEYS.every((k) => now[k] === goal[k]);
    if (settled) { lastTime = 0; return; }
    raf = requestAnimationFrame(step);
  }
  /** Draw now (no lag behind the timeline), then keep easing on later frames if needed. */
  function update() {
    cancelAnimationFrame(raf);
    step(performance.now());
  }

  host.append(canvas, labelLayer);
  const stopUnits = onUnitsChange(() => { markTape(); labelTape(); update(); });
  let current = 0;
  const api = {
    element: canvas,
    /** Switch to a guided view: "3d" or "side". Leaves the free orbit; the camera glides there. */
    setView(view) {
      goal.side = view === "side" ? 1 : 0;
      if (goal.free) {
        // Unwind the orbit to the nearest turn of the guided angle, so the camera never spins back
        const g = guided(), turn = 2 * Math.PI;
        now.yaw = g.az + ((((now.yaw - g.az + Math.PI) % turn) + turn) % turn) - Math.PI;
        goal.yaw = now.yaw;
        goal.free = 0;
      }
      update();
    },
    /** Circle the camera around the athlete by dYaw / dPitch radians; the moment in the jump is unchanged. */
    orbit(dYaw, dPitch = 0) {
      if (!goal.free) {                                         // start from exactly where the guided camera is
        const g = guided();
        now.yaw = goal.yaw = lerp(g.az, now.yaw, now.free);
        now.pitch = goal.pitch = Math.min(PITCH[1], Math.max(PITCH[0], Math.atan2(g.h, fit)));
        goal.free = 1;
      }
      goal.yaw += dYaw;
      goal.pitch = Math.min(PITCH[1], Math.max(PITCH[0], goal.pitch + dPitch));
      update();
    },
    get orbiting() { return goal.free === 1; },
    setPos(pos) {
      current = Math.max(0, Math.min(last, pos));
      const i = Math.floor(current), u = current - i;
      const p = u > 1e-6 ? lerpPose(frames[i].pose, frames[i + 1].pose, u) : frames[i].pose;
      pose(p);
      goal.progress = current / last;
      goal.mark = current >= events.landing ? 1 : 0;
      goal.focus = p.hip[0];                                    // the free camera keeps the athlete centered
      if (snap) now.focus = p.hip[0];
      pathIdx.forEach((fi, k) => dots.setColorAt(k, fi <= current ? lit : dim));
      dots.instanceColor.needsUpdate = true;
      update();
    },
    dispose() {
      stopUnits();
      ro?.disconnect();
      cancelAnimationFrame(raf);
      shadow.texture.dispose();
      release(scene);                                          // geometry, materials and the GPU context
      labelLayer.remove();
    },
  };
  const ro = "ResizeObserver" in window ? new ResizeObserver(() => { width = 0; update(); }) : null;
  ro?.observe(host);
  return api;
}
