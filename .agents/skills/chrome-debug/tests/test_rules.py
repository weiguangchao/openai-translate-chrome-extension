"""Input rules, stall detection and session ownership, without Chrome."""
import contextlib
import io
import json
import os
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import support  # noqa: F401  (puts scripts/ on the path)

import holder
import live


def check(*steps, **fields):
    return {"name": "c", "url": "https://example.com", "budget": 30, "steps": list(steps), **fields}


class Validate(unittest.TestCase):
    """c1d5f06 and 4ce2031: bad checks fail before any tab opens, with the field named."""

    def problems(self, *steps, **fields):
        return holder.validate([check(*steps, **fields)])

    def assertRejected(self, text, *steps, **fields):
        problems = self.problems(*steps, **fields)
        self.assertTrue(any(text in problem for problem in problems), problems)

    def test_valid_checks_pass(self):
        self.assertEqual(self.problems(
            {"action": "media", "time": 30, "rate": 2, "play": True, "keep_playing": True, "skip_ads": True},
            {"action": "wait", "time": 40},
            {"action": "overlay", "wait": True},
            {"action": "trace", "seconds": 20, "save": "/tmp/trace.json"},
            {"action": "evaluate", "expression": "1"},
            {"action": "requests", "match": [".vtt"]},
        ), [])

    def test_unknown_or_malformed_action(self):
        for action in ([], {}, None, 42, True, "seek", "play"):
            with self.subTest(action=action):
                self.assertRejected("unknown action", {"action": action})
        self.assertEqual(holder.validate([]), ["checks must be a non-empty list"])
        self.assertIn("check 0 is not an object", holder.validate(["media"]))

    def test_check_fields(self):
        self.assertRejected("name must be a non-empty string", {"action": "focus"}, name="")
        self.assertRejected("url must start with", {"action": "focus"}, url="file:///etc/hosts")
        self.assertRejected("budget must be 1-600", {"action": "focus"}, budget=True)
        self.assertRejected("budget must be 1-600", {"action": "focus"}, budget=601)
        self.assertRejected("unknown fields ['retries']", {"action": "focus"}, retries=2)
        self.assertRejected("fail_screenshot must be an absolute path", {"action": "focus"}, fail_screenshot="a.png")
        self.assertRejected("steps must be a non-empty list")

    def test_step_fields(self):
        self.assertRejected("rate must be 0.25-4", {"action": "media", "rate": 8})
        self.assertRejected("rate has the wrong type", {"action": "media", "rate": True})
        self.assertRejected("cannot both play and pause", {"action": "media", "play": True, "pause": True})
        self.assertRejected("time must not be negative", {"action": "media", "time": -1})
        self.assertRejected("exactly one of seconds and time", {"action": "wait"})
        self.assertRejected("exactly one of seconds and time", {"action": "wait", "seconds": 1, "time": 2})
        self.assertRejected("wait seconds must be above 0", {"action": "wait", "seconds": 0})
        self.assertRejected("does not take ['seconds']", {"action": "overlay", "seconds": 5})
        self.assertRejected("click needs ['selector']", {"action": "click"})
        self.assertRejected("match must not be empty", {"action": "requests", "match": []})
        self.assertRejected("match has the wrong type", {"action": "requests", "match": [""]})
        self.assertRejected("save must be an absolute path", {"action": "evaluate", "expression": "1", "save": "out.json"})
        self.assertRejected("trace seconds must be 1-600", {"action": "trace", "seconds": 0})
        self.assertRejected("trace seconds must be below the budget", {"action": "trace", "seconds": 30})


