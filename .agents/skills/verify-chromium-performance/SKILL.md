---
name: verify-chromium-performance
description: Verify Subline subtitle performance in Chromium when the user requests real-browser playback measurements or build comparisons. Covers readiness, trace timing, metrics, evidence and cleanup. Do not use for unrelated code or documentation edits.
---

# Verify Chromium performance

For a user-requested real-browser check, default to the [setup-headless-chromium skill](../setup-headless-chromium/SKILL.md) to launch and initialize an isolated headless browser. Then use the [debug-chromium skill](../debug-chromium/SKILL.md) for page operations, debugging and trace collection. Use an existing or headed browser when the user requests one. Do not start real-browser checks for unrelated code or documentation work.

Collect and report the metrics below for each build on YouTube and X by default. Include HBO Max only when the user explicitly requests HBO. Test each included platform at 1x, 1.25x, 1.5x and 2x. Each run reloads Subline so no translation is cached, opens the video, sets the rate and traces 45 s with `"since": "open"`. It then seeks once into a segment with no cached translations, away from where the opening trace played, traces 45 s with `"since": "seek"` for the landing trace, then keeps playing and traces 180 s; durations are video seconds. On YouTube, the first `media` step's `time` starts the video where someone is speaking; YouTube ignores `&t=`.

A run counts only if its traces report the tested `playbackRate` and none is marked `throttled` (keep Chrome in front). The landing trace fails by itself when the video leaves the seek target.

- Wait after opening: the seconds a viewer waits after opening the video until the first subtitle on screen shows its translation, from the opening trace: `(firstReadyAt - firstCaptionAt) / playbackRate`.
- Wait after seeking: the seconds a viewer waits after the seek until the first subtitle on screen shows its translation, from the landing trace: `(firstReadyAt - firstCaptionAt) / playbackRate`.
- Loading while playing: the share of subtitle time that shows the loading placeholder instead of a translation, from the 180 s trace: `states.loading / (states.loading + states.ready)`.
- Provider duration p90. Report the 90th percentile of wall seconds from `sent` to `done` for successful Provider requests completed during the 180 s trace, from `batches.p90`. Exclude queue time, failed, aborted and pending requests. Include the full duration when a request was sent before this trace but completed within it. Use nearest rank and do not divide by playback rate. Report the sample count from `batches.measured` and the outcome counts from `batches.results`. No samples means unavailable, not zero.

### Page readiness and visible subtitles

- On YouTube, wait for pre-roll ads to finish and confirm the selected caption track is enabled before seeking into spoken content. A fresh profile may have CC off. If the player fails after seeking, inspect its error and media response before changing the seek method or timeout. The investigation observed HTTP 200 media responses carrying STREAM_PROTECTION_STATUS rejection and player errors ump.spsrejectfailure and HTML5_SPS_UMP_STATUS_REJECTED. HTTP 200 alone does not establish playable media.
- On X, confirm the main video, selected subtitle language, track mode, loaded cues and active cues. Inspect the actual caption source before assuming prefetch works. The investigated page exposed a React controller instead of the adapter's expected `playerApi.video.hlsJs`. Subline used live native cues without a full timeline. The traces suggest many successful Provider replies arrived after their caption had changed. A source mode named model or successful requests alone do not prove timeline prefetch or timely subtitles.
- Check screenshots as well as `overlay` results. Choose a viewport that fits the subtitle area. DOM visibility and viewport intersection do not detect another element covering a subtitle. In the investigated 756 by 413 viewport, X's fixed See all the replies and Continue to X login panel covered the translation while the DOM check reported it visible. Scroll the subtitle region clear of page panels and inspect both lines. Do not remove page elements with injected CSS to manufacture a passing screenshot. Record viewport and scroll position with the evidence.
- A paused frame can confirm real translation and rendering. Label it as a separate diagnostic. It does not prove continuous playback quality and must not replace the opening, landing or playing traces. X displayed both lines after scrolling and pausing even when continuous playback showed almost entirely loading.

### Evidence and cleanup

- For authorized MiMo measurements, read the current worktree's Git-ignored `.env` fields MIMO_BASE_URL, MIMO_MODEL and MIMO_API_KEY before asking for configuration. Keep this user-requested persistent file at mode `0600`, fill the real settings page from it, and retain it during task cleanup. Never copy its key into evidence or a build.
- Preserve failed attempts and raw traces. Check saved runs with `.agents/skills/debug-chromium/scripts/verify.py`. Report collection completeness, timing validity, visible subtitle behavior and performance thresholds separately. Report wait time as unavailable when no caption becomes ready in its window. Report Provider duration as unavailable when its successful sample count is zero. The loading share excludes empty and error states. A value of zero does not mean all captions succeeded. Do not increase timeouts or weaken assertions to obtain a pass.
- Close only this task's tabs and stop its `live.py` holder. Stop any browser launcher owned by this task after the holder has stopped, and remove its temporary profile and secret-bearing setup files. Do not close the user's browser. Retain the evidence needed to reproduce the finding. Sanitize diagnostic network logs before sharing because they can contain cookies and signed media URLs.
