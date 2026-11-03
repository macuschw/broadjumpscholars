// How close Measure live is to the full analysis: replays what the browser's tracker saw on our 13
// test videos (20 jumps, 30 frames a second; tests/data/live_frames.json) through
// website/assets/js/live/detect.js, and compares each jump with the full analysis of the same video
// (tests/data/live_reference.json: takeoff/landing times, toe and heel positions, distance in px,
// and whether it counts: IMG_6233's last 3 are fouls). Then someone who stays in the picture between
// jumps (at the end). Exits with 1 if a jump's verdict is wrong or a jump after staying is missed.
//
//   node scripts/check_live.mjs              every frame (30 frames a second)
//   node scripts/check_live.mjs 2            every 2nd frame: a phone that tracks 15 a second (3: 10, 4: 7.5)
//   node scripts/check_live.mjs 1 '{"HEEL_S": 0.1}'     detect.js options, to try other choices
// Columns: dToe + = live's toe further back (adds distance), dHeel + = live's heel further on (adds),
// dT0/dT1 = live takeoff/landing time minus the full analysis's, gaps = feet apart (live/full, px).
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const [, , step = "1", opts = "{}"] = process.argv;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { createDetector } = await import(pathToFileURL(ROOT + "website/assets/js/live/detect.js").href);
const live = JSON.parse(fs.readFileSync(ROOT + "tests/data/live_frames.json"));
const ref = JSON.parse(fs.readFileSync(ROOT + "tests/data/live_reference.json"));
const M_PER_PX = 0.00307;                                    // ~ our 1080p videos' scale, for an inches feel
const rows = [];
for (const [name, v] of Object.entries(live)) {
  const found = [];
  const d = createDetector({ onJump: (j) => found.push(j), ...JSON.parse(opts) });
  d.setGeometry({ width: v.width ?? 1920, height: v.height ?? 1080, metersPerPixel: M_PER_PX });   // (our test videos: 1080p)
  v.frames.forEach(([t, flat], i) => {
    if (i % Number(step)) return;
    const pts = flat ? Array.from({ length: 33 }, (_, k) => flat.slice(3 * k, 3 * k + 3)) : null;
    d.feed(t, pts);
  });
  d.flush();
  for (const r of ref[name]) {
    const j = found.find((f) => Math.abs(f.tTakeoff - r.takeoff_s) < 0.5);
    const sgn = r.direction === "left" ? -1 : 1;
    rows.push({ name, t: r.takeoff_s, stagger: r.stagger, valid: r.valid, ref: r.distance_px,
      live: j?.distancePx ?? null,
      dToe: j && r.toe_x != null ? -sgn * (j.toeX - r.toe_x) : null,       // + = live toe behind: adds distance
      dHeel: j && r.heel_x != null ? sgn * (j.heelX - r.heel_x) : null,     // + = live heel ahead: adds distance
      dT0: j ? j.tTakeoff - r.takeoff_s : null, dT1: j ? j.tLanding - r.landing_s : null, unsure: j?.unsure || null,
      foul: j?.foul?.code.replace("foul_", "") ?? null,
      gaps: j ? [j.toeGapPx, r.toe_gap_px, j.heelGapPx, r.heel_gap_px] : null });
  }
  const extra = found.filter((f) => !ref[name].some((r) => Math.abs(f.tTakeoff - r.takeoff_s) < 0.5));
  for (const f of extra) rows.push({ name, t: f.tTakeoff, extra: true, live: f.distancePx });
}
const f1 = (x, n = 1) => (x == null ? "  -  " : x.toFixed(n).padStart(6));
console.log("video                 t    stag  ref_px live_px  err_px  err%   ~in   dToe  dHeel  dT0   dT1  live verdict");
for (const r of rows) {
  if (r.extra) { console.log(`${r.name.padEnd(20)} ${f1(r.t)}  EXTRA (false jump) ${f1(r.live)}`); continue; }
  const e = r.live == null ? null : r.live - r.ref;
  console.log(`${r.name.slice(0, 20).padEnd(20)} ${f1(r.t)}  ${r.stagger ? "st" : "  "}${r.valid ? " " : "F"} ${f1(r.ref)} ${f1(r.live)} ${f1(e)} ${f1(e == null ? null : 100 * e / r.ref)} ${f1(e == null ? null : e * M_PER_PX / 0.0254)} ${f1(r.dToe)} ${f1(r.dHeel)} ${f1(r.dT0, 2)} ${f1(r.dT1, 2)}  ${r.live == null ? "-" : r.foul ? `FOUL ${r.foul}` : "counts"}${r.foul && r.valid ? " (WRONG)" : !r.foul && !r.valid && r.live != null ? " (WRONG: a foul)" : ""}${r.unsure ? ` unsure:${r.unsure}` : ""}  gaps toe ${r.gaps ? r.gaps.slice(0, 2).map((g) => g == null ? "-" : g.toFixed(0)).join("/") : ""} heel ${r.gaps ? r.gaps.slice(2).map((g) => g == null ? "-" : g.toFixed(0)).join("/") : ""}`);
}
const ok = rows.filter((r) => !r.extra && r.live != null && r.valid && r.unsure !== "switched");   // (a clip ending mid-check: "stopped", measured fine)
const err = ok.map((r) => 100 * (r.live - r.ref) / r.ref);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
console.log(`\nfound ${rows.filter((r) => !r.extra && r.live != null).length}/${rows.filter((r) => !r.extra).length}, false ${rows.filter((r) => r.extra).length}; valid jumps: mean err ${mean(err).toFixed(2)}%  sd ${sd(err).toFixed(2)}%  mean |err| ${mean(err.map(Math.abs)).toFixed(2)}%  worst ${Math.max(...err.map(Math.abs)).toFixed(2)}%`);
console.log(`mean dToe ${mean(ok.map((r) => r.dToe)).toFixed(1)} px, mean dHeel ${mean(ok.map((r) => r.dHeel)).toFixed(1)} px`);
const judged = rows.filter((r) => !r.extra && r.live != null), wrong = judged.filter((r) => !!r.foul === r.valid);
console.log(`verdicts: ${judged.length - wrong.length}/${judged.length} right (fouls caught ${judged.filter((r) => !r.valid && r.foul).length}/${judged.filter((r) => !r.valid).length}, valid jumps called fouls ${judged.filter((r) => r.valid && r.foul).length})`);
if (wrong.length) process.exitCode = 1;

