#!/usr/bin/env python3
import base64
import hmac
import json
import os
import re
import secrets
import select
import signal
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

from live import STATE, alive, load_state, session_id
from worker_trace import clock as clock_stats, summarize as summarize_worker, trace_line

PORT_FILE = Path(
    os.environ.get("CHROME_DEBUG_PORT_FILE")
    or Path.home() / "Library/Application Support/Google/Chrome/DevToolsActivePort"
)
IDLE_SECONDS = int(os.environ.get("CHROME_DEBUG_IDLE", "3600"))
ALLOW_SECONDS = 60
POLL_SECONDS = 1.0
HEARTBEAT_SECONDS = 30
VALUE_CHARS = 20000
PREVIEW_CHARS = 500
TRACE_MILESTONE = 60
CAPTION_HINTS = ("/api/timedtext", ".vtt", ".mpd", "/subtitles/")
SKIP_AD = ".ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button"
SUBLINE_NAME = "Subline"
TRACE_ATTRIBUTE = "data-subline-trace"
TRACE_WORKER_ATTRIBUTE = "data-subline-trace-worker"
TRACE_PREFIX = "[subline] "
WORKER_WAIT_SECONDS = 20
WORKER_QUIET_SECONDS = 30
WORKER_EVENTS = 50000
STALL_SECONDS = 20

MUTE_MEDIA = """(() => {
  const prototype = HTMLMediaElement.prototype;
  const muted = Object.getOwnPropertyDescriptor(prototype, 'muted');
  const defaultMuted = Object.getOwnPropertyDescriptor(prototype, 'defaultMuted');
  const mute = (media) => {
    if (!defaultMuted.get.call(media)) defaultMuted.set.call(media, true);
    if (!muted.get.call(media)) muted.set.call(media, true);
  };
  for (const [name, descriptor] of [['muted', muted], ['defaultMuted', defaultMuted]]) {
    Object.defineProperty(prototype, name, {
      ...descriptor,
      get() { mute(this); return descriptor.get.call(this); },
      set() { mute(this); },
    });
  }
  const muteTree = (node) => {
    if (node instanceof HTMLMediaElement) mute(node);
    node.querySelectorAll?.('audio,video').forEach(mute);
  };
  for (const type of ['play', 'volumechange']) {
    document.addEventListener(type, (event) => {
      if (event.target instanceof HTMLMediaElement) mute(event.target);
    }, true);
  }
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) muteTree(node);
  }).observe(document, { childList: true, subtree: true });
  muteTree(document);
})();"""


class Verdict:

    def __bool__(self):
        return False


FAIL = Verdict()

ALLOW_SCRIPT = """
tell application "System Events"
  tell process "Google Chrome"
    set frontmost to true
    repeat with w in windows
      set prompt to false
      set allowButton to missing value
      try
        repeat with e in entire contents of w
          try
            if name of e is "Allow remote debugging?" then set prompt to true
            if role of e is "AXButton" and name of e is "Allow" then set allowButton to e
          end try
        end repeat
      end try
      if prompt and allowButton is not missing value then
        click allowButton
        return "clicked"
      end if
    end repeat
  end tell
end tell
return "none"
"""

OVERLAY = r"""
(() => {
  const host = document.querySelector('[data-subline-overlay]');
  const root = host && host.shadowRoot;
  const read = (node) => node ? {
    hidden: node.hidden,
    text: (node.textContent || '').trim().slice(0, 180),
    error: node.classList.contains('error')
  } : null;
  const video = document.querySelector('video');
  return {
    mounted: Boolean(host),
    original: root && read(root.querySelector('.original')),
    translation: root && read(root.querySelector('.translation')),
    time: video ? Math.round(video.currentTime * 10) / 10 : null
  };
})()
"""


def video_report():
    return """const ad = Boolean(document.querySelector('#movie_player.ad-showing'));
      return {time: Math.round(video.currentTime * 100) / 100, paused: video.paused,
        ended: video.ended, ad, rate: video.playbackRate, ready: video.readyState,
        visible: document.visibilityState};"""


def log(message):
    print(time.strftime("%H:%M:%S"), message, file=sys.stderr, flush=True)


def public_url(url):
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        return url[:120]
    return f"{parts.scheme}://{parts.netloc}{parts.path[:160]}"


class ChromeClosed(Exception):
    pass


class CdpError(RuntimeError):
    pass


class TabGone(Exception):
    pass


