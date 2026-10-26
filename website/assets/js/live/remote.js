// The remote screen: a laptop (or another phone) that shows what the phone on the tripod measures
// live, says each distance out loud, and runs it: the scale, Stop, Measure again. The two pass
// messages through a room on the server (live/room.js); the phone joins by scanning the QR code
// shown here, or by typing the code in Measure live.
//
//   const remote = createRemote(host, { code, onNeedScale(still), onClose() });
//   remote.setScale(metersPerPixel)   after the tape was marked on onNeedScale's still
import { ANALYSIS_URL, analysisServer } from "../config.js";
import { onUnitsChange } from "../lib/units.js";
import { read, repeat, send } from "./room.js";
import { createVoice, esc, fullScreen, jumpItemHTML, jumpWords, resultHTML } from "./shared.js";

const QR = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm";
const LOST_S = 8;                      // the phone hasn't written for this long: lost (it writes every 2 s)

/** The link the phone opens: this site's Analyze page, as the camera of this room. */
function joinURL(code) {
  const url = new URL("analyze.html", location.href);
  url.searchParams.set("camera", code);
  const server = analysisServer();                             // a local test server goes along (localhost only)
  if (server && server !== ANALYSIS_URL.replace(/\/+$/, "")) url.searchParams.set("server", server);
  return url.href;
}

async function drawQR(box, text) {
  try {
    const { default: qrcode } = await import(QR);
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), m = 4;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    box.innerHTML = `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" aria-hidden="true">
      <rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#121315"/></svg>`;
  } catch {
    box.hidden = true;                                         // the code below still works
  }
}

