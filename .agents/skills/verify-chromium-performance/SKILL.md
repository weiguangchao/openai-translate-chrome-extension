---
name: verify-chromium-performance
description: Measure Subline subtitle performance or compare builds in Chromium when the user requests it. Defines playback runs, metrics and evidence requirements.
---

# Verify Chromium performance

## Prepare

Use [setup-headless-chromium](../setup-headless-chromium/SKILL.md) to launch, then [debug-chromium](../debug-chromium/SKILL.md) to operate the browser. Use an existing or headed browser when the user requests one. Code or documentation edits alone do not require real-site measurements.

Test YouTube and X at 1x, 1.25x, 1.5x and 2x for each build. Include HBO Max only when explicitly requested. Before tracing, read the selected platform's [page checks](references/page-readiness.md).

For authorized MiMo runs, read `MIMO_BASE_URL`, `MIMO_MODEL` and `MIMO_API_KEY` from the worktree's ignored `.env` before asking for configuration. Keep it at mode `0600`, configure through the real settings page and retain the file during cleanup. Never copy its key into a build or evidence.

## Collect each run

1. Reload Subline to clear translations. Open the video, set the rate and trace 45 video seconds with `since: "open"`. On YouTube, use the first `media` step's `time` to reach spoken content; URL `&t=` does not set it reliably.
2. Seek once to uncached captions outside the opening trace and its prefetched ranges. Trace 45 video seconds with `since: "seek"`.
3. Continue playing and trace 180 video seconds.

Keep headed Chrome in front; do not use `focus` in headless runs. Traces must report the tested rate, stay unthrottled and cover their requested duration. Reject sparse or truncated evidence and unexpected rate changes. A landing trace fails if playback leaves the seek target. `ok` alone does not establish valid timing.

For automated plans, build comparisons, saved-run checks or interrupted runs, read [measurement.md](references/measurement.md).

## Report

| Metric                | Calculation                                                                             |
| --------------------- | --------------------------------------------------------------------------------------- |
| Wait after opening    | Opening `(firstReadyAt - firstCaptionAt) / playbackRate`, in viewer seconds.            |
| Wait after seeking    | Landing `(firstReadyAt - firstCaptionAt) / playbackRate`, in viewer seconds.            |
| Loading while playing | Playing `states.loading / (states.loading + states.ready)`.                             |
| Provider duration     | Playing `batches.p90`, with `batches.measured` and `batches.results`. |

Provider p90 uses nearest rank and full wall seconds from sent to done for successful requests completed in the playing window, including requests sent earlier. Exclude queue time, failed, aborted and pending requests. Do not divide by playback rate.

Report unavailable wait times when no caption becomes ready, and unavailable Provider durations when successful samples are zero. Loading share excludes empty and error states; zero does not establish that every caption succeeded.

Report collection completeness, timing validity, visible subtitle behavior and configured performance thresholds separately. Preserve failed attempts and raw traces. Do not increase timeouts or weaken assertions for a pass. Follow the debugging and setup skills' cleanup order, and sanitize diagnostic network logs before sharing.
