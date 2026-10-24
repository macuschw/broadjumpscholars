// Real jumps: a results bundle from the JumpLab analysis (jumplab/web.py: the command line's
// _web.json, or the analysis server's reply) turned into the attempt shape the dashboard draws
// (frames with hip position in meters, trunk / shin / knee angles; events; metrics).
// Every number comes from the bundle; nothing is re-estimated here. Lengths use the bundle's
// tape-measure scale; without one, the analysis's rough gravity-based scale, flagged as rough.
import { formatNumber, formatQuantity } from "../lib/units.js";

export const FORMAT_PREFIX = "jumplab-web/";
export const SESSION_PREFIX = "jumplab-session/";
const PHASES = ["Stance", "Countermovement", "Propulsion", "Flight", "Landing"];
let nextId = 1;

/**
 * A results file -> { name, jumps: [bundle, ...], still, best }: a session (one video, every jump
 * in it, from the analysis server or scripts/run_session.py) or a single jump's bundle.
 */
export function readResults(obj) {
  if (String(obj?.format || "").startsWith(SESSION_PREFIX) && Array.isArray(obj.jumps)) {
    if (!obj.jumps.length) throw new Error("No jump was found in this video.");
    return { name: obj.name, jumps: obj.jumps.map(checkBundle), still: obj.still || null, best: obj.best ?? null, skipped: obj.skipped || [] };
  }
  const b = checkBundle(obj);
  return { name: b.name, jumps: [b], still: b.still || null, best: null, skipped: [] };
}

/** Throws with a plain message if this isn't a JumpLab results file. */
export function checkBundle(b) {
  if (!b || typeof b !== "object" || !String(b.format || "").startsWith(FORMAT_PREFIX) || !b.results || !b.series || !b.landmarks) {
    throw new Error("That file isn't a JumpLab results file. Open the _web.json the JumpLab app saved next to the results.");
  }
  return b;
}

const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
/** A series with gaps (null) filled from the nearest earlier value (then later, for a leading gap). */
const filled = (xs) => {
  const out = xs.map((v) => (v == null ? NaN : v));
  let last = NaN;
  for (let i = 0; i < out.length; i++) if (Number.isFinite(out[i])) last = out[i]; else out[i] = last;
  for (let i = out.length - 1; i >= 0; i--) if (Number.isFinite(out[i])) last = out[i]; else out[i] = last;
  return out;
};

/**
 * One jump of a longer video keeps only its own stretch (from landmarks.offset): padded back out to
 * every frame here, so a frame number means the same thing everywhere. Frame times outside the
 * stretch are filled at the video's frame rate (playback needs one for every frame). The compact
 * bundle is what gets saved and sent back to the server.
 */
function expanded(b) {
  const lm = b.landmarks, n = lm.n_frames, at = lm.offset || 0;
  if (!at && lm.xyv.length === n) return b;
  const pad = (xs) => (xs == null ? xs : [...Array(at).fill(null), ...xs, ...Array(Math.max(0, n - at - xs.length)).fill(null)]);
  let times = lm.frame_times;
  if (times?.length) {
    const t0 = times[0], tN = times.at(-1), last = at + times.length - 1;
    times = Array.from({ length: n }, (_, i) => (i < at ? t0 - (at - i) / lm.fps : i > last ? tN + (i - last) / lm.fps : times[i - at]));
  }
  return { ...b, series: Object.fromEntries(Object.entries(b.series).map(([k, v]) => [k, pad(v)])),
    landmarks: { ...lm, xyv: pad(lm.xyv), sharpness: pad(lm.sharpness), frame_times: times, offset: 0 } };
}

