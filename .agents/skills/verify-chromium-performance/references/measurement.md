# Measurements

Start a debug holder; the runner leaves its lifecycle to you. Copy the [plan](../checks/playback-plan.json) to a task-owned file. Keep requested cases, replace unavailable URLs/seeks. Cases have `name`, `url`, `rate`, candidate `seek`, optional `start`/`media`. YouTube needs speech `start`; landing must fit and avoid opening/all requested captions.

```bash
python3 .agents/skills/debug-chromium/scripts/measure.py PLAN.json --build current=/path/to/dist --loaded /path/to/loaded/dist --output /path/to/results --session SESSION
```

Repeat `--build NAME=PATH` to compare. The runner snapshots builds, alternates order per case/reloads each run. Announce headed `--focus`; omit headlessly.

`manifest.json` records plan/tool/build/original fingerprints; `runs/CASE/BUILD/ATTEMPT/` retains attempts/traces/commands. `summary.json` separates completeness/validity/thresholds/restoration; absent thresholds stay unjudged. Keep `original-build/`/`builds/` until restoration/resume ends.

Apply main validity rules; multiple seeks invalidate landing. Sparse means states cover under 80% of played time. Slow Providers/missing translations do not invalidate timing. `counted` sums continuous states with wall gaps under 3 s at any rate. Caption/ready wall times start at the mark. Clock samples precede rate enforcement and cover this step: `rates`, `rateChanges`, `rateMismatch`; `complete` confirms duration.

Results include landing loading. Six optional `thresholds` are maxima; loading uses 0–1, unavailable values `null`. Failed thresholds never retry. Invalid attempts stop for inspection. `--attempts` allows full reload attempts, default one. Reconnect via this task's `live.py start` session; repeat with `--resume`. Keep completed valid runs, restart partials. Changed plans/builds/tools need new output.

Completion/Ctrl-C/SIGTERM attempt original restoration. If only files restore, reconnect/resume to verify reload. External changes block restoration. After forced kill, retain evidence/resume after the active command ends.

Run `python3 .agents/skills/debug-chromium/scripts/verify.py /path/to/run.json` offline. Invalid data/failed thresholds exit nonzero. Raw `events`/`media` allow recounting; retain/share only needed subtitle excerpts.
