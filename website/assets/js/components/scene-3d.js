// Shared pieces of the 3D jump scenes (home hero, demo playback, Metrics figure): the renderer,
// lights, the jump lane with its tape measure, the contact shadow and the mannequin.
// Everything works in the side-view coordinates of data/mock-data.js (x forward, y up, metres);
// the 3D scenes add z, across the lane: near limbs at +z (toward the camera), far limbs at -z.
// Every limb keeps its real length, so a pose is exactly the simulated one.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
import { FOOT, INCH, isImperial } from "../lib/units.js";

export { THREE };
export const C = {
  ink: 0x121315, ground: 0x111214, lane: 0x1b1d21, laneEdge: 0x34373c, tape: 0xd9d5cc,
  accent: 0xe8665a, body: 0xe9e6df, bodyFar: 0xbdb9b1, pathTodo: 0x3a3d42,
};
export const HIP_W = 0.095, SHOULDER_W = 0.185;              // half widths (m)
export const TAPE_Z = 0.62;                                  // tape runs along the lane edge nearest the camera
const R = { thigh: 0.07, shin: 0.052, foot: 0.04, upperArm: 0.046, forearm: 0.039, torso: 0.115 };
const LEN = { thigh: 0.45, shin: 0.43, upperArm: 0.3, forearm: 0.27, foot: 0.24, trunk: 0.5 };

/**
 * A transparent renderer with soft shadows. `onContextLost` runs if the browser drops the GPU
 * context; release() frees it on purpose (which is not reported as a loss).
 */
export function createRenderer({ className, onContextLost }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  if (!renderer.getContext()) throw new Error("WebGL unavailable");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(C.ink, 0);                           // transparent: the page's own charcoal shows through
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = className;
  canvas.setAttribute("aria-hidden", "true");
  let released = false;
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); if (!released) onContextLost?.(); });
  return {
    renderer, canvas,
    release(scene) {
      released = true;
      scene?.traverse((o) => { o.geometry?.dispose(); [].concat(o.material || []).forEach((m) => m.dispose()); });
      renderer.dispose();
      renderer.forceContextLoss();                             // free the GPU context for the next scene
      canvas.remove();
    },
  };
}

/** Soft sky fill, a key light that casts the shadow, a cool rim from behind. Returns the key light. */
export function addLights(scene) {
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
  return key;
}

/** Keep the key light over the athlete so its shadow stays sharp. */
export const aimKeyLight = (key, hipX) => {
  key.position.set(hipX + 2.2, 6, 3.6);
  key.target.position.set(hipX, 0.6, 0);
};

/**
 * The floor: ground, lane, takeoff line, tape measure and a landing mark at `landingX` (hidden
 * until its opacity is raised). markTape() redraws the tape's ticks in the current units.
 */
export function createLane(scene, { landingX }) {
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
  const landMark = flat(0.04, 1.5, C.accent, landingX - 0.02, 0, 0.003, { ...glow, transparent: true, opacity: 0 });
  return { markTape, landMark };
}

/** Where the tape's labels go, in the current units: each metre, or every 2 ft. [[x, text], ...] */
export const tapeMarks = () => (isImperial()
  ? [0, 2, 4, 6, 8].map((ft) => [ft * FOOT, ft ? `${ft} ft` : "0"])
  : [0, 1, 2, 3].map((m) => [m, m ? `${m} m` : "0"]));

/** A soft pool of shadow under the feet that spreads and fades as they leave the floor. */
export function createContactShadow(scene) {
  const texture = (() => {
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
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.004;
  blob.renderOrder = 1;
  scene.add(blob);
  return {
    texture,
    /** Tight and dark on the floor, wide and faint in the air. */
    follow(p) {
      const feet = [p.near.heel, p.near.toe, p.far.heel, p.far.toe];
      const lift = Math.max(0, Math.min(...feet.map((q) => q[1])) - 0.02);
      const k = Math.min(1, lift / 0.6);
      blob.position.x = feet.reduce((sum, q) => sum + q[0], 0) / 4;
      blob.scale.set(0.62 + 0.5 * k, 0.5 + 0.35 * k, 1);
      blob.material.opacity = 0.95 - 0.75 * k;
    },
  };
}

/**
 * The mannequin: rounded segments of fixed length. `materials` gives { near, far, shoe }; with
 * shadows false it neither casts nor receives them (e.g. a see-through ghost). Returns pose(p) to
 * place it, `parts` (trunk, shin, foot...) for highlighting and `meshes` (every segment).
 */
export function createMannequin(scene, materials, { shadows = true, detailed = false } = {}) {
  if (detailed) return createArticulated(scene, materials, { shadows });
  const meshes = [];
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = shadows; scene.add(m); meshes.push(m); return m; };
  const capsule = (r, len, mat) => add(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 10, 24), mat);
  const sphere = (r, mat) => add(new THREE.SphereGeometry(r, 32, 20), mat);

  const limbs = {};
  for (const side of ["near", "far"]) {
    const mat = side === "near" ? materials.near : materials.far;
    limbs[side] = {
      thigh: capsule(R.thigh, LEN.thigh, mat), shin: capsule(R.shin, LEN.shin, mat),
      foot: capsule(R.foot, LEN.foot - 2 * R.foot, materials.shoe),
      upperArm: capsule(R.upperArm, LEN.upperArm, mat), forearm: capsule(R.forearm, LEN.forearm, mat),
      hand: sphere(0.043, mat),
    };
  }
  const torso = capsule(R.torso, LEN.trunk - 2 * R.torso, materials.near);
  torso.scale.set(0.9, 1, 1.42);                               // deeper than wide in the side view, broad across
  const pelvis = capsule(0.1, 2 * HIP_W, materials.near); pelvis.rotation.x = Math.PI / 2;
  const girdle = capsule(0.066, 2 * SHOULDER_W, materials.near); girdle.rotation.x = Math.PI / 2;
  const neck = capsule(0.045, 0.07, materials.near);
  const head = sphere(0.105, materials.near);

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
  }

  const parts = {
    trunk: [torso, pelvis, girdle],
    shin: [limbs.near.shin],
    foot: [limbs.near.foot, limbs.far.foot],
  };
  return { pose, parts, limbs, meshes };
}

