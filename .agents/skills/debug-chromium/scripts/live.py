#!/usr/bin/env python3
import argparse
from contextlib import contextmanager, nullcontext
import fcntl
import hashlib
import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = Path(
    os.environ.get("DEBUG_CHROMIUM_STATE")
    or Path.home() / "Library/Caches/subline-debug-chromium/holder.json"
)
LOG = STATE.with_suffix(".log")
START_SECONDS = 75

ACTIONS_HELP = """JSON action fields
media: optional time, rate (0.25-4), play, pause, keep_playing, skip_ads, selector
(default video). Waits for readiness/motion; no fields only reports. Seeks at
most 3 times if playback leaves reach. YouTube uses its player rate. Later steps
enforce rate/keep_playing/skip_ads; pause disables keep_playing; close restores rate.
wait: seconds (wall duration) OR time (video position/end); optional selector.
evaluate: expression OR expression_file, optional save. Awaits JS/Promises;
falsy retries each second, fail-key objects fail; attempts have up to 8 s.
click: selector, trusted pointer click.
overlay: optional wait for visible source/translation without loading/error.
requests: optional match substrings; lists URLs or waits for a match.
trace: seconds (video/end), optional selector/save/since (open/seek).
Needs open --trace; run enables it. See verify-chromium-performance and its
measurement reference for marks, stats, raw/partial evidence and validity.
screenshot: path, JPEG for .jpg/.jpeg, otherwise PNG.
focus: activates Chrome, takes app focus, waits up to 5 s for visibility.
media/wait/trace fail after 20 s without playable motion; buffering waits.
save/path/fail_screenshot must be absolute.
"""

RUN_HELP = """FILE is a JSON list:
[{"name":"page","url":"https://example.com","budget":30,
  "steps":[{"action":"evaluate","expression":"document.title"}]}]
name selects --only; url is HTTP(S); budget is 1-600 wall seconds including
navigation. Steps stop on failure; later checks run and tabs always close.
on_fail evaluates a page expression; fail_screenshot captures before cleanup.
expression_file is relative to FILE. stdout emits JSON
and a summary; stderr emits progress. save keeps full values; otherwise 20,000
chars. Request URLs omit queries. Exit 0: passed; 1: check/holder failed; 2: bad input.
""" + ACTIONS_HELP

DO_HELP = """STEP is JSON; expression_file is relative to cwd. stdout emits {ok, tab, result}; stderr emits progress.
Crashed/closed tabs are removed, reported in closed. Exit 0/1/2: pass/fail/bad input.
""" + ACTIONS_HELP


class NotRunning(Exception):
    pass


class SessionConflict(Exception):
    pass


def session_id():
    return os.environ.get("DEBUG_CHROMIUM_SESSION")


def require_owner(state):
    owner = state.get("owner")
    if not owner:
        raise SessionConflict("Holder has no owner. Its task must stop it with its original live.py.")
    if not session_id():
        raise SessionConflict("A session id is required. Use --session ID from start.")
    if session_id() != owner:
        raise SessionConflict("Holder belongs to another session. Wait for its owner to stop it.")