class Chrome:

    def __init__(self, sock, rest):
        self.sock = sock
        self.buf = bytearray(rest)
        self.partial = b""
        self.next_id = 1
        self.waiting = set()
        self.responses = {}
        self.listener = None

    def call(self, method, params=None, session=None, timeout=20, abort=None):
        message_id = self.next_id
        self.next_id += 1
        payload = {"id": message_id, "method": method}
        if params:
            payload["params"] = params
        if session:
            payload["sessionId"] = session
        self.waiting.add(message_id)
        try:
            self.send(json.dumps(payload).encode())
            deadline = time.monotonic() + timeout
            while message_id not in self.responses:
                if abort and abort():
                    raise CdpError(f"{method}: abandoned")
                left = deadline - time.monotonic()
                if left <= 0:
                    raise CdpError(f"{method}: no reply in {timeout} s")
                self.pump(min(left, 1.0))
        finally:
            self.waiting.discard(message_id)
        response = self.responses.pop(message_id)
        if "error" in response:
            raise CdpError(f"{method}: {response['error'].get('message', response['error'])}")
        return response.get("result", {})

    def idle(self, seconds):
        end = time.monotonic() + seconds
        while True:
            left = end - time.monotonic()
            if left <= 0:
                return
            self.pump(left)

    def send(self, data, opcode=0x1):
        mask = os.urandom(4)
        length = len(data)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length < 1 << 16:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        try:
            self.sock.sendall(bytes(header) + mask + masked)
        except OSError as error:
            raise ChromeClosed(f"Chrome socket: {error}") from error

    def pump(self, timeout):
        ready, _, _ = select.select([self.sock], [], [], max(timeout, 0))
        if not ready:
            return
        try:
            chunk = self.sock.recv(1 << 20)
        except OSError as error:
            raise ChromeClosed(f"Chrome socket: {error}") from error
        if not chunk:
            raise ChromeClosed("Chrome closed the DevTools socket")
        self.buf += chunk
        while True:
            frame = self.next_frame()
            if frame is None:
                return
            fin, opcode, payload = frame
            if opcode == 0x8:
                raise ChromeClosed("Chrome closed the DevTools socket")
            if opcode == 0x9:
                self.send(payload, 0xA)
                continue
            if opcode == 0xA:
                continue
            self.partial = payload if opcode in (0x1, 0x2) else self.partial + payload
            if fin:
                message, self.partial = json.loads(self.partial), b""
                self.dispatch(message)

    def next_frame(self):
        data = self.buf
        if len(data) < 2:
            return None
        length = data[1] & 0x7F
        index = 2
        if length == 126:
            if len(data) < 4:
                return None
            length = struct.unpack(">H", data[2:4])[0]
            index = 4
        elif length == 127:
            if len(data) < 10:
                return None
            length = struct.unpack(">Q", data[2:10])[0]
            index = 10
        mask = None
        if data[1] & 0x80:
            mask = bytes(data[index : index + 4])
            index += 4
        if len(data) < index + length:
            return None
        payload = bytes(data[index : index + length])
        if mask:
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        fin, opcode = data[0] & 0x80, data[0] & 0x0F
        del data[: index + length]
        return fin, opcode, payload

    def dispatch(self, message):
        if "id" in message:
            if message["id"] in self.waiting:
                self.responses[message["id"]] = message
        elif self.listener:
            self.listener(message)

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def read_endpoint():
    try:
        lines = [line.strip() for line in PORT_FILE.read_text().splitlines() if line.strip()]
    except FileNotFoundError:
        lines = []
    if len(lines) < 2:
        raise SystemExit(
            f"{PORT_FILE} has no port. Turn on remote debugging at chrome://inspect/#remote-debugging."
        )
    return int(lines[0]), lines[1]


def click_allow():
    try:
        result = subprocess.run(
            ["osascript", "-e", ALLOW_SCRIPT], capture_output=True, text=True, timeout=20, check=False
        )
    except subprocess.TimeoutExpired:
        return "osascript timed out"
    if result.returncode:
        return result.stderr.strip()[:200] or f"osascript exited {result.returncode}"
    if result.stdout.strip() == "clicked":
        log("Clicked Allow.")
    return None


def handshake(port, path):
    key = base64.b64encode(os.urandom(16)).decode()
    request = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    try:
        sock = socket.create_connection(("127.0.0.1", port), 8)
    except OSError as error:
        raise SystemExit(f"Cannot reach Chrome on port {port} ({error}). Is Chrome running?")
    sock.sendall(request.encode())
    log('Waiting for Chrome. Click Allow on "Allow remote debugging?" if it shows.')
    buf = b""
    deadline = time.monotonic() + ALLOW_SECONDS
    next_click = time.monotonic() + 2
    warned = False
    while b"\r\n\r\n" not in buf:
        now = time.monotonic()
        if now > deadline:
            raise SystemExit(
                f"Chrome did not accept the connection within {ALLOW_SECONDS} s. "
                'Click Allow on "Allow remote debugging?", then start again.'
            )
        if now >= next_click:
            problem = click_allow()
            if problem and not warned:
                warned = True
                log(f"Could not click Allow automatically ({problem}). Click it by hand.")
            next_click = time.monotonic() + 5
        ready, _, _ = select.select([sock], [], [], 1)
        if not ready:
            continue
        chunk = sock.recv(4096)
        if not chunk:
            raise SystemExit("Chrome closed the connection before accepting it.")
        buf += chunk
    head, _, rest = buf.partition(b"\r\n\r\n")
    status = head.split(b"\r\n", 1)[0].decode("latin1", "replace")
    if " 101 " not in status:
        raise SystemExit(f"Chrome refused the connection: {status}")
    sock.settimeout(None)
    return Chrome(sock, rest)