/**
 * The articulated mannequin (Metrics figure): an artist's figure with light, believable anatomy.
 * Limbs are turned profiles - fuller at the muscle belly, slimmer at the joints - with a few soft
 * muscle shapes on the correct side: shoulder caps (deltoids), biceps and triceps, forearms, quads
 * and hamstrings, calves, glutes. They meet at slightly darker ball joints; one smooth torso, an oval
 * head, a satin finish. Same interface as createMannequin; `materials.joint` (optional) colours the
 * joints. Every segment stretches to the pose's own joint positions, so it always fits the data.
 */
function createArticulated(scene, materials, { shadows }) {
  const meshes = [];
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = shadows; scene.add(m); meshes.push(m); return m; };
  const joint = materials.joint || materials.near, jointFar = materials.jointFar || materials.far;
  // A limb turned from a profile [[t, radius], ...]: t runs 0 -> 1 from its first joint to its second
  const lathe = (profile, mat) => add(new THREE.LatheGeometry(profile.map(([t, r]) => new THREE.Vector2(r, t)), 32), mat);
  const ball = (r, mat) => add(new THREE.SphereGeometry(r, 28, 18), mat);
  const blob = (mat) => add(new THREE.SphereGeometry(1, 32, 20), mat);   // scaled into muscles, head, hands

  // Profiles (metres). Kept gentle: the shapes suggest muscle rather than sculpt it.
  const THIGH = [[0, 0.079], [0.12, 0.083], [0.32, 0.08], [0.55, 0.07], [0.78, 0.058], [0.93, 0.052], [1, 0.05]];
  const SHIN = [[0, 0.051], [0.12, 0.053], [0.3, 0.054], [0.52, 0.046], [0.76, 0.037], [0.92, 0.033], [1, 0.032]];
  const UPPER_ARM = [[0, 0.047], [0.18, 0.046], [0.45, 0.044], [0.72, 0.04], [0.9, 0.036], [1, 0.035]];
  const FOREARM = [[0, 0.036], [0.18, 0.039], [0.42, 0.035], [0.72, 0.029], [1, 0.026]];
  // Muscle bellies: [where along the limb, which way (+1 front, -1 back), how far out, half-sizes [front-back, along, across]]
  const MUSCLES = {
    thigh: [["quad", 0.42, 1, 0.022, [0.05, 0.16, 0.058]], ["hamstring", 0.45, -1, 0.017, [0.044, 0.15, 0.05]]],
    shin: [["calf", 0.3, -1, 0.021, [0.04, 0.12, 0.044]]],
    upperArm: [["biceps", 0.52, 1, 0.014, [0.029, 0.1, 0.032]], ["triceps", 0.42, -1, 0.015, [0.03, 0.12, 0.033]]],
  };

  const limbs = {};
  for (const side of ["near", "far"]) {
    const mat = side === "near" ? materials.near : materials.far, jm = side === "near" ? joint : jointFar;
    const L = limbs[side] = {
      thigh: lathe(THIGH, mat), shin: lathe(SHIN, mat), upperArm: lathe(UPPER_ARM, mat), forearm: lathe(FOREARM, mat),
      deltoid: blob(mat),
      foot: add(new THREE.CapsuleGeometry(0.037, LEN.foot - 0.074, 8, 20), materials.shoe),
      hip: ball(0.07, jm), knee: ball(0.052, jm), ankle: ball(0.036, jm),
      shoulder: ball(0.05, jm), elbow: ball(0.038, jm), wrist: ball(0.028, jm),
      hand: blob(mat),
    };
    for (const [seg, list] of Object.entries(MUSCLES)) for (const [name] of list) L[name] = blob(mat);
    L.foot.scale.set(1, 1, 1.12);                              // a little wider than tall
  }
  // One smooth torso: a lathe profile (hips, waist, ribcage, shoulders) in units of hip-to-shoulder
  // length, widened across the body and flattened front to back when posed; glutes behind the pelvis
  const PROFILE = [[0, -0.2], [0.52, -0.18], [0.8, -0.1], [0.9, 0.04], [0.84, 0.2], [0.74, 0.36], [0.8, 0.52],
    [0.95, 0.68], [1, 0.8], [0.93, 0.92], [0.72, 1.01], [0.42, 1.06], [0, 1.08]];
  const torso = add(new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 40), materials.near);
  const glutes = blob(materials.near);
  const neck = lathe([[0, 0.05], [1, 0.043]], materials.near), head = blob(materials.near);

  const Y = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  /** Run a turned limb from a to b (side-view points) at depth z, stretched to fit. */
  const spanFrom = (mesh, a, b, z = 0) => {
    dir.set(b[0] - a[0], b[1] - a[1], 0);
    const len = dir.length() || 1e-3;
    mesh.position.set(a[0], a[1], z);
    mesh.quaternion.setFromUnitVectors(Y, dir.normalize());
    mesh.scale.y = len;
  };
  /**
   * An ellipsoid along a->b at fraction t, pushed `off` metres to the limb's front (+) or back (-),
   * half-sizes [front-back, along, across]. "Front" is the side that faces forward with the limb
   * hanging straight down (quads, biceps), and turns with the limb.
   */
  const belly = (mesh, a, b, t, off, size, z = 0) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
    const fx = -dy / n, fy = dx / n;                            // the limb's front
    mesh.position.set(a[0] + dx * t + fx * off, a[1] + dy * t + fy * off, z);
    mesh.rotation.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2);
    mesh.scale.set(size[0], size[1], size[2]);
  };
  /** An ellipsoid centred at fraction t along a->b, half-sizes [along, front-back, across]. */
  const shape = (mesh, a, b, t, along, depth, across, z = 0) => belly(mesh, a, b, t, 0, [depth, along, across], z);
  const at = (mesh, p, z) => mesh.position.set(p[0], p[1], z);

  function pose(p) {
    for (const side of ["near", "far"]) {
      const s = p[side], L = limbs[side], z = side === "near" ? 1 : -1, zl = z * HIP_W, za = z * SHOULDER_W;
      const segs = { thigh: [p.hip, s.knee, zl], shin: [s.knee, s.ankle, zl], upperArm: [s.shoulder, s.elbow, za], forearm: [s.elbow, s.wrist, za] };
      for (const [seg, [a, b, zz]] of Object.entries(segs)) {
        spanFrom(L[seg], a, b, zz);
        for (const [name, t, sign, off, size] of MUSCLES[seg] || []) belly(L[name], a, b, t, sign * off, size, zz);
      }
      belly(L.deltoid, s.shoulder, s.elbow, 0.1, 0, [0.056, 0.075, 0.058], za);   // the shoulder cap, over the joint
      at(L.hip, p.hip, zl); at(L.knee, s.knee, zl); at(L.ankle, s.ankle, zl);
      at(L.shoulder, s.shoulder, za); at(L.elbow, s.elbow, za); at(L.wrist, s.wrist, za);
      const d = [s.toe[0] - s.heel[0], s.toe[1] - s.heel[1]], n = Math.hypot(d[0], d[1]) || 1;
      const up = [(-d[1] / n) * 0.02, (d[0] / n) * 0.02];      // sole on the heel/toe markers
      L.foot.position.set((s.heel[0] + s.toe[0]) / 2 + up[0], (s.heel[1] + s.toe[1]) / 2 + up[1], z * (HIP_W + 0.005));
      L.foot.rotation.set(0, 0, Math.atan2(d[1], d[0]) - Math.PI / 2);
      const hd = [s.wrist[0] - s.elbow[0], s.wrist[1] - s.elbow[1]], hl = Math.hypot(hd[0], hd[1]) || 1;
      shape(L.hand, s.wrist, [s.wrist[0] + hd[0] / hl, s.wrist[1] + hd[1] / hl], 0.065, 0.055, 0.03, 0.022, za);
    }
    const sh = p.near.shoulder;
    torso.position.set(p.hip[0], p.hip[1], 0);
    torso.rotation.set(0, 0, Math.atan2(sh[1] - p.hip[1], sh[0] - p.hip[0]) - Math.PI / 2);
    torso.scale.set(0.118, Math.hypot(sh[0] - p.hip[0], sh[1] - p.hip[1]), 0.19);   // front-back, length, across
    belly(glutes, p.hip, sh, 0.02, 0.048, [0.068, 0.088, 0.15]);   // behind the pelvis ("front" of an upward segment is its back)
    const neckTop = [sh[0] + (p.head[0] - sh[0]) * 0.62, sh[1] + (p.head[1] - sh[1]) * 0.62];
    spanFrom(neck, sh, neckTop);
    shape(head, sh, p.head, 1.04, 0.118, 0.098, 0.092);          // an oval head, a touch above the joint point
  }

  const parts = { trunk: [torso, glutes], shin: [limbs.near.shin, limbs.near.calf], foot: [limbs.near.foot, limbs.far.foot] };
  return { pose, parts, limbs, meshes };
}
