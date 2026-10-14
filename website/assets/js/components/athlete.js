// Bold, flat athlete figure drawn from a pose (see data/mock-data.js).
// Thick rounded limbs, solid head; the far-side arm and leg are drawn in a quieter tone
// for depth. Elements are built once and updated per frame, so playback stays cheap.
import { svg } from "../lib/dom.js";

const WIDTH = { thigh: 0.13, shin: 0.105, foot: 0.07, upperArm: 0.085, forearm: 0.072, trunk: 0.24 };
export const THEMES = {
  light: { near: "#16171a", far: "#b3afa6", head: "#16171a" },
  dark: { near: "#f3f1ec", far: "#5d6167", head: "#f3f1ec" },
};

/** A pose part-way between two neighbouring frames (u = 0..1), so slow motion stays fluid
 *  between the 120 fps samples. */
export function lerpPose(a, b, u) {
  const L = (p, q) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  const side = (s, t) => Object.fromEntries(Object.keys(s).map((k) => [k, L(s[k], t[k])]));
  return { head: L(a.head, b.head), neck: L(a.neck, b.neck), hip: L(a.hip, b.hip), near: side(a.near, b.near), far: side(a.far, b.far) };
}

/** Map metres (y up) to SVG pixels (y down). */
export function makeMap({ pxPerM, originPx, heightPx }) {
  return ([x, y]) => [originPx[0] + x * pxPerM, heightPx - originPx[1] - y * pxPerM];
}

export class Athlete {
  constructor(parent, map, { theme = "light", pxPerM = 200 } = {}) {
    this.map = map;
    this.k = pxPerM;
    const c = THEMES[theme];
    this.g = svg("g", { class: "ath", "aria-hidden": "true" });
    const seg = (part, side) => {
      const line = svg("line", {
        "data-part": part, "data-side": side, stroke: side === "far" ? c.far : c.near,
        "stroke-width": WIDTH[part] * pxPerM, "stroke-linecap": "round",
      });
      this.g.append(line);
      return line;
    };
    // Draw order: far limbs, trunk + head, near limbs (near arm on top)
    this.el = {
      far: { upperArm: seg("upperArm", "far"), forearm: seg("forearm", "far"), thigh: seg("thigh", "far"),
             shin: seg("shin", "far"), foot: seg("foot", "far") },
      trunk: seg("trunk", "mid"),
    };
    this.el.head = svg("circle", { "data-part": "head", r: 0.11 * pxPerM, fill: c.head });
    this.g.append(this.el.head);
    this.el.near = { thigh: seg("thigh", "near"), shin: seg("shin", "near"), foot: seg("foot", "near"),
                     upperArm: seg("upperArm", "near"), forearm: seg("forearm", "near") };
    this.el.trunk.setAttribute("stroke", c.near);
    parent.append(this.g);
  }

  update(pose) {
    const m = this.map;
    const set = (line, a, b) => {
      const [x1, y1] = m(a), [x2, y2] = m(b);
      line.setAttribute("x1", x1); line.setAttribute("y1", y1);
      line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    };
    for (const side of ["far", "near"]) {
      const s = pose[side], e = this.el[side];
      set(e.thigh, s.hip, s.knee); set(e.shin, s.knee, s.ankle); set(e.foot, s.heel, s.toe);
      set(e.upperArm, s.shoulder, s.elbow); set(e.forearm, s.elbow, s.wrist);
    }
    // Trunk: from just above the hip to the shoulder, so the thick stroke reads as a torso
    const h = pose.hip, sh = pose.near.shoulder;
    set(this.el.trunk, [h[0] + (sh[0] - h[0]) * 0.08, h[1] + (sh[1] - h[1]) * 0.08], sh);
    const [hx, hy] = m(pose.head);
    this.el.head.setAttribute("cx", hx); this.el.head.setAttribute("cy", hy);
  }

  /** Highlight body parts, e.g. highlight(["shin"]) or highlight([]) to clear. */
  highlight(parts = []) {
    this.g.querySelectorAll("[data-part]").forEach((n) => {
      const hot = parts.includes(n.dataset.part) && n.dataset.side !== "far";
      n.classList.toggle("is-hot", hot);
    });
  }
}
