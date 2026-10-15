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
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
import { lerpPose } from "./athlete.js";
import { FOOT, INCH, isImperial, onUnitsChange } from "../lib/units.js";

const C = {
  ink: 0x121315, ground: 0x111214, lane: 0x1b1d21, laneEdge: 0x34373c, tape: 0xd9d5cc,
  accent: 0xe8665a, body: 0xe9e6df, bodyFar: 0xbdb9b1, pathTodo: 0x3a3d42,
};
const HIP_W = 0.095, SHOULDER_W = 0.185;                     // half widths (m)
const R = { thigh: 0.07, shin: 0.052, foot: 0.04, upperArm: 0.046, forearm: 0.039, torso: 0.115 };
const LEN = { thigh: 0.45, shin: 0.43, upperArm: 0.3, forearm: 0.27, foot: 0.24, trunk: 0.5 };
const TAPE_Z = 0.62;                                         // tape runs along the lane edge nearest the camera
const TAU = { camera: 0.26, view: 0.3, fade: 0.12, free: 0.3, yaw: 0.07, pitch: 0.07, focus: 0.15 };   // smoothing time constants (s): ~3τ to settle
const DONE = { progress: 0.004, side: 0.004, mark: 0.02, free: 0.004, yaw: 0.002, pitch: 0.002, focus: 0.002 };   // gaps too small to see: snap and stop
const KEYS = Object.keys(TAU).map((k) => (k === "camera" ? "progress" : k === "view" ? "side" : k === "fade" ? "mark" : k));
const PITCH = [(3 * Math.PI) / 180, (60 * Math.PI) / 180];   // free camera: from just above the floor to 60° up

