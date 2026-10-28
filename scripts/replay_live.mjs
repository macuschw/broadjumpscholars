#!/usr/bin/env node
// Replay a "Save tracking data" file from Measure live (website/assets/js/live/live.js) through the
// live jump detector, and compare every jump with the tape measurements typed in on the phone.
//
//   node scripts/replay_live.mjs jumplab-live-track-2026-10-27-15-30.json [more files...]
//   node scripts/replay_live.mjs --detector path/to/detect.js FILE   (try a changed detector)
//
// For each jump: the distance shown live, the replayed distance (should match unless the detector
// changed), the tape, the error in inches and percent, and a foul if the replay calls one (stepped
// forward or back, hand down, fell); then the mean error (bias) and spread.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INCH = 0.0254, FOOT = 0.3048;
const args = process.argv.slice(2);
let detPath = resolve(dirname(fileURLToPath(import.meta.url)), "../website/assets/js/live/detect.js");
const at = args.indexOf("--detector");
if (at >= 0) { detPath = resolve(args[at + 1]); args.splice(at, 2); }
if (!args.length) { console.error("Usage: node scripts/replay_live.mjs [--detector detect.js] TRACK.json ..."); process.exit(1); }
const { createDetector } = await import(pathToFileURL(detPath).href);

/** "7 ft 2 in", "7' 2\"", "7-2", "86 in", "86\"", "2.18 m", "218 cm", "2,18" -> meters (null if unreadable). */
export function parseTape(text) {
  const s = String(text || "").trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  let m;
  if ((m = s.match(/^([\d.]+)\s*cm$/))) return +m[1] / 100;
  if ((m = s.match(/^([\d.]+)\s*m$/))) return +m[1];
  if ((m = s.match(/^([\d.]+)\s*(?:in|inches|"|'')$/))) return +m[1] * INCH;
  if ((m = s.match(/^(\d+)\s*(?:ft|feet|foot|')\s*(?:([\d.]+)\s*(?:in|inches|"|'')?)?\s*$/))) return +m[1] * FOOT + (+m[2] || 0) * INCH;
  if ((m = s.match(/^(\d+)\s*-\s*([\d.]+)$/))) return +m[1] * FOOT + +m[2] * INCH;
  if ((m = s.match(/^([\d.]+)$/))) return +m[1] < 4 ? +m[1] : +m[1] * INCH;   // a bare number: meters if small, else inches
  return null;
}
const inches = (m) => m / INCH;
const ftIn = (m) => { const t = Math.round(inches(m) * 2) / 2; return `${Math.floor(t / 12)}' ${(t % 12).toFixed(1)}"`; };

const all = [];
for (const file of args) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!String(data.format || "").startsWith("jumplab-live-track/")) { console.error(`${file}: not a live tracking file`); continue; }
  const replayed = [];
  const det = createDetector({ onJump: (j) => replayed.push(j) });
  for (const [t, pts] of data.frames) det.feed(t, pts);
  det.flush();
  const cam = data.camera || {};
  console.log(`\n${file}\n  camera: ${cam.label || "?"} ${cam.width}x${cam.height}, ${data.measured_fps ?? cam.fps ?? "?"} fps tracked, ` +
    `${data.frames.length} frames, 1 px = ${(data.scale_m_per_px * 1000).toFixed(2)} mm`);
  console.log("  jump   live      replay    tape      error");
  for (const j of data.jumps) {
    const r = replayed.find((x) => Math.abs(x.tTakeoff - j.tTakeoff) < 0.3);
    const again = r ? r.distancePx * data.scale_m_per_px : null;
    const tape = parseTape(j.tape);
    const err = tape ? j.meters - tape : null;
    if (err != null && !j.unsure) all.push({ err, tape });
    console.log(`  ${String(j.n).padEnd(5)}  ${ftIn(j.meters).padEnd(8)}  ${again == null ? "missed  " : ftIn(again).padEnd(8)}  ` +
      `${tape ? ftIn(tape).padEnd(8) : (j.tape ? `?${j.tape}`.padEnd(8) : "-".padEnd(8))}  ` +
      `${err == null ? "" : `${err >= 0 ? "+" : ""}${inches(err).toFixed(1)} in (${err >= 0 ? "+" : ""}${(err / tape * 100).toFixed(1)}%)`}${j.unsure ? "  unsure" : ""}` +
      `${(r?.foul ?? j.foul) ? `  FOUL ${(r?.foul ?? j.foul).code.replace("foul_", "")}` : ""}`);
  }
  const extra = replayed.filter((r) => !data.jumps.some((j) => Math.abs(r.tTakeoff - j.tTakeoff) < 0.3));
  if (extra.length) console.log(`  replay found ${extra.length} jump(s) that weren't shown live (detector changed?)`);
}
if (all.length) {
  const e = all.map((a) => inches(a.err)), mean = e.reduce((a, b) => a + b, 0) / e.length;
  const sd = Math.sqrt(e.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, e.length - 1));
  const pct = all.map((a) => a.err / a.tape * 100), meanPct = pct.reduce((a, b) => a + b, 0) / pct.length;
  console.log(`\n${all.length} jumps with a tape (unsure ones left out): mean error ${mean >= 0 ? "+" : ""}${mean.toFixed(1)} in ` +
    `(${meanPct >= 0 ? "+" : ""}${meanPct.toFixed(1)}%), spread (SD) ${sd.toFixed(1)} in, worst ${Math.max(...e.map(Math.abs)).toFixed(1)} in`);
}
