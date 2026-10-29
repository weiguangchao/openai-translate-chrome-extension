"""Headless launch, chrome-debug handoff and cleanup through their CLI interfaces."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from support import LIVE, REPO, SESSION, Result, Site, copy_extension, find_browser

LAUNCH = REPO / ".agents/skills/headless-chromium/scripts/launch.py"


class Headless(unittest.TestCase):

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="headless-skill-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.output = self.root / "run"

    def command(self, browser, extension):
        return [sys.executable, str(LAUNCH), "--browser", str(browser),
                "--extension", str(extension), "--output", str(self.output)]

    def test_launch_handoff_and_signal_cleanup(self):
        browser = find_browser()
        extension = copy_extension()
        self.addCleanup(shutil.rmtree, extension)
        with (self.root / "launcher.log").open("w") as log:
            launcher = subprocess.Popen(self.command(browser, extension), cwd=REPO,
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
        self.assertGreater(record["port"], 0)
        env = {**os.environ, **record["chrome_debug_env"], "CHROME_DEBUG_SESSION": SESSION}

        def live(*args):
            result = Result(subprocess.run([sys.executable, str(LIVE), *args], cwd=REPO,
                                          env=env, capture_output=True, text=True, timeout=90))
            self.assertEqual(result.code, 0, result)
            return result

        live("start")
        self.addCleanup(live, "stop")
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
        live("close", tab)
        live("stop")
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
