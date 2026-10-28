// Talking to the JumpLab analysis server (server/modal_app.py, or scripts/serve_local.py).
// A video goes up as a background job (analyzeSession): sent in pieces, analyzed on the server
// while this page asks how it's going, so a long video or slow wifi never hits a request limit.
// The reply is a session: every jump in the video, each a results bundle (demo/real.js).
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

const canceled = () => Object.assign(new Error("Canceled."), { canceled: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function ask(url, options = {}) {
  let res;
  try { res = await fetch(url, { mode: "cors", cache: "no-store", ...options }); } catch {
    throw Object.assign(new Error("Couldn't reach the analysis server. Check the connection and try again."), { network: true });
  }
  const text = await res.text();
  if (!res.ok) throw new Error(message(res, text));
  return JSON.parse(text);
}

/**
 * A video to the server in pieces, as a job not yet started (jumplab/jobs.py). onProgress(sent, size).
 * Each piece is tried up to three times, so a moment's wifi trouble doesn't lose it. Returns
 * { promise, abort }; the promise gives { job, chunks }. Measure live's phone hands its recording to
 * its remote screen this way; analyzeSession uploads with it.
 */
export function uploadVideo(file, { fps = null, scale = null, onProgress } = {}) {
  let stopped = false, xhr = null;
  const piece = (url, blob, sent) => new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.timeout = 120 * 1000;
    xhr.upload.onprogress = (e) => onProgress?.(sent + e.loaded, file.size);
    xhr.onload = () => (xhr.status === 200 ? resolve() : reject(new Error(message(xhr, xhr.responseText))));
    xhr.onerror = xhr.ontimeout = () => reject(Object.assign(new Error("The upload was interrupted. Check the connection and try again."), { network: true }));
    xhr.onabort = () => reject(canceled());
    xhr.send(blob);
  });
  const promise = (async () => {
    if (!serverURL) throw new Error("Video analysis isn't switched on for this site yet.");
    const q = new URLSearchParams({ name: file.name });
    if (fps) q.set("fps", String(fps));
    if (scale) q.set("scale", String(scale));                   // already known (live measuring): no calibration step
    const job = await ask(`${serverURL}/jobs?${q}`, { method: "POST" });
    const size = job.chunk_bytes, n = Math.max(1, Math.ceil(file.size / size));
    for (let i = 0; i < n; i++) {
      for (let attempt = 1; ; attempt++) {
        if (stopped) throw canceled();
        try { await piece(`${serverURL}/jobs/${job.job}/${i}`, file.slice(i * size, (i + 1) * size), i * size); break; } catch (e) {
          if (e.canceled || !e.network || attempt >= 3) throw e;
          await pause(1500 * attempt);
        }
      }
    }
    onProgress?.(file.size, file.size);
    return { job: job.job, chunks: n };
  })();
  return { promise, abort: () => { stopped = true; xhr?.abort(); } };
}

/**
 * A video uploaded with uploadVideo, back from the server piece by piece (a phone's live recording,
 * on its remote screen). onProgress(received, size). Returns { promise, abort }; the promise gives a File.
 */
export function downloadVideo({ job, chunks, size, name, type }, { onProgress } = {}) {
  let stopped = false, xhr = null;
  const piece = (url, got) => new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "blob";
    xhr.timeout = 120 * 1000;
    xhr.onprogress = (e) => onProgress?.(got + e.loaded, size);
    xhr.onload = () => (xhr.status === 200 ? resolve(xhr.response)
      : xhr.response.text().then((text) => reject(new Error(message(xhr, text))), () => reject(new Error(message(xhr, "")))));
    xhr.onerror = xhr.ontimeout = () => reject(Object.assign(new Error("The download was interrupted. Check the connection and try again."), { network: true }));
    xhr.onabort = () => reject(canceled());
    xhr.send();
  });
  const promise = (async () => {
    const parts = [];
    let got = 0;
    for (let i = 0; i < chunks; i++) {
      for (let attempt = 1; ; attempt++) {
        if (stopped) throw canceled();
        try { parts.push(await piece(`${serverURL}/jobs/${job}/${i}`, got)); break; } catch (e) {
          if (e.canceled || !e.network || attempt >= 3) throw e;
          await pause(1500 * attempt);
        }
      }
      got += parts.at(-1).size;
    }
    onProgress?.(got, size);
    return new File(parts, name, { type });
  })();
  return { promise, abort: () => { stopped = true; xhr?.abort(); } };
}

/** Delete an uploaded video that won't be analyzed (it's on the remote screen now). Best effort. */
export function forgetVideo(job) {
  if (serverURL && job) fetch(`${serverURL}/jobs/${job}`, { method: "DELETE", mode: "cors", keepalive: true }).catch(() => {});
}

/**
 * A video with one jump or several, analyzed as a background job (jumplab/jobs.py on the server).
 * onProgress(stage, done, total): "upload" (bytes sent of the file's size), then "looking" (frames
 * looked at), "tracking" (stretch done of all), "analyzing" (jump done of all). A few failed checks
 * in a row are waited out. uploaded: { job, chunks } when the video is on the server already (a
 * phone's live recording, handed to its remote screen): no second upload, unless it's gone.
 * Returns { promise, abort }; the promise gives the session.
 */
export function analyzeSession(file, { fps = null, scale = null, uploaded = null, onProgress } = {}) {
  let stopped = false, up = null;
  const promise = (async () => {
    if (!serverURL) throw new Error("Video analysis isn't switched on for this site yet.");
    let job = null;
    if (uploaded) {
      try {
        await ask(`${serverURL}/jobs/${uploaded.job}/start?chunks=${uploaded.chunks}`, { method: "POST" });
        job = uploaded.job;
        onProgress?.("upload", file.size, file.size);
      } catch (e) { if (e.network) throw e; }                  // gone (expired, or analyzed already): upload it
    }
    if (!job) {
      if (stopped) throw canceled();
      up = uploadVideo(file, { fps, scale, onProgress: (sent, size) => onProgress?.("upload", sent, size) });
      const { job: id, chunks } = await up.promise;
      await ask(`${serverURL}/jobs/${id}/start?chunks=${chunks}`, { method: "POST" });
      job = id;
    }
    for (let misses = 0; ; ) {
      await pause(2000);
      if (stopped) throw canceled();
      let st;
      try { st = await ask(`${serverURL}/jobs/${job}`); misses = 0; } catch (e) {
        if (!e.network || ++misses >= 10) throw e;
        continue;
      }
      if (st.state === "done") return st.result;
      if (st.state === "error") throw new Error(st.error || "The analysis failed.");
      if (st.state === "running") onProgress?.(st.stage, st.done, st.total);
    }
  })();
  return { promise, abort: () => { stopped = true; up?.abort(); } };
}

/** Analyze a bundle's landmarks again with a new scale (no video upload). */
export async function recompute(bundle, { scale }) {
  const r = bundle.results;
  const res = await fetch(`${serverURL}/recompute`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      landmarks: bundle.landmarks, name: bundle.name, scale, still: bundle.still, jump: r.jump ?? null,
      event_method: r.event_method, fps: r.fps_source === "override" ? r.fps : null,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(message(res, text));
  return JSON.parse(text);
}
