// ============================================================================
//  JumpLab mock data - the ONLY source of numbers shown on this site.
//  Everything here is SIMULATED demo data, not results from a real athlete.
//  A simple body model performs a standing broad jump. The hip (the site's stand-in for
//  the centre of mass) follows one smooth path: a countermovement dip, a push-off that
//  ends at exactly the takeoff velocity, a projectile flight, and a landing that brakes
//  it to a stop. Feet stay planted on the ground and the knees are solved to fit, so
//  nothing slides, floats or jumps between frames. Poses, charts and stats all come
//  from this one simulation, so they agree.
// ============================================================================
import {
  add, ankleFromHeel, ankleFromToe, feetFromAnkle, fromVertical, jointAngle, kneeIK, legDown, SEG,
  up, upperBody,
} from "../lib/body.js";

export const DEMO_LABEL = "Demo data";
export const DEMO_NOTICE =
  "Simulated sample data for demonstration. These are not results from a real athlete or a real video.";
export const FPS = 120;
const G = 9.81;
const MARKER_H = 0.02;                       // foot markers sit ~2 cm above the floor
const FAR_DX = 0.04;                         // far foot sits 4 cm ahead in the image (depth cue)

// --- smooth curves ---------------------------------------------------------------
/** Monotone cubic through keyframes [[t, value], ...]. Velocity is continuous, values never
 *  overshoot, and the motion comes to rest at every turning point, like a joint reversing. */
function curve(kf) {
  const n = kf.length, t = kf.map((k) => k[0]), v = kf.map((k) => k[1]);
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h[i] = t[i + 1] - t[i]; d[i] = (v[i + 1] - v[i]) / h[i]; }
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] > 0) {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  const end = (h0, h1, d0, d1) => {                        // shape-preserving end slope
    if (h1 === undefined) return d0;
    const s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(s) !== Math.sign(d0)) return 0;
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) return 3 * d0;
    return s;
  };
  m[0] = kf[0][2] ?? end(h[0], h[1], d[0], d[1]);          // optional explicit start slope
  m[n - 1] = end(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  return (x) => {
    if (x <= t[0]) return v[0];
    if (x >= t[n - 1]) return v[n - 1];
    let i = 0;
    while (x > t[i + 1]) i++;
    const s = (x - t[i]) / h[i];
    return hermite(s, h[i], v[i], m[i], v[i + 1], m[i + 1]);
  };
}

/** Cubic Hermite at s in [0, 1] over a span of T seconds: matches position AND velocity at both ends. */
function hermite(s, T, p0, v0, p1, v1) {
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * T * v0 + (3 * s2 - 2 * s3) * p1 + (s3 - s2) * T * v1;
}
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
/** Landing brake: starts at speed v0 and slows to rest over D seconds, hardest at impact
 *  (speed falls as (1 - s)^2). Total travel is v0 * D / 3. */
const brake = (t, D, v0) => { const s = clamp01(t / D); return v0 * D * (s - s * s + (s * s * s) / 3); };

const PHASES = ["Stance", "Countermovement", "Propulsion", "Flight", "Landing"];

