// Tape check: each live distance next to the tape measurement typed in for it (on the phone or
// the remote screen), kept on this device. It shows how far off live measuring is with your
// setup, can be downloaded as a table, and, once there are enough, can correct live distances.
//
// An entry: { key: "<session>:<jump>", at, session, n, live_m, tape_m, full_m, toe_gap_cm,
//             heel_gap_cm, fps, unsure, device }   (full_m: filled in when "Get the full data" runs here)
const KEY = "jl-tape-log", FIX = "jl-tape-fix";
export const MIN_FOR_FIX = 5;                  // tape checks needed before a correction is offered

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked: nothing kept */ }
  window.dispatchEvent(new CustomEvent("jl-tape-change"));
}
export const entries = () => load();

/** Add or update the entry for (session, n): only the fields given change. */
export function record(session, n, fields) {
  const list = load(), key = `${session}:${n}`;
  const i = list.findIndex((e) => e.key === key);
  const entry = { ...(i >= 0 ? list[i] : { key, at: new Date().toISOString(), session, n }), ...fields };
  if (i >= 0) list[i] = entry; else list.push(entry);
  save(list);
  return entry;
}
/** The full analysis of a live session's recording: its distances join the tape checks made here. */
export function addFull(session, n, meters) {
  if (load().some((e) => e.key === `${session}:${n}`)) record(session, n, { full_m: meters });
}
export function clear() { save([]); }

/** How live compares with the tape: the median and spread of tape - live (meters). */
export function summary(list = load()) {
  const d = list.filter((e) => e.tape_m > 0 && e.live_m > 0 && !e.unsure).map((e) => e.tape_m - e.live_m).sort((a, b) => a - b);
  if (!d.length) return null;
  const mid = d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, d.length - 1));
  return { count: d.length, median: mid, mean, sd, worst: Math.max(...d.map(Math.abs)) };
}

/** The correction for live distances: on only when chosen and there are enough tape checks. */
export function correction() {
  const s = summary();
  let on = false;
  try { on = localStorage.getItem(FIX) === "on"; } catch { /* off */ }
  return { on: on && !!s && s.count >= MIN_FOR_FIX, offset: s ? s.median : 0, available: !!s && s.count >= MIN_FOR_FIX, summary: s };
}
export function setCorrection(on) {
  try { localStorage.setItem(FIX, on ? "on" : "off"); } catch { /* fine */ }
  window.dispatchEvent(new CustomEvent("jl-tape-change"));
}
/** A live distance as shown: corrected when the correction is on. */
export function shown(meters) {
  const c = correction();
  return c.on ? meters + c.offset : meters;
}

export function csv(list = load()) {
  const cols = ["at", "session", "n", "live_m", "tape_m", "full_m", "live_minus_tape_cm", "toe_gap_cm", "heel_gap_cm", "fps", "unsure", "device"];
  const cell = (v) => (v == null ? "" : typeof v === "number" ? String(Math.round(v * 10000) / 10000)
    : typeof v === "boolean" ? String(v) : `"${String(v).replace(/"/g, '""')}"`);
  return [cols.join(","), ...list.map((e) => cols.map((c) => cell(c === "live_minus_tape_cm"
    ? (e.tape_m > 0 && e.live_m > 0 ? 100 * (e.live_m - e.tape_m) : null) : e[c])).join(","))].join("\n");
}
