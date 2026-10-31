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
from live import fingerprint


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


def developer_mode(port, path):
    chrome = handshake(port, path)
    target = None
    try:
        target = chrome.call("Target.createTarget", {"url": "chrome://extensions"})["targetId"]
        session = chrome.call("Target.attachToTarget", {
            "targetId": target, "flatten": True,
        })["sessionId"]
        expression = (
            "chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode: true})"
            ".then(() => chrome.developerPrivate.getProfileConfiguration())"
            ".then(config => config.inDeveloperMode)"
        )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            reply = chrome.call("Runtime.evaluate", {
                "expression": expression, "awaitPromise": True, "returnByValue": True,
            }, session=session)
            if reply.get("result", {}).get("value") is True:
                return
            time.sleep(0.1)
        raise RuntimeError("Could not enable extension developer mode")
    finally:
        try:
            if target:
                chrome.call("Target.closeTarget", {"targetId": target})
        finally:
            chrome.close()


def interrupted(signum, _frame):
    raise KeyboardInterrupt(signal.Signals(signum).name)


def main():
    parser = argparse.ArgumentParser(description="Launch isolated Chromium.")
    parser.add_argument("--browser", type=Path, required=True)
    parser.add_argument("--extension", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New task-owned directory")
    parser.add_argument("--window-size", default="1280,900")
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
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
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
        "debug_chromium_env": {
            "DEBUG_CHROMIUM_PORT_FILE": str(output / "endpoint"),
            "DEBUG_CHROMIUM_STATE": str(output / "holder.json"),
        },
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
        developer_mode(port, path)
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