STEP_FIELDS = {
    "play": ({}, {"selector": str}),
    "seek": ({"time": (int, float)}, {"selector": str}),
    "click": ({"selector": str}, {}),
    "wait-overlay": ({}, {"reject": list, "reject_error": bool}),
    "network-any": ({"hints": list}, {}),
    "evaluate": ({"expression": str}, {"save": str}),
    "trace": ({"seconds": (int, float)}, {"selector": str, "save": str}),
    "screenshot": ({"path": str}, {}),
}


def validate(checks):
    if not isinstance(checks, list) or not checks:
        return ["checks must be a non-empty list"]
    problems = []
    for number, check in enumerate(checks):
        where = f"check {number}"
        if not isinstance(check, dict):
            problems.append(f"{where} is not an object")
            continue
        where = f"check {check.get('name', number)!r}"
        extra = set(check) - {"name", "url", "budget", "steps", "on_fail", "fail_screenshot"}
        if extra:
            problems.append(f"{where}: unknown fields {sorted(extra)}")
        if not isinstance(check.get("name"), str) or not check["name"]:
            problems.append(f"{where}: name must be a non-empty string")
        if not str(check.get("url", "")).startswith(("https://", "http://")):
            problems.append(f"{where}: url must start with http:// or https://")
        budget = check.get("budget")
        if not isinstance(budget, (int, float)) or isinstance(budget, bool) or not 1 <= budget <= 600:
            problems.append(f"{where}: budget must be 1-600 seconds")
        if "on_fail" in check and (not isinstance(check["on_fail"], str) or not check["on_fail"]):
            problems.append(f"{where}: on_fail must be a non-empty JavaScript expression")
        if "fail_screenshot" in check and not (
            isinstance(check["fail_screenshot"], str) and Path(check["fail_screenshot"]).is_absolute()
        ):
            problems.append(f"{where}: fail_screenshot must be an absolute path")
        steps = check.get("steps")
        if not isinstance(steps, list) or not steps:
            problems.append(f"{where}: steps must be a non-empty list")
            continue
        for index, step in enumerate(steps):
            action = step.get("action") if isinstance(step, dict) else None
            if not isinstance(action, str) or action not in STEP_FIELDS:
                problems.append(f"{where} step {index}: unknown action {action!r}")
                continue
            required, optional = STEP_FIELDS[action]
            for field, kind in {**required, **optional}.items():
                value = step.get(field)
                if field in step and (
                    not isinstance(value, kind)
                    or isinstance(value, list) and not all(isinstance(item, str) and item for item in value)
                ):
                    problems.append(f"{where} step {index}: {field} has the wrong type")
            if action == "network-any" and not step.get("hints"):
                problems.append(f"{where} step {index}: hints must not be empty")
            missing = set(required) - set(step)
            extra = set(step) - set(required) - set(optional) - {"action"}
            if missing:
                problems.append(f"{where} step {index}: {action} needs {sorted(missing)}")
            if extra:
                problems.append(f"{where} step {index}: {action} does not take {sorted(extra)}")
            for field in ("path", "save"):
                if isinstance(step.get(field), str) and not Path(step[field]).is_absolute():
                    problems.append(f"{where} step {index}: {field} must be an absolute path")
            seconds = step.get("seconds")
            if action == "trace" and isinstance(seconds, (int, float)) and not (
                1 <= seconds <= 600 and (not isinstance(budget, (int, float)) or seconds < budget)
            ):
                problems.append(f"{where} step {index}: trace seconds must be 1-600 and below the budget")
    return problems


