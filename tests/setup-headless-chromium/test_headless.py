"""Headless launch, debug-chromium handoff and cleanup through their CLI interfaces."""
import json
import os
import shlex
import shutil
import signal
import subprocess
import threading
import sys
import tempfile
import time
import unittest
from pathlib import Path

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from support import LIVE, REPO, SESSION, Result, Site, copy_extension, find_browser
from holder import handshake
from live import extension_id
import measure

LAUNCH = REPO / ".agents/skills/setup-headless-chromium/scripts/launch.py"
KEY = "sk-headless-test-key"


class FakeOpenAI:
    """An OpenAI-compatible Provider on 127.0.0.1 that records the chat completions it answers."""

    def __init__(self):
        self.requests = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                fake.requests.append({"model": body.get("model"),
                                      "authorization": self.headers.get("Authorization")})
                reply = json.dumps({"choices": [{"message": {"content": "世界充满了美好的事物。"}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(reply)))
                self.end_headers()
                self.wfile.write(reply)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/v1"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


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

    def test_openai_with_microsoft_fallback_saves_and_passes_its_connection_test(self):
        """Saving OpenAI with Microsoft consent asks for two origins; one grant left the save waiting."""
        if not (REPO / "dist/manifest.json").is_file():
            self.fail("Build Subline first: npm run build:store")
        extension = self.root / "dist"
        shutil.copytree(REPO / "dist", extension)
        provider = FakeOpenAI()
        self.addCleanup(provider.close)
        env = self.root / "provider.env"
        env.write_text(f"OPENAI_BASE_URL={provider.url}\nOPENAI_MODEL=test-model\nOPENAI_API_KEY={KEY}\n")
        env.chmod(0o600)
        _, record = self.launch(extension, "--provider", "openai", "--provider-env", str(env),
                                "--microsoft-fallback")
        self.assertEqual(record["provider"], {
            "kind": "openai", "origins": ["http://127.0.0.1/*", "https://edge.microsoft.com/*"],
        })
        self.assertEqual([(r["model"], r["authorization"]) for r in provider.requests],
                         [("test-model", f"Bearer {KEY}")])
        for evidence in (self.output / "session.json", self.root / "launcher.log"):
            self.assertNotIn(KEY, evidence.read_text())
        chrome = handshake(record["port"], record["endpoint_path"])
        self.addCleanup(chrome.close)
        page = chrome.call("Target.createTarget", {
            "url": f"chrome-extension://{extension_id(extension)}/popup.html",
        })["targetId"]
        session = chrome.call("Target.attachToTarget", {"targetId": page, "flatten": True})["sessionId"]
        deadline = time.monotonic() + 10
        reply = {}
        while time.monotonic() < deadline:
            reply = chrome.call("Runtime.evaluate", {
                "expression": "Promise.race([chrome.permissions.request({origins: ['https://example.org/*']}), "
                              "new Promise(done => setTimeout(() => done('pending'), 3000))])",
                "awaitPromise": True, "returnByValue": True, "userGesture": True,
            }, session=session)
            if "exceptionDetails" not in reply:
                break
            time.sleep(0.1)
        self.assertEqual(reply["result"]["value"], "pending")
        saved = chrome.call("Runtime.evaluate", {
            "expression": "chrome.storage.local.get('subline.settings.v1').then(v => v['subline.settings.v1'])",
            "awaitPromise": True, "returnByValue": True,
        }, session=session)["result"]["value"]
        self.assertEqual((saved["provider"], saved["baseUrl"], saved["model"]),
                         ("openai", provider.url, "test-model"))
        self.assertEqual(set(saved["providerConsent"].split(",")),
                         {provider.url.removesuffix("/v1"), "https://edge.microsoft.com"})

    def test_background_returns_once_ready_and_refuses_a_used_output(self):
        extension = copy_extension()
        self.addCleanup(shutil.rmtree, extension)
        started = subprocess.run(self.command(find_browser(), extension, "--background"), cwd=REPO,
                                 capture_output=True, text=True, timeout=60)
        self.assertEqual(started.returncode, 0, started.stderr)
        record = json.loads(started.stdout)
        self.addCleanup(self.stop_background, record["launcher_pid"])
        self.assertEqual(record["state"], "ready")
        os.kill(record["launcher_pid"], 0)
        again = subprocess.run(self.command(find_browser(), extension), cwd=REPO,
                               capture_output=True, text=True, timeout=15)
        self.assertEqual(again.returncode, 2, again.stderr)
        self.assertIn("already holds a launch", again.stderr)

    def test_provider_settings_are_checked_before_launch(self):
        extension = self.root / "extension"
        extension.mkdir()
        (extension / "manifest.json").write_text('{"name":"Subline"}')
        env = self.root / "provider.env"
        env.write_text("OPENAI_BASE_URL=http://example.com/v1\nOPENAI_MODEL=m\nOPENAI_API_KEY=k\n")
        for extra, message in [(["--provider", "openai"], "--provider-env"),
                               (["--provider", "openai", "--provider-env", str(env)], "OPENAI_BASE_URL"),
                               (["--provider", "microsoft", "--microsoft-fallback"], "--provider openai")]:
            with self.subTest(extra=extra):
                result = subprocess.run(self.command(sys.executable, extension, *extra),
                                        cwd=REPO, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn(message, result.stderr)
                self.assertFalse(self.output.exists())

    def stop_background(self, pid):
        os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 15
        while json.loads((self.output / "session.json").read_text())["state"] == "ready":
            self.assertLess(time.monotonic(), deadline, "Background launcher did not stop")
            time.sleep(0.1)

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
