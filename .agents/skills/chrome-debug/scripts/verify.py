#!/usr/bin/env python3
"""Validate collected playback runs and calculate their metrics without Chrome."""
import argparse
import json
import math
from pathlib import Path

SCHEMA_VERSION = 1
PHASES = ('opening', 'landing', 'playing')


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def trace_issues(result, seconds, rate, since=None, target=None):
    stats = result.get('stats', {})
    issues = []
    if not result.get('ok') or not stats.get('complete'):
        issues.append('collection did not complete')
    if stats.get('playbackRate') != rate:
        issues.append('playback rate differs from the plan')
    for key in ('sparse', 'truncated', 'clockTruncated', 'clockMissing', 'rateMismatch'):
        if stats.get(key):
            issues.append(key)
    if stats.get('clock') or stats.get('rateChanges'):
        issues.append('clock was throttled or the rate changed')
    if since and stats.get('since') != since:
        issues.append('trace uses the wrong starting mark')
    played, before, counted = (stats.get(key, 0) for key in ('played', 'before', 'counted'))
    if not all(number(value) and value >= 0 for value in (played, before, counted)):
        issues.append('missing or invalid duration')
    else:
        if played + before + 0.1 < seconds:
            issues.append('video ended before the requested duration')
        if counted < 0.8 * (played + before):
            issues.append('states cover less than 80% of played time')
    if target is not None and (not number(stats.get('from')) or abs(stats['from'] - target) > 1.5):
        issues.append('trace does not start at the planned position')
    return issues


def wait_time(stats, rate):
    first, ready = stats.get('firstCaptionAt'), stats.get('firstReadyAt')
    if not number(first) or not number(ready):
        return None
    return round(max(0, ready - first) / rate, 3)


def loading_share(stats):
    states = stats.get('states', {})
    loading, ready = states.get('loading', 0), states.get('ready', 0)
    return loading / (loading + ready) if loading + ready > 0 else None


def metrics(traces, rate):
    opening, landing, playing = [traces.get(phase, {}).get('stats', {}) for phase in PHASES]
    batches = playing.get('batches', {})
    measured = batches.get('measured', 0)
    return {
        'waitAfterOpening': wait_time(opening, rate),
        'waitAfterSeeking': wait_time(landing, rate),
        'loadingAfterSeeking': loading_share(landing),
        'loadingWhilePlaying': loading_share(playing),
        'providerP50': batches.get('p50') if measured else None,
        'providerP90': batches.get('p90') if measured else None,
        'providerSamples': measured,
        'providerResults': batches.get('results', {}),
    }


def assess(run, thresholds=None):
    rate, durations = run['case']['rate'], run['durations']
    traces = run.get('traces', {})
    issues = {}
    for phase in PHASES:
        found = trace_issues(traces.get(phase, {}), durations[phase], rate,
                             {'opening': 'open', 'landing': 'seek'}.get(phase),
                             run.get('seekTarget') if phase == 'landing' else
                             run['case'].get('start') if phase == 'opening' else None)
        if found:
            issues[phase] = found
    if run.get('seek', {}).get('seeks') != 1:
        issues['seek'] = ['landing must use exactly one seek']
    if not run.get('reloadVerified'):
        issues['build'] = ['build reload was not verified']
    complete = all(traces.get(phase, {}).get('stats', {}).get('complete') for phase in PHASES)
    values = metrics(traces, rate)
    failures = {}
    for key, maximum in (thresholds or {}).items():
        value = values.get(key)
        if value is None or value > maximum:
            failures[key] = {'value': value, 'maximum': maximum}
    return {'schemaVersion': SCHEMA_VERSION, 'collectionComplete': complete,
            'dataValid': not issues, 'issues': issues, 'metrics': values,
            'performancePassed': (not failures if not issues else None) if thresholds else None,
            'performanceFailures': failures}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path, help='run.json from measure.py')
    args = parser.parse_args()
    run = json.loads(args.run.read_text())
    result = assess(run, run.get('thresholds'))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['dataValid'] and result['performancePassed'] is not False else 1


if __name__ == '__main__':
    raise SystemExit(main())
