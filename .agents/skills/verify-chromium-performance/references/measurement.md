# Automated measurements

Start a debug-chromium holder first and keep its session ID. The runner uses that holder; it does not start or stop it.

Copy the [plan template](../checks/playback-plan.json) to a task-owned file. Replace unavailable URLs and seek positions, and retain only the requested cases. Each case sets `name`, `url`, `rate`, candidate `seek` positions, optional opening `start` and optional `media` settings. YouTube needs an explicit `start` in spoken content. Landing candidates must fit the video and avoid the opening trace and all captions requested during it.

```bash
python3 .agents/skills/debug-chromium/scripts/measure.py PLAN.json --build current=/absolute/path/to/dist --loaded /absolute/path/to/loaded/dist --output /absolute/path/to/results --session SESSION
```

Repeat `--build NAME=PATH` to compare builds. The runner copies source builds into the output directory, alternates build order between cases and reloads before each run. Add `--focus` only for headed Chrome after telling the user it takes focus.

## Evidence and validity

- `manifest.json` records the plan, build fingerprints, tool fingerprint and original loaded build.
- `runs/CASE/BUILD/ATTEMPT/` retains every attempt, raw traces and command output.
- `summary.json` separates `collectionComplete`, `dataValid`, `performancePassed` and restoration status. Without configured thresholds, performance is unjudged.
- Keep `original-build/` and `builds/` until restoration and any resume are finished.

The runner rejects wrong or changing rates, throttled clocks, sparse or truncated evidence, short traces, wrong landing positions and multiple seeks. Trace `rates`, `rateChanges` and `rateMismatch` describe each window's own clock. `sparse` means subtitle states cover under 80% of played time. Missing translations or slow Providers do not invalidate timing.

The results also include landing loading share. Optional `thresholds` set maxima for the six metrics; loading fractions use 0–1. Unavailable measurements are `null`. A failed performance threshold never triggers a retry.

## Resume and restore

An invalid attempt stops for inspection. `--attempts` permits additional full attempts, each starting with reload; the default is one. After a connection failure, reconnect through `live.py start` with this task's session and repeat the command with `--resume`.

Resume keeps completed valid runs and starts partial runs as new attempts. Changed plans, builds or tools require a new output directory.

Completion, Ctrl-C and SIGTERM attempt to restore the original loaded build. If only the files could be restored, reconnect and resume to verify reload. External changes to the loaded files block restoration. After a forced kill, retain the evidence and resume once the active command ends.

## Check saved data

```bash
python3 .agents/skills/debug-chromium/scripts/verify.py /absolute/path/to/run.json
```

This needs no browser and returns nonzero for invalid data or failed configured thresholds. Raw trace `events` and `media` permit recounting Provider durations, subtitle states and clock changes. Traces include subtitle excerpts; retain or share only needed evidence.
