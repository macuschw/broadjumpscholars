"""Rooms: a phone filming with Measure live, and a remote screen (a laptop, another phone) that
shows its distances and runs it, so nobody has to touch the phone on the tripod.

The two never talk directly. Each writes its own slot in a short-lived room on the server and
reads the other's about once a second (website/assets/js/live/room.js). A room is forgotten an
hour after anything was last written to it; nothing in it is kept.

    POST /rooms                    -> {"code": "K7P2QX"}   (the remote screen opens one)
    PUT  /rooms/<code>/<slot>      body: JSON -> {"ok": true}
    GET  /rooms/<code>/<slot>      -> {"value": JSON or null, "age": seconds since it was written}
Slots: "phone" (its stage, status line and jumps), "preview" (a small picture of what it sees),
"still" (a full frame, for marking the tape), "remote" (the remote's commands: scale, stop...).

Only the standard library: the rooms server runs in its own small container on Modal.
"""
from __future__ import annotations

import json
import re
import secrets
import time

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no O/0 or I/1: easy to read off a screen and type
CODE_LEN = 6
SLOTS = ("phone", "preview", "still", "remote")
MAX_BYTES = 2_000_000                           # the largest message: a full frame (~0.5 MB)
KEEP_S = 3600                                   # forget a room an hour after its last message
_CODE = re.compile(f"^[{ALPHABET}]{{{CODE_LEN}}}$")


class RoomError(Exception):
    """A request that can't be served: its HTTP status and a message for the visitor."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def check_code(code):
    code = str(code or "").upper()
    if not _CODE.match(code):
        raise RoomError(404, "That code doesn't look right: it's 6 letters and numbers, from the remote screen.")
    return code


class Rooms:
    """Rooms kept in any dict-like store: a plain dict on this computer, a modal.Dict on Modal.
    Keys: "<code>" -> when the room was last written to; "<code>/<slot>" -> {"v": value, "t": time}.
    Each slot has one writer (the phone or the remote), so two writers never overwrite each other."""

    def __init__(self, kv, clock=time.time):
        self.kv, self.clock = kv, clock

    def create(self):
        now = self.clock()
        for key in list(self.kv.keys()):                       # tidy rooms nobody came back to
            if "/" not in key and now - self.kv.get(key, now) > KEEP_S:
                for k in [key] + [f"{key}/{s}" for s in SLOTS]:
                    self.kv.pop(k, None)
        code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))
        while code in self.kv:
            code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))
        self.kv[code] = now
        return code

    def _check(self, code):
        touched = self.kv.get(code)
        if touched is None or self.clock() - touched > KEEP_S:
            raise RoomError(404, "No remote screen has that code (or it closed). Check the code on the remote screen.")

    def put(self, code, slot, value):
        self._check(code)
        now = self.clock()
        self.kv[f"{code}/{slot}"] = {"v": value, "t": now}
        self.kv[code] = now

    def get(self, code, slot):
        self._check(code)
        entry = self.kv.get(f"{code}/{slot}")
        if entry is None:
            return None, None
        return entry["v"], round(max(0.0, self.clock() - entry["t"]), 2)


def route(store, method, path, body=b""):
    """One /rooms request -> (HTTP status, JSON-able body); None if the path isn't a /rooms path."""
    parts = [p for p in path.split("/") if p]
    if not parts or parts[0] != "rooms":
        return None
    try:
        if method == "POST" and len(parts) == 1:
            return 200, {"code": store.create()}
        if len(parts) == 3 and parts[2] in SLOTS:
            code = check_code(parts[1])
            if method == "PUT":
                if len(body) > MAX_BYTES:
                    raise RoomError(413, "That message was too large.")
                try:
                    value = json.loads(body or b"null")
                except ValueError:
                    raise RoomError(400, "That message wasn't readable.") from None
                store.put(code, parts[2], value)
                return 200, {"ok": True}
            if method == "GET":
                value, age = store.get(code, parts[2])
                return 200, {"value": value, "age": age}
        return 404, {"error": "Not found."}
    except RoomError as e:
        return e.status, {"error": str(e)}
