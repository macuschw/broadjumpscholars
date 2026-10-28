// Live jump detection, frame by frame, from MediaPipe's 33 pose landmarks (in the camera's pixels).
// A jump: a dip, then both feet leave the floor while the hips move forward, then come down. Its distance
// is measured the way the full analysis does it (jumplab/pipeline.py): from the camera-side toe
// while planted (from the bottom of the dip to takeoff), to the camera-side heel once landed. Then the
// landing has to be held, as in the full analysis (jumplab/checks.py check_landing): a step forward or
// back, a hand put down or a fall make it a foul. The full analysis of the recorded video checks it
// all again later (and more: someone in the shot, blur...).
//
//   const d = createDetector({ onLanded, onJump });   d.feed(timeSeconds, points | null) for every frame
//   points: 33 [x, y, visibility] in pixels (y down). onLanded(jump): just landed, its distance known,
//   the landing being checked; onJump(jump) once it's judged (up to 1.5 s after landing, at once for a
//   foul). jump: { n, distancePx, tTakeoff, tLanding, unsure, foul, toeGapPx, heelGapPx, ... }.
//   foul: null, or { code: "foul_step_forward" | "foul_step_back" | "foul_hand_down" | "foul_fell",
//   after: seconds after landing }. unsure: null, "switched" (the tracker jumped to someone else),
//   "unseen" (the jumper wasn't tracked for most of the landing) or "stopped" (measuring stopped
//   before the landing was fully checked). The gaps: how far apart the two
//   feet were along the jump (the tape rule takes the front toe and the rear heel; one camera
//   measures the near foot, so feet apart read long). d.flush(): judge a landing still being checked
//   (when measuring stops). Options override the constants below (for testing).

const FEET = { left: [27, 29, 31], right: [28, 30, 32] };    // ankle, heel, toe
const HIPS = [23, 24], KNEES = [25, 26], HANDS = [15, 16, 17, 18, 19, 20];   // (hands: wrists, fingers)
export const LIFT = 0.06;            // both feet this far above the floor (x body height): in the air
const MIN_FLIGHT = 0.15, MAX_FLIGHT = 1.0;                    // seconds: a broad jump's time in the air
const MIN_TRAVEL = 0.3;              // the hips move forward at least this far in the air (x body height)
const CROUCH = 0.85, CROUCH_S = 1.2; // a broad jump starts with a dip: the body under 85% of its standing
                                     //   height in the 1.2 s before takeoff (walking off never crouches)...
const MIN_RISE = 0.06;               // ...and the hips rise in the air (x body height; our jumps 0.11-0.18,
                                     //   walking off after a stumble about 0.02)
// The takeoff toe: its median while planted, from the bottom of the dip to takeoff (at least the
// last 0.1 s); the landing heel: its median over the first 0.25 s down. Checked against the full
// analysis on our 20 test jumps (scratch replay of the browser tracker's frames): mean error -0.2%,
// worst 1.2% at 30 fps, 1.3% at 15 fps (was -0.7% / 3.4% with the last 0.2 s and the first 0.1 s)
const OPTIONS = { TOE_MIN_S: 0.1, HEEL_S: 0.25 };
const KEEP_S = 4;                    // frames remembered (floor, body height, the toe before takeoff)
const TELEPORT = 4;                  // body heights a second: nobody moves this fast, the tracker jumped
                                     //   to someone else (e.g. a person walking behind the jumper)
const RESIZE = 1.3, RESIZE_S = 0.1, RESIZE_SPEED = 2.5;
                                     // ...or the body grows or shrinks by 30% within 0.1 s while moving
                                     //   2.5+ heights a second: a different person, nearer or farther. At
                                     //   30 fps a switch can look slower than TELEPORT (IMG_6233 jump 2).
                                     //   Replayed on IMG_6233 at 24-120 fps, with 12-25% of frames dropped:
                                     //   no clean jump marked; landing squats shrink the body, but slower.
// The landing, held? Watched for 1.5 s, with the full analysis's rules (in body heights):
const SETTLE_S = 0.1;                // where each foot landed: over the first 0.1 s down
const STEP_AHEAD = 0.22, AHEAD_S = 1.0;   // a foot this far ahead of the front foot's spot within 1 s: stumbled
const STEP_BEHIND = 0.20, JUDGE_S = 1.5;  // ...or behind the rear foot's within 1.5 s: the mark moved back
const HAND_FLOOR = 0.04, HAND_DOWN_S = 0.25, HAND_STILL = 0.10;   // a hand at the floor for 0.25 s, still: put down
const KNEE_FLOOR = 0.07, SEAT_FLOOR = 0.09, DOWN_S = 0.15;   // a knee or the seat at the floor: fell (the deepest
                                     //   valid landing squats: knees 0.17, hips 0.14 above it)
const SEEN = 0.5;                    // tracked in under half the frames after landing: unsure
// Replayed on our 20 test jumps (tests/data/live_frames.json; 3 failed on purpose: stumbled forward,
// stepped back, hands on the ground) at 30, 15 and 10 frames a second: each foul caught, no valid jump
// called one. Our valid landings: steps up to 0.16 ahead and 0.08 back, a hand down 0.03 s at most.

