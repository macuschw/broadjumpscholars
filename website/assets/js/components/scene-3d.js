// Shared pieces of the 3D jump scenes (home hero, demo playback, Metrics figure): the renderer,
// lights, the jump lane with its tape measure, the contact shadow and the mannequin.
// Everything works in the side-view coordinates of data/mock-data.js (x forward, y up, meters);
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

/**
 * Soft sky fill, a key light that casts the shadow, a cool rim from behind. Returns the key light.
 * `studio` (Metrics figure) turns the fill down: the soft studio environment (studioEnvironment)
 * does the modeling there, and the key light mainly casts the shadow.
 */
export function addLights(scene, { studio = false } = {}) {
  scene.add(new THREE.HemisphereLight(0xe6eaf0, 0x0b0b0d, studio ? 0.12 : 1.2));
  const key = new THREE.DirectionalLight(0xffffff, studio ? 2.1 : 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.4, bottom: -1.2, near: 0.5, far: 14 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xc4d2ff, studio ? 0.7 : 0.9);
  rim.position.set(-3, 3.2, -4);
  scene.add(rim);
  return key;
}

/**
 * A photo-studio lighting environment, built in code (no image to download): a dim room with a large
 * softbox overhead, a key box off to one side, a weak fill box opposite and a thin strip light behind.
 * Used as scene.environment, it lights rounded forms with long, soft gradients - the look of a
 * product shot - and gives a satin surface gentle highlights instead of hard specks.
 */
export function studioEnvironment(renderer) {
  const room = new THREE.Scene();
  room.background = new THREE.Color(0x15171a);
  const box = (w, h, x, y, z, glow, lookAt = [0, 1, 0]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(glow, glow, glow), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(...lookAt);
    room.add(m);
  };
  // The key comes from the side, ~60° off the usual camera line: light that grazes a form shows its
  // shape (frontal light flattens it, like a camera flash). The fill opposite is kept weak.
  box(6, 6, 0, 7, 0, 0.7);                   // overhead softbox: a soft top light
  box(4, 5, 5, 3.5, 2.5, 5);                 // key, to the right of the camera: the dominant light
  box(3, 4, -4, 2, 4, 0.22);                 // fill, left of the camera: weak, so shadow sides stay shaded
  box(0.8, 6, -2, 3, -6, 2.2);               // strip light behind: a rim along the back
  box(30, 30, 0, -1.5, 0, 0.08, [0, 5, 0]);  // the floor bounces a little light back up
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.03).texture;
  pmrem.dispose();
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return texture;
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
  // Tick marks: every 10 cm with a long one each half meter, or every 3 in with a long one each foot
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

/** Where the tape's labels go, in the current units: each meter, or every 2 ft. [[x, text], ...] */
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
  if (detailed) return createSculpted(scene, materials, { shadows });
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
 * Smooth sweep geometry for a body part: rings along y (0 -> 1, stretched to the part's length when
 * posed) whose cross-section is an ellipse with separate front, back and side radii, so a calf can
 * swell at the back and a quad at the front in one seamless surface. `rings` lists
 * [t, front, back, side] (meters); between them the radii follow a smooth curve. The front is local
 * -x for limbs (it faces forward with the limb hanging down) and +x for the trunk (`frontX`).
 */
