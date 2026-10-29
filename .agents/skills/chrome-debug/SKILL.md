---
name: chrome-debug
description: Debug Subline in Chromium and collect playback traces for requested real-browser checks. Use after headless-chromium prepares the browser, or with an existing browser requested by the user.
---

# Chrome debug

For a requested real-browser check, default to [headless-chromium](../headless-chromium/SKILL.md) for browser launch and initialization. That skill closes its bootstrap connection before this session starts. Use this skill for page operations and traces after handoff.

Run from the repository root:

```bash
python3 .agents/skills/chrome-debug/scripts/live.py --help
python3 .agents/skills/chrome-debug/scripts/live.py do --help
python3 .agents/skills/chrome-debug/scripts/live.py run --help
```

Append a command to `python3 .agents/skills/chrome-debug/scripts/live.py`:

| Command | Effect |
| --- | --- |
| `start` | Create a session and print its ID, or reuse this task's holder with `--session ID`. |
| `status` | Report the connection, active command and open tabs, including while a step runs. |
| `reload [--path DIR] [--from BUILD]` | Reload Subline from the folder Chrome loaded it from, defaulting to this repository's `dist`, and print the build fingerprint. `--from` first replaces that folder's files with another build. Does not build. |
| `open URL [--trace]` | Open a muted tab and print its tab ID. `--trace` watches Subline's worker from navigation so `trace` steps work. |
| `do TAB STEP [--timeout S]` | Run one JSON step in an open tab and print its result. |
| `close TAB` | Close a tab and undo its playback rate change. |
| `run FILE [FILE ...] [--only NAME]` | Run JSON checks. Each check opens its own tab, runs its steps in order, and closes it. |
| `stop` | Stop the holder and close its socket and its tabs. Leaves Chrome running. |

Keep the session ID printed by `start`. Pass `--session ID` after the command on later calls, or set `CHROME_DEBUG_SESSION` only for this task. A holder belongs to one task until stopped. If another task owns it, wait for that task to finish; do not copy its ID or stop its process. `status` is available without an ID. A holder started by an older version without ownership must be stopped by its original task using that version before this version can start.

Steps are the same in `do` and `run`: `media` seeks, sets the playback rate, plays or pauses and reports the video; `wait` waits for wall seconds or a video time; `evaluate`, `click`, `screenshot`, `requests`, `overlay`, `trace` and `focus` cover the page, Subline's overlay, Subline's timing events and the window. `do --help` lists every field and return value.

`click` scrolls its target into view and sends browser pointer input through the holder's existing connection. Use it for a page control that ignores JavaScript `node.click()`. Wait for advertisements to finish before checking caption readiness or starting a playback trace.

Use `open`, `do` and `close` to react to what the page does, for example to seek again when a site jumps elsewhere or to bring Chrome to the front when a trace reports `throttled`. `media` reports `seeks`, the number of times it moved the video, and a trace marks `sparse` when its states cover under 80% of the played time. A trace counts from its own step unless `since` sets `open`, where the video settled after the tab opened, or `seek`, the last `media` seek; only then does it cover the first seconds that play while `media` waits. Use `run` to repeat a fixed check. A tab that gets no request for 15 minutes closes by itself.

Each trace reports its own clock. `rates` gives wall seconds at each observed rate, and `rateChanges` and `rateMismatch` expose rate resets before the holder corrects them. `complete` means the requested video duration was collected; `ok` alone does not establish valid timing or acceptable subtitle performance. `save` retains this tab's raw worker events and media observations for recounting, including partial evidence after interruption.

For repeatable measurements, build comparisons and resuming interrupted runs, read [measurement.md](references/measurement.md). The separate `measure.py` runner uses a supplied plan, saves every attempt and restores the original loaded build. `verify.py` checks saved results and calculates metrics without Chrome. These helpers do not change the interactive commands or impose performance thresholds.

Report Provider duration p50 and p90 from the 180 s trace's `batches.p50` and `batches.p90`, with the sample count `batches.measured` and outcome counts `batches.results`. These are nearest-rank percentiles of wall seconds from `sent` to `done` for successful requests completed in that trace. A request sent earlier contributes its full duration if it completes in the window. Queue time and failed, aborted or pending requests do not enter the percentiles. No samples produces `null`.

Chrome must already be running. For the default headless workflow, use the endpoint and holder environment variables recorded by headless-chromium. When the user requests an existing browser, enable remote debugging at `chrome://inspect/#remote-debugging`. `start` tries to accept Chrome's Allow dialog; if it remains open, ask the user to click Allow once. Before checking a build, run `npm run build` in the repository that owns Chrome's loaded folder, then `start` and `reload`; rebuild and reload after source changes. `reload` unloads Subline from existing site tabs until they are refreshed.

## Constraints

- While this session is active, reach this Chrome only through `live.py`. Do not launch or quit it, read `DevToolsActivePort`, or open another DevTools connection. Browser launch belongs to headless-chromium before `start`. Launcher cleanup follows `stop`.
- Operate only tabs this session opened. Close them and stop the holder with its session ID when the task ends.
- Media stays muted from navigation until the tab closes; unmute attempts are ignored.
- `focus` takes focus from the app the user is working in. Tell the user before using it.
- Keep only the signed-in page text and screenshots the task needs.
- Do not evaluate custom code or enable Network in extension contexts. The holder only listens to Subline trace logs; `reload` uses fixed popup expressions.
- Do not enable the page's Runtime domain. YouTube stops serving captions. `evaluate` works without it.
- Preserve failed steps and report their findings. Do not relax assertions to obtain a pass.
