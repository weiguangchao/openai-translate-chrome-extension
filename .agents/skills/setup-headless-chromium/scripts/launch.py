#!/usr/bin/env python3
import argparse
import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

DEBUG = Path(__file__).resolve().parents[2] / "debug-chromium/scripts"
sys.path.insert(0, str(DEBUG))
from holder import handshake
from live import extension_id, fingerprint


def endpoint(process, port):
    deadline = time.monotonic() + 30
    while process.poll() is None and time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as response:
                data = json.load(response)
        except OSError:
            time.sleep(0.1)
            continue
        url = urllib.parse.urlsplit(data.get("webSocketDebuggerUrl", ""))
        if (url.scheme != "ws" or url.hostname not in {"127.0.0.1", "localhost"}
                or url.port != port or not url.path.startswith("/devtools/browser/")):
            raise ValueError("Unexpected Chromium debugging endpoint")
        return url.path
    raise RuntimeError("No Chromium endpoint; inspect chromium.log.")


MICROSOFT_ORIGIN = "https://edge.microsoft.com"
OPENAI_FIELDS = ("OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY")


def host_permission(url):
    parts = urllib.parse.urlsplit(url)
    local = parts.scheme == "http" and parts.hostname in {"localhost", "127.0.0.1"}
    if not parts.hostname or not (parts.scheme == "https" or local):
        return None
    return f"{parts.scheme}://{parts.hostname}/*"


def read_env(path):
    lines = (line.strip() for line in path.read_text().splitlines())
    return dict(line.split("=", 1) for line in lines if "=" in line and not line.startswith("#"))


def provider_setup(args, parser):
    if args.provider != "openai" and (args.provider_env or args.microsoft_fallback):
        parser.error("--provider-env and --microsoft-fallback need --provider openai")
    if args.provider == "microsoft":
        return {"kind": "microsoft", "origins": [host_permission(MICROSOFT_ORIGIN)], "fields": {}}
    if args.provider != "openai":
        return None
    if not args.provider_env:
        parser.error("--provider openai needs --provider-env")
    try:
        values = read_env(args.provider_env.expanduser())
    except OSError as error:
        parser.error(f"--provider-env: {error}")
    missing = [name for name in OPENAI_FIELDS if not values.get(name)]
    if missing:
        parser.error(f"--provider-env lacks {', '.join(missing)}")
    origin = host_permission(values["OPENAI_BASE_URL"])
    if not origin:
        parser.error("OPENAI_BASE_URL needs https, or http to localhost or 127.0.0.1")
    origins = [origin] + ([host_permission(MICROSOFT_ORIGIN)] if args.microsoft_fallback else [])
    return {"kind": "openai", "origins": origins,
            "fields": {name: values[name] for name in OPENAI_FIELDS}}


class Page:
    """One task-owned tab whose clicks count as user gestures, as permission requests need."""

    def __init__(self, chrome, url):
        self.chrome = chrome
        self.target = chrome.call("Target.createTarget", {"url": url})["targetId"]
        self.session = chrome.call("Target.attachToTarget", {
            "targetId": self.target, "flatten": True,
        })["sessionId"]

    def evaluate(self, expression):
        reply = self.chrome.call("Runtime.evaluate", {
            "expression": expression, "awaitPromise": True, "returnByValue": True, "userGesture": True,
        }, session=self.session)
        if "exceptionDetails" in reply:
            details = reply["exceptionDetails"]
            raise RuntimeError(str(details.get("exception", {}).get("description") or details.get("text"))[:300])
        return reply.get("result", {}).get("value")

    def until(self, expression, seconds, failure):
        deadline = time.monotonic() + seconds
        error = None
        while time.monotonic() < deadline:
            try:
                value, error = self.evaluate(expression), None
            except RuntimeError as problem:
                value, error = None, problem
            if value:
                return value
            time.sleep(0.1)
        raise RuntimeError(f"{failure} ({error})" if error else failure)

    def close(self):
        self.chrome.call("Target.closeTarget", {"targetId": self.target})