/** Simulate one attempt frame by frame. */
function simulate(p) {
  const { tOn, tBot, tTO, vx, vy } = p;
  const toe0 = [0, MARKER_H];                                   // takeoff toe on the takeoff line (x = 0)

  // ---- key hip positions, built from the body so every pose is reachable ----
  const ankleFlat = ankleFromToe(toe0, 0);
  const legLen = SEG.thigh + SEG.shin;
  const chord = (kneeDeg) => Math.sqrt(SEG.thigh ** 2 + SEG.shin ** 2 - 2 * SEG.thigh * SEG.shin * Math.cos(kneeDeg * Math.PI / 180));
  const pStand = add(ankleFlat, [0.03, chord(174)]);
  const pBot = add(ankleFlat, [p.botAhead, p.botHeight]);
  const vBot = [p.vxBot, 0];                                    // lowest point: moving forward, not down
  const ankleTO = ankleFromToe(toe0, p.footTO);
  const pTO = add(ankleTO, up(p.legLean).map((c) => c * chord(p.kneeTO)));

  // ---- landing: the pose at touchdown fixes when and where the heel lands ----
  const LAND = { thigh: -56, shin: -18, foot: -14 };
  const heelOff = legDown([0, 0], LAND).heel;                   // heel relative to the hip at touchdown
  const drop = pTO[1] + heelOff[1] - MARKER_H;
  const T = (vy + Math.sqrt(vy * vy + 2 * G * drop)) / G;       // exact flight time of the hip
  const tLe = tTO + T;
  const pLand = [pTO[0] + vx * T, pTO[1] + vy * T - 0.5 * G * T * T];
  const vLand = [vx, vy - G * T];
  const heelFixed = [pLand[0] + heelOff[0], MARKER_H];
  const BRAKE_X = 0.42, BRAKE_Y = 0.22;                         // seconds to absorb forward / downward speed
  const tRise = tLe + 0.36, end = tLe + 0.95;

  function hipAt(t) {
    if (t <= tOn) return pStand;
    if (t <= tBot) {
      const s = (t - tOn) / (tBot - tOn), D = tBot - tOn;
      return [hermite(s, D, pStand[0], 0, pBot[0], vBot[0]), hermite(s, D, pStand[1], 0, pBot[1], 0)];
    }
    if (t <= tTO) {
      const s = (t - tBot) / (tTO - tBot), D = tTO - tBot;
      return [hermite(s, D, pBot[0], vBot[0], pTO[0], vx), hermite(s, D, pBot[1], 0, pTO[1], vy)];
    }
    if (t < tLe) { const tau = t - tTO; return [pTO[0] + vx * tau, pTO[1] + vy * tau - 0.5 * G * tau * tau]; }
    const tau = t - tLe, r = smooth((t - tRise) / (end - 0.15 - tRise));
    return [pLand[0] + brake(tau, BRAKE_X, vLand[0]) + 0.03 * r, pLand[1] + brake(tau, BRAKE_Y, vLand[1]) + 0.13 * r];
  }

  // ---- upper body: trunk lean and arm swing (degrees; see lib/body.js) ----
  const trunk = curve([[0, 3], [tOn, 4], [tBot - 0.02, p.trunkBottom], [tTO, p.trunkTO], [tTO + 0.45 * T, p.trunkTO - 6],
    [tLe, p.trunkTO + 8], [tLe + 0.22, p.trunkTO + 24], [end - 0.15, 16], [end, 16]]);
  const arm = curve([[0, 0], [tOn, -4], [tBot - 0.05, -62], [tTO + 0.01, 146], [tTO + 0.5 * T, 104], [tLe, 72],
    [tLe + 0.24, 58], [end - 0.15, 22], [end, 22]]);
  const elbow = curve([[0, 8], [tBot, 22], [tTO, 12], [tTO + 0.5 * T, 30], [tLe, 24], [end, 14]]);

  // ---- feet while planted: heel rises through push-off; after landing the foot rolls flat ----
  const dP = tTO - tBot;
  const footPush = curve([[0, 0], [tBot + 0.3 * dP, 0], [tBot + 0.62 * dP, 0.3 * p.footTO], [tTO, p.footTO]]);
  const footLand = curve([[tLe, LAND.foot], [tLe + 0.07, 0], [end, 0]]);

  // ---- legs in flight: start exactly at the takeoff pose, end exactly at the landing pose ----
  const kTO = kneeIK(pTO, ankleTO).knee;
  const thighTO = fromVertical(kTO, pTO), shinTO = fromVertical(ankleTO, kTO);
  // The knee folds first (heel kicks up), so the toes clear the floor as the thigh swings through
  const fly = {
    thigh: curve([[tTO, thighTO, 0], [tTO + 0.45 * T, -88], [tLe, LAND.thigh]]),
    shin: curve([[tTO, shinTO], [tTO + 0.2 * T, shinTO + 8], [tTO + 0.45 * T, 26], [tLe, LAND.shin]]),
    foot: curve([[tTO, p.footTO], [tTO + 0.45 * T, 6], [tLe, LAND.foot]]),
  };

  const n = Math.round(end * FPS) + 1;
  const frames = [];
  let maxReach = 0;
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    const hip = hipAt(t);
    const a = { trunk: trunk(t), arm: arm(t), elbow: elbow(t) };
    let near, footDeg;
    if (t <= tTO || t >= tLe) {                                 // planted: feet fixed, knee solved
      footDeg = t <= tTO ? footPush(t) : footLand(t);
      const ankle = t <= tTO ? ankleFromToe(toe0, footDeg) : ankleFromHeel(heelFixed, footDeg);
      const ik = kneeIK(hip, ankle);
      maxReach = Math.max(maxReach, ik.reach);
      near = { ankle, knee: ik.knee, ...feetFromAnkle(ankle, footDeg) };
    } else {                                                    // airborne: leg hangs from the hip
      footDeg = fly.foot(t);
      near = legDown(hip, { thigh: fly.thigh(t), shin: fly.shin(t), foot: footDeg });
    }
    // Far leg: the foot moves with the near foot (two-footed jump), offset slightly for depth
    const farAnkle = add(near.ankle, [FAR_DX, 0]);
    const farIK = kneeIK(hip, farAnkle);
    maxReach = Math.max(maxReach, farIK.reach);
    const far = { ankle: farAnkle, knee: farIK.knee, ...feetFromAnkle(farAnkle, footDeg) };

    const top = upperBody(hip, a);
    const farTop = upperBody(hip, { ...a, arm: a.arm - 12, elbow: a.elbow + 6 });
    frames.push({
      i, t, hip,
      pose: {
        head: top.head, neck: top.neck, hip,
        near: { ...near, hip, shoulder: top.shoulder, elbow: top.elbow, wrist: top.wrist },
        far: { ...far, hip, shoulder: farTop.shoulder, elbow: farTop.elbow, wrist: farTop.wrist },
      },
      trunk: a.trunk,
      shin: fromVertical(near.ankle, near.knee),
      knee: jointAngle(hip, near.knee, near.ankle),
    });
  }
  if (maxReach > 1.0001) console.warn(`${p.id}: a leg was asked to reach ${(maxReach * 100).toFixed(1)}% of its length`);

  // ---- events (frame numbers, as the real pipeline reports them) ----
  const onset = Math.round(tOn * FPS);
  const takeoff = frames.findIndex((f) => f.t > tTO);           // first airborne frame
  const landing = frames.findIndex((f) => f.t >= tLe);          // first frame with a heel down
  let bottom = onset;
  for (let i = onset; i < takeoff; i++) if (frames[i].hip[1] < frames[bottom].hip[1]) bottom = i;
  let peak = takeoff;
  for (let i = takeoff; i < landing; i++) if (frames[i].hip[1] > frames[peak].hip[1]) peak = i;

  frames.forEach((f) => {
    f.phase = f.i < onset ? PHASES[0] : f.i < bottom ? PHASES[1] : f.i < takeoff ? PHASES[2] : f.i < landing ? PHASES[3] : PHASES[4];
  });

  const metrics = {
    distance: heelFixed[0] - toe0[0],                     // takeoff toe -> landing heel (m)
    vx, vy, speed: Math.hypot(vx, vy),
    launchAngle: (Math.atan2(vy, vx) * 180) / Math.PI,
    peakHeight: (vy * vy) / (2 * G),
    flightTime: (landing - takeoff) / FPS,
    contactTime: (takeoff - onset) / FPS,
    pushOff: (takeoff - bottom) / FPS,
    trunkTakeoff: frames[takeoff].trunk,
    shinTakeoff: shinTO,
    kneeTakeoff: p.kneeTO,
    cmDepth: pStand[1] - pBot[1],
  };
  return { ...p, fps: FPS, frames, events: { onset, bottom, takeoff, peak, landing }, metrics };
}

