import atexit
import contextlib
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
SCRIPTS = SKILL / "scripts"
REPO = SKILL.parents[2]
FIXTURES = HERE / "fixtures"
LIVE = SCRIPTS / "live.py"

# live.py and holder.py read these when imported. Point them away from the user's
# holder and signed-in Chrome before any test imports the scripts.
SANDBOX = Path(tempfile.mkdtemp(prefix="chrome-debug-tests-")).resolve()
atexit.register(shutil.rmtree, SANDBOX, True)
os.environ["CHROME_DEBUG_STATE"] = str(SANDBOX / "holder.json")
os.environ["CHROME_DEBUG_PORT_FILE"] = str(SANDBOX / "DevToolsActivePort")
os.environ.pop("CHROME_DEBUG_SESSION", None)
sys.path.insert(0, str(SCRIPTS))


def find_browser():
    """Chromium that still loads unpacked extensions from the command line.

    Branded Chrome stopped honouring --load-extension, so this takes
    CHROME_DEBUG_TEST_BROWSER or the newest Chromium Playwright installed.
    """
    wanted = os.environ.get("CHROME_DEBUG_TEST_BROWSER")
    if wanted:
        return wanted
    caches = [Path.home() / "Library/Caches/ms-playwright", Path.home() / ".cache/ms-playwright"]
    binaries = ["chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
                "chrome-mac*/Chromium.app/Contents/MacOS/Chromium", "chrome-linux*/chrome"]
    found = []
    for cache in caches:
        for folder in cache.glob("chromium-*"):
            revision = re.fullmatch(r"chromium-(\d+)", folder.name)
            if not revision:
                continue
            for pattern in binaries:
                found += [(int(revision.group(1)), str(path)) for path in folder.glob(pattern)
                          if os.access(path, os.X_OK)]
    if not found:
        raise unittest.SkipTest("No Chromium found. Run `npx playwright install chromium` "
                                "or set CHROME_DEBUG_TEST_BROWSER.")
    return max(found)[1]