export function createStage3D(host, attempt, { onContextLost, reducedMotion = false } = {}) {
  const { frames, events } = attempt, last = frames.length - 1;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  if (!renderer.getContext()) throw new Error("WebGL unavailable");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(C.ink, 0);                           // transparent: the hero's own charcoal shows through
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "jump-stage__canvas";
  canvas.setAttribute("aria-hidden", "true");
  let disposed = false;                                       // our own release below is not a "lost" context
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); if (!disposed) onContextLost?.(); });

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.ink, 4.5, 11);                   // the floor fades into the background
  const camera = new THREE.PerspectiveCamera(30, 16 / 10, 0.1, 60);

  // ---- lights: soft sky fill, a key light that casts the shadow, a cool rim from behind ----
  scene.add(new THREE.HemisphereLight(0xe6eaf0, 0x0b0b0d, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.4, bottom: -1.2, near: 0.5, far: 14 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xc4d2ff, 0.9);
  rim.position.set(-3, 3.2, -4);
  scene.add(rim);

  // ---- floor: ground, lane, takeoff line, tape measure, landing mark ----
  const flat = (w, d, color, x, z, y = 0.002, extra = {}) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...extra }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  flat(40, 40, C.ground, 1, 0, 0).receiveShadow = true;           // only the floor takes the cast shadow
  flat(5.6, 1.5, C.lane, 1.0, 0, 0.001).receiveShadow = true;
  flat(5.6, 0.012, C.laneEdge, 1.0, 0.75); flat(5.6, 0.012, C.laneEdge, 1.0, -0.75);
  const glow = { emissive: C.accent, emissiveIntensity: 0.35 };
  flat(0.05, 1.5, C.accent, -0.025, 0, 0.003, glow);           // takeoff line, just behind the toes
  flat(3.0, 0.028, C.tape, 1.5, TAPE_Z, 0.003);
  // Tick marks: every 10 cm with a long one each half metre, or every 3 in with a long one each foot
  const tapeTicks = new THREE.Group(), tickMat = new THREE.MeshStandardMaterial({ color: C.tape, roughness: 0.95, metalness: 0 });
  scene.add(tapeTicks);
  function markTape() {
    tapeTicks.children.forEach((t) => t.geometry.dispose());
    tapeTicks.clear();
    const step = isImperial() ? 3 * INCH : 0.1, longEvery = isImperial() ? 4 : 5;
    for (let i = 0; i * step <= 3.0 + 1e-6; i++) {
      const big = i % longEvery === 0, len = big ? 0.075 : 0.035;
      const t = new THREE.Mesh(new THREE.PlaneGeometry(big ? 0.012 : 0.007, len), tickMat);
      t.rotation.x = -Math.PI / 2;
      t.position.set(i * step, 0.003, TAPE_Z - 0.014 - len / 2);
      tapeTicks.add(t);
    }
  }
  const heelX = frames[events.landing].pose.near.heel[0];
  const landMark = flat(0.04, 1.5, C.accent, heelX - 0.02, 0, 0.003, { ...glow, transparent: true, opacity: 0 });

  // ---- contact shadow: a soft pool under the feet that spreads and fades as they leave the floor ----
  const blobTexture = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d"), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(0,0,0,0.6)");
    grad.addColorStop(0.45, "rgba(0,0,0,0.28)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.004;
  blob.renderOrder = 1;
  scene.add(blob);

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

  // ---- athlete: rounded segments of fixed length, red shoes; it shades itself lightly ----
  const matNear = new THREE.MeshStandardMaterial({ color: C.body, roughness: 0.55, metalness: 0 });
  const matFar = matNear.clone(); matFar.color.set(C.bodyFar);
  const matShoe = new THREE.MeshStandardMaterial({ color: C.accent, roughness: 0.6, metalness: 0 });
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  const capsule = (r, len, mat) => add(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 10, 24), mat);
  const sphere = (r, mat) => add(new THREE.SphereGeometry(r, 32, 20), mat);

  const limbs = {};
  for (const side of ["near", "far"]) {
    const mat = side === "near" ? matNear : matFar;
    limbs[side] = {
      thigh: capsule(R.thigh, LEN.thigh, mat), shin: capsule(R.shin, LEN.shin, mat),
      foot: capsule(R.foot, LEN.foot - 2 * R.foot, matShoe),
      upperArm: capsule(R.upperArm, LEN.upperArm, mat), forearm: capsule(R.forearm, LEN.forearm, mat),
      hand: sphere(0.043, mat),
    };
  }
  const torso = capsule(R.torso, LEN.trunk - 2 * R.torso, matNear);
  torso.scale.set(0.9, 1, 1.42);                               // deeper than wide in the side view, broad across
  const pelvis = capsule(0.1, 2 * HIP_W, matNear); pelvis.rotation.x = Math.PI / 2;
  const girdle = capsule(0.066, 2 * SHOULDER_W, matNear); girdle.rotation.x = Math.PI / 2;
  const neck = capsule(0.045, 0.07, matNear);
  const head = sphere(0.105, matNear);

  /** Put a capsule between two side-view points at depth z. */
  const place = (mesh, a, b, z = 0) => {
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z);
    mesh.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2;
  };

  function pose(p) {
    for (const side of ["near", "far"]) {
      const s = p[side], L = limbs[side], z = side === "near" ? 1 : -1;
      place(L.thigh, p.hip, s.knee, z * HIP_W);
      place(L.shin, s.knee, s.ankle, z * HIP_W);
      // Shoe: lifted so its sole sits on the heel/toe markers (they ride ~2 cm above the floor)
      const d = [s.toe[0] - s.heel[0], s.toe[1] - s.heel[1]], n = Math.hypot(d[0], d[1]) || 1;
      const up = [(-d[1] / n) * 0.022, (d[0] / n) * 0.022];
      place(L.foot, [s.heel[0] + up[0], s.heel[1] + up[1]], [s.toe[0] + up[0], s.toe[1] + up[1]], z * (HIP_W + 0.005));
      place(L.upperArm, s.shoulder, s.elbow, z * SHOULDER_W);
      place(L.forearm, s.elbow, s.wrist, z * SHOULDER_W);
      const fa = [s.wrist[0] - s.elbow[0], s.wrist[1] - s.elbow[1]], fl = Math.hypot(fa[0], fa[1]) || 1;
      L.hand.position.set(s.wrist[0] + (fa[0] / fl) * 0.035, s.wrist[1] + (fa[1] / fl) * 0.035, z * SHOULDER_W);
    }
    const sh = p.near.shoulder;
    place(torso, p.hip, sh);
    pelvis.position.set(p.hip[0], p.hip[1], 0);
    girdle.position.set(sh[0], sh[1], 0);
    place(neck, sh, [sh[0] + (p.head[0] - sh[0]) * 0.55, sh[1] + (p.head[1] - sh[1]) * 0.55]);
    head.position.set(p.head[0], p.head[1], 0);
    // Contact shadow follows the feet: tight and dark on the floor, wide and faint in the air
    const feet = [p.near.heel, p.near.toe, p.far.heel, p.far.toe];
    const lift = Math.max(0, Math.min(...feet.map((q) => q[1])) - 0.02);
    const k = Math.min(1, lift / 0.6);
    blob.position.x = feet.reduce((sum, q) => sum + q[0], 0) / 4;
    blob.scale.set(0.62 + 0.5 * k, 0.5 + 0.35 * k, 1);
    blob.material.opacity = 0.95 - 0.75 * k;
    // The key light follows the athlete so its shadow stays sharp
    key.position.set(p.hip[0] + 2.2, 6, 3.6);
    key.target.position.set(p.hip[0], 0.6, 0);
  }

  // ---- distance labels on the tape (HTML, so they use the site's type): each metre, or every 2 ft ----
  const labelLayer = document.createElement("div");
  labelLayer.className = "jump-stage__labels";
  labelLayer.setAttribute("aria-hidden", "true");
  let labels = [];
  function labelTape() {
    const marks = isImperial() ? [0, 2, 4, 6, 8].map((ft) => [ft * FOOT, `${ft} ft`]) : [0, 1, 2, 3].map((m) => [m, `${m} m`]);
    labels = marks.map(([x, text]) => {
      const el = document.createElement("span");
      el.className = "jump-stage__label";
      el.textContent = x ? text : "0";
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
      goal.focus = p.hip[0];                                    // the free camera keeps the athlete centred
      if (snap) now.focus = p.hip[0];
      pathIdx.forEach((fi, k) => dots.setColorAt(k, fi <= current ? lit : dim));
      dots.instanceColor.needsUpdate = true;
      update();
    },
    dispose() {
      disposed = true;
      stopUnits();
      ro?.disconnect();
      cancelAnimationFrame(raf);
      blobTexture.dispose();
      scene.traverse((o) => { o.geometry?.dispose(); [].concat(o.material || []).forEach((m) => m.dispose()); });
      renderer.dispose();
      renderer.forceContextLoss();                             // free the GPU context for the next stage
      canvas.remove();
      labelLayer.remove();
    },
  };
  const ro = "ResizeObserver" in window ? new ResizeObserver(() => { width = 0; update(); }) : null;
  ro?.observe(host);
  return api;
}
