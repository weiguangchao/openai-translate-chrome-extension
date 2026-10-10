---
name: chrome-debug
description: Chrome commands for Subline checks in the user's signed-in Default profile. Invoke explicitly.
disable-model-invocation: true
---

# Chrome debug

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
| `status` | Report whether the holder is running and which tabs it keeps open. |
| `reload [--path DIR] [--from BUILD]` | Reload Subline from the folder Chrome loaded it from, defaulting to this repository's `dist`, and print the build fingerprint. `--from` first replaces that folder's files with another build. Does not build. |
| `open URL [--trace]` | Open a muted tab and print its tab ID. `--trace` watches Subline's worker from navigation so `trace` steps work. |
| `do TAB STEP [--timeout S]` | Run one JSON step in an open tab and print its result. |
| `close TAB` | Close a tab and undo its playback rate change. |
| `run FILE [FILE ...] [--only NAME]` | Run JSON checks. Each check opens its own tab, runs its steps in order, and closes it. |
| `stop` | Stop the holder and close its socket and its tabs. Leaves Chrome running. |

Keep the session ID printed by `start`. Pass `--session ID` after the command on later calls, or set `CHROME_DEBUG_SESSION` only for this task. A holder belongs to one task until stopped. If another task owns it, wait for that task to finish; do not copy its ID or stop its process. `status` is available without an ID. A holder started by an older version without ownership must be stopped by its original task using that version before this version can start.

Steps are the same in `do` and `run`: `media` seeks, sets the playback rate, plays or pauses and reports the video; `wait` waits for wall seconds or a video time; `evaluate`, `click`, `screenshot`, `requests`, `overlay`, `trace` and `focus` cover the page, Subline's overlay, Subline's timing events and the window. `do --help` lists every field and return value.

Use `open`, `do` and `close` to react to what the page does, for example to seek again when a site jumps elsewhere or to bring Chrome to the front when a trace reports `throttled`. `media` reports `seeks`, the number of times it moved the video, and a trace marks `sparse` when its states cover under 80% of the played time. A trace counts from its own step unless `since` sets `open`, where the video settled after the tab opened, such as a site's resume, or `seek`, the last `media` seek; only then does it cover the first seconds that play while `media` waits. Use `run` to repeat a fixed check. A tab that gets no request for 15 minutes closes by itself.

Chrome must already be open with remote debugging enabled at `chrome://inspect/#remote-debugging`. `start` tries to accept Chrome's Allow dialog; if it remains open, ask the user to click Allow once. Before checking a build, run `npm run build` in the repository that owns Chrome's loaded folder, then `start` and `reload`; rebuild and reload after source changes. `reload` unloads Subline from existing site tabs until they are refreshed.

## Constraints

- Reach this Chrome only through `live.py`. Do not launch or quit it, read `DevToolsActivePort`, or open another DevTools connection.
- Operate only tabs this session opened. Close them and stop the holder with its session ID when the task ends.
- Media stays muted from navigation until the tab closes; unmute attempts are ignored.
- `focus` takes focus from the app the user is working in. Tell the user before using it.
- Keep only the signed-in page text and screenshots the task needs.
- Do not evaluate custom code or enable Network in extension contexts. The holder only listens to Subline trace logs; `reload` uses fixed popup expressions.
- Do not enable the page's Runtime domain. YouTube stops serving captions. `evaluate` works without it.
- Preserve failed steps and report their findings. Do not relax assertions to obtain a pass.

## Tests

After changing `scripts/`, run from the repository root:

```bash
python3 -m unittest discover -s .agents/skills/chrome-debug/tests
```

The browser tests launch their own headless Chromium from Playwright's cache (`npx playwright install chromium`, or set `CHROME_DEBUG_TEST_BROWSER`) with a Subline test double and a local player page; `CHROME_DEBUG_TEST_HEADED=1` shows its window. They never reach the user's Chrome or holder. A full run takes about five minutes; `-p 'test_[!bk]*.py'` runs only the tests that need no browser. `test_known_issues.py` holds problems the scripts still have as expected failures. When a fix makes one pass, remove its `expectedFailure`.
