// How close Measure live is to the full analysis: replays what the browser's tracker saw on our 13
// test videos (20 jumps, 30 frames a second; tests/data/live_frames.json) through
// website/assets/js/live/detect.js, and compares each jump with the full analysis of the same video
// (tests/data/live_reference.json: takeoff/landing times, toe and heel positions, distance in px,
// and whether it counts: IMG_6233's last 3 are fouls). Exits with 1 if a jump's verdict is wrong.
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
