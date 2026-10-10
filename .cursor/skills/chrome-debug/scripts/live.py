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
    os.environ.get("CHROME_DEBUG_STATE")
    or Path.home() / "Library/Caches/subline-chrome-debug/holder.json"
)
LOG = STATE.with_suffix(".log")
START_SECONDS = 75

ACTIONS_HELP = """Actions
  Each step is a JSON object with an action and that action's fields.

  media            Optional time, rate, play, pause, keep_playing, skip_ads, selector
                   (default video). Seeks to time, sets playbackRate to rate (0.25-4),
                   and plays or pauses, then waits until the video reports all of
                   them; a seek also waits for data at the new time, and play waits
                   for currentTime to advance or the video to end. It seeks once and
                   seeks again only when the video leaves the stretch it could have
                   played since then, at most 3 times. With no fields it
                   only reports the video. The rate goes through YouTube's player
                   when the page has one, since YouTube resets the video element to
                   its own rate every second; it is applied again during later steps
                   and undone when the tab closes. keep_playing resumes the video
                   whenever it pauses during later steps; pause turns it off.
                   skip_ads clicks YouTube's Skip button during later steps.
                   Returns time, paused, ended, ad, rate, ready and visible, plus
                   seeks, the number of times it moved currentTime, when time is set.
  wait             seconds, or time with optional selector. Waits that many wall
                   seconds, or until the video reaches time or ends.
  evaluate         expression or expression_file; optional save.
                   Evaluate page JavaScript, await Promises, return JSON.
                   Truthy values pass; falsy values retry every second.
                   An object with a fail key ends the step as failed.
                   Each attempt waits up to 8 seconds for the expression.
  click            selector. Click the first matching document element.
  overlay          Optional wait. Reports Subline's overlay: original and translation
                   lines with hidden, text and error. With wait, waits until both
                   lines show text and the translation is neither the loading
                   placeholder nor an error.
  requests         Optional match, a list of substrings. Lists this tab's request
                   URLs, or waits until one matches.
  trace            seconds; optional selector, default video; optional save.
                   Needs a tab that watches Subline (run adds this when a check has
                   a trace step; open needs --trace). Collects Subline timing events
                   for seconds of played video, or to the end. Reports lag, loading,
                   coverage, states, firstCaptionAt, firstReadyAt and batches; lag
                   and loading use video time. counted is the video time the states
                   cover; a gap counts when its wall time is under 3 s, whatever the
                   rate. The end line prints from, played, counted, wall,
                   playbackRate, visible, coverage, missed and lag max. clock is
                   "throttled" when the tab was mostly hidden or played/wall diverges
                   from playbackRate; "sparse" marks counted under 80% of played.
                   save writes the stats with every sentence, batch and view.
  screenshot       path. JPEG for .jpg/.jpeg, otherwise PNG.
  focus            Brings the tab and Chrome to the front and waits up to 5 s for the
                   page to become visible. This takes focus from other apps.

  media, wait and trace fail when a video that should be moving stays at the same
  time for 20 s; the reason says whether it was paused. Buffering waits.
  save, path and fail_screenshot must be absolute paths.
"""

RUN_HELP = """Input
  Each FILE contains a JSON list of checks:
    [{"name": "page", "url": "https://example.com", "budget": 30,
      "steps": [{"action": "evaluate", "expression": "document.title"}]}]

  name             Check id, selected by --only NAME.
  url              HTTP or HTTPS page to open in a new check tab.
  budget           Total wall seconds per check, 1-600, including navigation.
  steps            Non-empty action list, executed in order. A failed step ends
                   the check.
  on_fail          Optional page expression, evaluated once before tab cleanup.
  fail_screenshot  Optional screenshot path, captured before failed-tab cleanup.

""" + ACTIONS_HELP + """
Reports
  stdout emits one JSON report per check, then a summary; stderr carries progress.
  Remaining checks still run after a failed one. Check tabs always close.
  expression_file resolves from FILE's folder. evaluate with save writes the full
  value; without it, reports cap at 20,000 chars. Request URLs omit query strings.
  Exit 0: all steps passed; 1: failed check/holder; 2: invalid input.
"""

DO_HELP = """STEP is one JSON object, for example
  '{"action": "media", "time": 150, "rate": 1.5, "play": true}'

""" + ACTIONS_HELP + """
Reports
  stdout prints {"ok", "tab", "result"}; stderr carries progress for long steps.
  expression_file resolves from the current folder. If the tab crashed or closed,
  the report says so under closed and the tab is gone.
  Exit 0: the step passed; 1: it failed or the holder did; 2: invalid input.
"""


class NotRunning(Exception):
    pass


class SessionConflict(Exception):
    pass


def session_id():
    return os.environ.get("CHROME_DEBUG_SESSION")


def require_owner(state):
    owner = state.get("owner")
    if not owner:
        raise SessionConflict("This holder has no session owner. Have the task that started it stop it "
                              "with its original live.py before starting a new session.")
    if not session_id():
        raise SessionConflict("A session id is required. Pass --session ID from this task's start output.")
    if session_id() != owner:
        raise SessionConflict("Holder belongs to another session. Wait for that task to stop it; "
                              "do not adopt its session id.")


