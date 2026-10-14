// A simple 2-D body model (side view, metres, y up, +x = jump direction).
// Segment angles are measured from VERTICAL, forward-positive - the same convention the
// JumpLab analysis uses for trunk and shin angle.

export const SEG = { shin: 0.43, thigh: 0.45, trunk: 0.5, upperArm: 0.3, forearm: 0.27 };
const FOOT = { toe: [0.17, -0.06], heel: [-0.07, -0.06] };   // relative to the ankle, foot flat
const RAD = Math.PI / 180;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const scale = (a, k) => [a[0] * k, a[1] * k];
export const rot = ([x, y], rad) => [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)];

/** Unit vector at `deg` from vertical, leaning forward when positive. */
export const up = (deg) => [Math.sin(deg * RAD), Math.cos(deg * RAD)];
/** Arm direction: 0 = hanging straight down, 90 = pointing forward, 180 = straight up. */
const armDir = (deg) => [Math.sin(deg * RAD), -Math.cos(deg * RAD)];

/** Heel and toe from the ankle. footDeg > 0 = heel raised (toes pointing down). */
export const feetFromAnkle = (ankle, footDeg) => ({
  toe: add(ankle, rot(FOOT.toe, -footDeg * RAD)),
  heel: add(ankle, rot(FOOT.heel, -footDeg * RAD)),
});
export const ankleFromToe = (toe, footDeg) => add(toe, rot(scale(FOOT.toe, -1), -footDeg * RAD));
export const ankleFromHeel = (heel, footDeg) => add(heel, rot(scale(FOOT.heel, -1), -footDeg * RAD));

/** Knee from the hip and a planted ankle (two-bone inverse kinematics), bending forward.
 *  `reach` is how far apart hip and ankle are as a share of the full leg length (1 = straight). */
export function kneeIK(hip, ankle) {
  const c = sub(ankle, hip), d = Math.hypot(c[0], c[1]);
  const a = SEG.thigh, b = SEG.shin;
  const cosB = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  return { knee: add(hip, scale(rot(scale(c, 1 / d), Math.acos(cosB)), a)), reach: d / (a + b) };
}

/** Leg from the hip down (in the air). */
export function legDown(hip, a) {
  const knee = sub(hip, scale(up(a.thigh), SEG.thigh));
  const ankle = sub(knee, scale(up(a.shin), SEG.shin));
  return { knee, ankle, ...feetFromAnkle(ankle, a.foot) };
}

/** Trunk, head and one arm from the hip. */
export function upperBody(hip, a) {
  const shoulder = add(hip, scale(up(a.trunk), SEG.trunk));
  const neck = add(hip, scale(up(a.trunk), SEG.trunk + 0.05));
  const head = add(hip, scale(up(a.trunk + 6), SEG.trunk + 0.17));
  const elbow = add(shoulder, scale(armDir(a.arm), SEG.upperArm));
  const wrist = add(elbow, scale(armDir(a.arm + a.elbow), SEG.forearm));
  return { shoulder, neck, head, elbow, wrist };
}

/** Angle ABC at joint b, 0-180 deg (180 = straight). */
export function jointAngle(a, b, c) {
  const v1 = sub(a, b), v2 = sub(c, b);
  const cross = v1[0] * v2[1] - v1[1] * v2[0], dot = v1[0] * v2[0] + v1[1] * v2[1];
  return Math.atan2(Math.abs(cross), dot) / RAD;
}

/** Angle of the vector a->b from vertical, forward-positive. */
export const fromVertical = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]) / RAD;
