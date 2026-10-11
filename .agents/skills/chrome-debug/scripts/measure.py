#!/usr/bin/env python3
"""Run a playback plan through live.py, retaining evidence and resumable results."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

import live
from verify import PHASES, SCHEMA_VERSION, assess, number, trace_issues

HERE = Path(__file__).resolve().parent


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def now():
    return datetime.now(timezone.utc).isoformat()


def load_plan(path):
    plan = json.loads(path.read_text())
    if not isinstance(plan, dict) or set(plan) - {'cases', 'durations', 'thresholds'}:
        raise ValueError('plan takes cases, durations and optional thresholds')
    durations = plan.get('durations', dict(zip(PHASES, (45, 45, 180))))
    if set(durations) != set(PHASES) or any(not number(n) or not 1 <= n <= 600 for n in durations.values()):
        raise ValueError('durations must set opening, landing and playing to 1-600 video seconds')
    cases = plan.get('cases')
    if not isinstance(cases, list) or not cases:
        raise ValueError('cases must be a nonempty list')
    names = set()
    for case in cases:
        if not isinstance(case, dict) or set(case) - {'name', 'url', 'rate', 'start', 'seek', 'media'}:
            raise ValueError('each case takes name, url, rate, seek and optional start, media')
        name = case.get('name', '')
        if not isinstance(name, str) or not re.fullmatch(r'[a-zA-Z0-9_-]+', name) or name in names:
            raise ValueError('case names must be unique file-safe names')
        names.add(name)
        if not isinstance(case.get('url'), str) or not case['url'].startswith(('http://', 'https://')):
            raise ValueError(f'{name}: url must be http or https')
        if not number(case.get('rate')) or not 0.25 <= case['rate'] <= 4:
            raise ValueError(f'{name}: rate must be 0.25-4')
        if max(durations.values()) / case['rate'] + 120 > 900:
            raise ValueError(f'{name}: trace needs more than live.py\'s 900 second budget')
        seeks = case.get('seek')
        if not isinstance(seeks, list) or not seeks or any(not number(n) or n < 0 for n in seeks):
            raise ValueError(f'{name}: seek must list candidate video positions')
        if 'start' in case and (not number(case['start']) or case['start'] < 0):
            raise ValueError(f'{name}: start must be a video position')
        media = case.get('media', {})
        if not isinstance(media, dict) or set(media) - {'skip_ads', 'keep_playing'} or any(type(v) is not bool for v in media.values()):
            raise ValueError(f'{name}: media takes boolean skip_ads and keep_playing')
    thresholds = plan.get('thresholds', {})
    allowed = {'waitAfterOpening', 'waitAfterSeeking', 'loadingAfterSeeking', 'loadingWhilePlaying', 'providerP50', 'providerP90'}
    if not isinstance(thresholds, dict) or set(thresholds) - allowed or any(not number(n) or n < 0 for n in thresholds.values()):
        raise ValueError('thresholds must map metric names to nonnegative maxima')
    return {**plan, 'durations': durations, 'thresholds': thresholds}


def tool_fingerprint():
    digest = hashlib.sha256()
    for path in sorted(HERE.glob('*.py')):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


def choose_seek(candidates, opening, duration, needed):
    stats = opening['stats']
    intervals = [(stats['from'], stats['to'])]
    requested = [event for _, event in opening.get('events', []) if event.get('e') == 'batch']
    intervals += [(batch['start'], batch['end']) for batch in requested + opening.get('batches', [])
                  if number(batch.get('start')) and number(batch.get('end'))]
    # Require the whole measured stretch to miss every range requested at opening.
    for target in candidates:
        if target + needed > duration:
            continue
        if all(target + needed < start - 10 or target > end + 10 for start, end in intervals):
            return target
    raise ValueError('no candidate seek avoids the opening and its requested captions; adjust the plan')


class CommandError(RuntimeError):
    pass


class Commands:
    def __init__(self, folder, session):
        self.folder, self.session = folder, session
        self.folder.mkdir(parents=True, exist_ok=True)
        self.index = len(list(folder.glob('*.stdout')))

    def call(self, *args, timeout=120, check=True):
        self.index += 1
        prefix = self.folder / f'{self.index:03d}-{args[0]}'
        started = time.monotonic()
        write_json(prefix.with_suffix('.json'), {'args': list(args), 'started': now()})
        with prefix.with_suffix('.stdout').open('w') as stdout, prefix.with_suffix('.stderr').open('w') as stderr:
            process = subprocess.Popen([sys.executable, str(HERE / 'live.py'), *map(str, args),
                                        '--session', self.session], stdout=stdout, stderr=stderr)
            try:
                process.wait(timeout=timeout)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
        output = prefix.with_suffix('.stdout').read_text()
        write_json(prefix.with_suffix('.json'), {'args': list(args), 'finished': now(),
                                               'seconds': time.monotonic() - started, 'exit': process.returncode})
        messages = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
        if process.returncode and (check or not messages or 'result' not in messages[-1]):
            detail = prefix.with_suffix('.stderr').read_text()[-1500:]
            raise CommandError(f'{args[0]} failed; see {prefix}: {detail or output[-1500:]}')
        return messages[-1] if messages else output

    def step(self, tab, step, timeout=60, check=True):
        return self.call('do', tab, json.dumps(step), '--timeout', timeout, timeout=timeout + 40, check=check)['result']


@contextmanager
def output_lock(folder):
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / '.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('another runner is writing this output directory')
        yield


def prepare(output, plan, builds, loaded, resume):
    definitions = [{'name': name, 'path': str(path), 'fingerprint': live.fingerprint(path)} for name, path in builds]
    identity = {'schemaVersion': SCHEMA_VERSION, 'toolFingerprint': tool_fingerprint(),
                'plan': plan, 'builds': definitions, 'loaded': str(loaded)}
    manifest = output / 'manifest.json'
    if manifest.exists():
        if not resume:
            raise ValueError('output already exists; use --resume or a new directory')
        previous = json.loads(manifest.read_text())
        if previous['identity'] != identity:
            raise ValueError('plan, builds, loaded path or tools changed; use a new output directory')
        if live.fingerprint(output / 'original-build') != previous['originalFingerprint'] or any(
                live.fingerprint(output / 'builds' / build['name']) != build['fingerprint'] for build in definitions):
            raise ValueError('a saved build changed; cannot resume or restore it')
        return previous
    if resume:
        raise ValueError('cannot resume without manifest.json')
    if any(output.iterdir()) and set(p.name for p in output.iterdir()) != {'.lock'}:
        raise ValueError('new output directory must be empty')
    name = live.extension_name(loaded)
    if not name or any(live.extension_name(path) != name for _, path in builds):
        raise ValueError('loaded folder and all builds must have the same extension manifest name')
    backup = output / 'original-build'
    shutil.copytree(loaded, backup)
    for build, path in builds:
        shutil.copytree(path, output / 'builds' / build)
    previous = {'identity': identity, 'created': now(), 'originalFingerprint': live.fingerprint(backup)}
    write_json(manifest, previous)
    write_json(output / 'summary.json', {'runs': []})
    return previous


def restore(commands, output, loaded, manifest):
    result = {'at': now(), 'fingerprint': manifest['originalFingerprint'], 'reloadVerified': False}
    try:
        state = live.load_state()
        if state:
            live.require_owner(state)
        managed = {build['fingerprint'] for build in manifest['identity']['builds']}
        managed.add(manifest['originalFingerprint'])
        if live.fingerprint(loaded) not in managed:
            raise ValueError('loaded files changed outside this runner; original-build was preserved for recovery')
        live.sync(output / 'original-build', loaded)
        commands.call('reload', '--path', str(loaded))
        result['reloadVerified'] = True
    except (CommandError, OSError, subprocess.TimeoutExpired, ValueError, live.SessionConflict) as error:
        result['error'] = str(error)
    result['filesRestored'] = live.fingerprint(loaded) == manifest['originalFingerprint']
    return result


def recover_runs(output):
    runs = []
    for path in sorted((output / 'runs').glob('*/*/*/run.json')):
        run = json.loads(path.read_text())
        runs.append({'case': run['case']['name'], 'build': run['build']['name'], 'attempt': int(path.parent.name),
                     'path': str(path.relative_to(output)), 'assessment': assess(run, run.get('thresholds'))})
    return runs


def collect(case, build, plan, folder, commands, loaded, source, focus):
    run = {'case': case, 'build': build, 'durations': plan['durations'], 'thresholds': plan['thresholds'],
           'started': now(), 'traces': {}, 'reloadVerified': False}
    path = folder / 'run.json'
    tab = None
    try:
        print(f"{case['name']} / {build['name']}: reload and open", flush=True)
        response = commands.call('reload', '--path', str(loaded), '--from', str(source))
        if f"build {build['fingerprint']}" not in response:
            raise CommandError('reload did not confirm the expected build fingerprint')
        run['reloadVerified'] = True
        tab = commands.call('open', case['url'], '--trace', '--timeout', 90)['tab']
        if focus:
            commands.step(tab, {'action': 'focus'})
        media = {'action': 'media', 'rate': case['rate'], 'play': True, **case.get('media', {})}
        if 'start' in case:
            media['time'] = case['start']
        run['openingMedia'] = commands.step(tab, media, timeout=120)
        write_json(path, run)
        for phase in PHASES:
            if phase == 'landing':
                duration = commands.step(tab, {'action': 'evaluate', 'expression':
                    "(() => { const v = document.querySelector('video'); return v && Number.isFinite(v.duration) && v.duration; })()"})['value']
                opening = json.loads((folder / 'opening.json').read_text())
                target = choose_seek(case['seek'], opening, duration,
                                     plan['durations']['landing'] + plan['durations']['playing'])
                run['seekTarget'] = target
                run['seek'] = commands.step(tab, {'action': 'media', 'time': target, 'play': True}, timeout=120)
                if run['seek']['seeks'] != 1:
                    raise ValueError('landing used more than one seek')
            if focus:
                commands.step(tab, {'action': 'focus'})
            print(f"{case['name']} / {build['name']}: {phase}", flush=True)
            step = {'action': 'trace', 'seconds': plan['durations'][phase], 'save': str(folder / f'{phase}.json')}
            if phase != 'playing':
                step['since'] = 'open' if phase == 'opening' else 'seek'
            run['traces'][phase] = commands.step(tab, step, timeout=plan['durations'][phase] / case['rate'] + 120, check=False)
            write_json(path, run)
            issues = trace_issues(run['traces'][phase], step['seconds'], case['rate'], step.get('since'),
                                  run.get('seekTarget') if phase == 'landing' else
                                  case.get('start') if phase == 'opening' else None)
            if issues:
                raise ValueError(f"{phase}: {'; '.join(issues)}")
    except (CommandError, ValueError, OSError, subprocess.TimeoutExpired, KeyboardInterrupt) as error:
        run['error'] = str(error) or type(error).__name__
        if isinstance(error, KeyboardInterrupt):
            raise
    finally:
        if tab:
            try:
                commands.call('close', tab, timeout=40)
            except (CommandError, OSError, subprocess.TimeoutExpired) as error:
                run['cleanupError'] = str(error)
        run['finished'] = now()
        run['assessment'] = assess(run, plan['thresholds'])
        write_json(path, run)
    return run


def execute(args):
    plan = load_plan(args.plan)
    builds = []
    for value in args.build:
        name, separator, path = value.partition('=')
        if not separator or not re.fullmatch(r'[a-zA-Z0-9_-]+', name) or name in [b[0] for b in builds]:
            raise ValueError('--build must be a unique NAME=PATH')
        builds.append((name, Path(path).resolve()))
    loaded, output = args.loaded.resolve(), args.output.resolve()
    if any(output == path or output in path.parents or path in output.parents
           for path in [loaded] + [path for _, path in builds]):
        raise ValueError('output must be separate from the loaded folder and build sources')
    state = live.load_state()
    if not state:
        raise ValueError('start a holder with live.py first')
    os.environ['CHROME_DEBUG_SESSION'] = args.session
    live.require_owner(state)
    if not live.alive(state):
        raise ValueError('holder is disconnected; reconnect with live.py using this task\'s session, then resume')
    status = next(live.request('Session.status'))
    if status.get('active'):
        raise ValueError('holder is still executing a command; wait for it to finish before resuming')
    with output_lock(output):
        manifest = prepare(output, plan, builds, loaded, args.resume)
        summary_path = output / 'summary.json'
        summary = json.loads(summary_path.read_text())
        summary['runs'] = recover_runs(output)
        cleanup = Commands(output / 'cleanup', args.session)
        if args.focus:
            print('Focus enabled: each trace brings Chrome to the front.', flush=True)
        try:
            for index, case in enumerate(plan['cases']):
                ordered = manifest['identity']['builds'][::1 if index % 2 == 0 else -1]
                for build in ordered:
                    previous = [r for r in summary['runs'] if r['case'] == case['name'] and r['build'] == build['name']]
                    if any(r['assessment']['dataValid'] for r in previous):
                        print(f"{case['name']} / {build['name']}: kept completed run", flush=True)
                        continue
                    attempts = output / 'runs' / case['name'] / build['name']
                    last = max((int(path.name) for path in attempts.glob('*') if path.name.isdigit()), default=0)
                    for attempt in range(last + 1, last + args.attempts + 1):
                        folder = output / 'runs' / case['name'] / build['name'] / str(attempt)
                        commands = Commands(folder / 'commands', args.session)
                        try:
                            run = collect(case, build, plan, folder, commands, loaded,
                                          output / 'builds' / build['name'], args.focus)
                        finally:
                            if (folder / 'run.json').exists():
                                run = json.loads((folder / 'run.json').read_text())
                                summary['runs'].append({'case': case['name'], 'build': build['name'], 'attempt': attempt,
                                                       'path': str(folder.relative_to(output) / 'run.json'),
                                                       'assessment': run['assessment']})
                                write_json(summary_path, summary)
                        print(json.dumps({'case': case['name'], 'build': build['name'], 'error': run.get('error'),
                                          **run['assessment']}, ensure_ascii=False), flush=True)
                        if run['assessment']['dataValid']:
                            break
                        state = live.load_state()
                        if not state or not live.alive(state):
                            raise CommandError('holder disconnected; reconnect and resume this output directory')
                    else:
                        raise CommandError('run remained invalid; inspect its evidence before resuming')
        finally:
            summary['restoration'] = restore(cleanup, output, loaded, manifest)
            write_json(summary_path, summary)
        return 0 if summary['restoration']['reloadVerified'] and summary['restoration']['filesRestored'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('--build', action='append', required=True, metavar='NAME=PATH')
    parser.add_argument('--loaded', type=Path, required=True, help='folder Chrome already loaded')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--session', required=True, help='this task\'s live.py session')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--focus', action='store_true', help='bring Chrome forward before each trace')
    parser.add_argument('--attempts', type=int, choices=(1, 2, 3), default=1, help='attempts per unfinished case in this invocation')
    args = parser.parse_args()
    def interrupt(_number, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    try:
        return execute(args)
    except (ValueError, OSError, CommandError, live.SessionConflict) as error:
        print(str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('Interrupted; saved completed runs. Use --resume after reconnecting if needed.', file=sys.stderr)
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