@contextmanager
def lifecycle_lock():
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(STATE.with_suffix(".lock"), "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SessionConflict("Another session is starting/stopping. Retry later.")
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


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
    if not pid_alive(state.get("pid", 0)):
        return False
    try:
        socket.create_connection(("127.0.0.1", state["port"]), 2).close()
    except OSError:
        return False
    return True


def request(method, params=None, timeout=15):
    state = load_state()
    if state is None:
        raise NotRunning
    if method != "Session.status":
        require_owner(state)
    if not alive(state):
        raise NotRunning
    with socket.create_connection(("127.0.0.1", state["port"]), 5) as sock:
        sock.settimeout(timeout)
        message = {"token": state["token"], "owner": session_id(),
                   "method": method, "params": params or {}}
        sock.sendall((json.dumps(message, ensure_ascii=False) + "\n").encode())
        with sock.makefile("rb") as stream:
            for line in stream:
                reply = json.loads(line)
                yield reply
                if reply.get("done"):
                    return
        raise OSError('holder closed the request before completing it')


def echo_log(offset):
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
        require_owner(state)
        print(f"Holder already running (pid {state['pid']}). Reusing socket.")
        return 0
    owner = session_id() or secrets.token_hex(16)
    print(f"Session: {owner}. Use --session {owner}.", flush=True)
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    offset = LOG.stat().st_size if LOG.exists() else 0
    with open(LOG, "ab") as log:
        holder = subprocess.Popen(
            [sys.executable, str(HERE / "holder.py")],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env={**os.environ, "DEBUG_CHROMIUM_SESSION": owner},
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
            print(f"Holder pid {holder.pid}. Stop it with: "
                  f"python3 {display(__file__)} stop --session {owner}")
            return 0
        time.sleep(0.5)
    holder.terminate()
    try:
        holder.wait(timeout=5)
    except subprocess.TimeoutExpired:
        holder.kill()
        holder.wait()
    echo_log(offset)
    print("Holder did not get ready in time.", file=sys.stderr)
    return 1


def display(path):
    try:
        return str(Path(path).resolve().relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def not_running():
    print(f"Holder is not running. Start it with: python3 {display(__file__)} start", file=sys.stderr)
    return 1


def invalid(message):
    print(message, file=sys.stderr)
    raise SystemExit(2)


def resolve(owner, field):
    if isinstance(owner.get(field), str):
        owner[field] = str(Path(owner[field]).resolve())


def inline(step, folder, where):
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
        for check, _ in loaded:
            if not isinstance(check, dict) or not isinstance(check.get("name"), str) or not check["name"]:
                invalid("--only requires a nonempty string name on each check")
        known = {check["name"] for check, _ in loaded}
        unknown = sorted(set(only) - known)
        if unknown:
            invalid(f"No check named {', '.join(unknown)}. Checks: {', '.join(sorted(known))}")
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
        text = f"{head}: waiting {event.get('waited')} s"
        if video is not None:
            text += f", video at {video} s"
        if event.get("buffering"):
            text += ", buffering"
    else:
        text = f"{head}: {'ok' if event.get('ok') else 'failed'} in {event.get('seconds')} s"
        if event.get("detail"):
            text += f", {event['detail']}"
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
        return not_running()
    except (OSError, ValueError) as error:
        print(f"Lost the holder mid-run ({error}).", file=sys.stderr)
    if done is None:
        print(f"Holder stopped early. Log: {LOG}", file=sys.stderr)
        return 1
    if done.get("error"):
        print(f"Holder rejected the checks: {done['error']}", file=sys.stderr)
        return 2
    failed = [report.get("name") for report in reports if not report.get("ok")]
    print(f"{len(reports) - len(failed)}/{len(checks)} checks passed" + (f"; failed: {', '.join(failed)}" if failed else ""))
    return 0 if done.get("ok") and not failed and len(reports) == len(checks) else 1


def tab_request(method, params, timeout):
    reply = {}
    try:
        for message in request(method, params, timeout=timeout):
            if "progress" in message:
                show_progress(message["progress"])
                continue
            reply = message
    except NotRunning:
        return not_running()
    except (OSError, ValueError) as error:
        print(f"Holder request lost ({error}).", file=sys.stderr)
        return 1
    reply.pop("done", None)
    print(json.dumps(reply, ensure_ascii=False), flush=True)
    return 0 if reply.get("ok") else 1


def open_tab(args):
    return tab_request("Session.open", {"url": args.url, "trace": args.trace, "timeout": args.timeout},
                       args.timeout + 30)


def do_step(args):
    try:
        step = json.loads(args.step)
    except ValueError as error:
        invalid(f"STEP is not JSON: {error}")
    if not isinstance(step, dict):
        invalid("STEP must be a JSON object")
    resolve(step, "path")
    resolve(step, "save")
    if step.get("action") == "evaluate":
        inline(step, Path.cwd(), "STEP")
    return tab_request("Session.do", {"tab": args.tab, "step": step, "timeout": args.timeout},
                       args.timeout + 30)


def close_tab(args):
    return tab_request("Session.close", {"tab": args.tab}, 30)


def build_files(folder):
    return sorted(path for path in folder.rglob("*") if path.is_file())


def fingerprint(folder):
    digest = hashlib.sha256()
    for path in build_files(folder):
        digest.update(str(path.relative_to(folder)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


def extension_name(folder):
    try:
        return json.loads((folder / "manifest.json").read_text()).get("name")
    except (OSError, ValueError):
        return None


def sync(source, folder):
    name = extension_name(source)
    if not name:
        invalid(f"{source} has no readable manifest.json")
    if extension_name(folder) != name:
        invalid(f"{folder} is not loaded {name}; --from requires the loaded folder")
    wanted = {path.relative_to(source) for path in build_files(source)}
    for path in build_files(folder):
        if path.relative_to(folder) not in wanted:
            path.unlink()
    for relative in sorted(wanted):
        target = folder / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, target)
    for path in sorted(folder.rglob("*"), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    if fingerprint(folder) != fingerprint(source):
        print(f"{folder} does not match {source} after copying.", file=sys.stderr)
        raise SystemExit(1)


def extension_id(folder):
    digest = hashlib.sha256(str(folder).encode()).hexdigest()[:32]
    return "".join(chr(ord("a") + int(char, 16)) for char in digest)


def reload(args):
    state = load_state()
    if state:
        require_owner(state)
    else:
        print('Holder is not running. Start it before replacing the loaded build.', file=sys.stderr)
        return 1
    try:
        status = next(request('Session.status'))
    except (OSError, NotRunning):
        print('Holder is disconnected; the loaded files were not replaced.', file=sys.stderr)
        return 1
    if status.get('active'):
        print('Holder is busy; the loaded files were not replaced.', file=sys.stderr)
        return 1
    folder = Path(args.path).resolve() if args.path else HERE.parents[3] / "dist"
    if args.source:
        sync(Path(args.source).resolve(), folder)
    try:
        reply = next(request("Session.reload", {"extension": extension_id(folder)}, timeout=60))
    except NotRunning:
        return not_running()
    if not reply.get("ok"):
        print(f"Reload failed from {folder}: {reply.get('error')}", file=sys.stderr)
        return 1
    print(f"Reloaded {reply.get('name')} from {folder}, build {fingerprint(folder)}. "
          "Refresh YouTube/HBO/X tabs.")
    return 0


def status(_args):
    state = load_state()
    if state is None:
        print("Not running.")
        return 1
    if not alive(state):
        print(json.dumps({'ok': False, 'state': 'disconnected', 'pid': state.get('pid')}))
        return 1
    try:
        reply = next(request("Session.status"))
    except (OSError, NotRunning) as error:
        print(json.dumps({'ok': False, 'state': 'unresponsive', 'error': str(error)}))
        return 1
    print(json.dumps(reply, ensure_ascii=False))
    return 0 if reply.get("ok") else 1


def stop(_args):
    state = load_state()
    if state is None:
        print("Not running.")
        return 0
    require_owner(state)
    pid = state.get("pid", 0)
    if alive(state):
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
    parser = argparse.ArgumentParser(description="Use one Chromium DevTools connection.")
    commands = parser.add_subparsers(dest="command", required=True)
    definitions = (
        ("start", start, []), ("status", status, []), ("stop", stop, []),
        ("close", close_tab, [("tab", {})]),
        ("run", run, [("files", {"nargs": "+"}), ("--only", {"action": "append"})]),
        ("open", open_tab, [("url", {}), ("--trace", {"action": "store_true"}),
                            ("--timeout", {"type": float, "default": 60})]),
        ("do", do_step, [("tab", {}), ("step", {}),
                         ("--timeout", {"type": float, "default": 60})]),
        ("reload", reload, [("--path", {}), ("--from", {"dest": "source"})]),
    )
    for name, func, arguments in definitions:
        command = commands.add_parser(name, epilog={"run": RUN_HELP, "do": DO_HELP}.get(name),
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
        command.set_defaults(func=func)
        for flag, options in arguments:
            command.add_argument(flag, **options)
        command.add_argument("--session", help="task's start ID or DEBUG_CHROMIUM_SESSION")
    args = parser.parse_args()
    if args.session is not None:
        os.environ["DEBUG_CHROMIUM_SESSION"] = args.session
    try:
        with lifecycle_lock() if args.command in ("start", "stop") else nullcontext():
            result = args.func(args)
    except SessionConflict as error:
        print(str(error), file=sys.stderr)
        result = 1
    sys.exit(result)


if __name__ == "__main__":
    main()