function sweep(rings, { frontX = -1, around = 40, along = 44 } = {}) {
  const smooth = (k, t) => {                                  // Catmull-Rom through the control radii
    let i = 0;
    while (i < rings.length - 2 && rings[i + 1][0] < t) i++;
    const p = (j) => rings[Math.max(0, Math.min(rings.length - 1, j))];
    const t0 = p(i)[0], t1 = p(i + 1)[0], u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    const [a, b, c, d] = [p(i - 1)[k], p(i)[k], p(i + 1)[k], p(i + 2)[k]];
    return 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  };
  const tMin = rings[0][0], tMax = rings[rings.length - 1][0], pos = [], idx = [];
  for (let i = 0; i <= along; i++) {
    const t = tMin + ((tMax - tMin) * i) / along, front = smooth(1, t), back = smooth(2, t), side = smooth(3, t);
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      pos.push(frontX * c * (c >= 0 ? front : back), t, sn * side);
    }
  }
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < around; j++) {
      const r0 = i * (around + 1) + j, r1 = r0 + around + 1;
      // Mirroring the front to -x reverses the winding; keep every face pointing outward either way
      if (frontX > 0) idx.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
      else idx.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Body-part shapes, [t, front, back, side] in meters; t runs from the first joint (0) to the second (1).
// Read against a standing figure: quads at the front of the thigh, calves at the back of the shin,
// the deltoid cap at the top of the upper arm, broad shoulders over a narrow waist.
const SHAPES = {
  thigh: [[0, 0.074, 0.076, 0.08], [0.12, 0.083, 0.081, 0.084], [0.3, 0.088, 0.078, 0.081], [0.5, 0.079, 0.07, 0.072],
    [0.7, 0.064, 0.058, 0.06], [0.86, 0.051, 0.049, 0.051], [1, 0.046, 0.046, 0.047]],
  shin: [[0, 0.046, 0.046, 0.047], [0.1, 0.046, 0.059, 0.051], [0.26, 0.044, 0.07, 0.054], [0.42, 0.04, 0.055, 0.046],
    [0.62, 0.034, 0.037, 0.037], [0.82, 0.028, 0.028, 0.03], [1, 0.027, 0.027, 0.028]],
  upperArm: [[0, 0.052, 0.052, 0.056], [0.12, 0.053, 0.053, 0.06], [0.3, 0.042, 0.045, 0.045], [0.5, 0.047, 0.049, 0.041],
    [0.7, 0.041, 0.042, 0.037], [0.88, 0.034, 0.034, 0.033], [1, 0.032, 0.032, 0.031]],
  forearm: [[0, 0.033, 0.033, 0.034], [0.16, 0.04, 0.037, 0.042], [0.36, 0.037, 0.034, 0.038], [0.62, 0.03, 0.028, 0.031],
    [0.86, 0.025, 0.024, 0.026], [1, 0.022, 0.022, 0.023]],
  // Trunk, hips (t 0) to shoulders (t 1), in units of that length for t; glutes swell the back low down
  trunk: [[-0.2, 0.05, 0.06, 0.09], [-0.1, 0.09, 0.116, 0.145], [0.04, 0.102, 0.126, 0.157], [0.2, 0.097, 0.1, 0.141],
    [0.36, 0.09, 0.09, 0.127], [0.52, 0.098, 0.097, 0.143], [0.66, 0.115, 0.107, 0.168], [0.78, 0.124, 0.112, 0.185],
    [0.9, 0.102, 0.104, 0.193], [1, 0.072, 0.08, 0.164], [1.07, 0.038, 0.04, 0.07]],
  neck: [[0, 0.048, 0.052, 0.05], [1, 0.041, 0.044, 0.043]],
  // Foot, heel to toe: "front" is the top of the foot, "back" the sole
  foot: [[-0.05, 0.022, 0.016, 0.026], [0.06, 0.036, 0.02, 0.036], [0.35, 0.036, 0.019, 0.04], [0.7, 0.027, 0.017, 0.046],
    [0.95, 0.019, 0.015, 0.04], [1.05, 0.01, 0.01, 0.026]],
};

/**
 * The sculpted mannequin (Metrics figure): one smooth, continuous surface per body part, shaped like
 * a sports mannequin - broad shoulders over a narrow waist, quads and hamstrings, calves high on the
 * back of the leg, a deltoid cap over each shoulder - with joints that blend in instead of showing,
 * a featureless egg head and mitten hands. Built for a matte finish under studio light. Same
 * interface as createMannequin; every part stretches to the pose's own joint positions.
 */
function createSculpted(scene, materials, { shadows }) {
  const meshes = [];
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = shadows; scene.add(m); meshes.push(m); return m; };
  const blob = (mat) => add(new THREE.SphereGeometry(1, 40, 28), mat);   // scaled into joints, head, hands
  const geo = Object.fromEntries(Object.entries(SHAPES).map(([k, rings]) => [k, sweep(rings, { frontX: k === "trunk" ? 1 : -1 })]));

  const limbs = {};
  for (const side of ["near", "far"]) {
    const mat = side === "near" ? materials.near : materials.far;
    limbs[side] = {
      thigh: add(geo.thigh, mat), shin: add(geo.shin, mat), upperArm: add(geo.upperArm, mat), forearm: add(geo.forearm, mat),
      foot: add(geo.foot, materials.shoe),
      // Joints in the body's own color, sized to the limb ends, so the surface reads as continuous
      knee: blob(mat), ankle: blob(mat), shoulder: blob(mat), elbow: blob(mat), wrist: blob(mat), hand: blob(mat),
    };
  }
  const torso = add(geo.trunk, materials.near), neck = add(geo.neck, materials.near), head = blob(materials.near);

  const Y = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  /** Stand a unit-length part on point a, pointing at b, stretched to reach it. */
  const span = (mesh, a, b, z = 0) => {
    dir.set(b[0] - a[0], b[1] - a[1], 0);
    const len = dir.length() || 1e-3;
    mesh.position.set(a[0], a[1], z);
    mesh.rotation.set(0, 0, Math.atan2(dir.y, dir.x) - Math.PI / 2);
    mesh.scale.set(1, len, 1);
  };
  const ball = (mesh, p, r, z) => { mesh.position.set(p[0], p[1], z); mesh.scale.setScalar(r); };
  /** An ellipsoid centered at fraction t along a->b, half-sizes [front-back, along, across]. */
  const egg = (mesh, a, b, t, size, z = 0) => {
    mesh.position.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z);
    mesh.rotation.set(0, 0, Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2);
    mesh.scale.set(...size);
  };

  function pose(p) {
    for (const side of ["near", "far"]) {
      const s = p[side], L = limbs[side], z = side === "near" ? 1 : -1, zl = z * HIP_W, za = z * SHOULDER_W;
      span(L.thigh, p.hip, s.knee, zl);
      span(L.shin, s.knee, s.ankle, zl);
      span(L.upperArm, s.shoulder, s.elbow, za);
      span(L.forearm, s.elbow, s.wrist, za);
      ball(L.knee, s.knee, 0.047, zl); ball(L.ankle, s.ankle, 0.029, zl);
      ball(L.shoulder, s.shoulder, 0.054, za); ball(L.elbow, s.elbow, 0.034, za); ball(L.wrist, s.wrist, 0.023, za);
      // Foot: from the heel to the toe markers, its sole on them (they ride ~2 cm above the floor)
      span(L.foot, [s.heel[0], s.heel[1] - 0.005], [s.toe[0], s.toe[1] - 0.005], z * (HIP_W + 0.005));
      const hd = [s.wrist[0] - s.elbow[0], s.wrist[1] - s.elbow[1]], hl = Math.hypot(hd[0], hd[1]) || 1;
      egg(L.hand, s.wrist, [s.wrist[0] + hd[0] / hl, s.wrist[1] + hd[1] / hl], 0.07, [0.022, 0.058, 0.04], za);   // a mitten
    }
    const sh = p.near.shoulder;
    span(torso, p.hip, sh);
    const neckTop = [sh[0] + (p.head[0] - sh[0]) * 0.62, sh[1] + (p.head[1] - sh[1]) * 0.62];
    span(neck, [sh[0] + (p.head[0] - sh[0]) * 0.1, sh[1] + (p.head[1] - sh[1]) * 0.1], neckTop);
    egg(head, sh, p.head, 1.03, [0.095, 0.122, 0.085]);        // featureless egg: taller than wide
  }

  const parts = { trunk: [torso], shin: [limbs.near.shin], foot: [limbs.near.foot, limbs.far.foot] };
  return { pose, parts, limbs, meshes };
}
