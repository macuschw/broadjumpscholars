"""Remote screens (jumplab/rooms.py): a room opened by the remote, each side writing its own slot
and reading the other's, and rooms forgotten an hour after their last message."""
import json

from jumplab import rooms


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def _open():
    clock = Clock()
    store = rooms.Rooms({}, clock)
    status, body = rooms.route(store, "POST", "/rooms")
    assert status == 200
    return store, clock, body["code"]


def _put(store, code, slot, value):
    return rooms.route(store, "PUT", f"/rooms/{code}/{slot}", json.dumps(value).encode())


def test_the_phone_and_the_remote_read_each_others_messages():
    store, clock, code = _open()
    assert len(code) == rooms.CODE_LEN and set(code) <= set(rooms.ALPHABET)
    assert rooms.route(store, "GET", f"/rooms/{code}/phone") == (200, {"value": None, "age": None})
    assert _put(store, code, "phone", {"stage": "measuring", "jumps": [{"n": 1, "meters": 2.31}]}) == (200, {"ok": True})
    assert _put(store, code, "remote", {"cmds": [{"id": 1, "type": "stop"}]}) == (200, {"ok": True})
    clock.t += 1.5
    status, body = rooms.route(store, "GET", f"/rooms/{code}/phone")
    assert status == 200 and body == {"value": {"stage": "measuring", "jumps": [{"n": 1, "meters": 2.31}]}, "age": 1.5}
    # codes are typed by hand: lower case is fine
    assert rooms.route(store, "GET", f"/rooms/{code.lower()}/remote")[1]["value"] == {"cmds": [{"id": 1, "type": "stop"}]}


def test_wrong_codes_slots_and_messages_are_refused():
    store, clock, code = _open()
    other = "".join(c for c in rooms.ALPHABET if c not in code)[:rooms.CODE_LEN]
    assert rooms.route(store, "GET", f"/rooms/{other}/phone")[0] == 404           # nobody opened it
    assert rooms.route(store, "GET", "/rooms/HELLO0/phone")[0] == 404             # not a code at all
    assert rooms.route(store, "GET", f"/rooms/{code}/secrets")[0] == 404          # not a slot
    assert rooms.route(store, "PUT", f"/rooms/{code}/phone", b"{not json")[0] == 400
    assert rooms.route(store, "PUT", f"/rooms/{code}/still", b"0" * (rooms.MAX_BYTES + 1))[0] == 413
    assert rooms.route(store, "GET", "/jobs/abc") is None                         # someone else's path


def test_rooms_are_forgotten_an_hour_after_their_last_message():
    store, clock, code = _open()
    clock.t += rooms.KEEP_S - 10
    assert _put(store, code, "phone", {"stage": "ready"})[0] == 200               # still in use: kept
    clock.t += rooms.KEEP_S - 10
    assert rooms.route(store, "GET", f"/rooms/{code}/phone")[0] == 200
    clock.t += 20
    assert rooms.route(store, "GET", f"/rooms/{code}/phone")[0] == 404
    rooms.route(store, "POST", "/rooms")                                          # a new room tidies old ones
    assert not any(k == code or k.startswith(code + "/") for k in store.kv)
