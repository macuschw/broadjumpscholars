// The remote screen: a laptop (or another phone) that shows what the phone on the tripod measures
// live, says each distance (or why a jump doesn't count) out loud, and runs it: the scale, Stop,
// Measure again. After Stop it brings the phone's recording over (the phone uploads it to the
// analysis server, this screen downloads it) to save it or get the full data here, and saves the
// results as a spreadsheet. The two pass messages through a room on the server (live/room.js); the
// phone joins by scanning the QR code shown here, or by typing the code in Measure live.
//
//   const remote = createRemote(host, { code, onNeedScale(still), onAnalyze(file, info), onClose() });
//   remote.setScale(metersPerPixel)   after the tape was marked on onNeedScale's still
import { ANALYSIS_URL, analysisServer } from "../config.js";
import { downloadVideo, forgetVideo } from "../demo/server.js";
import { onUnitsChange } from "../lib/units.js";
import { read, repeat, send } from "./room.js";
import { bindUnits, createVoice, esc, fileStamp, fullScreen, guardLeaving, jumpItemHTML, jumpWords, renderTapeCheck, resultsCSV, saveFile,
  setupHTML, showResult, tapeEntry, unitsHTML } from "./shared.js";
import { record } from "./tapelog.js";

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

export function createRemote(host, { code, onNeedScale, onAnalyze, onClose }) {
  const join = joinURL(code);
  host.innerHTML = `
    <div class="live remote">
      <div class="live__head">
        <h2 id="remote-title" tabindex="-1">Remote screen</h2>
        <p class="live__lede">This screen shows each distance, says it out loud, and runs the phone on the tripod, so nobody
          has to touch it.</p>
        ${setupHTML()}
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
        ${unitsHTML()}
        <button type="button" class="btn btn--quiet btn--sm live__speak" aria-pressed="true">Say each distance out loud</button>
        <button type="button" class="btn btn--quiet btn--sm live__full-screen" hidden>Full screen</button>
      </div>
      <p class="live__status" aria-live="polite">Waiting for the phone…</p>
      <p class="live__rate" hidden></p>
      <div class="live__actions">
        <button type="button" class="btn btn--primary remote__scale" hidden>Set the scale</button>
        <button type="button" class="btn btn--primary remote__stop" hidden>Stop</button>
        <button type="button" class="btn btn--primary remote__again" hidden>Measure again</button>
        <button type="button" class="btn btn--quiet btn--sm remote__close">Back</button>
      </div>
      <ol class="live__jumps" role="list" aria-label="Jumps measured live"></ol>
      <p class="live__tapecheck" hidden></p>
      <div class="live__done remote__done" hidden>
        <p class="remote__done-text"></p>
        <div class="live__done-actions">
          <button type="button" class="btn btn--primary remote__full">Get the full data here</button>
          <button type="button" class="btn btn--quiet remote__save">Save the video here</button>
          <button type="button" class="btn btn--quiet remote__results">Save the results</button>
        </div>
        <p class="remote__transfer" role="status" hidden></p>
      </div>
    </div>`;
  const q = (s) => host.querySelector(s);
  const status = (text) => { if (q(".live__status").textContent !== text) q(".live__status").textContent = text; };
  const voice = createVoice(q(".live__speak"));
  const wide = fullScreen(q(".remote__stage"), q(".live__full-screen"));
  const offUnitSwitch = bindUnits(q(".live__options"));
  drawQR(q(".remote__qr"), join);

  let cmds = [], cmdId = Date.now(), wantStill = null, picId = 0, heardUpTo = 0, session = null, listed = "", misses = 0, closed = false;
  let last = null, big = null;                                 // the phone's latest message; the jump shown big
  const typed = {};                                            // tape lengths typed here, until the phone confirms them
  const logged = new Set();                                    // tape checks already in this device's log
  /** A command for the phone: kept in the "remote" slot (the last ten), which the phone reads about once a second. */
  function command(type, extra = {}) {
    const c = { id: ++cmdId, type, ...extra };
    cmds = [...cmds.slice(-9), c];
    beat.soon();
    return c.id;
  }
  const beat = repeat(4000, () => send(code, "remote", { cmds }));   // "still here", with the commands
  const poll = repeat(400, async () => {
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

  // ---- the phone's recording, brought over after Stop (asked for once; both buttons wait for the same)
  let video = null, getting = null, upload = null, handed = false, savedHere = false, abortDownload = null;
  const waiters = [];                                          // waiting on the phone's messages
  const untilPhone = (test) => new Promise((resolve) => waiters.push({ test, resolve }));
  const pct = (a, b) => Math.round((100 * a) / Math.max(1, b));
  const mb = (bytes) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  const transferText = (text) => { const el = q(".remote__transfer"); el.hidden = !text; el.textContent = text || ""; };
  function getVideo() {
    if (video) return Promise.resolve(video);
    getting ??= (async () => {
      const want = session, before = JSON.stringify(last?.[0]?.video ?? null), asked = Date.now();
      command("video");
      transferText("Asking the phone for the video…");
      const v = await untilPhone((s) => {
        if (!s || s.session !== want || s.stage !== "done") return { state: "error", error: "it left this session" };
        const v = s.video;
        if (!v || JSON.stringify(v) === before) {              // not yet answered (an old failure doesn't count)
          return Date.now() - asked > 20000 ? { state: "error", error: "it didn't answer. Is it still on Measure live, with its screen on" } : null;
        }
        if (v.state === "sending") transferText(`The phone is sending the video: ${pct(v.sent, v.size)}%. Keep the phone on this page.`);
        return v.state === "sending" ? null : v;
      });
      if (v.state === "error") throw new Error(`The phone couldn't send the video: ${v.error}.`);
      upload = { job: v.job, chunks: v.chunks };
      const down = downloadVideo(v, { onProgress: (got, size) => transferText(`Downloading the video: ${pct(got, size)}%`) });
      abortDownload = down.abort;
      video = await down.promise;
      command("kept");                                         // the phone can leave without losing it
      return video;
    })();
    renderDone();
    return getting.catch((e) => { getting = null; throw e; }).finally(renderDone);
  }
  /** Forget the brought-over video (a new session, or leaving), and the server's copy unless it's being analyzed. */
  function dropVideo() {
    abortDownload?.();
    const job = upload?.job || last?.[0]?.video?.job;
    if (job && !handed) forgetVideo(job);
    video = getting = upload = abortDownload = null;
    handed = savedHere = false;
    waiters.length = 0;
    transferText("");
  }
  /** The jumps with any tape typed here that the phone hasn't confirmed yet. */
  const withTyped = (s) => (s?.jumps || []).map((j) => ({ ...j, tape: j.tape || (typed[`${s.session}:${j.n}`] ?? null) }));
  function renderDone() {
    const s = last?.[0], box = q(".remote__done");
    box.hidden = s?.stage !== "done";
    if (box.hidden) return;
    const rec = s.recording, busy = !!getting && !video;
    q(".remote__done-text").textContent = rec
      ? `The phone recorded the session (${mb(rec.size)}). Get the full data here (the angles, the timing, the checks, and each
        distance confirmed, on this screen), or save the video to upload later. The video comes over from the phone through the
        JumpLab server, which deletes it afterwards; keep the phone on Measure live until it has.`.replace(/\s+/g, " ")
      : "The phone couldn't record this session, so only the live distances are available.";
    q(".remote__full").hidden = q(".remote__save").hidden = !rec;
    q(".remote__full").disabled = q(".remote__save").disabled = busy;
    q(".remote__results").hidden = !s.jumps?.length;
  }
  q(".remote__save").addEventListener("click", async () => {
    try {
      const f = await getVideo();
      saveFile(f, f.name);
      savedHere = true;
      if (upload && !handed) { forgetVideo(upload.job); upload = null; }   // saved: off the server (the full data uploads it again)
      transferText(`Saved ${f.name} (${mb(f.size)}) on this computer, in its downloads.`);
    } catch (e) { if (!e.canceled) transferText(e.message); }
  });
  q(".remote__full").addEventListener("click", async () => {
    try {
      const f = await getVideo(), s = last[0];
      handed = true;                                           // the server's copy is analyzed now: not deleted
      onAnalyze(f, { scale: s.scale, fps: s.fps, session: s.session, uploaded: upload,
        jumps: withTyped(s).filter((j) => !j.checking).map(({ n, meters, t, unsure, foul }) => ({ n, meters, tTakeoff: t, unsure, foul })) });
    } catch (e) { if (!e.canceled) transferText(e.message); }
  });
  q(".remote__results").addEventListener("click", () => {
    const s = last?.[0];
    const stem = s?.recording?.name?.replace(/\.\w+$/, "") || `jumplab-live-${fileStamp(s?.session)}`;
    saveFile(new Blob([resultsCSV(withTyped(s))], { type: "text/csv" }), `${stem}-results.csv`);
  });

  const CLOSED = {
    analyzing: "The phone is running the full analysis: the results will be on the phone.",
    disconnected: "The phone disconnected from this screen. Scan the code again to reconnect.",
    back: "The phone left Measure live. Open it again there (this code still works).",
  };
  function show(s, age) {
    last = [s, age];
    for (const w of waiters.splice(0)) { const got = w.test(s); if (got) w.resolve(got); else waiters.push(w); }
    renderDone();
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
      if (session !== null) { box.hidden = true; dropVideo(); }
      heardUpTo = session === null ? Math.max(0, ...jumps.filter((j) => !j.checking).map((j) => j.n)) : 0;
      session = s.session;
    }
    if (box.hidden && jumps.length && heardUpTo >= jumps.at(-1).n) {   // (re)opened mid-session: the last one, quietly
      big = jumps.at(-1);
      showResult(box, big);
    }
    for (const j of jumps.filter((j) => j.n > heardUpTo)) {
      big = j;
      showResult(box, j);
      if (j.checking) break;                                   // landed: said once the landing is judged
      heardUpTo = j.n;
      voice.say(jumpWords(j));
    }
    for (const j of jumps) if (j.tape > 0) logTape(j, j.tape);     // typed on the phone: in this device's tape log too
    const shownJumps = withTyped(s);
    const list = JSON.stringify(shownJumps);
    if (list !== listed && !tape.busy()) { listed = list; q(".live__jumps").innerHTML = shownJumps.map(jumpItemHTML).join(""); }
    const rate = q(".live__rate");
    rate.hidden = !(s.rate > 0) || !["ready", "measuring"].includes(s.stage);
    rate.classList.toggle("live__rate--slow", s.rate < 12);
    rate.textContent = s.rate < 12 ? `The phone is tracking only ${s.rate} frame${s.rate === 1 ? "" : "s"} a second: jumps may be missed or measured roughly. Close other apps on it, or try a newer phone.`
      : `The phone is tracking ${s.rate} frames a second.`;
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
      const fouls = jumps.filter((j) => j.foul).length;
      status(`${n ? `${n} jump${n === 1 ? "" : "s"} measured${fouls ? ` (${fouls} didn't count)` : ""}.` : "No jumps were measured."}
        ${s.recording ? "Get the full data or save the video here (below), or measure again." : "Measure again, or go back."}`.replace(/\s+/g, " "));
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
    if (last?.[0]?.recording && !savedHere && !confirm("Start again? The phone's recording of this session will be lost unless it was saved (here or on the phone).")) return;
    command("again");
    q(".remote__again").hidden = true;
    status("Starting again on the phone…");
  });
  // Leaving while the phone measures (this screen is its scoreboard and its Stop button), or while its video comes over
  const measuring = () => ["measuring", "ready"].includes(last?.[0]?.stage);
  const busy = () => measuring() || (!!getting && !video);
  const offGuard = guardLeaving(busy);
  q(".remote__close").addEventListener("click", () => {
    if (measuring() && !confirm("Close the remote screen? The phone keeps measuring, but its distances won't show here and it can't be stopped from here.")) return;
    if (!measuring() && busy() && !confirm("Close the remote screen? The video is still coming over from the phone.")) return;
    dispose(); onClose();
  });

  // The tape check: typed here, sent to the phone (which keeps it with the jump) and kept in this device's log
  const tape = tapeEntry(q(".live__jumps"), (n, m) => {
    const j = last?.[0]?.jumps?.find((x) => x.n === n);
    if (!j) return;
    typed[`${session}:${n}`] = m;
    logTape(j, m);
    command("tape", { n, meters: m });
    listed = "";
    if (last) show(...last);
  });
  function logTape(j, m) {
    const key = `${session}:${j.n}:${m}`;
    if (logged.has(key)) return;
    logged.add(key);
    record(session, j.n, { live_m: j.meters, tape_m: m, toe_gap_cm: j.toeGapCm ?? null, heel_gap_cm: j.heelGapCm ?? null,
      fps: j.fps ?? null, unsure: !!j.unsure, device: "remote" });
  }
  const redraw = () => {                                       // m <-> ft in the header, or the correction: redrawn
    listed = "";
    if (big && !q(".live__result").hidden) showResult(q(".live__result"), big);
    if (last) show(...last);
    renderTapeCheck(q(".live__tapecheck"));
  };
  const offUnits = onUnitsChange(redraw);
  window.addEventListener("jl-tape-change", redraw);
  renderTapeCheck(q(".live__tapecheck"));

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
    dropVideo();
    poll.stop(); beat.stop();
    wide.exit();
    voice.stop();
    document.removeEventListener("visibilitychange", keepAwake);
    offUnits(); offGuard(); offUnitSwitch();
    window.removeEventListener("jl-tape-change", redraw);
    wake?.release?.().catch?.(() => {});
    host.replaceChildren();
  }
  return { setScale, dispose, code };
}