SET_FIELD = """((id, value) => {
  const field = document.getElementById(id);
  const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
  field.dispatchEvent(new Event('input', {bubbles: true}));
  field.dispatchEvent(new Event('change', {bubbles: true}));
})"""
CONSENT = """(index => {
  const box = document.querySelectorAll('.consent-check input[type=checkbox]')[index];
  if (box && !box.checked) box.click();
  return Boolean(box && box.checked);
})"""
ALERT = "document.querySelector('.settings-alert.error')?.innerText.trim()"
SAVED = ("(() => { const error = document.querySelector('.settings-alert:not(.success)')?.innerText.trim(); "
         "if (error) return {error}; "
         "return Boolean(document.querySelector('.settings-alert.success')); })()")
CONNECTED = (f"(() => {{ const error = {ALERT}; if (error) return {{error}}; "
             "return Boolean(document.querySelector('.connection-badge.connected')); })()")


def configure_provider(page, setup):
    page.until("Boolean(document.getElementById('provider'))", 15, "Settings page did not load")
    page.evaluate(f"{SET_FIELD}('provider', {json.dumps(setup['kind'])})")
    fields = setup["fields"]
    if fields:
        page.until("Boolean(document.getElementById('base-url'))", 5, "OpenAI fields did not appear")
        page.evaluate(f"{SET_FIELD}('base-url', {json.dumps(fields['OPENAI_BASE_URL'])})")
        page.evaluate(f"{SET_FIELD}('api-key', {json.dumps(fields['OPENAI_API_KEY'])})")
        page.evaluate("document.getElementById('model') instanceof HTMLSelectElement && "
                      "document.querySelector('label[for=model] .text-button').click()")
        page.until("document.getElementById('model') instanceof HTMLInputElement", 5,
                   "Model ID did not switch to manual entry")
        page.evaluate(f"{SET_FIELD}('model', {json.dumps(fields['OPENAI_MODEL'])})")
    for index in range(len(setup["origins"])):
        if page.evaluate(f"{CONSENT}({index})") is not True:
            raise RuntimeError("Could not accept the data use notice")
    page.evaluate("document.querySelector('.save-button').click()")
    saved = page.until(SAVED, 20, "Saving did not finish in 20 s; an ungranted origin is the usual cause")
    if isinstance(saved, dict):
        raise RuntimeError(f"Saving failed: {saved['error']}")
    page.evaluate("document.querySelector('.test-button').click()")
    connected = page.until(CONNECTED, 60, "Connection test did not finish")
    if isinstance(connected, dict):
        raise RuntimeError(f"Connection test failed: {connected['error']}")


def prepare_extensions(port, path, extension, setup):
    chrome = handshake(port, path)
    try:
        page = Page(chrome, "chrome://extensions")
        page.until("chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode: true})"
                   ".then(() => chrome.developerPrivate.getProfileConfiguration())"
                   ".then(config => config.inDeveloperMode)", 10, "Could not enable extension developer mode")
        for origin in setup["origins"] if setup else []:
            page.evaluate(f"chrome.developerPrivate.addHostPermission("
                          f"{json.dumps(extension_id(extension))}, {json.dumps(origin)})")
        page.close()
        if setup:
            page = Page(chrome, f"chrome-extension://{extension_id(extension)}/index.html")
            configure_provider(page, setup)
            page.close()
    finally:
        chrome.close()


def background(output, argv):
    output.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (output / "launcher.log").open("w") as log:
        launcher = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), *argv],
                                    stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    deadline = time.monotonic() + 180
    record = {}
    while time.monotonic() < deadline:
        try:
            record = json.loads((output / "session.json").read_text())
        except (OSError, ValueError):
            record = {}
        if record.get("state") in {"ready", "failed", "stopped"} or launcher.poll() is not None:
            break
        time.sleep(0.2)
    else:
        launcher.terminate()
        launcher.wait()
    if record.get("state") == "ready":
        print(json.dumps(record), flush=True)
        return 0
    print((output / "launcher.log").read_text()[-2000:] or "Launcher stopped before it was ready.",
          file=sys.stderr)
    return 1


def interrupted(signum, _frame):
    raise KeyboardInterrupt(signal.Signals(signum).name)