const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN;
};
const pct = (xs, p) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : NaN;
};

/** What one frame says: body height, the lowest point of each foot, the hips, foot visibility. */
function measure(pts) {
  const seen = pts.filter((p) => p[2] > 0.5);
  if (seen.length < 8) return null;
  const ys = seen.map((p) => p[1]);
  const foot = (side) => {
    const [ankle, heel, toe] = FEET[side].map((i) => pts[i]);
    return { low: Math.max(heel[1], toe[1]), heelX: heel[0], toeX: toe[0], x: (ankle[0] + heel[0] + toe[0]) / 3,
      vis: (ankle[2] + heel[2] + toe[2]) / 3 };
  };
  const hand = HANDS.map((i) => pts[i]).reduce((a, p) => (p[1] > a[1] ? p : a));   // the lowest hand point
  return { tall: Math.max(...ys) - Math.min(...ys), hipX: (pts[HIPS[0]][0] + pts[HIPS[1]][0]) / 2,
    hipY: (pts[HIPS[0]][1] + pts[HIPS[1]][1]) / 2, kneeY: Math.max(pts[KNEES[0]][1], pts[KNEES[1]][1]),
    hand: [hand[0], hand[1]], left: foot("left"), right: foot("right") };
}

/** A foul in this frame after landing, or null. g: the landing being judged (its spots, runs so far). */
function landingFoul(g, t, m) {
  const since = t - g.j.tLanding, { land, tall, dir } = g;
  const at = [dir * m.left.x, dir * m.right.x];                // + = the jump's direction
  if (since >= SETTLE_S) {
    if (since <= AHEAD_S && Math.max(...at) - Math.max(land.left, land.right) > STEP_AHEAD * tall) return "foul_step_forward";
    if (Math.min(...at) - Math.min(land.left, land.right) < -STEP_BEHIND * tall) return "foul_step_back";
  }
  // a hand at the floor (the lowest foot point at landing), staying put: put down, not swung past
  if (m.hand[1] >= land.floor - HAND_FLOOR * tall) {
    g.hand.push({ t, x: m.hand[0], y: m.hand[1] });
    const moved = Math.max(...g.hand.map((h) => Math.hypot(h.x - g.hand[0].x, h.y - g.hand[0].y)));
    if (t - g.hand[0].t >= HAND_DOWN_S && moved < HAND_STILL * tall) return "foul_hand_down";
  } else g.hand = [];
  if (land.floor - m.kneeY < KNEE_FLOOR * tall || land.floor - m.hipY < SEAT_FLOOR * tall) {
    g.downSince ??= t;
    if (t - g.downSince >= DOWN_S) return "foul_fell";
  } else g.downSince = null;
  return null;
}

