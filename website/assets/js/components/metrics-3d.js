// Metrics figure in 3D: the sample athlete at takeoff on the same lane as the home hero, with the
// selected metric drawn into the scene where it comes from on the body:
//   distance - a dimension line on the floor from the takeoff toe to the landing heel (landing ghost)
//   velocity - forward, upward and resultant arrows from the hips, with their parallelogram
//   launch   - the launch angle against the horizontal, and the peak height above takeoff
//   trunk / shin - the segment's lean from vertical, as an arc
//   contact  - the lowest point of the dip as a ghost, and a timeline of the ground phases
// Lines are drawn over the body (like a diagram) and labelled with callouts in the site's type,
// each joined to the exact point it describes. Choosing a metric glides the camera to frame it;
// "Side" is level and side-on - what the phone sees, where every angle reads true. Dragging (or the
// rotate buttons / arrow keys) turns the camera all the way round; the chosen angle holds as metrics
// change. Callouts are placed by world direction (behind, ahead, above, below the athlete), so they
// stay on the right side from any angle, push apart instead of overlapping, and keep clear of the
// buttons; lines drawn in the side-on plane fade back when seen edge-on, where they would mislead.
// Rendering happens only while something is still moving. Under reduced motion, nothing glides.
import {
  THREE, C, HIP_W, TAPE_Z, addLights, aimKeyLight, createContactShadow, createLane, createMannequin, createRenderer, tapeMarks,
} from "./scene-3d.js";
import { fmt } from "../lib/dom.js";
import { formatQuantity, onUnitsChange } from "../lib/units.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const TAU = { camera: 0.3, fade: 0.14 };                      // smoothing time constants (s): ~3τ to settle
const DONE = { x: 0.002, y: 0.002, d: 0.004, az: 0.0015, el: 0.0015 };   // camera gaps too small to see (m, rad)
const TAU_DRAG = 0.07;                                         // the camera follows a drag closely
const PITCH = [0.03, 1.05];                                    // free camera: just above the floor to 60° up
const DIRS = { left: [-1, 0], right: [1, 0], above: [0, 1], below: [0, -1] };   // label sides, in the side view
const wrap = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const VIEW = { "3d": { az: 0.42, el: 0.17 }, side: { az: 0, el: 0.02 } };   // camera angles (rad)
const COL = { halo: C.ink, key: C.accent, main: 0xd9d5cc, ref: 0x8a8e95, shoe: 0x8d8a84 };
const BASE = { halo: 0.55, key: 1, main: 0.95, ref: 0.8 };    // overlay opacity by line kind; halo: the dark outline
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const TOP = 0.12;                                            // extra headroom: the view buttons sit top right