class Stall(unittest.TestCase):
    """00834c8: a video that should move but stays put fails after 20 s; buffering waits."""

    def setUp(self):
        self.now = 1000.0
        clock = patch.object(holder.time, "monotonic", lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)
        self.tab = holder.Tab(None, "target", "session", 0, None)

    def feed(self, seconds, **video):
        value = {"time": 12.0, "paused": False, "ended": False, "ad": False, "rate": 1, "ready": 4,
                 "visible": "visible", **video}
        verdict = None
        for _ in range(int(seconds) + 1):
            verdict = self.tab.note_stall(value)
            if verdict is holder.FAIL:
                return verdict
            self.now += 1
        return verdict

    def test_frozen_playable_video_fails_after_20_seconds(self):
        self.assertIsNone(self.feed(19))
        self.assertIs(self.feed(1), holder.FAIL)
        self.assertEqual(self.tab.fail_reason, "video time stuck at 12.0 s, readyState 4")

    def test_reason_says_when_it_was_paused(self):
        self.assertIs(self.feed(25, paused=True), holder.FAIL)
        self.assertEqual(self.tab.fail_reason, "video time stuck at 12.0 s, paused")

    def test_buffering_ended_and_ads_never_stall(self):
        for video in ({"ready": 2}, {"ended": True}, {"ad": True}):
            with self.subTest(**video):
                self.tab.stall_since = None
                self.assertIsNone(self.feed(60, **video))

    def test_moving_video_resets_the_timer(self):
        self.assertIsNone(self.feed(15))
        self.assertIsNone(self.feed(15, time=12.5))

    def test_samples_feed_the_trace_clock(self):
        self.feed(3, rate=2, visible="hidden")
        self.assertEqual((self.tab.rates, self.tab.clock_samples, self.tab.clock_visible), ({2: 4}, 4, 0))