class Site:
    """Serves the fixture player on 127.0.0.1 and keeps the events its pages beacon."""

    def __init__(self):
        self.events = []
        self.lock = threading.Lock()
        site = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                path = self.path.split("?", 1)[0]
                if path == "/watch":
                    return self.send(FIXTURES / "site/watch.html", "text/html; charset=utf-8")
                if path == "/clip.webm":
                    return self.send(FIXTURES / "site/clip.webm", "video/webm")
                self.send_error(404)

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                if self.path == "/log":
                    with site.lock:
                        site.events.append(json.loads(body))
                self.send_response(204)
                self.end_headers()

            def send(self, path, kind):
                data = path.read_bytes()
                status, start, end = 200, 0, len(data) - 1
                match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
                if match:
                    status, start = 206, int(match.group(1))
                    end = min(int(match.group(2) or end), end)
                self.send_response(status)
                self.send_header("Content-Type", kind)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(end - start + 1))
                if status == 206:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
                self.end_headers()
                self.wfile.write(data[start : end + 1])

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def url(self, page, **params):
        query = "&".join(f"{key}={value}" for key, value in {"page": page, **params}.items())
        return f"{self.origin}/watch?{query}"

    def log(self, page, kind=None):
        with self.lock:
            return [e for e in self.events if e.get("page") == page and (kind is None or e["type"] == kind)]

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class Browser:
    """A throwaway headless Chromium with the test double extension loaded."""

    def __init__(self, extension):
        self.profile = Path(tempfile.mkdtemp(prefix="chrome-debug-profile-")).resolve()
        self.port_file = self.profile / "DevToolsActivePort"
        args = [
            find_browser(),
            f"--user-data-dir={self.profile}",
            "--remote-debugging-port=0",
            f"--disable-extensions-except={extension}",
            f"--load-extension={extension}",
            "--no-first-run",
            "--no-default-browser-check",
            "--use-mock-keychain",
            "--password-store=basic",
            "--autoplay-policy=no-user-gesture-required",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",
            "about:blank",
        ]
        if not os.environ.get("CHROME_DEBUG_TEST_HEADED"):
            args.insert(1, "--headless=new")
        self.process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.port_file.exists() and len(self.port_file.read_text().split()) >= 2:
                self.port = int(self.port_file.read_text().split()[0])
                break
            time.sleep(0.1)
        else:
            self.close()
            raise RuntimeError("Chromium did not open its DevTools port")
        try:
            self.developer_mode()
        except BaseException:
            self.close()
            raise

    def developer_mode(self):
        """Without developer mode, Chrome disables an unpacked extension when it reloads."""
        import holder

        port, path = self.port_file.read_text().split()[:2]
        with contextlib.redirect_stderr(io.StringIO()):
            chrome = holder.handshake(int(port), path)
        try:
            target = chrome.call("Target.createTarget", {"url": "chrome://extensions"})["targetId"]
            session = chrome.call("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
            expression = ("chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode: true})"
                          ".then(() => chrome.developerPrivate.getProfileConfiguration())"
                          ".then((config) => config.inDeveloperMode)")
            deadline = time.monotonic() + 10
            while True:
                reply = chrome.call("Runtime.evaluate", {"expression": expression, "awaitPromise": True,
                                                         "returnByValue": True}, session=session)
                if reply.get("result", {}).get("value") is True:
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError(f"Could not turn on developer mode: {reply}")
                chrome.idle(0.3)
            chrome.call("Target.closeTarget", {"targetId": target})
        finally:
            chrome.close()

    def targets(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/list", timeout=5) as reply:
            return [target for target in json.load(reply) if target.get("type") == "page"]

    def close_target(self, target_id):
        urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/close/{target_id}", timeout=5).close()

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        shutil.rmtree(self.profile, ignore_errors=True)


class Result:
    def __init__(self, completed):
        self.code = completed.returncode
        self.out = completed.stdout
        self.err = completed.stderr

    @property
    def json(self):
        return json.loads(self.out.strip().splitlines()[-1])

    @property
    def reports(self):
        return [json.loads(line) for line in self.out.splitlines() if line.startswith("{")]

    def __repr__(self):
        return f"exit {self.code}\nstdout: {self.out}\nstderr: {self.err}"


class Live:
    """Runs live.py against one Chromium with its own state file, never the user's."""

    def __init__(self, port_file):
        self.folder = Path(tempfile.mkdtemp(prefix="chrome-debug-state-")).resolve()
        self.env = {**os.environ, "CHROME_DEBUG_STATE": str(self.folder / "holder.json"),
                    "CHROME_DEBUG_PORT_FILE": str(port_file), "CHROME_DEBUG_IDLE": "900"}

    @staticmethod
    def command(args, session):
        return [sys.executable, str(LIVE), *map(str, args), *(["--session", session] if session else [])]

    def __call__(self, *args, session=None, timeout=180):
        return Result(subprocess.run(self.command(args, session), cwd=REPO, env=self.env,
                                     capture_output=True, text=True, timeout=timeout))

    def spawn(self, *args, session=None):
        return subprocess.Popen(self.command(args, session), cwd=REPO, env=self.env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    @property
    def state(self):
        try:
            return json.loads((self.folder / "holder.json").read_text())
        except (FileNotFoundError, ValueError):
            return None

    def kill_holder(self):
        state = self.state
        if state:
            try:
                os.kill(state["pid"], signal.SIGKILL)
            except ProcessLookupError:
                pass

    def close(self):
        self.kill_holder()
        shutil.rmtree(self.folder, ignore_errors=True)


def copy_extension(version=None):
    """The test double in a fresh folder, so reload --from can replace its files."""
    folder = Path(tempfile.mkdtemp(prefix="chrome-debug-extension-")).resolve()
    shutil.copytree(FIXTURES / "extension", folder, dirs_exist_ok=True)
    if version:
        manifest = json.loads((folder / "manifest.json").read_text())
        manifest["version"] = version
        (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return folder


def step(**fields):
    return json.dumps(fields)


SESSION = "browser-test"


class BrowserCase(unittest.TestCase):
    """One Chromium, fixture site and holder per test class; tests open and close their own tabs."""

    @classmethod
    def setUpClass(cls):
        cls.extension = copy_extension()
        cls.site = Site()
        cls.browser = cls.live = None
        try:
            cls.browser = Browser(cls.extension)
            cls.live = Live(cls.browser.port_file)
            started = cls.live("start", session=SESSION)
            if started.code:
                raise RuntimeError(f"start failed: {started}")
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        if cls.live:
            cls.live("stop", session=SESSION)
            cls.live.close()
        if cls.browser:
            cls.browser.close()
        cls.site.close()
        shutil.rmtree(cls.extension, ignore_errors=True)

    def call(self, *args, session=SESSION, **options):
        return self.live(*args, session=session, **options)

    def open(self, page, trace=False, **params):
        opened = self.call("open", self.site.url(page, **params), *(["--trace"] if trace else []))
        self.assertEqual(opened.code, 0, opened)
        tab = opened.json["tab"]
        self.addCleanup(self.call, "close", tab)
        return tab

    def do(self, tab, timeout=60, **fields):
        return self.call("do", tab, step(**fields), "--timeout", timeout)

    def result(self, done, ok=True):
        self.assertEqual(done.code, 0 if ok else 1, done)
        return done.json["result"]

    def folder(self):
        path = Path(tempfile.mkdtemp(prefix="chrome-debug-out-")).resolve()
        self.addCleanup(shutil.rmtree, path, True)
        return path

    def until(self, probe, seconds=5):
        deadline = time.monotonic() + seconds
        while True:
            value = probe()
            if value or time.monotonic() > deadline:
                return value
            time.sleep(0.2)
