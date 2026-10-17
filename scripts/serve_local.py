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

from jumplab import web  # noqa: E402


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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self._send(200, {"ok": True, "service": "jumplab-analysis", "where": "local"})
        self._send(404, {"error": "Not found."})

    def do_POST(self):
        url = urlparse(self.path)
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