export function createRemote(host, { code, onNeedScale, onClose }) {
  const join = joinURL(code);
  host.innerHTML = `
    <div class="live remote">
      <div class="live__head">
        <h2 id="remote-title" tabindex="-1">Remote screen</h2>
        <p class="live__lede">This screen shows each distance, says it out loud, and runs the phone on the tripod, so nobody
          has to touch it.</p>
      </div>
      <div class="remote__pair">
        <div class="remote__qr"></div>
        <div class="remote__how">
          <p><strong>On the phone that will film:</strong> scan this with its camera app. Or open this site's Analyze page
            there, choose <strong>Start the camera</strong>, then <strong>Use a remote screen</strong>, and type the code:</p>
          <p class="remote__code">${code.slice(0, 3)} ${code.slice(3)}</p>
          <p class="remote__url">${esc(join)}</p>
        </div>
      </div>
      <div class="live__stage remote__stage" hidden>
        <img class="remote__view" alt="What the phone's camera sees">
        <p class="live__badge" hidden></p>
        <div class="live__result" role="status" aria-live="assertive" hidden></div>
        <p class="remote__lost" hidden>Lost the phone: is it still on Measure live, with its screen on?</p>
      </div>
      <div class="live__options">
        <button type="button" class="btn btn--quiet btn--sm live__speak" aria-pressed="true">Say each distance out loud</button>
        <button type="button" class="btn btn--quiet btn--sm live__full-screen" hidden>Full screen</button>
      </div>
      <p class="live__status" aria-live="polite">Waiting for the phone…</p>
      <div class="live__actions">
        <button type="button" class="btn btn--primary remote__scale" hidden>Set the scale</button>
        <button type="button" class="btn btn--primary remote__stop" hidden>Stop</button>
        <button type="button" class="btn btn--primary remote__again" hidden>Measure again</button>
        <button type="button" class="btn btn--quiet btn--sm remote__close">Back</button>
      </div>
      <ol class="live__jumps" role="list" aria-label="Jumps measured live"></ol>
    </div>`;
  const q = (s) => host.querySelector(s);
  const status = (text) => { if (q(".live__status").textContent !== text) q(".live__status").textContent = text; };
  const voice = createVoice(q(".live__speak"));
  const wide = fullScreen(q(".remote__stage"), q(".live__full-screen"));
  drawQR(q(".remote__qr"), join);

  let cmds = [], cmdId = Date.now(), wantStill = null, picId = 0, heardUpTo = 0, session = null, listed = "", misses = 0, closed = false;
  let last = null, big = null;                                 // the phone's latest message; the jump shown big
  /** A command for the phone: kept in the "remote" slot (the last ten), which the phone reads about once a second. */
  function command(type, extra = {}) {
    const c = { id: ++cmdId, type, ...extra };
    cmds = [...cmds.slice(-9), c];
    beat.soon();
    return c.id;
  }
  const beat = repeat(4000, () => send(code, "remote", { cmds }));   // "still here", with the commands
  const poll = repeat(600, async () => {
    let got;
    try {
      got = await read(code, "phone");
      misses = 0;
    } catch (e) {
      if (e.status === 404) { status("This remote screen has expired. Go back and open a new one."); poll.stop(); beat.stop(); return; }
      if (++misses >= 3) status("No connection to the JumpLab server. Still trying…");
      throw e;
    }
    show(got.value, got.age);
    const s = got.value;
    if (s?.previewId && s.previewId !== picId) {
      const p = (await read(code, "preview")).value;
      if (p?.jpeg && p.id !== picId) { q(".remote__view").src = `data:image/jpeg;base64,${p.jpeg}`; picId = p.id; }
    }
    if (wantStill && s?.stillId === wantStill) {
      wantStill = null;
      const still = (await read(code, "still")).value;
      if (still?.jpeg && !closed) onNeedScale(still);
    }
  });

  const CLOSED = {
    analyzing: "The phone is running the full analysis: the results will be on the phone.",
    disconnected: "The phone disconnected from this screen. Scan the code again to reconnect.",
    back: "The phone left Measure live. Open it again there (this code still works).",
  };
  function show(s, age) {
    last = [s, age];
    const here = !!s && s.stage !== "closed";
    q(".remote__pair").hidden = here || s?.reason === "analyzing";
    q(".remote__stage").hidden = !here && !s?.jumps?.length;
    q(".remote__lost").hidden = !here || age < LOST_S || s.stage === "done";
    for (const b of [".remote__scale", ".remote__stop", ".remote__again"]) q(b).hidden = true;
    if (!s) { status("Waiting for the phone…"); return; }
    if (s.stage === "closed") { status(CLOSED[s.reason] || CLOSED.back); return; }

    // each new jump: shown big and said out loud (not the ones from before this screen opened)
    const jumps = s.jumps || [];
    const box = q(".live__result");
    if (s.session !== session) {                               // first sight (a reload: nothing said again), or a new session
      if (session !== null) box.hidden = true;
      heardUpTo = session === null ? Math.max(0, ...jumps.map((j) => j.n)) : 0;
      session = s.session;
    }
    if (box.hidden && jumps.length && heardUpTo >= jumps.at(-1).n) {   // (re)opened mid-session: the last one, quietly
      big = jumps.at(-1);
      box.innerHTML = resultHTML(big, big.meters);
      box.hidden = false;
    }
    for (const j of jumps.filter((j) => j.n > heardUpTo)) {
      heardUpTo = j.n;
      big = j;
      box.innerHTML = resultHTML(j, j.meters);
      box.hidden = false;
      voice.say(jumpWords(j, j.meters));
    }
    const list = JSON.stringify(jumps);
    if (list !== listed) { listed = list; q(".live__jumps").innerHTML = jumps.map((j) => jumpItemHTML(j, j.meters)).join(""); }
    q(".live__badge").textContent = s.air ? "In the air" : "";
    q(".live__badge").hidden = !s.air;
    q(".live__result").classList.toggle("live__result--old", !!s.air);

    const n = jumps.length;
    if (s.stage === "starting") status("The phone is starting its camera…");
    else if (s.stage === "error") status(`On the phone: ${s.status}`);
    else if (s.stage === "ready") {
      q(".remote__scale").hidden = !!wantStill;
      if (!wantStill) status("Set the scale: have the tape measure on the floor in the picture, then click Set the scale.");
    } else if (s.stage === "measuring") {
      q(".remote__stop").hidden = false;
      status("Measuring: jump whenever you like. Each distance shows here and is said out loud.");
    } else if (s.stage === "stopping") status("Stopping…");
    else if (s.stage === "done") {
      q(".remote__again").hidden = false;
      status(`${n ? `${n} jump${n === 1 ? "" : "s"} measured.` : "No jumps were measured."} The recording is on the phone: tap
        Get the full data there, or Save the video. Or measure again.`.replace(/\s+/g, " "));
    }
  }

  q(".remote__scale").addEventListener("click", () => {
    const id = command("still");
    wantStill = id;
    q(".remote__scale").hidden = true;
    status("Getting a picture from the phone…");
    setTimeout(() => { if (wantStill === id) { wantStill = null; status("The phone didn't send a picture. Try Set the scale again."); } }, 15000);
  });
  q(".remote__stop").addEventListener("click", () => { command("stop"); status("Stopping…"); });
  q(".remote__again").addEventListener("click", () => {
    command("again");
    q(".remote__again").hidden = true;
    status("Starting again on the phone…");
  });
  q(".remote__close").addEventListener("click", () => { dispose(); onClose(); });
  const offUnits = onUnitsChange(() => {                       // m <-> ft in the header: the numbers redrawn
    listed = "";
    if (big && !q(".live__result").hidden) q(".live__result").innerHTML = resultHTML(big, big.meters);
    if (last) show(...last);
  });

  // the screen stays on while it's the scoreboard
  let wake = null;
  const keepAwake = async () => { try { if (document.visibilityState === "visible") wake = await navigator.wakeLock?.request("screen"); } catch { /* fine */ } };
  document.addEventListener("visibilitychange", keepAwake);
  keepAwake();

  function setScale(scale) {
    command("scale", { scale });
    voice.say("Ready. Jump when you like.");                   // (it follows a click: lets phones speak later)
    status("Sending the scale to the phone…");
    q("#remote-title").focus();
  }
  function dispose() {
    closed = true;
    poll.stop(); beat.stop();
    wide.exit();
    voice.stop();
    document.removeEventListener("visibilitychange", keepAwake);
    offUnits();
    wake?.release?.().catch?.(() => {});
    host.replaceChildren();
  }
  return { setScale, dispose, code };
}
