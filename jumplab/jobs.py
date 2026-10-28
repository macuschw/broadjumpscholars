"""Uploads as background jobs, so a long video (or slow wifi) never runs into a web request limit
(Modal: 150 s per request). The browser sends the video in pieces, starts the job, then asks for
its state every couple of seconds until the results are ready:

    POST /jobs?name=&fps=&scale=&event_method=   -> {"job": id, "chunk_bytes": CHUNK_BYTES}
    PUT  /jobs/<id>/<i>        body: piece i of the video (each at most CHUNK_BYTES)
    POST /jobs/<id>/start?chunks=n                -> the analysis starts in the background
    GET  /jobs/<id>            -> {"state": "uploading" | "queued" | "running" | "done" | "error",
                                   "stage", "done", "total", "error"?, "result"? (the session)}
    GET  /jobs/<id>/<i>        -> piece i, before the job starts: Measure live's phone uploads its
                                  recording and its remote screen (a laptop) downloads it from here
    DELETE /jobs/<id>          -> the job and its pieces are deleted (the remote screen has the video)

A store keeps each job's files and state: LocalJobs (a temporary folder and a thread, for
scripts/serve_local.py); the Modal server keeps them in a Volume and a Dict and runs the analysis
in a function of its own (server/modal_app.py). route() is the HTTP part both servers share.
The video is deleted as soon as the analysis ends (or when deleted, or after an hour if never
started); the results once they've been collected.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid

from . import web

CHUNK_BYTES = 8 * 1024 * 1024          # a piece takes seconds even on slow wifi, far under 150 s
MAX_CHUNKS = web.MAX_UPLOAD_BYTES // CHUNK_BYTES + 1
KEEP_S = 3600                          # forget jobs (and any results never collected) after an hour
_ID = re.compile(r"^[0-9a-f]{32}$")


class JobError(Exception):
    """A request the store can't do; .status is the HTTP status, the message is for the visitor."""
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def check_id(job_id):
    if not _ID.match(str(job_id)):
        raise JobError(404, "Unknown job.")
    return job_id


def join_chunks(folder, n):
    """The video from its pieces (chunk_00000 ...), as one file in `folder`; the pieces are removed."""
    with open(os.path.join(folder, "options.json")) as f:
        options = json.load(f)
    suffix = os.path.splitext(options["name"])[1][:8] or ".mp4"
    video = os.path.join(folder, "video" + suffix)
    with open(video, "wb") as out:
        for i in range(n):
            piece = os.path.join(folder, f"chunk_{i:05d}")
            with open(piece, "rb") as f:
                shutil.copyfileobj(f, out)
            os.unlink(piece)
    return video, options


def run_job(folder, n_chunks, set_state):
    """Join the pieces, analyze the video (web.analyze_session_upload), save the result as
    result.json.gz in `folder`, and delete the video. set_state(dict) reports progress."""
    video, last = None, {"t": 0.0, "stage": None}

    def report(stage, done, total):                            # at most twice a second, or a new stage
        if stage != last["stage"] or time.time() - last["t"] >= 0.5:
            last.update(t=time.time(), stage=stage)
            set_state({"state": "running", "stage": stage, "done": done, "total": total})
    try:
        video, options = join_chunks(folder, n_chunks)
        report("looking", 0, 1)
        result = web.analyze_session_upload(
            video, options["name"], options.get("fps"), options.get("scale"), options.get("event_method") or "ankle",
            progress=report)
        with gzip.open(os.path.join(folder, "result.json.gz"), "wt") as f:
            json.dump(result, f, separators=(",", ":"))
        set_state({"state": "done", "jumps": len(result["jumps"])})
    except Exception as e:                                     # noqa: BLE001 - the visitor gets a message
        from .events import NoJumpFound
        plain = isinstance(e, (NoJumpFound, ValueError, KeyError, TypeError))
        set_state({"state": "error", "error": web.visitor_message(e) if plain else "The analysis failed unexpectedly."})
        if not plain:
            raise
    finally:
        if video and os.path.exists(video):
            os.unlink(video)                                   # the video is never kept


def read_chunk(folder, i):
    """Piece i of a job's video, while the job hasn't started (once it has, the pieces are joined)."""
    try:
        with open(os.path.join(folder, f"chunk_{i:05d}"), "rb") as f:
            return f.read()
    except FileNotFoundError:
        raise JobError(404, "The video isn't on the server any more (it was analyzed, or it expired).") from None