class Ownership(unittest.TestCase):
    """c1d5f06: one task's holder never serves, restarts or stops for another task."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.state = Path(folder.name) / "holder.json"
        for module in (live, holder):
            replaced = patch.object(module, "STATE", self.state)
            replaced.start()
            self.addCleanup(replaced.stop)
        environment = patch.dict(os.environ, {"CHROME_DEBUG_SESSION": "task-a"})
        environment.start()
        self.addCleanup(environment.stop)
        self.server = holder.Holder(Mock(), 9222)
        self.addCleanup(self.server.server.close)

    def ask(self, method, owner="task-a", token=None):
        client, peer = socket.socketpair()
        self.addCleanup(client.close)
        self.addCleanup(peer.close)
        message = {"token": token or self.server.token, "owner": owner, "method": method, "params": {}}
        peer.sendall((json.dumps(message) + "\n").encode())
        self.server.handle(client)
        peer.settimeout(1)
        with peer.makefile("rb") as stream:
            return json.loads(stream.readline())

    def test_other_or_missing_owner_is_refused(self):
        for name in ("run", "open", "do", "close", "reload"):
            setattr(self.server, name, Mock(side_effect=AssertionError(f"{name} ran for another task")))
        for owner in ("task-b", "", None):
            for method in ("Session.run", "Session.open", "Session.do", "Session.close", "Session.reload"):
                with self.subTest(owner=owner, method=method):
                    reply = self.ask(method, owner=owner)
                    self.assertEqual(reply["error"], "Holder belongs to another session")

    def test_anyone_can_ask_for_status_but_not_without_the_token(self):
        self.assertTrue(self.ask("Session.status", owner="task-b")["ok"])
        self.assertEqual(self.ask("Session.status", token="forged")["error"], "bad token")

    def test_start_and_stop_never_touch_another_tasks_holder(self):
        for owner in ("task-b", None):
            state = {"pid": 12345, "port": 1, "token": "t", "owner": owner}
            with self.subTest(owner=owner), \
                    patch.object(live, "load_state", return_value=state), \
                    patch.object(live, "alive", return_value=True), \
                    patch.object(live.subprocess, "Popen") as spawn, \
                    patch.object(live.os, "kill") as kill, \
                    contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(live.SessionConflict):
                    live.start(None)
                with self.assertRaises(live.SessionConflict):
                    live.stop(None)
                spawn.assert_not_called()
                kill.assert_not_called()

    def test_commands_need_a_session_id(self):
        os.environ.pop("CHROME_DEBUG_SESSION")
        with self.assertRaisesRegex(live.SessionConflict, "A session id is required"):
            live.require_owner({"owner": "task-a"})


class CheckFiles(unittest.TestCase):

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name).resolve()

    def write(self, name, data):
        path = self.folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data if isinstance(data, str) else json.dumps(data))
        return path

    def test_expression_file_and_paths_resolve_beside_the_check_file(self):
        """c3b792e: expression_file reads JavaScript from beside the check file."""
        self.write("checks/probe.js", "document.title")
        path = self.write("checks/smoke.json", [check(
            {"action": "evaluate", "expression_file": "probe.js"},
            {"action": "screenshot", "path": "shot.png"},
        )])
        cwd = os.getcwd()
        os.chdir(self.folder)
        try:
            [loaded] = live.load_checks([str(path)], None)
        finally:
            os.chdir(cwd)
        self.assertEqual(loaded["steps"][0], {"action": "evaluate", "expression": "document.title"})
        self.assertEqual(loaded["steps"][1]["path"], str(self.folder / "shot.png"))

    def test_bad_files_and_names_exit_2(self):
        cases = [
            ([self.write("list.json", {"name": "x"})], None, "expected a JSON list"),
            ([self.write("bad.json", "[")], None, "bad.json"),
            ([self.write("ok.json", [check({"action": "focus"})])], ["nope"], "No check named nope"),
            ([self.write("expr.json", [check({"action": "evaluate", "expression": "1",
                                              "expression_file": "a.js"})])], None, "exactly one of"),
        ]
        for files, only, message in cases:
            with self.subTest(message=message):
                errors = io.StringIO()
                with contextlib.redirect_stderr(errors), self.assertRaises(SystemExit) as stop:
                    live.load_checks([str(path) for path in files], only)
                self.assertEqual(stop.exception.code, 2)
                self.assertIn(message, errors.getvalue())

    def test_smoke_checks_are_valid(self):
        checks = live.load_checks([str(support.SKILL / "checks/smoke.json")], None)
        self.assertEqual(holder.validate(checks), [])
        self.assertEqual([c["name"] for c in checks], ["youtube", "hbo", "x"])


class ReloadFrom(unittest.TestCase):
    """4ce2031: reload --from replaces the loaded folder with another build of Subline."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name).resolve()

    def build(self, name, files):
        folder = self.root / name
        for relative, text in files.items():
            (folder / relative).parent.mkdir(parents=True, exist_ok=True)
            (folder / relative).write_text(text)
        return folder

    def test_copies_the_build_and_removes_stale_files(self):
        manifest = json.dumps({"name": "Subline · 双语字幕"})
        loaded = self.build("dist", {"manifest.json": manifest, "old.js": "1", "chunks/old.js": "1"})
        source = self.build("other", {"manifest.json": manifest, "background.js": "2", "chunks/new.js": "2"})
        live.sync(source, loaded)
        self.assertEqual(sorted(str(p.relative_to(loaded)) for p in loaded.rglob("*")),
                         ["background.js", "chunks", "chunks/new.js", "manifest.json"])
        self.assertEqual(live.fingerprint(loaded), live.fingerprint(source))

    def test_refuses_a_folder_holding_another_extension(self):
        loaded = self.build("dist", {"manifest.json": json.dumps({"name": "Other"}), "keep.js": "1"})
        source = self.build("other", {"manifest.json": json.dumps({"name": "Subline"})})
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors), self.assertRaises(SystemExit) as stop:
            live.sync(source, loaded)
        self.assertEqual(stop.exception.code, 2)
        self.assertTrue((loaded / "keep.js").exists())

    def test_extension_id_is_chromes_id_for_an_unpacked_folder(self):
        extension = live.extension_id(Path("/Users/me/subline/dist"))
        self.assertRegex(extension, r"^[a-p]{32}$")
        self.assertNotEqual(extension, live.extension_id(Path("/Users/me/subline/dist2")))


if __name__ == "__main__":
    unittest.main()
