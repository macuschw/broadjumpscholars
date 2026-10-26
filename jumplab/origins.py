"""The websites allowed to call the JumpLab servers (CORS): the published site and local test copies.
Its own module so the small rooms server (jumplab/rooms.py) can use it without the analysis code."""
ALLOWED_ORIGINS = ("https://macuschw.github.io", "http://localhost:4321", "http://127.0.0.1:4321",
                   "http://localhost:8000", "http://127.0.0.1:8000")