export function createDetector({ onJump = () => {}, onLanded = () => {}, onState = () => {}, ...options } = {}) {
  const O = { ...OPTIONS, ...options };
  let hist = [], state = "ground", up = 0, jump = null, count = 0, judging = null;

  function reset() { hist = []; state = "ground"; up = 0; jump = null; judging = null; onState(state); }

  /** One frame of the landing being checked (m: null when nobody was tracked in it). */
  function judge(t, m) {
    const g = judging, since = t - g.j.tLanding;
    g.total++;
    let foul = null;
    if (m) {
      g.seen++;
      if (since < SETTLE_S) g.settle.push({ t, ...m });
      else {
        if (!g.land) {                                         // where the feet landed, and the floor there
          const s = g.settle.length ? g.settle : [{ t, ...m }];
          g.land = { left: median(s.map((h) => g.dir * h.left.x)), right: median(s.map((h) => g.dir * h.right.x)),
            floor: Math.max(...s.map((h) => Math.max(h.left.low, h.right.low))) };
          for (const h of g.settle) foul ||= landingFoul(g, h.t, h);   // (the hands and knees from landing on)
        }
        foul ||= landingFoul(g, t, m);
      }
    }
    if (foul || since >= JUDGE_S) finish(foul, since);
  }
  function finish(foul, since, stopped = false) {
    const g = judging;
    judging = null;
    const unseen = !foul && g.seen < SEEN * g.total;
    onJump({ ...g.j, foul: foul ? { code: foul, after: Math.round(since * 100) / 100 } : null,
      unsure: g.j.unsure || (stopped ? "stopped" : unseen ? "unseen" : null) });
  }
  /** Measuring stopped: a landing still being checked counts, marked unsure (it wasn't watched to the end). */
  function flush() { if (judging) finish(null, 0, true); }

  function feed(t, pts) {
    const m = pts ? measure(pts) : null;
    if (judging) judge(t, m);
    if (!m) {
      if (state === "landed" && jump) jump.missed++;
      if (state !== "ground" && jump && t - jump.tTakeoff > MAX_FLIGHT + 0.5) { state = "ground"; jump = null; onState(state); }
      return;
    }
    const tall = pct(hist.map((h) => h.tall).concat(m.tall), 0.8);
    // Teleport: judged over at least 0.1 s, so uneven frame timing can't fake one
    const before = hist.findLast((h) => t - h.t >= 0.1 && t - h.t <= 0.5);
    const speed = before ? Math.abs(m.hipX - before.hipX) / tall / (t - before.t) : 0;
    const last = hist.at(-1);
    const resized = !!last && t - last.t <= RESIZE_S && Math.max(m.tall / last.tall, last.tall / m.tall) > RESIZE;
    const switched = speed > TELEPORT || (resized && speed > RESIZE_SPEED);
    hist.push({ t, ...m, grounded: state === "ground", switched });
    while (hist.length && t - hist[0].t > KEEP_S) hist.shift();
    const standing = hist.filter((h) => h.grounded);
    const floor = median(standing.slice(-45).map((h) => Math.max(h.left.low, h.right.low)));
    if (!(tall > 0) || !Number.isFinite(floor)) return;
    const lift = (side) => (floor - m[side].low) / tall;      // + = above the floor
    const inAir = Math.min(lift("left"), lift("right")) > LIFT;

    if (state === "ground") {
      up = inAir && !judging ? up + 1 : 0;                    // (no new jump while a landing is being checked)
      if (up < 2) return;                                     // two frames off the floor: a takeoff
      const tTakeoff = hist[hist.length - 2].t;
      const recent = hist.filter((h) => h.t >= t - 1);
      const side = median(recent.map((h) => h.left.vis)) >= median(recent.map((h) => h.right.vis)) ? "left" : "right";
      const dip = hist.filter((h) => h.t >= tTakeoff - CROUCH_S && h.t <= tTakeoff)
        .reduce((a, h) => (h.hipY > a.hipY ? h : a), { hipY: -Infinity, t: tTakeoff });   // image y is down
      const planted = standing.filter((h) => h.t >= Math.min(dip.t, tTakeoff - O.TOE_MIN_S) && h.t < tTakeoff);
      jump = { tTakeoff, side, toeX: median(planted.map((h) => h[side].toeX)), hipX: median(planted.map((h) => h.hipX)), tall,
        toeGapPx: median(planted.map((h) => Math.abs(h.left.toeX - h.right.toeX))),
        crouched: hist.some((h) => h.t >= tTakeoff - CROUCH_S && h.t <= tTakeoff && h.tall < CROUCH * tall),
        hipY: median(planted.map((h) => h.hipY)), top: m.hipY,
        switched: hist.some((h) => h.switched && h.t >= tTakeoff - 1) };
      hist[hist.length - 1].grounded = hist[hist.length - 2].grounded = false;
      state = "air"; onState(state);
      return;
    }
    hist[hist.length - 1].grounded = false;
    if (state === "air") {
      jump.switched ||= hist[hist.length - 1].switched;
      jump.top = Math.min(jump.top, m.hipY);                  // image y is down: the highest the hips got
      if (t - jump.tTakeoff > MAX_FLIGHT + 0.2) { state = "ground"; jump = null; onState(state); return; }   // not a jump
      if (inAir) return;
      jump.tLanding = t;
      if (t - jump.tTakeoff < MIN_FLIGHT) { state = "ground"; jump = null; onState(state); return; }        // a twitch
      jump.down = []; jump.missed = 0;
      state = "landed";
    }
    if (state === "landed") {
      jump.down.push({ t, ...m });
      jump.switched ||= hist[hist.length - 1].switched;
      if (t - jump.tLanding < O.HEEL_S) return;
      const heelX = median(jump.down.map((h) => h[jump.side].heelX)), hipX = median(jump.down.map((h) => h.hipX));
      const dir = Math.sign(hipX - jump.hipX), travel = Math.abs(hipX - jump.hipX) / jump.tall;
      const distancePx = dir * (heelX - jump.toeX);
      state = "ground"; onState(state);
      hist.forEach((h) => { if (h.t >= jump.tTakeoff) h.grounded = false; });   // the floor stays the floor before the jump
      const rise = (jump.hipY - jump.top) / jump.tall;
      // (when the tracker switched people around the jump, its rise is meaningless: it's kept, marked unsure)
      if (jump.crouched && (rise >= MIN_RISE || jump.switched) && travel >= MIN_TRAVEL && distancePx > 0) {
        const j = { n: ++count, distancePx, tTakeoff: jump.tTakeoff, tLanding: jump.tLanding, flight: jump.tLanding - jump.tTakeoff,
          side: jump.side, toeX: jump.toeX, heelX, direction: dir > 0 ? "right" : "left", tall: jump.tall,
          toeGapPx: jump.toeGapPx, heelGapPx: median(jump.down.map((h) => Math.abs(h.left.heelX - h.right.heelX))),
          // unsure: the tracker jumped between people around this jump, so the number may be someone else's
          unsure: jump.switched ? "switched" : null };
        judging = { j, dir, tall: jump.tall, settle: [], hand: [], downSince: null, land: null, seen: 0, total: jump.missed };
        onLanded(j);
        for (const h of jump.down) if (judging) judge(h.t, h);  // the frames since landing
      }
      jump = null;
    }
  }
  return { feed, reset, flush };
}
