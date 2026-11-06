"""Headless launch, debug-chromium handoff and cleanup through their CLI interfaces."""
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from support import LIVE, REPO, SESSION, Result, Site, copy_extension, find_browser
from holder import handshake
from live import extension_id
import measure

LAUNCH = REPO / ".agents/skills/setup-headless-chromium/scripts/launch.py"


class Headless(unittest.TestCase):

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="headless-skill-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.output = self.root / "run"

    def command(self, browser, extension, *extra):
        return [sys.executable, str(LAUNCH), "--browser", str(browser),
                "--extension", str(extension), "--output", str(self.output), *extra]

    def launch(self, extension, *extra):
        with (self.root / "launcher.log").open("w") as log:
            launcher = subprocess.Popen(self.command(find_browser(), extension, *extra), cwd=REPO,
                                        stdout=log, stderr=log)
        self.addCleanup(self.stop_launcher, launcher)
        deadline = time.monotonic() + 40
        record = {}
        while launcher.poll() is None and time.monotonic() < deadline:
            if (self.output / "session.json").exists():
                record = json.loads((self.output / "session.json").read_text())
                if record["state"] == "ready":
                    break
            time.sleep(0.1)
        diagnostics = (self.root / "launcher.log").read_text()
        if (self.output / "chromium.log").exists():
            diagnostics += (self.output / "chromium.log").read_text()
        self.assertEqual(record.get("state"), "ready", diagnostics)
        return launcher, record

    def test_launch_handoff_and_signal_cleanup(self):
        extension = copy_extension()
        self.addCleanup(shutil.rmtree, extension)
        launcher, record = self.launch(extension)
        self.assertGreater(record["port"], 0)
        env = {**os.environ, "DEBUG_CHROMIUM_SESSION": SESSION}
        env.pop("DEBUG_CHROMIUM_PORT_FILE", None)
        env.pop("DEBUG_CHROMIUM_STATE", None)

        def live(*args):
            result = Result(subprocess.run([sys.executable, str(LIVE), *args,
                                           "--launch-session", str(self.output / "session.json")], cwd=REPO,
                                          env=env, capture_output=True, text=True, timeout=90))
            self.assertEqual(result.code, 0, result)
            return result

        started = live("start")
        stop_command = started.out.split("Stop it with: ", 1)[1].strip()
        self.assertIn(str(self.output / "session.json"), shlex.split(stop_command))
        self.addCleanup(live, "stop")
        self.assertEqual(live("status").json["chrome_port"], record["port"])
        commands = measure.Commands(self.root / "measure", SESSION,
                                    ["--launch-session", str(self.output / "session.json")])
        self.assertEqual(commands.call("status")["chrome_port"], record["port"])
        live("reload", "--path", str(extension))
        site = Site()
        self.addCleanup(site.close)
        tab = live("open", site.url("headless")).json["tab"]
        value = live("do", tab, json.dumps({
            "action": "evaluate",
            "expression": "({webdriver:navigator.webdriver,ua:navigator.userAgent,width:innerWidth})",
        })).json["result"]["value"]
        self.assertIs(value["webdriver"], False)
        self.assertNotIn("HeadlessChrome", value["ua"])
        self.assertIn("Chrome/", value["ua"])
        self.assertGreaterEqual(value["width"], 1200)
        result = subprocess.run([sys.executable, str(LIVE), "do", tab,
                                 '{"action":"focus"}', "--launch-session",
                                 str(self.output / "session.json")], cwd=REPO,
                                env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("focus requires", result.stdout)
        live("close", tab)
        stopped = subprocess.run(shlex.split(stop_command), cwd=REPO,
                                 capture_output=True, text=True, timeout=15)
        self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
        self.stop_launcher(launcher)
        record = json.loads((self.output / "session.json").read_text())
        self.assertEqual(record["state"], "stopped",
                         f"launcher exit={launcher.returncode}; "
                         f"record={record}; log={(self.root / 'launcher.log').read_text()}")
        self.assertFalse(Path(record["profile"]).exists())
        self.assertTrue(record["profile_removed"])
        self.assertEqual(record["received_signal"], "SIGTERM")
        self.assertEqual(record["browser_exit_code"], 0)
        self.assertEqual(record["termination_scope"], "owned_process_group")
        self.assertFalse((self.output / "endpoint").exists())
        with self.assertRaises(ProcessLookupError):
            os.kill(record["browser_pid"], 0)

    def test_provider_url_grants_only_its_origin(self):
        """Headless macOS never showed the native permission sheet, so saving Provider settings hung."""
        extension = copy_extension()
        self.addCleanup(shutil.rmtree, extension)
        manifest = json.loads((extension / "manifest.json").read_text())
        manifest["optional_host_permissions"] = ["https://*/*"]
        (extension / "manifest.json").write_text(json.dumps(manifest))
        _, record = self.launch(extension, "--provider-url", "https://example.com/v1")
        self.assertEqual(record["provider_origin"], "https://example.com/*")
        chrome = handshake(record["port"], record["endpoint_path"])
        self.addCleanup(chrome.close)
        page = chrome.call("Target.createTarget", {
            "url": f"chrome-extension://{extension_id(extension)}/popup.html",
        })["targetId"]
        session = chrome.call("Target.attachToTarget", {"targetId": page, "flatten": True})["sessionId"]

        def evaluate(expression):
            return chrome.call("Runtime.evaluate", {
                "expression": expression, "awaitPromise": True, "returnByValue": True, "userGesture": True,
            }, session=session)["result"].get("value")

        deadline = time.monotonic() + 10
        while evaluate("typeof chrome.permissions") != "object" and time.monotonic() < deadline:
            time.sleep(0.1)

        def request(origin):
            return evaluate(f"Promise.race([chrome.permissions.request({{origins: [{json.dumps(origin)}]}}), "
                            "new Promise(done => setTimeout(() => done('pending'), 3000))])")

        self.assertIs(request("https://example.com/*"), True)
        self.assertIsNot(request("https://example.org/*"), True)

    def test_provider_url_must_stay_on_https(self):
        extension = self.root / "extension"
        extension.mkdir()
        (extension / "manifest.json").write_text('{"name":"Subline"}')
        result = subprocess.run(self.command(sys.executable, extension, "--provider-url", "http://example.com"),
                                cwd=REPO, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("--provider-url", result.stderr)
        self.assertFalse(self.output.exists())

    def stop_launcher(self, launcher):
        if launcher.poll() is None:
            launcher.terminate()
            launcher.wait(timeout=15)

    def test_failed_browser_leaves_evidence_without_a_profile(self):
        browser = self.root / "browser"
        browser.write_text('#!/bin/sh\nif [ "$1" = "--version" ]; then\n'
                           '  echo "Chromium 153.0.8010.12"\n  exit 0\nfi\nexit 1\n')
        browser.chmod(0o700)
        extension = self.root / "extension"
        extension.mkdir()
        (extension / "manifest.json").write_text('{"name":"Subline"}')
        result = subprocess.run(self.command(browser, extension), cwd=REPO,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 1, result.stderr)
        record = json.loads((self.output / "session.json").read_text())
        self.assertEqual(record["state"], "failed")
        self.assertTrue(record["error"])
        self.assertFalse(Path(record["profile"]).exists())
        self.assertFalse((self.output / "endpoint").exists())
        self.assertTrue((self.output / "chromium.log").exists())
        self.assertEqual(record["browser_exit_code"], 1)
        self.assertEqual(record["termination_scope"], "owned_process_group")

    def test_failed_browser_terminates_its_remaining_descendant(self):
        stopped = self.root / "descendant-stopped"
        ready = self.root / "descendant-ready"
        child = (
            "import os, signal, time; from pathlib import Path; "
            f"signal.signal(signal.SIGTERM, lambda *_: (Path({str(stopped)!r}).touch(), os._exit(0))); "
            f"Path({str(ready)!r}).touch(); time.sleep(30)"
        )
        browser = self.root / "browser"
        browser.write_text(
            f"#!{sys.executable}\nimport subprocess, sys, time\nfrom pathlib import Path\n"
            "if '--version' in sys.argv:\n print('Chromium 153.0.8010.12'); sys.exit(0)\n"
            f"subprocess.Popen([sys.executable, '-c', {child!r}])\n"
            f"while not Path({str(ready)!r}).exists(): time.sleep(0.01)\n"
            "sys.exit(1)\n"
        )
        browser.chmod(0o700)
        extension = self.root / "extension"
        extension.mkdir()
        (extension / "manifest.json").write_text('{"name":"Subline"}')
        result = subprocess.run(self.command(browser, extension), cwd=REPO,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 1, result.stderr)
        deadline = time.monotonic() + 3
        while not stopped.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(stopped.exists(), "Browser descendant did not receive SIGTERM")


if __name__ == "__main__":
    unittest.main()
