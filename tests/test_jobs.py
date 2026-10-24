"""Uploads as background jobs (jumplab/jobs.py): pieces in, the analysis in the background, the
state polled until the results come back; nothing kept afterwards."""
import os
import time

import pytest

from jumplab import jobs, web
from jumplab.events import NoJumpFound

VIDEO = b"pretend this is a video " * 1000


@pytest.fixture
def store(tmp_path):
    return jobs.LocalJobs(str(tmp_path))


def _upload(store, data, piece=10_000, query=None):
    status, body = jobs.route(store, "POST", "/jobs", query or {"name": "session.mov", "fps": "120"})
    assert status == 200 and body["chunk_bytes"] == jobs.CHUNK_BYTES
    job = body["job"]
    pieces = [data[i:i + piece] for i in range(0, len(data), piece)]
    for i, p in enumerate(pieces):
        assert jobs.route(store, "PUT", f"/jobs/{job}/{i}", {}, p) == (200, {"ok": True})
    return job, len(pieces)


def _wait(store, job, timeout=10):
    t0 = time.time()
    while time.time() - t0 < timeout:
        status, state = jobs.route(store, "GET", f"/jobs/{job}", {})
        if state["state"] in ("done", "error"):
            return status, state
        time.sleep(0.02)
    raise AssertionError("the job never finished")


def test_a_video_in_pieces_is_joined_analyzed_and_then_forgotten(store, monkeypatch):
    seen = {}

    def analyze(path, name, fps, scale, event_method, progress=None):
        with open(path, "rb") as f:
            seen["video"], seen["name"], seen["fps"] = f.read(), name, fps
        progress("tracking", 1, 3)
        return {"format": web.SESSION_FORMAT, "jumps": [{"n": 1}, {"n": 2}], "best": 2}
    monkeypatch.setattr(web, "analyze_session_upload", analyze)
    job, n = _upload(store, VIDEO)
    assert jobs.route(store, "POST", f"/jobs/{job}/start", {"chunks": str(n)}) == (200, {"ok": True})
    status, state = _wait(store, job)
    assert status == 200 and state["state"] == "done" and state["result"]["best"] == 2
    assert seen == {"video": VIDEO, "name": "session.mov", "fps": 120.0}
    assert not os.path.exists(os.path.join(store.root, job))            # collected: nothing kept
    assert jobs.route(store, "GET", f"/jobs/{job}", {})[0] == 404


def test_a_problem_with_the_video_comes_back_as_a_plain_message(store, monkeypatch):
    def analyze(*a, **k):
        raise NoJumpFound("No jump was found in this video.")
    monkeypatch.setattr(web, "analyze_session_upload", analyze)
    job, n = _upload(store, VIDEO)
    jobs.route(store, "POST", f"/jobs/{job}/start", {"chunks": str(n)})
    _, state = _wait(store, job)
    assert state["state"] == "error" and "No complete jump" in state["error"]
    assert not any(f.startswith("video") for f in os.listdir(os.path.join(store.root, job)))   # deleted


def test_bad_requests_are_refused_plainly(store):
    assert jobs.route(store, "GET", "/jobs/not-a-job", {})[0] == 404
    assert jobs.route(store, "GET", "/somewhere/else", {}) is None
    job, n = _upload(store, VIDEO)
    status, body = jobs.route(store, "POST", f"/jobs/{job}/start", {"chunks": str(n + 1)})
    assert status == 409 and "didn't arrive" in body["error"]
    assert jobs.route(store, "PUT", f"/jobs/{job}/0", {}, b"")[0] == 400
    assert jobs.route(store, "PUT", f"/jobs/{job}/0", {}, b"x" * (jobs.CHUNK_BYTES + 1))[0] == 400
    assert jobs.route(store, "PUT", f"/jobs/{job}/{jobs.MAX_CHUNKS}", {}, b"x")[0] == 413
    assert jobs.route(store, "POST", "/jobs", {"scale": "5"})[0] == 422