def read_result(folder):
    with gzip.open(os.path.join(folder, "result.json.gz"), "rt") as f:
        return json.load(f)


class LocalJobs:
    """Jobs on this computer: a folder each under a temporary directory, the analysis in a thread."""

    def __init__(self, root=None):
        self.root = root or tempfile.mkdtemp(prefix="jumplab-jobs-")
        self.states, self.lock = {}, threading.Lock()

    def _folder(self, job_id):
        folder = os.path.join(self.root, check_id(job_id))
        if not os.path.isdir(folder):
            raise JobError(404, "Unknown job (it may have expired). Upload the video again.")
        return folder

    def _set(self, job_id, state):
        with self.lock:
            self.states[job_id] = {**state, "updated": time.time()}

    def _sweep(self):
        for job_id in list(self.states):
            if time.time() - self.states[job_id]["updated"] > KEEP_S:
                shutil.rmtree(os.path.join(self.root, job_id), ignore_errors=True)
                self.states.pop(job_id, None)

    def create(self, options):
        self._sweep()
        job_id = uuid.uuid4().hex
        os.makedirs(os.path.join(self.root, job_id))
        with open(os.path.join(self.root, job_id, "options.json"), "w") as f:
            json.dump(options, f)
        self._set(job_id, {"state": "uploading"})
        return job_id

    def put_chunk(self, job_id, i, data):
        folder = self._folder(job_id)
        with open(os.path.join(folder, f"chunk_{i:05d}"), "wb") as f:
            f.write(data)

    def get_chunk(self, job_id, i):
        return read_chunk(self._folder(job_id), i)

    def delete(self, job_id):
        shutil.rmtree(self._folder(job_id), ignore_errors=True)
        self.states.pop(job_id, None)

    def start(self, job_id, n):
        folder = self._folder(job_id)
        missing = [i for i in range(n) if not os.path.exists(os.path.join(folder, f"chunk_{i:05d}"))]
        if missing:
            raise JobError(409, f"Part of the video didn't arrive (piece {missing[0] + 1} of {n}). Try again.")
        self._set(job_id, {"state": "queued"})
        threading.Thread(target=run_job, args=(folder, n, lambda st: self._set(job_id, st)), daemon=True).start()

    def status(self, job_id):
        folder = self._folder(job_id)
        state = dict(self.states.get(job_id, {"state": "unknown"}))
        if state["state"] == "done":
            state["result"] = read_result(folder)
            shutil.rmtree(folder, ignore_errors=True)          # collected: nothing is kept
            self.states.pop(job_id, None)
        return state


def route(store, method, path, query, body=b""):
    """One /jobs request -> (HTTP status, JSON-able body, or bytes: a piece of a video); None if the
    path isn't a /jobs path."""
    parts = [p for p in path.split("/") if p]
    if not parts or parts[0] != "jobs":
        return None
    try:
        if method == "POST" and len(parts) == 1:
            options = web.options_from_query(query)
            web._check_options(options["fps"], options["scale"])
            return 200, {"job": store.create(options), "chunk_bytes": CHUNK_BYTES}
        if len(parts) >= 2:
            job_id = check_id(parts[1])
            if method == "PUT" and len(parts) == 3:
                i = int(parts[2]) if parts[2].isdigit() else -1
                if not 0 <= i < MAX_CHUNKS:
                    raise JobError(413, "That video is too large (over 800 MB). Trim it to the jumps.")
                if not body or len(body) > CHUNK_BYTES:
                    raise JobError(400, "A piece of the upload was empty or too large.")
                store.put_chunk(job_id, i, body)
                return 200, {"ok": True}
            if method == "POST" and len(parts) == 3 and parts[2] == "start":
                n = int(query.get("chunks") or 0)
                if not 1 <= n <= MAX_CHUNKS:
                    raise JobError(400, "Nothing was uploaded.")
                store.start(job_id, n)
                return 200, {"ok": True}
            if method == "GET" and len(parts) == 2:
                return 200, store.status(job_id)
            if method == "GET" and len(parts) == 3 and parts[2].isdigit():
                return 200, store.get_chunk(job_id, int(parts[2]))     # bytes: sent as they are
            if method == "DELETE" and len(parts) == 2:
                store.delete(job_id)
                return 200, {"ok": True}
        return 404, {"error": "Not found."}
    except JobError as e:
        return e.status, {"error": str(e)}
    except ValueError as e:
        return 422, {"error": web.visitor_message(e)}
