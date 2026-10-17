"""The JumpLab analysis server, on Modal (https://modal.com).

It runs the same analysis as the command line (jumplab/web.py: MediaPipe 0.10.14, then
analyze_keypoints), for videos uploaded from the website's Demo page. Modal starts it when a
request arrives and stops it a few minutes after the last one, so it costs nothing while idle.
Uploaded videos are written to a temporary file, analysed, and deleted; nothing is stored.

One-time setup (from this repo's folder):
    python3 -m pip install modal
    python3 -m modal setup                       # log in or create the account in the browser
Deploy (and again after changing the analysis code):
    python3 -m modal deploy server/modal_app.py
Modal prints the server's URL (https://...modal.run). Put it in the website's
assets/js/config.js as ANALYSIS_URL.

Endpoints
    GET  /health                   wake the server (the Demo page calls this on load)
    POST /analyze?name=&fps=&scale=&event_method=    body: the video file -> website bundle
    POST /recompute                body: {"landmarks", "name", "fps", "scale", "event_method", "still"}
                                   -> bundle (e.g. once the visitor has clicked the tape)
"""
import os
import sys
from pathlib import Path
from typing import Optional

import modal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # so `jumplab` can be added to the image

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0", "libegl1", "libgles2")   # OpenCV / MediaPipe need these
    # Exact versions in two steps, so pip never has to search for a combination that fits
    .pip_install("numpy==1.26.4", "scipy==1.13.1", "opencv-contrib-python==4.10.0.84", "protobuf==4.25.5")
    .pip_install("mediapipe==0.10.14")
    .pip_install("fastapi==0.115.6")
    .add_local_python_source("jumplab")
)
app = modal.App("jumplab-analysis", image=image)


@app.function(cpu=2.0, memory=4096, timeout=900, scaledown_window=300)
@modal.asgi_app()
def web():
    import tempfile

    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from starlette.concurrency import run_in_threadpool

    from jumplab import web as jw

    api = FastAPI(title="JumpLab analysis", docs_url=None, redoc_url=None)
    api.add_middleware(CORSMiddleware, allow_origins=list(jw.ALLOWED_ORIGINS),
                       allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type"])

    @api.get("/health")
    def health():
        return {"ok": True, "service": "jumplab-analysis", "where": "modal"}

    @api.post("/analyze")
    async def analyze(request: Request, name: str = "video.mp4", fps: Optional[str] = None,
                      scale: Optional[str] = None, event_method: str = "ankle"):
        options = jw.options_from_query({"name": name, "fps": fps, "scale": scale, "event_method": event_method})
        suffix = os.path.splitext(options["name"])[1][:8] or ".mp4"
        size = 0
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            path = f.name
            async for chunk in request.stream():
                size += len(chunk)
                if size > jw.MAX_UPLOAD_BYTES:
                    break
                f.write(chunk)
        try:
            if size > jw.MAX_UPLOAD_BYTES:
                return JSONResponse({"error": "That video is too large (over 800 MB). Trim it to the jump."}, 413)
            if size == 0:
                return JSONResponse({"error": "Nothing was uploaded."}, 400)
            status, body = await run_in_threadpool(jw.handle, "analyze", video_path=path, options=options)
        finally:
            os.unlink(path)                                          # nothing is kept
        return JSONResponse(body, status)

    @api.post("/recompute")
    async def recompute(request: Request):
        status, body = await run_in_threadpool(jw.handle, "recompute", payload=await request.json())
        return JSONResponse(body, status)

    return api