class Tab:

    def __init__(self, chrome, target_id, session, deadline, progress):
        self.chrome = chrome
        self.target_id = target_id
        self.session = session
        self.deadline = deadline
        self.progress = progress
        self.requests = []
        self.seen = set()
        self.playing = None
        self.expect_motion = False
        self.rates = {}
        self.clock_samples = 0
        self.clock_visible = 0
        self.stall_since = None
        self.stall_time = None
        self.buffering = False
        self.fail_reason = None
        self.last_error = None
        self.gone = None
        self.video_time = None
        self.label = None
        self.step_started = None
        self.milestone = None
        self.run_id = None
        self.tag = None
        self.extension = None
        self.workers = set()
        self.attached = set()
        self.worker_targets = []
        self.worker_events = []
        self.saw_view = False

    def on_event(self, event):
        method = event.get("method")
        params = event.get("params", {})
        session = event.get("sessionId")
        if method == "Target.detachedFromTarget":
            if params.get("sessionId") == self.session:
                self.lost("closed")
            if params.get("sessionId") in self.workers:
                self.workers.discard(params["sessionId"])
                self.attached.discard(params.get("targetId"))
        elif method == "Target.targetCreated":
            if params.get("targetInfo", {}).get("type") == "service_worker":
                self.worker_targets.append(params["targetInfo"])
        elif session in self.workers:
            if method == "Runtime.consoleAPICalled":
                self.worker_event(params)
        elif session != self.session:
            return
        elif method == "Network.requestWillBeSent":
            url = public_url(params["request"]["url"])
            if url not in self.seen and len(self.requests) < 5000:
                self.seen.add(url)
                self.requests.append(url)
        elif method == "Inspector.targetCrashed":
            self.lost("crashed")
        elif method == "Inspector.detached":
            reason = params.get("reason", "")
            self.lost("closed" if reason == "target_closed" else f"detached ({reason})")

    def worker_event(self, params):
        args = params.get("args") or []
        text = args[0].get("value") if args else None
        if not isinstance(text, str) or not text.startswith(TRACE_PREFIX):
            return
        if len(self.worker_events) >= WORKER_EVENTS:
            return
        try:
            event = json.loads(text[len(TRACE_PREFIX):])
        except ValueError:
            return
        if isinstance(event, dict):
            self.worker_events.append((params.get("timestamp") or time.time() * 1000, event))
            self.saw_view = self.saw_view or (event.get("e") == "view" and event.get("run") == self.run_id)

    def watch_worker(self):
        self.run_id = secrets.token_hex(8)
        root = "document.documentElement"
        self.tag = (f"(() => {{ if ({root}.getAttribute({json.dumps(TRACE_ATTRIBUTE)}) !== {json.dumps(self.run_id)}) "
                    f"{root}.setAttribute({json.dumps(TRACE_ATTRIBUTE)}, {json.dumps(self.run_id)}); "
                    f"return {root}.getAttribute({json.dumps(TRACE_WORKER_ATTRIBUTE)}); }})()")
        self.chrome.call("Target.setDiscoverTargets", {"discover": True})

    def pump_worker(self):
        try:
            answer = self.evaluate(self.tag)
        except CdpError:
            answer = None
        if not self.extension and isinstance(answer, str) and re.fullmatch(r"[a-p]{32}", answer):
            self.extension = f"chrome-extension://{answer}"
        if not self.extension:
            return
        script = f"{self.extension}/background.js"
        pending, self.worker_targets = self.worker_targets, []
        for info in pending:
            if info.get("url") != script or info.get("targetId") in self.attached:
                continue
            try:
                session = self.chrome.call(
                    "Target.attachToTarget", {"targetId": info["targetId"], "flatten": True}
                )["sessionId"]
                self.workers.add(session)
                self.attached.add(info["targetId"])
                self.chrome.call("Runtime.enable", session=session)
            except (CdpError, KeyError):
                continue

    def await_worker(self):
        limit = time.monotonic() + WORKER_WAIT_SECONDS
        while not self.workers and time.monotonic() < min(limit, self.deadline):
            self.check_gone()
            self.pump_worker()
            self.chrome.idle(0.1)
        self.pump_worker()

    def stop_worker(self):
        for session in list(self.workers):
            try:
                self.chrome.call("Target.detachFromTarget", {"sessionId": session}, timeout=5)
            except CdpError:
                pass
        self.workers.clear()
        if self.run_id:
            try:
                self.chrome.call("Target.setDiscoverTargets", {"discover": False}, timeout=5)
            except CdpError:
                pass

    def lost(self, how):
        if not self.gone:
            at = f" at video {self.video_time} s" if self.video_time is not None else ""
            self.gone = f"tab {how}{at}"

    def check_gone(self):
        if self.gone:
            raise TabGone(self.gone)

    def remember(self, value):
        if isinstance(value, dict) and isinstance(value.get("time"), (int, float)):
            self.video_time = value["time"]
        return value

    def note_stall(self, value):
        self.buffering = False
        if not isinstance(value, dict) or "ready" not in value:
            self.stall_since = None
            return None
        rate = value.get("rate")
        if isinstance(rate, (int, float)):
            self.rates[rate] = self.rates.get(rate, 0) + 1
            self.clock_samples += 1
            if value.get("visible") == "visible":
                self.clock_visible += 1
        if value.get("ended") or value.get("ad"):
            self.stall_since = None
            return None
        ready = value.get("ready")
        if not isinstance(ready, (int, float)) or ready < 3:
            self.stall_since = None
            self.buffering = True
            return None
        now = time.monotonic()
        mark = value.get("time")
        if self.stall_time != mark or self.stall_since is None:
            self.stall_time = mark
            self.stall_since = now
            return None
        if now - self.stall_since >= STALL_SECONDS:
            self.fail_reason = f"video time stuck at {mark} s, readyState {ready}"
            return FAIL
        return None

    def attach_clock(self, stats):
        clock_stats(stats, self.rates, self.clock_visible, self.clock_samples)

    def call(self, method, params=None, timeout=20):
        self.check_gone()
        try:
            return self.chrome.call(
                method, params, session=self.session, timeout=timeout, abort=lambda: self.gone
            )
        except CdpError:
            self.check_gone()
            raise

    def evaluate(self, expression, timeout=8):
        result = self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
            timeout=timeout,
        )
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            text = details.get("exception", {}).get("description") or details.get("text")
            raise CdpError(str(text)[:300])
        return result.get("result", {}).get("value")

    def sample(self, expression):
        try:
            value = self.evaluate(expression)
        except CdpError as error:
            self.last_error = str(error)
            return None
        self.last_error = None
        return value

    def until(self, probe, passed):
        beat = time.monotonic() + HEARTBEAT_SECONDS
        while True:
            self.check_gone()
            if self.run_id:
                self.pump_worker()
            observed = None
            if self.playing:
                observed = self.remember(self.sample(self.playing))
            value = probe()
            if isinstance(value, dict) and "ready" in value:
                observed = self.remember(value)
            if self.expect_motion and self.note_stall(observed) is FAIL:
                return FAIL, observed
            verdict = passed(value)
            if verdict is FAIL:
                return FAIL, value
            if verdict:
                return True, value
            now = time.monotonic()
            left = self.deadline - now
            if left <= 0:
                return False, value
            if self.label and now >= beat:
                waited = round(now - self.step_started)
                event = {**self.label, "state": "wait", "waited": waited, "video": self.video_time}
                if self.buffering:
                    event["buffering"] = True
                self.progress(event)
                beat = now + HEARTBEAT_SECONDS
            self.chrome.idle(min(POLL_SECONDS, left))

    def loaded(self):
        ok, _ = self.until(
            lambda: self.sample("location.href"), lambda href: bool(href) and href != "about:blank"
        )
        return ok

    def run(self, step, label):
        self.label = label
        self.milestone = None
        self.fail_reason = None
        self.progress({**label, "state": "start"})
        started = self.step_started = time.monotonic()
        try:
            result = getattr(self, "do_" + step["action"].replace("-", "_"))(step)
        except (CdpError, TabGone) as error:
            result = {"ok": False, "error": str(error)}
            if self.milestone:
                result["last"] = self.milestone
        result = {"action": step["action"], **result, "seconds": round(time.monotonic() - started, 1)}
        if not result["ok"] and "error" not in result and "reason" not in result:
            result["reason"] = "budget spent"
            if self.last_error:
                result["page_error"] = self.last_error
        event = {**label, "state": "end", "ok": result["ok"], "seconds": result["seconds"]}
        if step["action"] == "trace" and isinstance(result.get("stats"), dict):
            detail = trace_line(result["stats"])
            fail = result.get("value") if isinstance(result.get("value"), dict) else None
            if fail and fail.get("fail"):
                detail = f"{detail}, {fail['fail']}"
            event["detail"] = detail
        self.progress(event)
        return result

    def do_play(self, step):
        selector = json.dumps(step.get("selector", "video"))
        expression = f"""(() => {{
          const skip = document.querySelector({json.dumps(SKIP_AD)});
          if (skip) skip.click();
          const video = document.querySelector({selector});
          if (!video) return null;
          video.muted = true;
          if (video.paused && !video.ended) {{
            const playing = video.play();
            if (playing && playing.catch) playing.catch(() => {{}});
          }}
          {video_report()}
        }})()"""
        self.expect_motion = True
        origin = [None]

        def playing(item):
            if not isinstance(item, dict):
                return False
            if item.get("ended"):
                return True
            if item.get("paused"):
                return False
            mark = item.get("time")
            if origin[0] is None:
                origin[0] = mark
                return False
            return mark != origin[0]

        ok, value = self.until(lambda: self.sample(expression), playing)
        if ok is True:
            self.playing = expression
            return {"ok": True, "video": value}
        result = {"ok": False, "video": value}
        if self.fail_reason:
            result["reason"] = "fail"
            result["value"] = {"fail": self.fail_reason}
        return result

    def do_seek(self, step):
        target = float(step["time"])
        expression = f"""(() => {{
          const video = document.querySelector({json.dumps(step.get("selector", "video"))});
          if (!video || video.readyState < 1) return null;
          if (Math.abs(video.currentTime - {target}) > 1.5) video.currentTime = {target};
          return Math.round(video.currentTime * 10) / 10;
        }})()"""
        ok, value = self.until(
            lambda: self.sample(expression), lambda value: value is not None and abs(value - target) <= 1.5
        )
        return {"ok": ok, "time": value}

    def do_click(self, step):
        expression = f"""(() => {{
          const node = document.querySelector({json.dumps(step["selector"])});
          if (!node) return null;
          node.click();
          return {{tag: node.tagName.toLowerCase(), text: (node.textContent || '').trim().slice(0, 60)}};
        }})()"""
        ok, value = self.until(lambda: self.sample(expression), lambda value: value is not None)
        return {"ok": ok, "clicked": value}

    def do_wait_overlay(self, step):
        reject = {text.strip() for text in step.get("reject", ["翻译中"])}
        reject_error = step.get("reject_error", True)

        def shown(line):
            return bool(line and not line["hidden"] and line["text"])

        def passed(value):
            if not value or not shown(value.get("original")) or not shown(value.get("translation")):
                return False
            translation = value["translation"]
            return translation["text"] not in reject and not (reject_error and translation["error"])

        ok, value = self.until(lambda: self.remember(self.sample(OVERLAY)), passed)
        if ok:
            pair = {"original": value["original"]["text"], "translation": value["translation"]["text"]}
            return {"ok": True, "pair": pair, "time": value["time"]}
        return {"ok": False, "last": value}

    def do_network_any(self, step):
        hints = [hint.lower() for hint in step["hints"]]

        def match():
            return next((url for url in self.requests if any(hint in url.lower() for hint in hints)), None)

        ok, value = self.until(match, lambda value: value is not None)
        return {"ok": ok, "url": value} if ok else {"ok": False, "requests": len(self.requests)}

    def do_evaluate(self, step):
        def passed(value):
            if isinstance(value, dict) and "fail" in value:
                return FAIL
            return value not in (None, False, 0, "")

        verdict, value = self.until(lambda: self.sample(step["expression"]), passed)
        result = {"ok": verdict is True}
        if verdict is FAIL:
            result["reason"] = "fail"
        if step.get("save"):
            result["saved"] = save_json(step["save"], value)
            result["value"] = clip(value, PREVIEW_CHARS)
        else:
            result["value"] = clip(value)
        return result

    def do_trace(self, step):
        self.expect_motion = True
        started = time.time() * 1000
        selector = json.dumps(step.get("selector", "video"))
        probe = f"""(() => {{
          const video = document.querySelector({selector});
          if (!video) return null;
          {video_report()}
        }})()"""
        progress = {"played": 0.0, "last": None, "playing_since": None, "milestone": TRACE_MILESTONE}

        def summary():
            return summarize_worker(self.worker_events, self.run_id, started, progress["played"])

        def passed(value):
            if not isinstance(value, dict):
                return False
            self.remember(value)
            moving = not value["paused"] and not value["ad"]
            last = progress["last"]
            if moving and last is not None and 0 <= value["time"] - last <= 3:
                progress["played"] += value["time"] - last
            progress["last"] = value["time"] if moving else None
            if moving and progress["playing_since"] is None:
                progress["playing_since"] = time.monotonic()
            if progress["played"] >= progress["milestone"]:
                progress["milestone"] += TRACE_MILESTONE
                stats = summary()["stats"]
                self.attach_clock(stats)
                self.milestone = stats
            since = progress["playing_since"]
            if not self.saw_view and since is not None and time.monotonic() - since > WORKER_QUIET_SECONDS:
                return FAIL
            return progress["played"] >= step["seconds"] or value["ended"]

        try:
            verdict, _ = self.until(lambda: self.sample(probe), passed)
        except TabGone:
            stats = summary()["stats"]
            self.attach_clock(stats)
            self.milestone = stats
            raise
        full = summary()
        self.attach_clock(full["stats"])
        if self.fail_reason or (verdict is True and not self.saw_view):
            verdict = FAIL
        result = {"ok": verdict is True}
        if verdict is FAIL:
            if self.fail_reason:
                why = self.fail_reason
            elif not self.extension:
                why = ("no answer from Subline in this tab; it is off for this site, or Chrome runs a build "
                       "from before tracing, so run live reload")
            elif not self.attached:
                why = "Subline's service worker never appeared"
            else:
                why = "no trace events from Subline; run live reload so Chrome runs this build"
            result.update(reason="fail", value={"fail": why})
        result["stats"] = full["stats"]
        if len(self.worker_events) >= WORKER_EVENTS:
            result["stats"]["truncated"] = True
        result["longest"] = sorted(full["episodes"], key=lambda e: -e["seconds"])[:5]
        measured = [s for s in full["sentences"] if s["lag"] is not None]
        result["slowest"] = sorted(measured, key=lambda s: -s["lag"])[:5]
        if step.get("save"):
            views = [[stamp, e] for stamp, e in self.worker_events if e.get("e") == "view" and e.get("run") == self.run_id]
            result["saved"] = save_json(step["save"], {**full, "views": views})
        return result

    def screenshot(self, path):
        path = Path(path)
        jpeg = path.suffix.lower() in (".jpg", ".jpeg")
        params = {"format": "jpeg", "quality": 88} if jpeg else {"format": "png"}
        data = self.call("Page.captureScreenshot", params, timeout=30)["data"]
        return write_file(path, base64.b64decode(data))

    def do_screenshot(self, step):
        return {"ok": True, "path": self.screenshot(step["path"])}