@contextmanager
def lifecycle_lock():
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(STATE.with_suffix(".lock"), "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SessionConflict("Another session is starting or stopping Chrome debugging. Retry later.")
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
        print(f"Holder already running (pid {state['pid']}). Reusing its Chrome socket.")
        return 0
    owner = session_id() or secrets.token_hex(16)
    print(f"Session: {owner}. Pass --session {owner} on this task's commands.", flush=True)
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    offset = LOG.stat().st_size if LOG.exists() else 0
    with open(LOG, "ab") as log:
        holder = subprocess.Popen(
            [sys.executable, str(HERE / "holder.py")],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env={**os.environ, "CHROME_DEBUG_SESSION": owner},
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
                invalid("Each check must have a non-empty string name before selecting with --only")
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


def tab_request(method, params, timeout):
    reply = {}
    try:
        for message in request(method, params, timeout=timeout):
            if "progress" in message:
                show_progress(message["progress"])
                continue
            reply = message
    except NotRunning:
        print(f"Holder is not running. Start it with: python3 {display(__file__)} start", file=sys.stderr)
        return 1
    except (OSError, ValueError) as error:
        print(f"Lost the holder mid-request ({error}).", file=sys.stderr)
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
        invalid(f"{folder} does not hold {name}; --from only replaces a folder Chrome loaded it from")
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
    folder = Path(args.path).resolve() if args.path else HERE.parents[3] / "dist"
    if args.source:
        sync(Path(args.source).resolve(), folder)
    try:
        reply = next(request("Session.reload", {"extension": extension_id(folder)}, timeout=60))
    except NotRunning:
        print(f"Holder is not running. Start it with: python3 {display(__file__)} start", file=sys.stderr)
        return 1
    if not reply.get("ok"):
        print(f"Could not reload Subline from {folder}: {reply.get('error')}", file=sys.stderr)
        return 1
    print(f"Reloaded {reply.get('name')} from {folder}, build {fingerprint(folder)}. "
          "Refresh open YouTube, HBO and X tabs to use it there.")
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
    parser = argparse.ArgumentParser(
        description="Chrome commands through one DevTools socket to the signed-in Default profile.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("start", help="connect to Chrome once and keep the socket").set_defaults(func=start)
    runner = commands.add_parser(
        "run", help="run checks from JSON files", epilog=RUN_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    runner.add_argument("files", nargs="+", metavar="FILE", help="JSON check files")
    runner.add_argument("--only", action="append", metavar="NAME", help="run only this check; repeatable")
    runner.set_defaults(func=run)
    opener = commands.add_parser(
        "open", help="open a muted tab and keep it for do steps",
        description="Open URL in a new muted tab owned by this session. The tab stays open for do "
        "steps until close, stop, or 15 minutes without a request.",
    )
    opener.add_argument("url", metavar="URL")
    opener.add_argument("--trace", action="store_true",
                        help="watch Subline's worker from navigation so trace steps work")
    opener.add_argument("--timeout", type=float, default=60, help="seconds to load the page (default 60)")
    opener.set_defaults(func=open_tab)
    doer = commands.add_parser(
        "do", help="run one step in an open tab", epilog=DO_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    doer.add_argument("tab", metavar="TAB", help="tab id from open")
    doer.add_argument("step", metavar="STEP", help="one JSON step")
    doer.add_argument("--timeout", type=float, default=60, help="wall seconds for the step (default 60)")
    doer.set_defaults(func=do_step)
    closer = commands.add_parser("close", help="close an open tab and undo its rate change")
    closer.add_argument("tab", metavar="TAB")
    closer.set_defaults(func=close_tab)
    reloader = commands.add_parser(
        "reload", help="reload Subline in Chrome",
        description="Reload Subline from Chrome's loaded folder and print the build fingerprint; "
        "does not build it. Existing site tabs need a refresh.",
    )
    reloader.add_argument("--path", help="folder Chrome loaded Subline from (default: this repository's dist)")
    reloader.add_argument("--from", dest="source", metavar="DIR",
                          help="copy this build into the loaded folder first, replacing its files")
    reloader.set_defaults(func=reload)
    commands.add_parser("status", help="report holder status").set_defaults(func=status)
    commands.add_parser("stop", help="close the Chrome socket and exit the holder").set_defaults(func=stop)
    for command in commands.choices.values():
        command.add_argument("--session", metavar="ID",
                             help="this task's session id from start (or CHROME_DEBUG_SESSION)")
    args = parser.parse_args()
    if args.session is not None:
        os.environ["CHROME_DEBUG_SESSION"] = args.session
    try:
        with lifecycle_lock() if args.command in ("start", "stop") else nullcontext():
            result = args.func(args)
    except SessionConflict as error:
        print(str(error), file=sys.stderr)
        result = 1
    sys.exit(result)


if __name__ == "__main__":
    main()
