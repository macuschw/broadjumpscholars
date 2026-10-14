// 2D jump stage: the flat side-view athlete, used when 3D can't load (offline, no WebGL).
// Same interface as the 3D stage, so the timeline drives either one.
import { svg } from "../lib/dom.js";
import { Athlete, lerpPose } from "./athlete.js";
import { createScene, pathFrom } from "./scene.js";

export function createStage2D(host, attempt) {
  const { frames, events } = attempt, last = frames.length - 1;
  const scene = createScene(host, { xRange: [-0.75, 2.85], yMax: 2.15, below: 20, theme: "dark" });
  const { map, layers, pxPerM } = scene;
  scene.root.classList.add("jump-stage__svg");
  const flight = frames.slice(events.takeoff, events.landing + 1).map((f) => f.hip);
  layers.back.append(svg("path", { class: "scene-arc scene-arc--todo", d: pathFrom(map, flight) }));
  const done = svg("path", { class: "scene-arc" });
  layers.back.append(done);
  const athlete = new Athlete(layers.front, map, { theme: "dark", pxPerM });
  return {
    element: scene.root,
    setPos(pos) {
      const p = Math.max(0, Math.min(last, pos)), i = Math.floor(p), u = p - i;
      const pose = u > 1e-6 ? lerpPose(frames[i].pose, frames[i + 1].pose, u) : frames[i].pose;
      athlete.update(pose);
      const shown = i >= events.takeoff ? [...flight.slice(0, Math.min(i, events.landing) - events.takeoff + 1)] : [];
      if (i >= events.takeoff && i < events.landing) shown.push(pose.hip);
      done.setAttribute("d", shown.length > 1 ? pathFrom(map, shown) : "");
    },
    dispose() { scene.root.remove(); },
  };
}