// Someone who doesn't clear the picture after a jump. A jump, the jumper moves around in the shot, then
// the same jump again: both must be found, the same size, and nothing false in between. (Real sessions:
// live got stuck on "In the air" until the jumper left the picture, and missed the jumps after a foul.)
const unflat = (flat) => (flat ? Array.from({ length: 33 }, (_, k) => flat.slice(3 * k, 3 * k + 3)) : null);
const clip = live.IMG_6199.frames.map(([t, f]) => [t, unflat(f)]).filter(([t]) => t >= 2);   // a jump, ~3 s lead-in
const pose = clip[0][1];
const known = ref.IMG_6199[0].distance_px;
const ys = pose.filter((p) => p[2] > 0.5).map((p) => p[1]), H = Math.max(...ys) - Math.min(...ys);
const footY = Math.max(...[29, 30, 31, 32].map((i) => pose[i][1])), hipX = pose[23][0];
// the pose further from (dy < 0, smaller) or nearer to the camera, with its feet moved dy body heights up or down the picture
const moved = (dy, p = pose) => p.map(([x, y, v]) => [hipX + (x - hipX) * (1 + 0.8 * dy), footY + (y - footY) * (1 + 0.8 * dy) + dy * H, v]);
const hold = (s, p) => Array.from({ length: Math.round(s * 30) }, () => p);
const walk = (s, a, b) => Array.from({ length: Math.round(s * 30) }, (_, i) => moved(a + (b - a) * (i + 1) / Math.round(s * 30)));
const legsLost = pose.map(([x, y, v], i) => (i >= 25 ? [x, y - 0.4 * H, 0.3] : [x, y, v]));
const crouch = moved(0, pose.map(([x, y, v]) => [x, footY + (y - footY) * 0.55, v]));
const STAY = {
  "stands still": hold(4, pose),
  "walks further from the camera, stays there": [...walk(1, 0, -0.15), ...hold(8, moved(-0.15)), ...walk(1, -0.15, 0), ...hold(3, pose)],
  "walks nearer, then back past the start": [...walk(1, 0, 0.3), ...hold(3, moved(0.3)), ...walk(1.5, 0.3, -0.15), ...hold(8, moved(-0.15)), ...walk(1, -0.15, 0), ...hold(3, pose)],
  "crouches, gets up further back": [...hold(1, crouch), ...walk(0.5, 0, -0.2), ...hold(5, moved(-0.2)), ...walk(1, -0.2, 0), ...hold(3, pose)],
  "legs out of the picture for a while": [...hold(5, legsLost), ...hold(3, pose)],
};
let stayBad = 0;
console.log("\nstaying in the picture between two jumps:");
for (const [label, between] of Object.entries(STAY)) {
  const found = [];
  let air = false;
  const d = createDetector({ onJump: (j) => found.push(j), onState: (s) => { air = s === "air"; } });
  d.setGeometry({ width: 1920, height: 1080, metersPerPixel: M_PER_PX });
  let t = 0, i = 0, airAfter = false;
  const feed = (pts) => { t += 1 / 30; if (i++ % Number(step) === 0) d.feed(t, pts); };
  clip.forEach(([, p]) => feed(p));
  between.forEach(feed);
  airAfter = air;
  clip.forEach(([, p]) => feed(p));
  d.flush();
  const ok = found.length === 2 && !airAfter && found.every((j) => Math.abs(j.distancePx - known) / known < 0.05);
  if (!ok) stayBad++;
  console.log(`  ${ok ? "ok   " : "WRONG"} ${label}: ${found.length} jumps (${found.map((j) => j.distancePx.toFixed(0)).join(", ")} px, full analysis ${known.toFixed(0)})${airAfter ? ', stuck on "In the air"' : ""}`);
}
// ...and after a foul: IMG_6233's last jumps fail; the jumper stays in the shot, moves, and jumps again
{
  const frames = live.IMG_6233.frames.map(([t, f]) => [t, unflat(f)]);
  const refs = ref.IMG_6233, foulAt = refs.filter((r) => !r.valid);
  for (const r of foulAt) {
    const found = [];
    const d = createDetector({ onJump: (j) => found.push(j) });
    d.setGeometry({ width: 1920, height: 1080, metersPerPixel: M_PER_PX });
    let t = 0, i = 0;
    const feed = (t1, pts) => { t = t1; if (i++ % Number(step) === 0) d.feed(t, pts); };
    const seg = frames.filter(([tt]) => tt >= r.takeoff_s - 3 && tt <= r.takeoff_s + 3);
    seg.forEach(([tt, p]) => feed(tt, p));
    let tt = t;
    for (const p of [...walk(1, 0.1, -0.15), ...hold(4, moved(-0.15)), ...walk(1, -0.15, 0), ...hold(3, pose)]) feed(tt += 1 / 30, p);
    clip.forEach(([, p]) => feed(tt += 1 / 30, p));
    d.flush();
    const ok = found.length === 2 && found[0].foul && !found[1].foul && Math.abs(found[1].distancePx - known) / known < 0.05;
    if (!ok) stayBad++;
    console.log(`  ${ok ? "ok   " : "WRONG"} after a foul (${r.takeoff_s.toFixed(1)} s): ${found.map((j) => `${j.foul ? j.foul.code.replace("foul_", "") : "counts"} ${j.distancePx.toFixed(0)} px`).join(", ") || "nothing found"}`);
  }
}
if (stayBad) process.exitCode = 1;
