// Live jump detection, frame by frame, from MediaPipe's 33 pose landmarks (in the camera's pixels).
// A jump: a dip, then both feet leave the floor while the hips move forward, then come down. Its distance
// is measured the way the full analysis does it (jumplab/pipeline.py): from the camera-side toe
// while it was still planted before takeoff, to the camera-side heel just after landing. The full
// analysis of the recorded video checks it later (steps, hands, someone in the shot...).
//
//   const d = createDetector({ onJump });     d.feed(timeSeconds, points | null) for every frame
//   points: 33 [x, y, visibility] in pixels (y down); onJump({ n, distancePx, tTakeoff, unsure, ... })

const FEET = { left: [27, 29, 31], right: [28, 30, 32] };    // ankle, heel, toe
const HIPS = [23, 24];
export const LIFT = 0.06;            // both feet this far above the floor (x body height): in the air
const MIN_FLIGHT = 0.15, MAX_FLIGHT = 1.0;                    // seconds: a broad jump's time in the air
const MIN_TRAVEL = 0.3;              // the hips move forward at least this far in the air (x body height)
const CROUCH = 0.85, CROUCH_S = 1.2; // a broad jump starts with a dip: the body under 85% of its standing
                                     //   height in the 1.2 s before takeoff (walking off never crouches)...
const MIN_RISE = 0.06;               // ...and the hips rise in the air (x body height; our jumps 0.11-0.18,
                                     //   walking off after a stumble about 0.02)
const TOE_S = 0.2;                   // the takeoff toe: its median over the last 0.2 s on the ground
const HEEL_S = 0.1;                  // the landing heel: its median over the first 0.1 s down
const KEEP_S = 4;                    // frames remembered (floor, body height, the toe before takeoff)
const TELEPORT = 4;                  // body heights a second: nobody moves this fast, the tracker jumped
                                     //   to someone else (e.g. a person walking behind the jumper)

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
    return { low: Math.max(heel[1], toe[1]), heelX: heel[0], toeX: toe[0], vis: (ankle[2] + heel[2] + toe[2]) / 3 };
  };
  return { tall: Math.max(...ys) - Math.min(...ys), hipX: (pts[HIPS[0]][0] + pts[HIPS[1]][0]) / 2,
    hipY: (pts[HIPS[0]][1] + pts[HIPS[1]][1]) / 2, left: foot("left"), right: foot("right") };
}

export function createDetector({ onJump = () => {}, onState = () => {} } = {}) {
  let hist = [], state = "ground", up = 0, jump = null, count = 0;

  function reset() { hist = []; state = "ground"; up = 0; jump = null; onState(state); }

  function feed(t, pts) {
    const m = pts ? measure(pts) : null;
    if (!m) { if (state !== "ground" && jump && t - jump.tTakeoff > MAX_FLIGHT + 0.5) { state = "ground"; jump = null; onState(state); } return; }
    const prev = hist[hist.length - 1];
    const tall = pct(hist.map((h) => h.tall).concat(m.tall), 0.8);
    const switched = !!prev && t > prev.t && Math.abs(m.hipX - prev.hipX) / tall / (t - prev.t) > TELEPORT;
    hist.push({ t, ...m, grounded: state === "ground", switched });
    while (hist.length && t - hist[0].t > KEEP_S) hist.shift();
    const standing = hist.filter((h) => h.grounded);
    const floor = median(standing.slice(-45).map((h) => Math.max(h.left.low, h.right.low)));
    if (!(tall > 0) || !Number.isFinite(floor)) return;
    const lift = (side) => (floor - m[side].low) / tall;      // + = above the floor
    const inAir = Math.min(lift("left"), lift("right")) > LIFT;

    if (state === "ground") {
      up = inAir ? up + 1 : 0;
      if (up < 2) return;                                     // two frames off the floor: a takeoff
      const tTakeoff = hist[hist.length - 2].t;
      const recent = hist.filter((h) => h.t >= t - 1);
      const side = median(recent.map((h) => h.left.vis)) >= median(recent.map((h) => h.right.vis)) ? "left" : "right";
      const planted = standing.filter((h) => h.t >= tTakeoff - TOE_S && h.t < tTakeoff);
      jump = { tTakeoff, side, toeX: median(planted.map((h) => h[side].toeX)), hipX: median(planted.map((h) => h.hipX)), tall,
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
      jump.down = [];
      state = "landed";
    }
    if (state === "landed") {
      jump.down.push(m);
      jump.switched ||= hist[hist.length - 1].switched;
      if (t - jump.tLanding < HEEL_S) return;
      const heelX = median(jump.down.map((h) => h[jump.side].heelX)), hipX = median(jump.down.map((h) => h.hipX));
      const dir = Math.sign(hipX - jump.hipX), travel = Math.abs(hipX - jump.hipX) / jump.tall;
      const distancePx = dir * (heelX - jump.toeX);
      state = "ground"; onState(state);
      hist.forEach((h) => { if (h.t >= jump.tTakeoff) h.grounded = false; });   // the floor stays the floor before the jump
      const rise = (jump.hipY - jump.top) / jump.tall;
      // (when the tracker switched people around the jump, its rise is meaningless: it's kept, marked unsure)
      if (jump.crouched && (rise >= MIN_RISE || jump.switched) && travel >= MIN_TRAVEL && distancePx > 0) {
        onJump({ n: ++count, distancePx, tTakeoff: jump.tTakeoff, tLanding: jump.tLanding, flight: jump.tLanding - jump.tTakeoff,
          side: jump.side, toeX: jump.toeX, heelX, direction: dir > 0 ? "right" : "left", tall: jump.tall,
          // unsure: the tracker jumped between people around this jump, so the number may be someone else's
          unsure: jump.switched ? "The tracker jumped to someone else around this jump, so this number may be off." : null });
      }
      jump = null;
    }
  }
  return { feed, reset };
}
