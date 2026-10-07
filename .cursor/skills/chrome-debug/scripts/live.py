#!/usr/bin/env python3
"""Run Subline checks in the signed-in Default Chrome through one DevTools socket.

    python3 live.py start                       # connect once; the user allows at most once
    python3 live.py run CHECKS.json [--only N]  # exit 0 only when every check passed
    python3 live.py reload [--path DIR]         # reload Subline after npm run build
    python3 live.py status
    python3 live.py stop                        # close the socket when the task ends
"""

import argparse
import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = Path(
    os.environ.get("CHROME_DEBUG_STATE")
    or Path.home() / "Library/Caches/subline-chrome-debug/holder.json"
)
LOG = STATE.with_suffix(".log")
START_SECONDS = 75


class NotRunning(Exception):
    pass


def load_state():
    try:
        return json.loads(STATE.read_text())
    except (FileNotFoundError, ValueError):
        return None


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def alive(state):
    """True when the holder process exists and accepts connections. Busy holders count."""
    if not pid_alive(state.get("pid", 0)):
        return False
    try:
        socket.create_connection(("127.0.0.1", state["port"]), 2).close()
    except OSError:
        return False
    return True


def request(method, params=None, timeout=15):
    """Yield every reply line until the holder marks one `done`."""
    state = load_state()
    if state is None or not alive(state):
        raise NotRunning
    with socket.create_connection(("127.0.0.1", state["port"]), 5) as sock:
        # A page that never commits keeps the holder silent for a whole budget, so the read timeout covers it.
        sock.settimeout(timeout)
        message = {"token": state["token"], "method": method, "params": params or {}}
        sock.sendall((json.dumps(message, ensure_ascii=False) + "\n").encode())
        with sock.makefile("rb") as stream:
            for line in stream:
                reply = json.loads(line)
                yield reply
                if reply.get("done"):
                    return


def echo_log(offset):
    """Print holder log lines written after `offset`; return the new offset."""
    try:
        with open(LOG, "rb") as file:
            file.seek(offset)
            text = file.read()
    except FileNotFoundError:
        return offset
    if text:
        print(text.decode("utf-8", "replace").rstrip(), file=sys.stderr, flush=True)
    return offset + len(text)