// --- demo attempts ------------------------------------------------------------
// vx, vy: takeoff velocity (m/s). legLean: ankle-to-hip lean at takeoff, kneeTO: knee angle at
// takeoff, footTO: heel raise at takeoff (deg). botAhead/botHeight: hip at the lowest point,
// relative to the ankle (m); vxBot: forward speed there. Times in seconds from the clip start;
// each takeoff instant falls halfway between two frames, which is what the analysis assumes.
const PARAMS = [
  { id: "a1", label: "Attempt 1", vx: 2.72, vy: 1.66, legLean: 31, kneeTO: 161, footTO: 54, trunkTO: 35, trunkBottom: 57,
    botAhead: 0.03, botHeight: 0.6, vxBot: 0.7, tOn: 0.28, tBot: 0.8, tTO: 128.5 / FPS },
  { id: "a2", label: "Attempt 2", vx: 2.86, vy: 1.72, legLean: 33, kneeTO: 165, footTO: 57, trunkTO: 31, trunkBottom: 62,
    botAhead: 0.04, botHeight: 0.58, vxBot: 0.8, tOn: 0.3, tBot: 0.78, tTO: 124.5 / FPS },
  { id: "a3", label: "Attempt 3", vx: 2.8, vy: 1.58, legLean: 31, kneeTO: 163, footTO: 55, trunkTO: 37, trunkBottom: 55,
    botAhead: 0.03, botHeight: 0.6, vxBot: 0.75, tOn: 0.32, tBot: 0.76, tTO: 120.5 / FPS },
];

