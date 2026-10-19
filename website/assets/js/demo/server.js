// Talking to the JumpLab analysis server (server/modal_app.py, or scripts/serve_local.py).
// The video is sent as the request body; the reply is a results bundle (demo/real.js).
import { analysisServer } from "../config.js";

export const serverURL = analysisServer();

/** Wake the server early (a sleeping cloud server takes a few seconds to start). */
export function wake() {
  if (serverURL) fetch(`${serverURL}/health`, { mode: "cors", cache: "no-store" }).catch(() => {});
}

const message = (xhrOrRes, text) => {
  try { const body = JSON.parse(text); if (body?.error) return body.error; } catch { /* not JSON */ }
  return xhrOrRes.status === 413 ? "That video is too large. Trim it to the jump and try again."
    : `The analysis server had a problem (${xhrOrRes.status}). Try again in a moment.`;
};

/**
 * Upload a video and analyze it. onProgress(stage, fraction): "upload" with 0..1 while sending,
 * then "analyze" once the server has it. Returns { promise, abort }.
 */
export function analyzeVideo(file, { fps = null, onProgress } = {}) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    if (!serverURL) { reject(new Error("Video analysis isn't switched on for this site yet.")); return; }
    const q = new URLSearchParams({ name: file.name });
    if (fps) q.set("fps", String(fps));
    xhr.open("POST", `${serverURL}/analyze?${q}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.timeout = 15 * 60 * 1000;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.("upload", e.loaded / e.total); };
    xhr.upload.onload = () => onProgress?.("analyze", 0);
    xhr.onload = () => {
      if (xhr.status === 200) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("The server's reply couldn't be read.")); }
      } else reject(new Error(message(xhr, xhr.responseText)));
    };
    xhr.onerror = () => reject(new Error("Couldn't reach the analysis server. Check the connection and try again."));
    xhr.ontimeout = () => reject(new Error("The analysis took too long. Try a shorter clip, trimmed to the jump."));
    xhr.onabort = () => reject(Object.assign(new Error("Canceled."), { canceled: true }));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Analyze a bundle's landmarks again with a new scale (no video upload). */
export async function recompute(bundle, { scale }) {
  const r = bundle.results;
  const res = await fetch(`${serverURL}/recompute`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      landmarks: bundle.landmarks, name: bundle.name, scale, still: bundle.still,
      event_method: r.event_method, fps: r.fps_source === "override" ? r.fps : null,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(message(res, text));
  return JSON.parse(text);
}