/** Bundle (+ the video File, if the visitor has it) -> attempt for the dashboard. */
export function bundleToAttempt(bundle, { video = null } = {}) {
  const saved = checkBundle(bundle), b = expanded(saved), r = b.results, s = b.series, tr = r.trajectory || {}, d = r.distance || {};
  const fps = r.fps, n = s.time_s.length;
  const calibrated = r.scale_m_per_px != null;
  const scale = r.scale_m_per_px ?? tr.gravity_implied_scale_m_per_px ?? null;
  const ev = r.events;
  const onset = ev.movement_onset.frame, bottom = ev.countermovement_bottom.frame, takeoff = ev.takeoff.frame, landing = ev.landing.frame;
  const dir = r.direction === "left" ? -1 : 1;

  // Ground and start line, in image pixels: the floor under the standing feet, the takeoff toe
  const toeX = filled(s.toe_x_px), toeY = filled(s.toe_y_px_up), heelY = filled(s.heel_y_px_up);
  const x0 = median(toeX.slice(bottom, takeoff + 1));
  const stand = Math.max(1, Math.min(onset, Math.round(0.4 * fps)));
  const floor = median(toeY.slice(0, stand).map((y, i) => Math.min(y, heelY[i])));
  const hipX = filled(s.hip_x_px), hipY = filled(s.hip_y_px_up);
  const k = scale ?? 0;
  const trunk = filled(s.trunk_angle_deg), shin = filled(s.shin_angle_deg), knee = filled(s.knee_angle_deg);
  const frames = Array.from({ length: n }, (_, i) => ({
    i, t: s.time_s[i] ?? i / fps,
    hip: [dir * (hipX[i] - x0) * k, (hipY[i] - floor) * k],
    trunk: trunk[i], shin: shin[i], knee: knee[i],
    phase: i < onset ? PHASES[0] : i < bottom ? PHASES[1] : i < takeoff ? PHASES[2] : i < landing ? PHASES[3] : PHASES[4],
  }));
  let peak = takeoff;
  for (let i = takeoff; i <= landing && i < n; i++) if (hipY[i] > hipY[peak]) peak = i;

  // Metrics, in SI, exactly as the analysis reported them (rough ones from the gravity scale)
  const fit = tr.fit_px || {};
  const roughV = (v) => (v == null || scale == null ? null : Math.abs(v) * scale);
  const vx = tr.vx_m_s != null ? Math.abs(tr.vx_m_s) : roughV(fit.vx);
  const vy = tr.vy_m_s ?? (fit.vy != null && scale != null ? fit.vy * scale : null);
  const ang = r.angles_deg?.takeoff || {}, tm = r.timing || {};
  const metrics = {
    distance: d.jump_distance_m ?? d.jump_distance_m_gravity_scale ?? null,
    vx, vy, speed: tr.speed_m_s ?? (vx != null && vy != null ? Math.hypot(vx, vy) : null),
    launchAngle: tr.launch_angle_deg ?? null,
    peakHeight: tr.peak_rise_m ?? (vy != null ? (vy * vy) / (2 * 9.81) : null),
    flightTime: tm.flight_time_s ?? null, contactTime: tm.contact_time_s ?? null, pushOff: tm.push_off_time_s ?? null,
    trunkTakeoff: ang.trunk ?? null, shinTakeoff: ang.shin ?? null, kneeTakeoff: ang.knee ?? null,
  };
  const name = b.name || r.video || "Your jump";
  const fouls = b.fouls || r.fouls || [], jump = r.jump ?? null;
  // The part of the clip worth charting: from just before the dip to just after landing
  const window = [Math.max(0, onset - Math.round(0.5 * fps)), Math.min(n - 1, landing + Math.round(0.8 * fps))];
  return {
    id: `real-${nextId++}`, label: jump ? `Jump ${jump}` : shortName(name), name, real: true, window,
    calibrated, rough: !calibrated && scale != null, measured: scale != null,
    fps, frames, events: { onset, bottom, takeoff, peak, landing }, metrics,
    ratings: b.ratings || {}, warnings: b.warnings || r.warnings || [],
    // Does it count? (stepped forward or back after landing, hand on the ground: server checks.py)
    valid: b.valid !== false && !fouls.length, fouls, jump,
    bundle: b, saved, video,
  };
}

/** A short label for the attempt picker: the file name without its extension, at most 14 characters. */
function shortName(name) {
  const base = String(name).replace(/\.[a-z0-9]+$/i, "");
  return base.length > 14 ? `${base.slice(0, 13)}…` : base;
}