export function createMetricsFigure3D(host, attempt, { reducedMotion = false, onContextLost } = {}) {
  const { frames, events, metrics: m } = attempt;
  const TO = frames[events.takeoff], LAND = frames[events.landing], PEAK = frames[events.peak], LOW = frames[events.bottom];
  const toeX = frames[events.onset].pose.near.toe[0], heelX = toeX + m.distance;   // exactly the measured distance

  const { renderer, canvas, release } = createRenderer({ className: "mx3d__canvas", onContextLost });
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.ink, 5.5, 13);
  const camera = new THREE.PerspectiveCamera(30, 16 / 10, 0.05, 60);
  const key = addLights(scene, { modelling: true });          // stronger shading, so the anatomy reads
  const { markTape, landMark } = createLane(scene, { landingX: heelX });
  markTape();
  const shadow = createContactShadow(scene);

  // ---- the athlete at takeoff: the articulated mannequin in a satin finish, darker ball joints.
  //      Shoes are neutral here, so the accent only ever marks the metric ----
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...extra });
  const satin = (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.5 });
  const athlete = createMannequin(scene, {
    near: satin(C.body), far: satin(C.bodyFar), shoe: std(COL.shoe, { roughness: 0.6 }), joint: std(0x9d998f, { roughness: 0.45 }), jointFar: std(0x7e7a73, { roughness: 0.45 }),
  }, { detailed: true });
  athlete.pose(TO.pose);
  shadow.follow(TO.pose);
  aimKeyLight(key, TO.hip[0]);
  // Parts that can light up get their own material, so each fades to the accent on its own
  const hot = {};
  for (const [part, meshes] of Object.entries(athlete.parts)) {
    hot[part] = meshes.map((mesh) => {
      mesh.material = mesh.material.clone();
      return { mesh, base: mesh.material.color.clone() };
    });
  }
  const accent = new THREE.Color(C.accent);

  // ---- see-through ghosts: the landing (distance) and the lowest point of the dip (contact) ----
  const ghostMat = () => std(C.body, { transparent: true, opacity: 0, roughness: 0.7 });
  const ghosts = {};
  for (const [name, frame] of [["landing", LAND], ["dip", LOW]]) {
    const mats = { near: ghostMat(), far: ghostMat(), shoe: ghostMat() };
    const g = createMannequin(scene, mats, { shadows: false, detailed: true });
    g.pose(frame.pose);
    g.meshes.forEach((mesh) => { mesh.renderOrder = 2; });     // after the solid athlete
    ghosts[name] = { mats: Object.values(mats), meshes: g.meshes };
  }

  // ---- the flight: dots along the hip's arc ----
  const pathIdx = [];
  for (let i = events.takeoff; i <= events.landing; i += 2) pathIdx.push(i);
  const pathMat = new THREE.MeshBasicMaterial({ color: C.pathTodo });
  const path = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 10, 8), pathMat, pathIdx.length);
  const tmp = new THREE.Matrix4();
  pathIdx.forEach((i, k) => path.setMatrixAt(k, tmp.makeTranslation(frames[i].hip[0], frames[i].hip[1], 0)));
  scene.add(path);

  // ---- overlay kit: tubes, dotted lines, arcs and arrows, drawn over the body ----
  function kit(r) {
    const group = new THREE.Group();
    const mats = Object.fromEntries(Object.keys(BASE).map((k) => [k, new THREE.MeshBasicMaterial({
      color: COL[k], transparent: true, opacity: 0, depthTest: false, depthWrite: false })]));
    const add = (geo, kind) => { const mesh = new THREE.Mesh(geo, mats[kind]); mesh.renderOrder = kind === "halo" ? 9 : 10; group.add(mesh); return mesh; };
    const ball = (p, kind, rad = r * 1.9) => { const b = add(new THREE.SphereGeometry(rad, 16, 12), kind); b.position.copy(p); return b; };
    const HALO = 2.3;                                          // outline width, as a multiple of the line's
    const tube = (curveOf, segs, ends, kind, rad) => {
      for (const [k2, w] of [["halo", rad * HALO], [kind, rad]]) {
        add(new THREE.TubeGeometry(curveOf, segs, w, 10, false), k2);
        ends.forEach((e) => ball(e, k2, w));                   // round ends
      }
    };
    const line = (a, b, kind, rad = r) => tube(new THREE.LineCurve3(a, b), 1, [a, b], kind, rad);
    const curve = (pts, kind, rad = r) => tube(new THREE.CatmullRomCurve3(pts), 48, [pts[0], pts[pts.length - 1]], kind, rad);
    const dotted = (a, b, kind, gap = r * 5.5) => {
      const n = Math.max(2, Math.round(a.distanceTo(b) / gap));
      const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(r * 1.05, 10, 8), mats[kind], n + 1);
      for (let i = 0; i <= n; i++) dots.setMatrixAt(i, tmp.makeTranslation(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, a.z + ((b.z - a.z) * i) / n));
      dots.renderOrder = 10;
      group.add(dots);
    };
    const arc = (c, rad, a0, a1, kind, width = r) => {
      const pts = Array.from({ length: 33 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / 32; return V(c.x + rad * Math.cos(a), c.y + rad * Math.sin(a), c.z); });
      curve(pts, kind, width);
      return V(c.x + rad * Math.cos((a0 + a1) / 2), c.y + rad * Math.sin((a0 + a1) / 2), c.z);   // its midpoint, for a label
    };
    const arrow = (a, b, kind, rad = r) => {
      const dir = b.clone().sub(a), len = dir.length(), head = Math.min(len * 0.35, rad * 9);
      dir.normalize();
      line(a, a.clone().addScaledVector(dir, len - head * 0.9), kind, rad);
      for (const [k2, grow] of [["halo", 1.45], [kind, 1]]) {
        const cone = add(new THREE.ConeGeometry(rad * 3.4 * grow, head * grow, 20), k2);
        cone.position.copy(a).addScaledVector(dir, len - head / 2);
        cone.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
      }
    };
    scene.add(group);
    return { group, mats, ball, line, curve, dotted, arc, arrow };
  }

  // ---- one overlay per metric: what is drawn, where the camera looks, what the labels say ----
  const H = V(TO.hip[0], TO.hip[1]);                            // hips (centre of mass stand-in) at takeoff
  const bodyPts = (p) => [p.hip, p.head, ...["near", "far"].flatMap((s) => Object.values(p[s]))];
  const overlays = {};
  function build(id, frameBox, r, draw, { planar = true } = {}) {
    const k = kit(r);
    const labels = draw(k) || [];
    overlays[id] = { ...k, labels, frameBox, planar, now: 0, goal: 0 };
  }

  build("distance", { pts: [[toeX - 0.55, 0], [heelX + 0.45, 0], ...bodyPts(TO.pose), ...bodyPts(LAND.pose)], pad: [0.06, 0.2], el: 0.3, lift: 0.09 }, 0.0085, (k) => {
    const z = 0.4, y = 0.012, a = V(toeX, y, z), b = V(heelX, y, z);
    k.line(a, b, "key");
    for (const x of [toeX, heelX]) {
      k.line(V(x, y, z - 0.07), V(x, y, z + 0.07), "key");      // end ticks
      k.dotted(V(x, y, HIP_W + 0.04), V(x, y, z - 0.08), "ref");   // from the foot out to the dimension line
    }
    return [
      { at: V((toeX + heelX) / 2, y, z), side: "above", gap: 34, value: () => formatQuantity("distance", m.distance), name: "Jump distance", key: true },
      { at: V(toeX, y, HIP_W), side: "left", gap: 30, name: "Takeoff toe" },
      { at: V(heelX, y, HIP_W), side: "right", gap: 30, name: "Landing heel" },
    ];
  }, { planar: false });                                         // on the floor, readable from any side

  const kv = 0.22;                                               // metres of arrow per m/s
  const vxTip = V(H.x + m.vx * kv, H.y), vyTip = V(H.x, H.y + m.vy * kv), vTip = V(H.x + m.vx * kv, H.y + m.vy * kv);
  build("velocity", { pts: [...bodyPts(TO.pose), [vTip.x + 0.55, vTip.y + 0.1], [H.x - 0.55, H.y]], pad: [0.08, 0.1], az: 0.28 }, 0.0075, (k) => {
    k.dotted(vxTip, vTip, "ref"); k.dotted(vyTip, vTip, "ref");    // the parallelogram: the two parts add up
    k.arrow(H, vxTip, "main"); k.arrow(H, vyTip, "main");
    k.arrow(H, vTip, "key", 0.0105);
    k.ball(H, "key", 0.02);
    return [
      { at: vTip, side: "right", gap: 26, value: () => formatQuantity("speed", m.speed), name: "Takeoff speed", key: true },
      { at: vxTip, side: "below", gap: 26, value: () => formatQuantity("speed", m.vx), name: "Forward" },
      { at: vyTip, side: "left", gap: 30, value: () => formatQuantity("speed", m.vy), name: "Upward" },
    ];
  });

  const theta = Math.atan2(m.vy, m.vx), reach = 0.62, peakTop = V(PEAK.hip[0], H.y + m.peakHeight);
  build("launch", { pts: [...bodyPts(TO.pose), [H.x + 0.95, H.y - 0.5], [peakTop.x + 0.4, peakTop.y + 0.5]], pad: [0.08, 0.08], az: 0.28 }, 0.0075, (k) => {
    k.dotted(H, V(Math.max(H.x + reach + 0.12, peakTop.x + 0.2), H.y), "ref");   // the horizontal, at takeoff height
    k.arrow(H, V(H.x + reach * Math.cos(theta), H.y + reach * Math.sin(theta)), "key", 0.0095);
    const mid = k.arc(H, 0.3, 0, theta, "key", 0.0065);
    k.line(V(peakTop.x, H.y), peakTop, "main");
    for (const y of [H.y, peakTop.y]) k.line(V(peakTop.x - 0.045, y), V(peakTop.x + 0.045, y), "main");
    k.ball(H, "key", 0.02);
    return [
      { at: mid, side: "below", gap: 52, value: () => `${fmt(m.launchAngle, 1)}°`, name: "Launch angle", key: true },
      { at: peakTop, side: "above", narrow: "right", gap: 52, value: () => `+${formatQuantity("short", m.peakHeight)}`, name: "Peak height" },
    ];
  });

  const S = TO.pose.near.shoulder;
  build("trunk", { pts: [...bodyPts(TO.pose), [H.x - 0.7, H.y + 0.3]], pad: [0.08, 0.08], az: 0.28 }, 0.007, (k) => {
    const up = V(H.x, H.y + 0.72), len = 0.72, dir = V(S[0] - H.x, S[1] - H.y).normalize();
    k.dotted(H, up, "ref");
    k.line(H, H.clone().addScaledVector(dir, len), "main");
    const mid = k.arc(H, 0.42, Math.PI / 2, Math.atan2(dir.y, dir.x), "key", 0.0075);
    k.ball(H, "key", 0.016);
    return [{ at: mid, side: "left", gap: 46, value: () => `${Math.round(m.trunkTakeoff)}°`, name: "Trunk angle", key: true }];
  });

  const A = TO.pose.near.ankle, K = TO.pose.near.knee;
  build("shin", { pts: [...bodyPts(TO.pose), [A[0] - 0.7, A[1] + 0.25], [A[0], -0.05]], pad: [0.08, 0.08], az: 0.28 }, 0.0065, (k) => {
    const a = V(A[0], A[1], HIP_W), dir = V(K[0] - A[0], K[1] - A[1]).normalize();
    k.dotted(a, V(a.x, a.y + 0.56, HIP_W), "ref");
    k.line(a, a.clone().addScaledVector(dir, 0.56), "main");
    const mid = k.arc(a, 0.3, Math.PI / 2, Math.atan2(dir.y, dir.x), "key", 0.0075);
    k.ball(a, "key", 0.014);
    return [{ at: mid, side: "left", gap: 44, value: () => `${Math.round(m.shinTakeoff)}°`, name: "Shin angle", key: true }];
  });

  build("contact", { pts: [...bodyPts(TO.pose), ...bodyPts(LOW.pose), [TO.hip[0] - 0.7, 0], [TO.hip[0] + 0.7, 0]], pad: [0.1, 0.34], lift: 0.12 }, 0.006, () => [
    { at: V(LOW.hip[0], LOW.hip[1]), side: "left", gap: 40, name: "Lowest point" },
    { at: V(TO.hip[0], TO.hip[1]), side: "right", gap: 40, name: "Takeoff" },
  ]);

  // What each metric shows besides its overlay
  const SCENE = {
    distance: { ghost: "landing", parts: ["foot"], path: true, mark: true, tape: true },
    velocity: { path: true },
    launch: { path: true },
    trunk: { parts: ["trunk"] },
    shin: { parts: ["shin"] },
    contact: { ghost: "dip", parts: ["foot"] },
  };

  // ---- HTML layers: callout labels with leader lines, tape labels, and the ground-contact timeline ----
  const stage = document.createElement("div");
  stage.className = "mx3d__layers";
  stage.setAttribute("aria-hidden", "true");
  const leaders = document.createElementNS(SVG_NS, "svg");
  leaders.setAttribute("class", "mx3d__leaders");
  const tags = document.createElement("div");
  tags.className = "mx3d__tags";
  const tapeLayer = document.createElement("div");
  tapeLayer.className = "mx3d__tape";
  const timeline = buildTimeline(attempt);
  stage.append(tapeLayer, leaders, tags, timeline);
  host.append(canvas, stage);

  let tape = [];
  function labelTape() {
    tape = tapeMarks().map(([x, text]) => {
      const el = document.createElement("span");
      el.className = "jump-stage__label";
      el.textContent = text;
      return { el, at: V(x, 0, TAPE_Z + 0.09) };
    });
    tapeLayer.replaceChildren(...tape.map((t) => t.el));
  }
  labelTape();

  let live = [];                                                 // the callouts on screen now
  function showLabels(id) {
    const specs = overlays[id].labels;
    tags.replaceChildren();
    leaders.replaceChildren();
    live = specs.map((spec) => {
      const el = document.createElement("div");
      el.className = `mx3d-tag${spec.key ? " mx3d-tag--key" : ""}${spec.value ? "" : " mx3d-tag--note"}`;
      el.innerHTML = (spec.value ? `<span class="mx3d-tag__value">${spec.value()}</span>` : "") + `<span class="mx3d-tag__name">${spec.name}</span>`;
      const line = document.createElementNS(SVG_NS, "line");
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("r", spec.key ? 3.5 : 2.5);
      for (const n of [line, dot]) n.setAttribute("class", spec.key ? "is-key" : "");
      tags.append(el);
      leaders.append(line, dot);
      return { spec, el, line, dot, w: 0, h: 0 };
    });
    for (const l of live) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
  }

  // ---- camera: frame each metric's points, from the chosen angle ----
  let view = "3d", current = null, width = 0, height = 0;
  let free = false, yaw = 0, pitch = 0;                        // free: the visitor has turned the camera
  const goal = { x: 0, y: 1, d: 5, az: VIEW["3d"].az, el: VIEW["3d"].el };
  const now = { ...goal };
  function frameGoal(id) {
    const { pts, pad, el = VIEW["3d"].el, az = VIEW["3d"].az, lift = 0 } = overlays[id].frameBox;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const w = (x1 - x0) * (1 + 2 * pad[0]), h = (y1 - y0) * (1 + 2 * pad[1] + TOP);
    const tv = Math.tan((camera.fov * Math.PI) / 360), th = tv * (width / Math.max(1, height) || 1.6);
    const a = free ? { az: yaw, el: pitch } : view === "side" ? VIEW.side : { az, el };
    Object.assign(goal, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + (TOP / 2) * (y1 - y0) - lift * h, d: Math.max(w / 2 / th, h / 2 / tv) / Math.cos(a.el * 0.5), az: a.az, el: a.el });
  }

  function resize() {
    // Measure the canvas's own box: on phones it sits below a strip for the view buttons
    const w = Math.max(1, Math.round(canvas.clientWidth || host.clientWidth)), h = Math.max(1, Math.round(canvas.clientHeight || host.clientHeight));
    if (w === width && h === height) return false;
    width = w; height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    leaders.setAttribute("viewBox", `0 0 ${w} ${h}`);
    if (current) { frameGoal(current); now.d = goal.d; }       // a new shape refits at once, no glide
    for (const l of live) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
    return true;
  }

  const projected = new THREE.Vector3();
  const toScreen = (v) => {
    projected.copy(v).project(camera);
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height, ok: projected.z < 1 };
  };
  function placeLabels() {
    for (const t of tape) {
      const p = toScreen(t.at);
      t.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, 0)`;
      t.el.style.opacity = p.ok && p.x > -20 && p.x < width + 20 ? "" : "0";
    }
    // 1. Where each callout wants to be: beside its point, toward its side of the athlete. Sides are
    //    world directions (behind, ahead, up, down), so after turning the camera round the "behind"
    //    callout is still behind the athlete. If that direction points at the camera, use the screen side.
    const narrow = width < 480, boxes = [];
    for (const l of live) {
      const a = toScreen(l.spec.at), sideName = (narrow && l.spec.narrow) || l.spec.side, g = narrow ? l.spec.gap * 0.7 : l.spec.gap;
      const [wx, wy] = DIRS[sideName];
      const tip = toScreen(l.spec.at.clone().add(V(wx * 0.25, wy * 0.25)));
      let ux = tip.x - a.x, uy = tip.y - a.y, len = Math.hypot(ux, uy);
      if (len < 6) { ux = wx; uy = -wy; len = 1; }            // looking straight along it
      ux /= len; uy /= len;
      const tx = a.x + ux * g, ty = a.y + uy * g;
      const across = Math.abs(ux) >= Math.abs(uy) * 0.8;      // mostly sideways: box beside; else above/below
      boxes.push({ l, a, key: l.spec.key, w: l.w, h: l.h,
        x: across ? (ux > 0 ? tx : tx - l.w) : tx - l.w / 2,
        y: across ? ty - l.h / 2 : (uy > 0 ? ty : ty - l.h) });
    }
    // 2. Keep clear of each other, the buttons and the timeline; stay inside the figure
    const box = canvas.getBoundingClientRect(), keepOut = [...host.querySelectorAll(".jump-stage__views, .mx3d-timeline.is-on")].map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
    }).filter((r) => r.w && r.y < height && r.y + r.h > 0);
    const M = 8, push = (b, o, share) => {                      // move b out of o along the shorter way
      const dx1 = o.x + o.w + M - b.x, dx2 = b.x + b.w + M - o.x, dy1 = o.y + o.h + M - b.y, dy2 = b.y + b.h + M - o.y;
      if (dx1 <= 0 || dx2 <= 0 || dy1 <= 0 || dy2 <= 0) return false;
      const m = Math.min(dx1, dx2, dy1, dy2);
      if (m === dy1) b.y += m * share; else if (m === dy2) b.y -= m * share; else if (m === dx1) b.x += m * share; else b.x -= m * share;
      return true;
    };
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [p1, p2] = boxes[i].key ? [boxes[j], boxes[i]] : [boxes[i], boxes[j]];   // the key callout gives way least
          if (push(p1, p2, 0.75)) { push(p2, p1, 0.25); moved = true; }
        }
        for (const o of keepOut) moved = push(boxes[i], o, 1) || moved;
      }
      for (const b of boxes) {
        b.x = Math.max(M, Math.min(width - b.w - M, b.x));
        b.y = Math.max(M, Math.min(height - b.h - M, b.y));
      }
      if (!moved) break;
    }
    // 3. Draw: the box, and a leader from the point to the nearest edge of the box
    for (const { l, a, x, y } of boxes) {
      l.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      const ex = Math.max(x, Math.min(x + l.w, a.x)), ey = Math.max(y, Math.min(y + l.h, a.y));
      const show = a.ok && Math.hypot(ex - a.x, ey - a.y) > 6;
      Object.entries({ x1: a.x, y1: a.y, x2: ex, y2: ey }).forEach(([k2, v]) => l.line.setAttribute(k2, v.toFixed(1)));
      l.line.style.display = show ? "" : "none";
      l.dot.setAttribute("cx", a.x.toFixed(1)); l.dot.setAttribute("cy", a.y.toFixed(1));
    }
  }

  function aim() {
    const R = now.d;
    camera.position.set(now.x + R * Math.cos(now.el) * Math.sin(now.az), now.y + R * Math.sin(now.el), R * Math.cos(now.el) * Math.cos(now.az));
    camera.lookAt(now.x, now.y, 0);
    camera.updateMatrixWorld();
  }

  // ---- smoothing loop: camera, overlays, ghosts and highlights ease to their goals, then it stops ----
  const fades = { ghostLanding: { now: 0, goal: 0 }, ghostDip: { now: 0, goal: 0 }, foot: { now: 0, goal: 0 }, trunk: { now: 0, goal: 0 },
    shin: { now: 0, goal: 0 }, path: { now: 0, goal: 0 }, mark: { now: 0, goal: 0 } };
  let raf = 0, last = 0, snap = true;
  function step(time) {
    const dt = last ? Math.min(0.05, (time - last) / 1000) : 1 / 60;
    last = time;
    const k = (tau) => (snap || reducedMotion ? 1 : 1 - Math.exp(-dt / tau));
    let moving = false;
    for (const key2 of ["x", "y", "d", "az", "el"]) {
      const gap = goal[key2] - now[key2], tau = free && (key2 === "az" || key2 === "el") ? TAU_DRAG : TAU.camera;
      now[key2] = Math.abs(gap) < DONE[key2] ? goal[key2] : now[key2] + gap * k(tau);   // close enough to look still: stop
      moving ||= now[key2] !== goal[key2];
    }
    const ease = (o) => { const gap = o.goal - o.now; o.now = Math.abs(gap) < 0.004 ? o.goal : o.now + gap * k(TAU.fade); moving ||= o.now !== o.goal; };
    // Lines in the side-on plane fade back as the camera turns edge-on to it (they'd collapse into slivers)
    const facing = Math.abs(Math.cos(now.el) * Math.cos(now.az));
    const planeVis = 0.18 + 0.82 * Math.min(1, Math.max(0, (facing - 0.12) / 0.38));
    for (const o of Object.values(overlays)) {
      ease(o);
      for (const [kind, mat] of Object.entries(o.mats)) mat.opacity = o.now * BASE[kind] * (o.planar ? planeVis : 1);
      o.group.visible = o.now > 0.005;
    }
    Object.values(fades).forEach(ease);
    for (const [name, f] of [["landing", fades.ghostLanding], ["dip", fades.ghostDip]]) {
      ghosts[name].mats.forEach((mat) => { mat.opacity = 0.24 * f.now; });
      ghosts[name].meshes.forEach((mesh) => { mesh.visible = f.now > 0.01; });
    }
    for (const part of Object.keys(hot)) {
      hot[part].forEach(({ mesh, base }) => {
        mesh.material.color.copy(base).lerp(accent, 0.62 * fades[part].now);       // a tint, so the accent lines stay distinct on it
        mesh.material.emissive.copy(accent).multiplyScalar(0.12 * fades[part].now);   // a faint glow, so it reads in shadow too
      });
    }
    pathMat.color.set(C.pathTodo).lerp(accent, fades.path.now);
    landMark.material.opacity = fades.mark.now;
    landMark.visible = fades.mark.now > 0.01;
    tapeLayer.style.opacity = String(Math.max(0.0, fades.mark.now));
    snap = false;
    resize();
    aim();
    renderer.render(scene, camera);
    placeLabels();
    if (!moving) { last = 0; return; }
    raf = requestAnimationFrame(step);
  }
  const update = () => { cancelAnimationFrame(raf); step(performance.now()); };

  const stopUnits = onUnitsChange(() => { markTape(); labelTape(); if (current) showLabels(current); update(); });
  const ro = "ResizeObserver" in window ? new ResizeObserver(() => update()) : null;
  ro?.observe(host);

  return {
    element: canvas,
    /** Show one metric: its overlay, labels, ghost and highlighted parts; the camera glides to frame it. */
    show(id) {
      if (!overlays[id] || id === current) return;
      current = id;
      resize();
      const s = SCENE[id];
      for (const [oid, o] of Object.entries(overlays)) o.goal = oid === id ? 1 : 0;
      fades.ghostLanding.goal = s.ghost === "landing" ? 1 : 0;
      fades.ghostDip.goal = s.ghost === "dip" ? 1 : 0;
      for (const part of Object.keys(hot)) fades[part].goal = s.parts?.includes(part) ? 1 : 0;
      fades.path.goal = s.path ? 1 : 0;
      fades.mark.goal = s.tape ? 1 : 0;
      timeline.classList.toggle("is-on", id === "contact");
      frameGoal(id);
      showLabels(id);
      host.dataset.metric = id;
      update();
    },
    /** "3d" (three-quarter, the default) or "side" (level, side-on: angles read true). Leaves a free orbit. */
    setView(next) {
      view = next === "side" ? "side" : "3d";
      if (free) {
        free = false;
        const az = view === "side" ? VIEW.side.az : (overlays[current]?.frameBox.az ?? VIEW["3d"].az);
        now.az = az + wrap(now.az - az);                       // glide back the short way round, never a full spin
      }
      if (current) frameGoal(current);
      update();
    },
    /** Turn the camera around the athlete by dYaw / dPitch radians. The angle holds as metrics change. */
    orbit(dYaw, dPitch = 0) {
      if (!free) { free = true; yaw = now.az; pitch = now.el; }
      yaw += dYaw;
      pitch = Math.min(PITCH[1], Math.max(PITCH[0], pitch + dPitch));
      goal.az = yaw;
      goal.el = pitch;
      update();
    },
    get orbiting() { return free; },
    dispose() {
      stopUnits();
      ro?.disconnect();
      cancelAnimationFrame(raf);
      shadow.texture.dispose();
      release(scene);
      stage.remove();
    },
  };
}

/** Ground contact as a strip along the bottom: dip, push-off (the key part), then flight to landing. */
function buildTimeline(a) {
  const { frames, events: e, metrics: m } = a, t = (i) => frames[i].t;
  const t0 = t(e.onset), span = t(e.landing) - t0, pct = (i) => (((t(i) - t0) / span) * 100).toFixed(2);
  const el = document.createElement("div");
  el.className = "mx3d-timeline";
  el.innerHTML = `
    <div class="mx3d-timeline__brace" style="left:0;width:${pct(e.takeoff)}%"><span><b>${fmt(m.contactTime, 2)} s</b> Ground contact</span></div>
    <div class="mx3d-timeline__track">
      <span class="mx3d-timeline__seg mx3d-timeline__seg--dip" style="left:0;width:${pct(e.bottom)}%"></span>
      <span class="mx3d-timeline__seg mx3d-timeline__seg--push" style="left:${pct(e.bottom)}%;width:${(pct(e.takeoff) - pct(e.bottom)).toFixed(2)}%"></span>
      <span class="mx3d-timeline__seg mx3d-timeline__seg--flight" style="left:${pct(e.takeoff)}%;right:0"></span>
    </div>
    <div class="mx3d-timeline__marks">
      <span style="left:0">Dip starts</span>
      <span class="is-key" style="left:${pct(e.bottom)}%"><b>${fmt(m.pushOff, 2)} s</b> Push-off</span>
      <span style="left:${pct(e.takeoff)}%">Takeoff</span>
      <span class="is-end" style="left:100%">Landing</span>
    </div>`;
  return el;
}
