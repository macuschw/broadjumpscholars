// A side-view jump scene: ground, takeoff line and a meter scale, with layers to draw into.
// Used by the home hero, the Metrics figure and the demo playback.
import { svg } from "../lib/dom.js";
import { makeMap } from "./athlete.js";

export function createScene(host, { xRange = [-0.7, 2.6], yMax = 1.75, width = 640, theme = "light", label, ground = true, below = 34 } = {}) {
  const pxPerM = width / (xRange[1] - xRange[0]);
  const groundPx = below;                      // room under the ground line (dimensions, timelines)
  const height = Math.round(yMax * pxPerM + groundPx);
  const map = makeMap({ pxPerM, originPx: [-xRange[0] * pxPerM, groundPx], heightPx: height });
  const root = svg("svg", {
    viewBox: `0 0 ${width} ${height}`, class: `scene scene--${theme}`,
    role: label ? "img" : false, "aria-label": label || false, "aria-hidden": label ? false : "true",
  });
  const layers = { back: svg("g"), mid: svg("g"), front: svg("g") };
  if (ground) {
    const [gx0, gy] = map([xRange[0], 0]);
    const [gx1] = map([xRange[1], 0]);
    layers.back.append(svg("line", { class: "scene-ground", x1: gx0, x2: gx1, y1: gy, y2: gy }));
    const [tx] = map([0, 0]);
    layers.back.append(svg("line", { class: "scene-takeoff", x1: tx, x2: tx, y1: gy - 2, y2: gy + 16 }));
  }
  root.append(layers.back, layers.mid, layers.front);
  host.append(root);
  return { root, map, pxPerM, layers, width, height };
}

/** Polyline through meter points. */
export const pathFrom = (map, pts) => pts.map((p, i) => `${i ? "L" : "M"}${map(p).map((v) => v.toFixed(1)).join(",")}`).join("");