def start(_args):
    state = load_state()
    if state and alive(state):
        print(f"Holder already running (pid {state['pid']}). Reusing its Chrome socket.")
        return 0
    # A stale state file stays: the new holder reads it to close a tab the old one left open.
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    offset = LOG.stat().st_size if LOG.exists() else 0
    with open(LOG, "ab") as log:
        holder = subprocess.Popen(
            [sys.executable, str(HERE / "holder.py")],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    deadline = time.monotonic() + START_SECONDS
    while time.monotonic() < deadline:
        offset = echo_log(offset)
        if holder.poll() is not None:
            echo_log(offset)
            print(f"Holder exited with {holder.returncode}.", file=sys.stderr)
            return 1
        state = load_state()
        if state and state.get("pid") == holder.pid:
            print(f"Holder pid {holder.pid}. Stop it with: python3 {display(__file__)} stop")
            return 0
        time.sleep(0.5)
    holder.terminate()
    echo_log(offset)
    print("Holder did not get ready in time.", file=sys.stderr)
    return 1


def display(path):
    try:
        return str(Path(path).resolve().relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def invalid(message):
    print(message, file=sys.stderr)
    raise SystemExit(2)


def resolve(owner, field):
    """Output paths resolve from where `live run` runs."""
    if isinstance(owner.get(field), str):
        owner[field] = str(Path(owner[field]).resolve())


def inline(step, folder, where):
    """Replace `expression_file`, resolved from the check file's folder, with its text."""
    if ("expression" in step) == ("expression_file" in step):
        invalid(f"{where}: evaluate needs exactly one of expression and expression_file")
    name = step.pop("expression_file", None)
    if name is None:
        return
    if not isinstance(name, str) or not name:
        invalid(f"{where}: expression_file must be a file name")
    try:
        step["expression"] = (folder / name).read_text()
    except (OSError, UnicodeDecodeError) as error:
        invalid(f"{where}: {error}")


def load_checks(files, only):
    loaded = []
    for name in files:
        try:
            data = json.loads(Path(name).read_text())
        except (OSError, ValueError) as error:
            invalid(f"{name}: {error}")
        if not isinstance(data, list):
            invalid(f"{name}: expected a JSON list of checks")
        loaded += [(check, Path(name).resolve().parent) for check in data]
    if only:
        known = {check.get("name") for check, _ in loaded if isinstance(check, dict)}
        unknown = sorted(set(only) - known)
        if unknown:
            raise SystemExit(f"No check named {', '.join(unknown)}. Checks: {', '.join(sorted(map(str, known)))}")
        loaded = [(check, folder) for check, folder in loaded if isinstance(check, dict) and check.get("name") in only]
    for check, folder in loaded:
        if not isinstance(check, dict):
            continue
        resolve(check, "fail_screenshot")
        steps = check.get("steps")
        for index, step in enumerate(steps if isinstance(steps, list) else []):
            if not isinstance(step, dict):
                continue
            resolve(step, "path")
            resolve(step, "save")
            if step.get("action") == "evaluate":
                inline(step, folder, f"check {check.get('name')!r} step {index}")
    return [check for check, _ in loaded]


def show_progress(event):
    head = f"{event.get('check')} {event.get('step')}/{event.get('of')} {event.get('action')}"
    state = event.get("state")
    if state == "start":
        text = head
    elif state == "wait":
        video = event.get("video")
        text = f"{head}: waiting {event.get('waited')} s" + (f", video at {video} s" if video is not None else "")
    else:
        text = f"{head}: {'ok' if event.get('ok') else 'failed'} in {event.get('seconds')} s"
    print(text, file=sys.stderr, flush=True)


def run(args):
    checks = load_checks(args.files, args.only)
    budgets = [c.get("budget") for c in checks if isinstance(c, dict) and isinstance(c.get("budget"), (int, float))]
    timeout = max(budgets, default=60) + 120
    reports = []
    done = None
    try:
        for reply in request("Session.run", {"checks": checks}, timeout=timeout):
            if reply.get("done"):
                done = reply
                break
            if "progress" in reply:
                show_progress(reply["progress"])
                continue
            reports.append(reply)
            print(json.dumps(reply, ensure_ascii=False), flush=True)
    except NotRunning:
        print(f"Holder is not running. Start it with: python3 {display(__file__)} start", file=sys.stderr)
        return 1
    except (OSError, ValueError) as error:
        print(f"Lost the holder mid-run ({error}).", file=sys.stderr)
    if done is None:
        print(f"Holder stopped before finishing. Log: {LOG}", file=sys.stderr)
        return 1
    if done.get("error"):
        print(f"Holder rejected the checks: {done['error']}", file=sys.stderr)
        return 2
    failed = [report.get("name") for report in reports if not report.get("ok")]
    print(f"{len(reports) - len(failed)}/{len(checks)} checks passed" + (f"; failed: {', '.join(failed)}" if failed else ""))
    return 0 if done.get("ok") and not failed and len(reports) == len(checks) else 1


def extension_id(folder):
    """Chrome names an unpacked extension after the folder it was loaded from."""
    digest = hashlib.sha256(str(folder).encode()).hexdigest()[:32]
    return "".join(chr(ord("a") + int(char, 16)) for char in digest)


def reload(args):
    folder = Path(args.path).resolve() if args.path else HERE.parents[3] / "dist"
    try:
        reply = next(request("Session.reload", {"extension": extension_id(folder)}, timeout=60))
    except NotRunning:
        print(f"Holder is not running. Start it with: python3 {display(__file__)} start", file=sys.stderr)
        return 1
    if not reply.get("ok"):
        print(f"Could not reload Subline from {folder}: {reply.get('error')}", file=sys.stderr)
        return 1
    print(f"Reloaded {reply.get('name')} from {folder}. Refresh open YouTube, HBO and X tabs to use it there.")
    return 0


def status(_args):
    state = load_state()
    if state is None:
        print("Not running.")
        return 1
    if not alive(state):
        print(f"Not running. Stale state file {STATE} (pid {state.get('pid')}).")
        return 1
    try:
        reply = next(request("Session.status"))
    except socket.timeout:
        print(f"Running (pid {state['pid']}), busy with checks.")
        return 0
    print(json.dumps(reply, ensure_ascii=False))
    return 0 if reply.get("ok") else 1


def stop(_args):
    state = load_state()
    if state is None:
        print("Not running.")
        return 0
    pid = state.get("pid", 0)
    if alive(state):
        # SIGTERM ends a running check, closes its tab and the Chrome socket, and removes the state file.
        os.kill(pid, signal.SIGTERM)
        for _ in range(40):
            if not pid_alive(pid):
                break
            time.sleep(0.25)
    if pid_alive(pid) and alive(state):
        print(f"Holder pid {pid} is still running.")
        return 1
    if load_state() == state:
        STATE.unlink()
    print("Stopped.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("start", help="connect to Chrome once and keep the socket").set_defaults(func=start)
    runner = commands.add_parser("run", help="run checks from JSON files")
    runner.add_argument("files", nargs="+")
    runner.add_argument("--only", action="append", metavar="NAME", help="run only this check; repeatable")
    runner.set_defaults(func=run)
    reloader = commands.add_parser("reload", help="reload Subline in Chrome after npm run build")
    reloader.add_argument("--path", help="folder Chrome loaded Subline from (default: this repository's dist)")
    reloader.set_defaults(func=reload)
    commands.add_parser("status").set_defaults(func=status)
    commands.add_parser("stop", help="close the Chrome socket and exit the holder").set_defaults(func=stop)
    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