// The headline stats fed by each part of the analysis (a warning's `affects`)
const AFFECTS = { distance: ["distance"], trajectory: ["velocity", "launch"], angles: ["trunk", "shin"], timing: ["contact"] };
export const STAT_NAMES = { distance: "Jump distance", velocity: "Takeoff velocity", launch: "Launch angle",
  trunk: "Trunk angle", shin: "Shin angle", contact: "Ground contact" };
const ICONS = { staggered_feet: "feet", person_near_athlete: "people", person_in_shot: "people", limb_snap: "track",
  blurry_video: "blur", low_confidence_landmarks: "blur", missing_in_jump: "track", offframe_landmarks: "track" };
const ORDER = { serious: 0, caution: 1 };

/**
 * The jump's problems in plain words, serious first: headline, what happened, how to fix it,
 * the analysis's own technical message, and the headline stats it affects. Info-level notes
 * are left out (they don't make a number less trustworthy). Older results files have only
 * the technical message, which then stands in for the explanation.
 */
export function issues(a) {
  return a.warnings.filter((w) => w.severity in ORDER).map((w) => ({
    code: w.code, severity: w.severity, icon: ICONS[w.code] || "alert",
    headline: w.headline || "Check this jump",
    explain: w.explain || w.message, fix: w.fix || "", detail: w.explain ? w.message : "",
    stats: [...new Set((w.affects || Object.keys(AFFECTS)).flatMap((k) => AFFECTS[k] || []))],
  })).sort((x, y) => ORDER[x.severity] - ORDER[y.severity]);
}

/** The six headline metrics for a real jump (same shape as data/mock-data.js headline()). */
export function realHeadline(a) {
  const m = a.metrics, speed = (v) => (v == null ? "—" : formatNumber("speed", v));
  const flags = {};                                          // stat id -> the serious problems behind it
  for (const i of issues(a)) if (i.severity === "serious") i.stats.forEach((id) => (flags[id] ??= []).push(i.headline));
  const voided = a.valid ? null : a.fouls.map((f) => f.headline || "Doesn't count").join(" · ");
  return [
    { id: "distance", label: "Jump distance", value: m.distance, unit: "m", kind: "distance", digits: 2,
      sub: a.calibrated ? "Takeoff toe to landing heel" : a.rough ? "Rough: no tape calibration" : "Needs calibration" },
    { id: "velocity", label: "Takeoff velocity", value: m.speed, unit: "m/s", kind: "speed", digits: 2,
      sub: `Horizontal ${speed(m.vx)} · Vertical ${speed(m.vy)}` },
    { id: "launch", label: "Launch angle", value: m.launchAngle, unit: "°", digits: 1,
      sub: m.peakHeight == null ? "Peak height —" : `Peak height +${formatQuantity("short", m.peakHeight)}` },
    { id: "trunk", label: "Trunk angle", value: m.trunkTakeoff, unit: "°", digits: 0, sub: "Forward lean at takeoff" },
    { id: "shin", label: "Shin angle", value: m.shinTakeoff, unit: "°", digits: 0, sub: "Forward lean at takeoff" },
    { id: "contact", label: "Ground contact", value: m.contactTime, unit: "s", digits: 2,
      sub: m.pushOff == null ? "" : `Push-off ${m.pushOff.toFixed(2)} s` },
  ].map((h) => (h.id === "distance" && voided ? { ...h, flag: voided, flagText: "Doesn't count" }
    : flags[h.id] ? { ...h, flag: flags[h.id].join(" · ") } : h));
}

/** Save the jumps shown as a file the visitor can open again later: one jump's bundle, or a
 *  session (every jump) when there are several. */
export function downloadBundle(a, all = [a]) {
  const several = all.length > 1;
  const body = several ? { format: `${SESSION_PREFIX}1`, name: a.name, jumps: all.map((x) => x.saved || x.bundle) } : (a.saved || a.bundle);
  const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${String(a.name).replace(/\.[a-z0-9]+$/i, "")}_${several ? "session_" : ""}web.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
