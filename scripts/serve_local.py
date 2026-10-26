"""Run the JumpLab analysis server on this computer.

The website's Demo page can send a video here instead of to the cloud server: handy for
testing, or for a team running analyses on a laptop. It does exactly what the cloud server does
(jumplab/web.py), keeps nothing, and only answers the JumpLab site and localhost.

    python scripts/serve_local.py              # then open the site with ?server=http://localhost:8765
    python scripts/serve_local.py --port 9000
"""
import argparse
import json
import os
import sys
import tempfile
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from jumplab import jobs, rooms, web  # noqa: E402

JOBS = jobs.LocalJobs()                                         # uploads in pieces, analyzed in the background
ROOMS = rooms.Rooms({})                                         # Measure live's remote screens


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in web.ALLOWED_ORIGINS or origin.startswith(("http://localhost:", "http://127.0.0.1:")):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _send(self, status, body):
        data = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):                                      # CORS preflight
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self._send(200, {"ok": True, "service": "jumplab-analysis", "where": "local"})
        reply = rooms.route(ROOMS, "GET", url.path) or jobs.route(JOBS, "GET", url.path, dict(parse_qsl(url.query)))
        self._send(*(reply or (404, {"error": "Not found."})))

    def _rooms(self, method):
        """/rooms requests (jumplab/rooms.py): a phone and its remote screen passing messages."""
        size = int(self.headers.get("Content-Length") or 0)
        if size > rooms.MAX_BYTES:
            return self._send(413, {"error": "That message was too large."})
        body = self.rfile.read(size) if size else b""
        self._send(*rooms.route(ROOMS, method, urlparse(self.path).path, body))

    def _jobs(self, method):
        """/jobs requests (jumplab/jobs.py): a piece of a video, starting a job."""
        url = urlparse(self.path)
        size = int(self.headers.get("Content-Length") or 0)
        if size > jobs.CHUNK_BYTES:
            return self._send(400, {"error": "A piece of the upload was too large."})
        body = self.rfile.read(size) if size else b""
        reply = jobs.route(JOBS, method, url.path, dict(parse_qsl(url.query)), body)
        if url.path.endswith("/start"):
            print(f"{url.path} -> {reply[0] if reply else 404}")
        self._send(*(reply or (404, {"error": "Not found."})))

    def do_PUT(self):
        if urlparse(self.path).path.startswith("/rooms"):
            return self._rooms("PUT")
        self._jobs("PUT")

    def do_POST(self):
        url = urlparse(self.path)
        if url.path.startswith("/rooms"):
            return self._rooms("POST")
        if url.path.startswith("/jobs"):
            return self._jobs("POST")
        size = int(self.headers.get("Content-Length") or 0)
        if size <= 0:
            return self._send(400, {"error": "Nothing was uploaded."})
        if size > web.MAX_UPLOAD_BYTES:
            return self._send(413, {"error": "That video is too large (over 800 MB). Trim it to the jump."})
        t0 = time.time()
        try:
            if url.path == "/analyze":
                options = web.options_from_query(dict(parse_qsl(url.query)))
                suffix = os.path.splitext(options["name"])[1][:8] or ".mp4"
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                    left = size
                    while left:
                        chunk = self.rfile.read(min(left, 1 << 20))
                        if not chunk:
                            break
                        f.write(chunk)
                        left -= len(chunk)
                try:
                    status, body = web.handle("analyze", video_path=f.name, options=options)
                finally:
                    os.unlink(f.name)                          # nothing is kept
            elif url.path == "/recompute":
                status, body = web.handle("recompute", payload=json.loads(self.rfile.read(size)))
            else:
                status, body = 404, {"error": "Not found."}
        except Exception:                                      # noqa: BLE001 - report, don't crash
            traceback.print_exc()
            status, body = 500, {"error": "The analysis failed unexpectedly."}
        print(f"{url.path} -> {status} in {time.time() - t0:.1f} s")
        self._send(status, body)

    def log_message(self, *args):                              # quieter: one line per request above
        pass


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    print(f"JumpLab analysis server on http://localhost:{args.port}  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
