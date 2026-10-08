"""Regression tests for malformed checks and task ownership, without Chrome."""
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import holder
import live


class SessionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        state = Path(temporary.name) / "holder.json"
        state.write_text("{}")
        for module in (live, holder):
            replace_state = patch.object(module, "STATE", state)
            replace_state.start()
            self.addCleanup(replace_state.stop)
        self.env = patch.dict(os.environ, {"CHROME_DEBUG_SESSION": "task-a"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.chrome = Mock()
        self.server = holder.Holder(self.chrome, 9222)
        self.addCleanup(self.server.server.close)

    def dispatch(self, method, params=None, owner="task-a"):
        client, peer = socket.socketpair()
        self.addCleanup(client.close)
        self.addCleanup(peer.close)
        peer.sendall((json.dumps({"token": self.server.token, "owner": owner,
                                 "method": method, "params": params or {}}) + "\n").encode())
        self.server.handle(client)
        peer.settimeout(1)
        messages = []
        with peer.makefile("rb") as stream:
            for line in stream:
                messages.append(json.loads(line))
                if messages[-1].get("done"):
                    break
        return messages

    def test_bad_action_is_rejected_and_next_check_still_runs(self):
        check = {"name": "bad-action", "url": "https://example.com", "budget": 5,
                 "steps": [{"action": []}]}
        for action in ([], {}, None, 42, True):
            with self.subTest(action=action):
                check["steps"][0]["action"] = action
                reply = self.dispatch("Session.run", {"checks": [check]})[-1]
                self.assertFalse(reply["ok"])
                self.assertIn("unknown action", reply["error"])
        self.server.check = Mock(return_value={"name": "good", "ok": True, "seconds": 0})
        check["steps"] = [{"action": "evaluate", "expression": "true"}]
        reply = self.dispatch("Session.run", {"checks": [check]})[-1]
        self.assertTrue(reply["ok"])
        self.server.check.assert_called_once()

    def test_foreign_and_missing_owner_cannot_run_or_reload(self):
        def accepted(client, _params):
            holder.reply(client, {"done": True, "ok": True})
        self.server.run = Mock(side_effect=accepted)
        self.server.reload = Mock(side_effect=accepted)
        for owner in ("task-b", "", None):
            for method in ("Session.run", "Session.reload"):
                with self.subTest(owner=owner, method=method):
                    reply = self.dispatch(method, owner=owner)[-1]
                    self.assertFalse(reply["ok"])
                    self.assertIn("session", reply["error"].lower())
        self.server.run.assert_not_called()
        self.server.reload.assert_not_called()
        self.assertTrue(self.dispatch("Session.status", owner="task-b")[-1]["ok"])

    def test_foreign_stop_never_signals_holder(self):
        state = {"pid": 12345, "port": 1234, "token": "test", "owner": "task-b"}
        with patch.object(live, "load_state", return_value=state), \
                patch.object(live, "alive", return_value=True), \
                patch.object(live, "pid_alive", return_value=False), \
                patch.object(live.os, "kill") as kill, \
                contextlib.redirect_stdout(io.StringIO()):
            try:
                live.stop(None)
            except Exception as error:
                self.assertIn("session", str(error).lower())
            kill.assert_not_called()

    def test_missing_owner_cannot_stop(self):
        os.environ.pop("CHROME_DEBUG_SESSION")
        self.test_foreign_stop_never_signals_holder()

    def test_start_does_not_adopt_another_or_legacy_holder(self):
        for owner in ("task-b", None):
            with self.subTest(owner=owner), \
                    patch.object(live, "load_state", return_value={"pid": 12345, "owner": owner}), \
                    patch.object(live, "alive", return_value=True), \
                    patch.object(live.subprocess, "Popen") as spawn, \
                    contextlib.redirect_stdout(io.StringIO()):
                try:
                    result = live.start(None)
                except Exception as error:
                    self.assertIn("session", str(error).lower())
                else:
                    self.assertNotEqual(result, 0, "start must not claim another task's holder")
                spawn.assert_not_called()

    def test_same_owner_reuses_holder(self):
        with patch.object(live, "load_state", return_value={"pid": 12345, "owner": "task-a"}), \
                patch.object(live, "alive", return_value=True), \
                patch.object(live.subprocess, "Popen") as spawn, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(live.start(None), 0)
            spawn.assert_not_called()

    def test_owner_can_stop_and_remove_only_its_state(self):
        state = {"pid": 12345, "owner": "task-a"}
        with patch.object(live, "load_state", return_value=state), \
                patch.object(live, "alive", return_value=True), \
                patch.object(live, "pid_alive", return_value=False), \
                patch.object(live.os, "kill") as kill, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(live.stop(None), 0)
            kill.assert_called_once_with(12345, live.signal.SIGTERM)
            self.assertFalse(live.STATE.exists())

    def test_lifecycle_commands_cannot_overlap_before_state_is_published(self):
        live.STATE.unlink()
        environment = {**os.environ, "CHROME_DEBUG_STATE": str(live.STATE),
                       "CHROME_DEBUG_SESSION": "task-b"}
        with live.lifecycle_lock():
            for command in ("start", "stop"):
                result = subprocess.run([sys.executable, live.__file__, command], env=environment,
                                        capture_output=True, text=True, timeout=3)
                self.assertEqual(result.returncode, 1)
                self.assertIn("starting or stopping", result.stderr)
                self.assertNotIn("Traceback", result.stderr)
        self.assertFalse(live.STATE.exists())

    def test_interrupted_check_closes_its_own_tab(self):
        def call(method, params=None, **kwargs):
            if method == "Target.createTarget":
                return {"targetId": "owned-check-tab"}
            if method == "Target.attachToTarget":
                return {"sessionId": "owned-page-session"}
            return {}
        self.chrome.call.side_effect = call
        check = {"name": "interrupted", "url": "https://example.com", "budget": 10,
                 "steps": [{"action": "evaluate", "expression": "false"}]}
        with patch.object(holder.Tab, "loaded", return_value=True), \
                patch.object(holder.Tab, "run", side_effect=SystemExit(0)), \
                self.assertRaises(SystemExit):
            self.server.check(check, Mock())
        self.chrome.call.assert_any_call("Target.closeTarget", {"targetId": "owned-check-tab"}, timeout=10)
        self.assertIsNone(json.loads(live.STATE.read_text())["tab"])

    def test_bad_name_with_filter_is_input_error_not_traceback(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "checks.json"
            file.write_text(json.dumps([{"name": [], "steps": []}]))
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
                live.load_checks([str(file)], ["wanted"])
            self.assertEqual(caught.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
