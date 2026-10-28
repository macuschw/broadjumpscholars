"""The JumpLab analysis server, on Modal (https://modal.com).

It runs the same analysis as the command line (jumplab/web.py: MediaPipe 0.10.14, then
analyze_keypoints), for videos uploaded from the website's Demo page. Modal starts it when a
request arrives and stops it a few minutes after the last one, so it costs nothing while idle.
Uploaded videos are analyzed and deleted; nothing is stored. (A live recording handed to a remote
screen waits until the remote screen has saved or analyzed it; tidy_jobs clears anything left
behind every hour.)

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
                                   Also how Measure live's phone hands its recording to its remote
                                   screen (pieces read back before the job starts, then deleted).
    POST /analyze?name=&fps=&scale=&event_method=    body: the video file -> website bundle
                                   (the older one-request upload; kept for pages not yet updated)
    POST /recompute                body: {"landmarks", "name", "fps", "scale", "event_method", "still"}
                                   -> bundle (e.g. once the visitor has clicked the tape)

A second, small server (the `rooms` function, its own URL: ...-rooms.modal.run) passes messages
between a phone measuring live and its remote screen (jumplab/rooms.py). Both poll it about once a
second for a whole session, so it runs on a fraction of a CPU, apart from the analysis machine.
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
# The rooms server needs only FastAPI: a small image that starts in a second or two
rooms_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi==0.115.6").add_local_python_source("jumplab")
room_store = modal.Dict.from_name("jumplab-rooms", create_if_missing=True)


def tidy_jobs_dir(keep_s, skip=None):
    """Delete uploads nobody came back for: never started (a live recording a remote screen never
    took), or results never collected. Runs hourly (tidy_jobs), and before each new job."""
    import shutil
    import time
    for old in os.listdir(JOBS_DIR):
        path = os.path.join(JOBS_DIR, old)
        if old != skip and time.time() - os.path.getmtime(path) > keep_s:
            shutil.rmtree(path, ignore_errors=True)
            job_states.pop(old, None)


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
        tidy_jobs_dir(self.jobs.KEEP_S)
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

    def get_chunk(self, job_id, i):
        self._state(job_id)
        volume.reload()                                        # (the pieces may have come in elsewhere)
        return self.jobs.read_chunk(self._folder(job_id), i)

    def delete(self, job_id):
        import shutil
        self.jobs.check_id(job_id)
        shutil.rmtree(self._folder(job_id), ignore_errors=True)
        volume.commit()
        job_states.pop(job_id, None)

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
    import time

    from jumplab import jobs

    volume.reload()
    tidy_jobs_dir(jobs.KEEP_S, skip=job_id)
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


@app.function(cpu=0.25, memory=1024, schedule=modal.Period(hours=1), volumes={JOBS_DIR: volume})
def tidy_jobs():
    """Hourly, so nothing uploaded stays on the server longer than about an hour, even when nobody
    starts another job (Modal's free plan allows 5 scheduled functions; this is the only one)."""
    from jumplab import jobs
    volume.reload()
    tidy_jobs_dir(jobs.KEEP_S)
    volume.commit()


@app.function(cpu=2.0, memory=4096, timeout=900, scaledown_window=300, volumes={JOBS_DIR: volume})
@modal.asgi_app()
def web():
    import tempfile

    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.middleware.gzip import GZipMiddleware
    from fastapi.responses import JSONResponse, Response
    from starlette.concurrency import run_in_threadpool

    from jumplab import jobs
    from jumplab import web as jw
    from jumplab.origins import ALLOWED_ORIGINS

    api = FastAPI(title="JumpLab analysis", docs_url=None, redoc_url=None)
    api.add_middleware(CORSMiddleware, allow_origins=list(ALLOWED_ORIGINS),
                       allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Content-Type"])
    api.add_middleware(GZipMiddleware, minimum_size=2000)        # results are mostly numbers: ~10x smaller
    store = ModalJobs(jobs)

    @api.api_route("/jobs", methods=["POST"])
    @api.api_route("/jobs/{rest:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def job(request: Request, rest: str = ""):
        body = await request.body() if request.method == "PUT" else b""
        status, reply = await run_in_threadpool(jobs.route, store, request.method, request.url.path,
                                                dict(request.query_params), body) or (404, {"error": "Not found."})
        if isinstance(reply, bytes):                               # a piece of a video, for a remote screen
            return Response(reply, status, media_type="application/octet-stream")
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


class MemoryFirst:
    """The rooms' store: this container's memory in front of the Dict. One container serves every
    room (max_containers=1), so memory is always current and reads skip the Dict (~0.25 s each);
    writes also go to the Dict in the background, in order, so a restarted container carries on."""

    def __init__(self, store):
        from concurrent.futures import ThreadPoolExecutor
        self.store, self.memory = store, {}
        self.writer = ThreadPoolExecutor(max_workers=1)        # one thread: the Dict sees writes in order

    def get(self, key, default=None):
        if key not in self.memory:
            self.memory[key] = self.store.get(key)             # (None: not there; rooms never store None)
        value = self.memory[key]
        return default if value is None else value

    def __setitem__(self, key, value):
        self.memory[key] = value
        self.writer.submit(self.store.__setitem__, key, value)

    def __contains__(self, key):
        return self.get(key) is not None

    def pop(self, key, default=None):
        self.memory[key] = None
        self.writer.submit(self.store.pop, key, None)
        return default

    def keys(self):
        return {k for k in self.store.keys() if self.memory.get(k, True) is not None} | {k for k, v in self.memory.items() if v is not None}


@app.function(image=rooms_image, cpu=0.25, memory=256, scaledown_window=120, max_containers=1)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def rooms():
    """Measure live's remote screens (jumplab/rooms.py): a phone and a remote passing messages."""
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from starlette.concurrency import run_in_threadpool

    from jumplab import rooms as rm
    from jumplab.origins import ALLOWED_ORIGINS

    api = FastAPI(title="JumpLab rooms", docs_url=None, redoc_url=None)
    api.add_middleware(CORSMiddleware, allow_origins=list(ALLOWED_ORIGINS),
                       allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Content-Type"], max_age=3600)
    store = rm.Rooms(MemoryFirst(room_store))

    @api.api_route("/rooms", methods=["POST"])
    @api.api_route("/rooms/{rest:path}", methods=["GET", "PUT"])
    async def room(request: Request, rest: str = ""):
        body = await request.body() if request.method == "PUT" else b""
        if len(body) > rm.MAX_BYTES:
            return JSONResponse({"error": "That message was too large."}, 413)
        status, reply = await run_in_threadpool(rm.route, store, request.method, request.url.path, body) or (404, {"error": "Not found."})
        return JSONResponse(reply, status)

    @api.get("/health")
    def health():
        return {"ok": True, "service": "jumplab-rooms", "where": "modal"}

    return api