export const ATTEMPTS = PARAMS.map(simulate);
export const SAMPLE = ATTEMPTS[1];            // the "sample jump" used across the site
export const ATHLETE = { name: "Demo athlete", session: "Sample session" };

/** The six headline metrics, as shown on stat cards and the Metrics page. */
export function headline(attempt) {
  const m = attempt.metrics;
  return [
    { id: "distance", label: "Jump distance", value: m.distance, unit: "m", digits: 2,
      sub: "Takeoff toe to landing heel" },
    { id: "velocity", label: "Takeoff velocity", value: m.speed, unit: "m/s", digits: 2,
      sub: `Horizontal ${m.vx.toFixed(2)} · Vertical ${m.vy.toFixed(2)}` },
    { id: "launch", label: "Launch angle", value: m.launchAngle, unit: "°", digits: 1,
      sub: `Peak height +${(m.peakHeight * 100).toFixed(0)} cm` },
    { id: "trunk", label: "Trunk angle", value: m.trunkTakeoff, unit: "°", digits: 0,
      sub: "Forward lean at takeoff" },
    { id: "shin", label: "Shin angle", value: m.shinTakeoff, unit: "°", digits: 0,
      sub: "Forward lean at takeoff" },
    { id: "contact", label: "Ground contact", value: m.contactTime, unit: "s", digits: 2,
      sub: `Push-off ${m.pushOff.toFixed(2)} s` },
  ];
}

/** Key moments: takeoff, peak and landing. */
export function keyMoments(attempt) {
  const f = attempt.frames, e = attempt.events;
  return [["Takeoff", e.takeoff], ["Peak", e.peak], ["Landing", e.landing]].map(([name, i]) => ({
    name, frame: i, time: f[i].t, hipHeight: f[i].hip[1], trunk: f[i].trunk, shin: f[i].shin, knee: f[i].knee,
  }));
}

/**
 * The flight as a pose tracker would report it: the hip in every airborne frame plus a few
 * millimetres of simulated tracking noise (seeded, so it is identical on every visit).
 * Time runs from the takeoff instant, half a frame before the first airborne frame.
 */
export function trackedFlight(attempt, { noise = 0.005, seed = SCIENCE_SEED } = {}) {
  let state = seed >>> 0;
  const rand = () => {                                       // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const { frames, events, fps } = attempt;
  const t0 = frames[events.takeoff].t - 0.5 / fps;
  return frames.slice(events.takeoff, events.landing).map((f) => ({
    frame: f.i, t: f.t - t0, x: f.hip[0] + noise * gauss(), y: f.hip[1] + noise * gauss(),
  }));
}
const SCIENCE_SEED = 7;

// --- PLACEHOLDER validation table (no real study yet); used by the parked Accuracy page
export const VALIDATION_PLACEHOLDER = {
  note: "Placeholder layout. These rows show how results will be reported once a validation study is complete; the numbers are illustrative, not measured.",
  rows: [
    { metric: "Jump distance", reference: "Tape measure (official rule)", n: "—", bias: "± — cm", limits: "— to — cm" },
    { metric: "Flight time", reference: "Hand-labelled video frames", n: "—", bias: "± — ms", limits: "— to — ms" },
    { metric: "Takeoff / landing frame", reference: "Hand-labelled video frames", n: "—", bias: "± — frames", limits: "— to — frames" },
    { metric: "Trunk & shin angle", reference: "Marker-based motion capture", n: "—", bias: "± — °", limits: "— to — °" },
    { metric: "Takeoff velocity", reference: "Force plate", n: "—", bias: "± — m/s", limits: "— to — m/s" },
  ],
};
