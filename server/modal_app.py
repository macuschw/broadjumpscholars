"""The JumpLab analysis server, on Modal (https://modal.com).

It runs the same analysis as the command line (jumplab/web.py: MediaPipe 0.10.14, then
analyze_keypoints), for videos uploaded from the website's Demo page. Modal starts it when a
request arrives and stops it a few minutes after the last one, so it costs nothing while idle.
Uploaded videos are written to a temporary file, analyzed, and deleted; nothing is stored.

One-time setup (from this repo's folder):
    python3 -m pip install modal
    python3 -m modal setup                       # log in or create the account in the browser
Deploy (and again after changing the analysis code):
    python3 -m modal deploy server/modal_app.py
Modal prints the server's URL (https://...modal.run). Put it in the website's
assets/js/config.js as ANALYSIS_URL.

Endpoints
    GET  /health                   wake the server (the Analyze page calls this on load)
    /jobs ...                      a video in pieces, analyzed in the background (jumplab/jobs.py):
                                   every jump in it, each with its verdict. No request comes near
                                   Modal's 150 s limit, however long the video or slow the wifi.
    POST /analyze?name=&fps=&scale=&event_method=    body: the video file -> website bundle
                                   (the older one-request upload; kept for pages not yet updated)
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
# A job's video pieces and its result (deleted once analyzed / collected), and every job's state
volume = modal.Volume.from_name("jumplab-jobs", create_if_missing=True)
job_states = modal.Dict.from_name("jumplab-job-states", create_if_missing=True)
JOBS_DIR = "/jobs"


class ModalJobs:
    """jobs.py's store on Modal: files in the Volume, states in the Dict, the analysis in
    process_job (its own container, so it can run as long as a video needs)."""

    def __init__(self, jobs):
        self.jobs = jobs

    def _folder(self, job_id):
        return os.path.join(JOBS_DIR, self.jobs.check_id(job_id))

    def _state(self, job_id):
        state = job_states.get(job_id)
        if state is None:
            raise self.jobs.JobError(404, "Unknown job (it may have expired). Upload the video again.")
        return state

    def create(self, options):
        import json
        import time
        import uuid
        job_id = uuid.uuid4().hex
        os.makedirs(self._folder(job_id))
        with open(os.path.join(self._folder(job_id), "options.json"), "w") as f:
            json.dump(options, f)
        volume.commit()
        job_states[job_id] = {"state": "uploading", "updated": time.time()}
        return job_id

    def put_chunk(self, job_id, i, data):
        self._state(job_id)
        os.makedirs(self._folder(job_id), exist_ok=True)
        with open(os.path.join(self._folder(job_id), f"chunk_{i:05d}"), "wb") as f:
            f.write(data)
        volume.commit()

    def start(self, job_id, n):
        import time
        self._state(job_id)
        job_states[job_id] = {"state": "queued", "updated": time.time()}
        process_job.spawn(job_id, n)

    def status(self, job_id):
        state = dict(self._state(job_id))
        if state["state"] == "done":
            import shutil
            volume.reload()
            state["result"] = self.jobs.read_result(self._folder(job_id))
            shutil.rmtree(self._folder(job_id), ignore_errors=True)   # collected: nothing is kept
            volume.commit()
            job_states.pop(job_id)
        return state


@app.function(cpu=2.0, memory=4096, timeout=1800, volumes={JOBS_DIR: volume})
def process_job(job_id: str, n_chunks: int):
    """One upload's analysis: join its pieces, find and judge every jump, save the result."""
    import shutil
    import time

    from jumplab import jobs

    volume.reload()
    for old in os.listdir(JOBS_DIR):                           # tidy jobs nobody came back for
        path = os.path.join(JOBS_DIR, old)
        if old != job_id and time.time() - os.path.getmtime(path) > jobs.KEEP_S:
            shutil.rmtree(path, ignore_errors=True)
    folder = os.path.join(JOBS_DIR, job_id)
    missing = [i for i in range(n_chunks) if not os.path.exists(os.path.join(folder, f"chunk_{i:05d}"))]
    if missing:
        job_states[job_id] = {"state": "error", "updated": time.time(),
                              "error": f"Part of the video didn't arrive (piece {missing[0] + 1} of {n_chunks}). Try again."}
        return
    try:
        jobs.run_job(folder, n_chunks, lambda st: job_states.put(job_id, {**st, "updated": time.time()}))
    finally:
        volume.commit()                                        # the result in, the video gone


@app.function(cpu=2.0, memory=4096, timeout=900, scaledown_window=300, volumes={JOBS_DIR: volume})
@modal.asgi_app()
def web():
    import tempfile

    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.middleware.gzip import GZipMiddleware
    from fastapi.responses import JSONResponse
    from starlette.concurrency import run_in_threadpool

    from jumplab import jobs
    from jumplab import web as jw

    api = FastAPI(title="JumpLab analysis", docs_url=None, redoc_url=None)
    api.add_middleware(CORSMiddleware, allow_origins=list(jw.ALLOWED_ORIGINS),
                       allow_methods=["GET", "POST", "PUT", "OPTIONS"], allow_headers=["Content-Type"])
    api.add_middleware(GZipMiddleware, minimum_size=2000)        # results are mostly numbers: ~10x smaller
    store = ModalJobs(jobs)

    @api.api_route("/jobs", methods=["POST"])
    @api.api_route("/jobs/{rest:path}", methods=["GET", "POST", "PUT"])
    async def job(request: Request, rest: str = ""):
        body = await request.body() if request.method == "PUT" else b""
        status, reply = await run_in_threadpool(jobs.route, store, request.method, request.url.path,
                                                dict(request.query_params), body) or (404, {"error": "Not found."})
        return JSONResponse(reply, status)

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
