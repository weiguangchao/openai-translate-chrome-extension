# Playback measurements

`measure.py` repeats a supplied plan through `live.py`. It collects the opening, landing and playing traces, calculates playback metrics and retains every attempt. Follow [verify-chromium-performance](../../verify-chromium-performance/SKILL.md) for the measurement protocol and required reporting. Start a holder first and use its session ID. The runner does not start or stop the holder.

```bash
python3 .agents/skills/debug-chromium/scripts/measure.py \
  .agents/skills/debug-chromium/checks/playback-plan.json \
  --build current=/absolute/path/to/dist \
  --loaded /absolute/path/Chrome/loaded/dist \
  --output /absolute/path/to/results \
  --session SESSION --focus
```

The supplied plan covers YouTube, HBO Max and X at four rates. Remove the HBO Max cases unless the user explicitly requests HBO. It uses 45, 45 and 180 video seconds for opening, landing and playing. Edit the plan before running if a video is unavailable. Each case supplies a name, URL, rate, candidate seek positions, optional opening `start`, and optional `media` settings for `keep_playing` and `skip_ads`. YouTube uses `start: 60`; URL time parameters do not work reliably. Candidate landing stretches must fit within the video and avoid both the opening trace and all caption ranges requested during it.

Repeat `--build NAME=PATH` to compare builds. The runner reverses build order for alternate cases. Each run reloads the extension to clear translations. Build sources are copied into the output directory before measurement, so switching the loaded directory cannot change a later build's source.

`--focus` takes focus from other apps before each trace. Tell the user before enabling it. Without that option, keep Chrome in front yourself. This runner does not prevent sleep or continually take focus back.

## Results and interruption

- `manifest.json` records the plan, source build fingerprints, tool fingerprint and original loaded build fingerprint.
- `runs/CASE/BUILD/ATTEMPT/` holds `run.json`, each raw trace and command stdout, stderr and timing records. Failed attempts are kept.
- `summary.json` lists attempts, metrics and restoration status. `collectionComplete`, `dataValid` and `performancePassed` are separate results. Without configured thresholds, performance is unjudged.
- `original-build/` and `builds/` hold the exact files required for restoration and resuming. Keep these with the output until finished.

The runner rejects wrong or changing rates, throttled clocks, sparse or truncated evidence, short traces, incorrect landing positions and multiple landing seeks. A missing translation or slow Provider does not invalidate a measurement. No translation or no successful Provider sample produces `null`, not zero. `thresholds` in the plan can set maxima for any of the six metrics; loading fractions use 0–1. A failed performance threshold never triggers a retry.

An invalid trace stops that attempt. `--attempts 2` allows one more full run, starting with a reload; the default is one attempt. If a run stays invalid, the runner stops for inspection. On a connection failure, reconnect through `live.py start` using this task's session. Then repeat the same command with `--resume`. Completed valid runs are kept. A partial run starts over with a new attempt number. Changed plans, builds or tools require a new output directory so incompatible measurements cannot mix.

Normal completion, Ctrl-C and SIGTERM attempt to restore the original loaded build. If Chrome disconnected, files can be restored while the reload remains unverified; `summary.json` distinguishes those outcomes. Reconnect and resume to verify restoration. An external change to the loaded files blocks restoration rather than overwriting it. A forced process kill cannot perform cleanup; preserve the output and resume after its active command has ended.

To check a saved run without Chrome:

```bash
python3 .agents/skills/debug-chromium/scripts/verify.py /absolute/path/to/run.json
```

The checker returns nonzero for invalid data or a failed configured performance threshold. Metrics use the formulas in [verify-chromium-performance](../../verify-chromium-performance/SKILL.md). The raw `events` in each trace permit independent recalculation of Provider durations and subtitle states; `media` contains the observed clock changes. Raw traces contain subtitle excerpts, so retain or share only the evidence needed for the task.