class Holder:
    def __init__(self, chrome, chrome_port):
        self.chrome = chrome
        self.chrome_port = chrome_port
        self.token = secrets.token_hex(16)
        self.owner = session_id()
        if not self.owner:
            raise ValueError("Start a session through live.py start")
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(8)
        self.port = self.server.getsockname()[1]
        self.started = time.time()

    def publish(self, tab=None):
        write_state({"pid": os.getpid(), "port": self.port, "token": self.token,
                     "owner": self.owner, "chrome_port": self.chrome_port, "tab": tab})

    def serve(self):
        idle_until = time.monotonic() + IDLE_SECONDS
        while True:
            left = idle_until - time.monotonic()
            if left <= 0:
                log(f"No request for {IDLE_SECONDS} s. Closing.")
                return
            ready, _, _ = select.select([self.server, self.chrome.sock], [], [], min(left, 30))
            if self.chrome.sock in ready:
                self.chrome.pump(0)
            if self.server in ready:
                client, _ = self.server.accept()
                with client:
                    try:
                        self.handle(client)
                    except OSError as error:
                        log(f"Client went away: {error}")
                idle_until = time.monotonic() + IDLE_SECONDS

    def handle(self, client):
        client.settimeout(10)
        try:
            with client.makefile("rb") as stream:
                request = json.loads(stream.readline(1 << 22))
        except ValueError:
            return
        token = str(request.get("token", "")) if isinstance(request, dict) else ""
        if not hmac.compare_digest(token.encode(), self.token.encode()):
            reply(client, {"done": True, "ok": False, "error": "bad token"})
            return
        client.settimeout(None)
        method = request.get("method")
        if method != "Session.status" and request.get("owner") != self.owner:
            reply(client, {"done": True, "ok": False, "error": "Holder belongs to another session"})
            return
        if method == "Session.status":
            reply(client, {"done": True, "ok": True, "pid": os.getpid(), "chrome_port": self.chrome_port,
                           "started": self.started, "idle_minutes": IDLE_SECONDS // 60})
        elif method == "Session.run":
            self.run(client, (request.get("params") or {}).get("checks"))
        elif method == "Session.reload":
            self.reload(client, (request.get("params") or {}).get("extension"))
        else:
            reply(client, {"done": True, "ok": False, "error": f"unknown method {method!r}"})

    def reload(self, client, extension):
        if not isinstance(extension, str) or not re.fullmatch(r"[a-p]{32}", extension):
            reply(client, {"done": True, "ok": False, "error": "extension must be a 32-letter extension id"})
            return
        origin = f"chrome-extension://{extension}"
        workers = []

        def watch(event):
            info = event.get("params", {}).get("targetInfo", {})
            if event.get("method") == "Target.targetCreated" and info.get("url") == f"{origin}/background.js":
                workers.append(info.get("targetId"))

        def evaluate(session, expression):
            result = self.chrome.call("Runtime.evaluate", {"expression": expression, "returnByValue": True},
                                      session=session, timeout=5)
            return result.get("result", {}).get("value")

        def popup():
            target = self.chrome.call("Target.createTarget", {"url": f"{origin}/popup.html"})["targetId"]
            opened.append(target)
            self.publish(target)
            session = self.chrome.call("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                try:
                    name = evaluate(session, "chrome.runtime.getManifest().name")
                    if isinstance(name, str):
                        return session, name
                except CdpError:
                    pass
                self.chrome.idle(0.3)
            return session, None

        log(f"Reloading {origin}.")
        opened = []
        self.chrome.listener = watch
        try:
            self.chrome.call("Target.setDiscoverTargets", {"discover": True})
            session, name = popup()
            if not isinstance(name, str) or not name.startswith(SUBLINE_NAME):
                raise CdpError(f"{origin} is not Subline, or Chrome did not load it from that folder")
            before = set(workers)
            try:
                evaluate(session, "chrome.runtime.reload()")
            except CdpError:
                pass
            deadline = time.monotonic() + 15
            while not set(workers) - before and time.monotonic() < deadline:
                self.chrome.idle(0.3)
            if not set(workers) - before and popup()[1] != name:
                raise CdpError("Subline did not come back after reloading; turn it on at chrome://extensions")
            log(f"Reloaded {name}.")
            reply(client, {"done": True, "ok": True, "name": name})
        except CdpError as error:
            log(f"Reload failed: {error}")
            reply(client, {"done": True, "ok": False, "error": str(error)})
        finally:
            self.chrome.listener = None
            try:
                self.chrome.call("Target.setDiscoverTargets", {"discover": False}, timeout=5)
            except CdpError:
                pass
            for target in opened:
                try:
                    self.chrome.call("Target.closeTarget", {"targetId": target}, timeout=5)
                except CdpError:
                    pass
            self.publish()

    def run(self, client, checks):
        problems = validate(checks)
        if problems:
            reply(client, {"done": True, "ok": False, "error": "; ".join(problems)})
            return
        passed = 0
        for check in checks:
            log(f"Check {check['name']}: {check['url']}")
            report = self.check(check, lambda event: reply(client, {"progress": event}))
            passed += report["ok"]
            log(f"Check {check['name']}: {'ok' if report['ok'] else 'failed'} in {report['seconds']} s")
            reply(client, report)
        reply(client, {"done": True, "ok": passed == len(checks), "passed": passed, "total": len(checks)})

    def check(self, check, progress):
        started = time.monotonic()
        report = {"name": check["name"], "ok": False, "url": check["url"], "steps": []}
        target_id = None
        tab = None
        try:
            try:
                target_id = self.chrome.call("Target.createTarget", {"url": "about:blank"})["targetId"]
                self.publish(target_id)
                session = self.chrome.call(
                    "Target.attachToTarget", {"targetId": target_id, "flatten": True}
                )["sessionId"]
                tab = Tab(self.chrome, target_id, session, started + check["budget"], progress)
                self.chrome.listener = tab.on_event
                self.chrome.call("Network.enable", session=session)
                self.chrome.call("Inspector.enable", session=session)
                self.chrome.call("Page.enable", session=session)
                self.chrome.call(
                    "Page.addScriptToEvaluateOnNewDocument", {"source": MUTE_MEDIA}, session=session
                )
                if any(step.get("action") == "trace" for step in check["steps"]):
                    tab.watch_worker()
                navigated = self.chrome.call("Page.navigate", {"url": check["url"]}, session=session)
                if navigated.get("errorText"):
                    raise CdpError(f"navigation failed: {navigated['errorText']}")
                if not tab.loaded():
                    raise CdpError("page did not commit within the budget")
                if tab.run_id:
                    tab.await_worker()
                steps = check["steps"]
                for index, step in enumerate(steps, 1):
                    label = {"check": check["name"], "step": index, "of": len(steps), "action": step["action"]}
                    result = tab.run(step, label)
                    report["steps"].append(result)
                    if not result["ok"]:
                        break
                else:
                    report["ok"] = True
            except CdpError as error:
                report["error"] = str(error)
            except TabGone:
                pass
            if tab:
                self.wrap_up(check, tab, report)
        finally:
            self.chrome.listener = None
            if tab:
                tab.stop_worker()
            if target_id:
                try:
                    self.chrome.call("Target.closeTarget", {"targetId": target_id}, timeout=10)
                except CdpError:
                    pass
                self.publish()
        if tab:
            if tab.gone and not report["ok"]:
                report["error"] = tab.gone
            report["captions"] = [url for url in tab.requests if any(h in url.lower() for h in CAPTION_HINTS)][:8]
        report["seconds"] = round(time.monotonic() - started, 1)
        return report

    def wrap_up(self, check, tab, report):
        try:
            if not report["ok"] and check.get("on_fail"):
                try:
                    report["on_fail"] = clip(tab.evaluate(check["on_fail"]))
                except CdpError as error:
                    report["on_fail_error"] = str(error)
            if not report["ok"] and check.get("fail_screenshot"):
                try:
                    report["fail_screenshot"] = tab.screenshot(check["fail_screenshot"])
                except CdpError as error:
                    report["fail_screenshot_error"] = str(error)
            report["title"] = str(tab.sample("document.title") or "")[:120]
        except TabGone:
            pass


def clip(value, limit=VALUE_CHARS):
    text = json.dumps(value, ensure_ascii=False)
    return value if len(text) <= limit else text[:limit] + "…"


def write_file(path, data):
    path = Path(path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError as error:
        raise CdpError(f"cannot write {path}: {error}") from error
    return str(path)


def save_json(path, value):
    return write_file(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def reply(client, message):
    client.sendall((json.dumps(message, ensure_ascii=False) + "\n").encode())


def write_state(data):
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = STATE.with_name(STATE.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as file:
        json.dump(data, file)
    os.replace(temporary, STATE)


def remove_state():
    state = load_state()
    if state and state.get("pid") == os.getpid():
        STATE.unlink()


def main():
    previous = load_state()
    if previous and alive(previous):
        raise SystemExit(f"A holder is already running (pid {previous['pid']}).")
    port, path = read_endpoint()
    chrome = handshake(port, path)
    holder = Holder(chrome, port)
    for number in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, lambda *_: sys.exit(0))
    try:
        if previous and previous.get("tab") and previous.get("owner") == holder.owner:
            try:
                chrome.call("Target.closeTarget", {"targetId": previous["tab"]}, timeout=5)
                log("Closed the tab a stopped holder left open.")
            except CdpError:
                pass
        holder.publish()
        log(f"Ready. Chrome port {port}, holder port {holder.port}.")
        holder.serve()
    except ChromeClosed as error:
        log(f"{error}. Exiting.")
    finally:
        remove_state()
        holder.server.close()
        chrome.close()
        log("Holder stopped.")


if __name__ == "__main__":
    main()
