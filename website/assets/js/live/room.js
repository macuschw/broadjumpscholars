// Measure live with a remote screen: the phone on the tripod and a laptop (or another phone) pass
// messages through a short-lived room on the rooms server (jumplab/rooms.py). Each side writes its
// own slot and reads the other's about once a second; nothing about the jumps is kept there.
//
//   the phone writes  "phone"   { stage, status, air, jumps, previewId, stillId }
//                     "preview" { id, jpeg }   a small picture of what it sees, while someone watches
//                     "still"   { id, ...frame }   a full frame for marking the tape, when asked
//   the remote writes "remote"  { cmds: [{ id, type: "still" | "scale" | "stop" | "again", ... }] }
import { roomsServer } from "../config.js";

const BASE = roomsServer();
export const cleanCode = (text) => String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const isCode = (code) => /^[A-HJ-NP-Z2-9]{6}$/.test(code);   // the server's alphabet: no O/0, I/1

async function call(method, path, value) {
  if (!BASE) throw new Error("The remote screen needs the JumpLab server, which isn't set up for this site.");
  let r;
  try {
    r = await fetch(`${BASE}/rooms${path}`, value === undefined ? { method, cache: "no-store" }
      : { method, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  } catch {
    throw Object.assign(new Error("No connection to the JumpLab server."), { status: 0 });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `The server answered ${r.status}.`), { status: r.status });
  return data;
}
export const openRoom = () => call("POST", "").then((d) => d.code);
export const send = (code, slot, value) => call("PUT", `/${code}/${slot}`, value);
export const read = (code, slot) => call("GET", `/${code}/${slot}`);                 // -> { value, age }

/** step() again and again, `ms` apart (a number, or a function giving one), or at once after soon(). */
export function repeat(ms, step) {
  let stopped = false, hurry = false, wake = null;
  (async () => {
    while (!stopped) {
      try { await step(); } catch { /* the next round tries again */ }
      if (stopped) break;
      if (!hurry) await new Promise((done) => { const t = setTimeout(done, typeof ms === "function" ? ms() : ms); wake = () => { clearTimeout(t); done(); }; });
      hurry = false; wake = null;
    }
  })();
  return { soon() { hurry = true; wake?.(); }, stop() { stopped = true; wake?.(); } };
}

/**
 * The phone's side: sends what it shows (state(), picture() while the remote watches, still() when
 * asked for the tape) and passes the remote's other commands to onCommand. onLink(how) says how the
 * link is: "watching" (the remote is there), "waiting" (not yet / not lately), "lost" (no
 * connection), "gone" (no such room: it closed or the code was wrong).
 */
export function linkPhone(code, { state, picture, still, onCommand, onLink }) {
  let lastCmd = null, sent = "", sentAt = 0, picAt = 0, picId = 0, stillId = null, remoteAge = Infinity, misses = 0, how = "";
  const tell = (h) => { if (h !== how) { how = h; onLink(h); } };
  const loop = repeat(700, async () => {
    try {
      const { value, age } = await read(code, "remote");
      misses = 0;
      remoteAge = age ?? Infinity;
      const cmds = value?.cmds || [];
      if (lastCmd === null) lastCmd = Math.max(0, ...cmds.map((c) => c.id));   // older ones were for an earlier session
      for (const c of cmds.filter((c) => c.id > lastCmd)) {
        lastCmd = c.id;
        if (c.type === "still") {
          const frame = still();
          if (frame) { await send(code, "still", { id: c.id, ...frame }); stillId = c.id; }
        } else onCommand(c);
      }
    } catch (e) {
      if (e.status === 404) { tell("gone"); loop.stop(); return; }
      if (++misses >= 4) tell("lost");
      throw e;
    }
    tell(remoteAge < 15 ? "watching" : "waiting");
    const now = Date.now(), s = state();
    if (remoteAge < 15 && now - picAt > (s.stage === "measuring" ? 3000 : 1000)) {   // a picture while someone watches
      const jpeg = picture();
      if (jpeg) { await send(code, "preview", { id: picId + 1, jpeg }); picId++; picAt = now; }
    }
    const msg = JSON.stringify({ ...s, previewId: picId, stillId });
    if (msg !== sent || now - sentAt > 2000) { await send(code, "phone", JSON.parse(msg)); sent = msg; sentAt = now; }
  });
  return {
    code,
    soon: loop.soon,
    /** reason: told to the remote ("back", "analyzing", "disconnected"); null: say nothing (a new session follows). */
    stop(reason = "back") { loop.stop(); if (reason) send(code, "phone", { ...state(), stage: "closed", reason }).catch(() => {}); },
  };
}