def main():
    parser = argparse.ArgumentParser(description="Launch isolated Chromium.", allow_abbrev=False)
    parser.add_argument("--browser", type=Path, required=True)
    parser.add_argument("--extension", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True,
                        help="Task-owned directory without an earlier session.json")
    parser.add_argument("--window-size", default="1280,900")
    parser.add_argument("--provider", choices=("microsoft", "openai"),
                        help="Save this Provider in the settings page and pass its connection test")
    parser.add_argument("--provider-env", type=Path,
                        help="Private file with OPENAI_BASE_URL, OPENAI_MODEL and OPENAI_API_KEY")
    parser.add_argument("--microsoft-fallback", action="store_true",
                        help="Also consent to Microsoft temporary translations")
    parser.add_argument("--background", action="store_true",
                        help="Return once the browser is ready; the launcher keeps running")
    args = parser.parse_args()
    browser, extension, output = (p.expanduser().resolve() for p in (
        args.browser, args.extension, args.output,
    ))
    if not browser.is_file() or not os.access(browser, os.X_OK):
        parser.error("--browser needs an executable full Chromium")
    if not (extension / "manifest.json").is_file():
        parser.error("--extension needs manifest.json; build first.")
    if not re.fullmatch(r"[1-9]\d*,[1-9]\d*", args.window_size):
        parser.error("--window-size needs positive WIDTH,HEIGHT")
    setup = provider_setup(args, parser)
    if (output / "session.json").exists():
        parser.error("--output already holds a launch; use a new directory")
    if args.background:
        return background(output, [arg for arg in sys.argv[1:] if arg != "--background"])
    version = subprocess.run([str(browser), "--version"], check=True,
                             capture_output=True, text=True).stdout.strip()
    match = re.search(r"\b(\d+)\.\d+\.\d+\.\d+\b", version)
    if not match:
        parser.error("Cannot read Chromium version")
    platforms = {"Darwin": "Macintosh; Intel Mac OS X 10_15_7", "Linux": "X11; Linux x86_64"}
    if platform.system() not in platforms:
        parser.error("Only macOS/Linux are supported")
    ua = (f"Mozilla/5.0 ({platforms[platform.system()]}) AppleWebKit/537.36 "
          f"(KHTML, like Gecko) Chrome/{match[1]}.0.0.0 Safari/537.36")
    output.mkdir(parents=True, mode=0o700, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="profile-", dir=output))
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    flags = [
        "--headless=new", f"--user-data-dir={profile}",
        "--remote-debugging-address=127.0.0.1", f"--remote-debugging-port={port}",
        f"--user-agent={ua}", f"--window-size={args.window_size}",
        f"--disable-extensions-except={extension}", f"--load-extension={extension}",
        "--no-first-run", "--no-default-browser-check", "--use-mock-keychain",
        "--password-store=basic", "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows", "about:blank",
    ]
    record = {
        "state": "starting", "launcher_pid": os.getpid(), "browser_pid": None,
        "browser": str(browser), "version": version, "extension": str(extension),
        "fingerprint": fingerprint(extension), "profile": str(profile), "port": port,
        "user_agent": ua, "flags": flags,
        "provider": setup and {"kind": setup["kind"], "origins": setup["origins"]},
    }

    def save():
        pending = output / "session.json.tmp"
        pending.write_text(json.dumps(record, indent=2) + "\n")
        pending.replace(output / "session.json")

    process = None
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        save()
        with (output / "chromium.log").open("w") as log:
            process = subprocess.Popen([str(browser), *flags], stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=log, start_new_session=True)
        record["browser_pid"] = process.pid
        save()
        path = endpoint(process, port)
        record["endpoint_path"] = path
        prepare_extensions(port, path, extension, setup)
        (output / "endpoint").write_text(f"{port}\n{path}\n")
        record["state"] = "ready"
        save()
        print(json.dumps(record), flush=True)
        if process.wait() != 0:
            raise RuntimeError("Chromium exited; inspect chromium.log.")
        record["state"] = "stopped"
    except KeyboardInterrupt as error:
        record.update(state="stopped", received_signal=str(error) or None)
    except (Exception, SystemExit) as error:
        record.update(state="failed", error=str(error))
        print(str(error), file=sys.stderr)
    finally:
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            record["browser_exit_code"] = process.returncode
            record["termination_scope"] = "owned_process_group"
        try:
            shutil.rmtree(profile)
        except OSError as error:
            record.update(state="failed", cleanup_error=str(error))
        finally:
            (output / "endpoint").unlink(missing_ok=True)
            record["profile_removed"] = not profile.exists()
            save()
    return 1 if record["state"] == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
