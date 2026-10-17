// Where the Demo page sends a video for analysis: the JumpLab analysis server
// (server/modal_app.py in the jumplab-analysis repo; deploy it, then paste its URL here).
// While this is empty, the Demo page still opens results files from the JumpLab app, and the
// sample jump; only "analyse a video" waits for the server.
export const ANALYSIS_URL = "https://macuschw--jumplab-analysis-web.us-east.modal.run";

/**
 * The analysis server to use: ANALYSIS_URL, or a server on this computer given once as
 * ?server=http://localhost:8765 (for testing scripts/serve_local.py). Only localhost is accepted
 * from the address bar, so a link can never send someone's video to another site.
 */
export function analysisServer() {
  let local = null;
  try {
    const asked = new URLSearchParams(location.search).get("server");
    if (asked !== null) sessionStorage.setItem("jl-server", asked);
    local = sessionStorage.getItem("jl-server");
  } catch { /* storage blocked: fine */ }
  if (local) {
    try {
      const u = new URL(local);
      if (["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol === "http:") return u.origin;
    } catch { /* not a URL */ }
  }
  return ANALYSIS_URL.replace(/\/+$/, "") || null;
}
