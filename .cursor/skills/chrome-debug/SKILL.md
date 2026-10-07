---
name: chrome-debug
description: Real-site acceptance for Subline in the user's signed-in Default Chrome (YouTube, HBO, X) through one DevTools socket. Invoke explicitly.
disable-model-invocation: true
---

# Chrome Debug

Checks run in the user's signed-in Default Chrome. A background holder owns the only DevTools socket to it. Chrome asks **Allow remote debugging?** once for that socket, and every later check in the task reuses it.

Remote debugging is already on at `chrome://inspect/#remote-debugging`. Do not launch Chrome and do not pass `--remote-debugging-port`; Chrome ignores it for the default profile.

Below, `live` means `python3 .cursor/skills/chrome-debug/scripts/live.py`, run from the repository root.

## Steps

1. `live start`, before any other verification. It waits up to 60 seconds for Chrome to accept and tries to click Allow itself. If the dialog stays up, ask the user to click **Allow** once. A holder that is already running is reused.
2. If the change touches Subline itself, `npm run build`, then `live reload` so Chrome runs that build. Chrome loads Subline unpacked from this repository's `dist`; pass `--path` if it uses another folder. Reloading also starts a fresh worker with empty caches, which a cold-start measurement needs. Open YouTube, HBO and X tabs lose Subline until they are refreshed, as with the button at `chrome://extensions`.
3. Write the checks this change can break to `scripts/live/<change>.json`, and commit it with the change so a reviewer can rerun it.
4. `live run scripts/live/<change>.json`. It prints one JSON report per check on stdout and progress on stderr, and exits 0 only when every check passed. Rerun it as often as needed.
5. `live stop` when the task is finished or abandoned. The holder also exits after 60 idle minutes or when Chrome drops the socket.

## Rules

- Reach Chrome only through `live`. Do not connect to Chrome's debugging port, read `DevToolsActivePort`, or point the `chrome-devtools` MCP server or Playwright `connectOverCDP` at this Chrome. Each new connection raises another Allow dialog.
- Do not quit Chrome or touch tabs the checks did not open. Each check opens its own tab and closes it.
- A failing check is a finding. Do not loosen the check or edit the scripts to make it pass.
- Pages are signed in. Keep only the screenshots and text the change needs.
- Subline's worker and pages can read the API key. On the worker the holder only listens for `[subline] ` console lines, and `live reload` runs two fixed expressions in Subline's popup page. Do not add anything that evaluates client code in an extension context or turns on its `Network` domain.
- Do not turn on the `Runtime` domain for a check's page. YouTube notices it and stops serving captions. `Runtime.evaluate` alone is fine.

## Check file

A JSON list of checks:

```json
[
  {
    "name": "x-long-cue",
    "url": "https://x.com/NASA/status/2085101081260904717",
    "budget": 90,
    "steps": [
      { "action": "play" },
      { "action": "network-any", "hints": ["video.twimg.com/subtitles/"] },
      { "action": "wait-overlay" },
      { "action": "screenshot", "path": "docs/reviews/assets/x-long-cue-after.jpg" }
    ]
  }
]
```

| Field             | Meaning                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | Short id. `live run FILE --only NAME` runs just this check.                                                                                                      |
| `url`             | Page to open in a new tab.                                                                                                                                       |
| `budget`          | Seconds for the whole check, 1–600.                                                                                                                              |
| `steps`           | Run in order. A step that waits retries every second until it passes or the budget is spent. The first failed step ends the check as failed.                     |
| `on_fail`         | Optional JavaScript expression. When the check fails and its tab is still open, it runs once before the tab closes, and the report keeps its value as `on_fail`. |
| `fail_screenshot` | Optional path. When the check fails and its tab is still open, the visible tab is saved there before it closes.                                                  |

| `action`       | Fields                                                           | Passes when                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `play`         | `selector` (default `video`)                                     | The video exists. From then on every retry keeps it muted and playing and clicks YouTube's skip-ad button.                                                                                                |
| `seek`         | `time`, `selector`                                               | `currentTime` is within 1.5 s of `time`. Unseekable media fails here.                                                                                                                                     |
| `click`        | `selector`                                                       | An element in the document (not in shadow roots) matched and was clicked.                                                                                                                                 |
| `wait-overlay` | `reject` (default `["翻译中"]`), `reject_error` (default `true`) | `.original` and `.translation` in the `[data-subline-overlay]` shadow root are both shown and non-empty, the translation is not exactly one of `reject`, and with `reject_error` it has no `error` class. |
| `network-any`  | `hints`                                                          | A request from this tab contains a hint, case-insensitive. Requests are recorded from navigation onward and kept as scheme, host and path; query strings are dropped.                                     |
| `evaluate`     | `expression` or `expression_file`, `save`                        | The JavaScript value is truthy. Promises are awaited. The value must be JSON-serializable. An object with a `fail` key fails the step at once with `reason: "fail"` instead of retrying.                  |
| `trace`        | `seconds`, `selector`, `save`                                    | `seconds` of playback were sampled, or the video ended. See [Trace](#trace).                                                                                                                              |
| `screenshot`   | `path`                                                           | The visible tab was saved. `.jpg` and `.jpeg` save JPEG, anything else PNG.                                                                                                                               |

`expression_file` names a file whose text becomes `expression`. It resolves from the check file's folder, and a step gives one or the other. The report keeps an `evaluate` value whole up to 20,000 characters of JSON and cuts it after that. With `save`, the whole value goes to that JSON file and the report keeps a 500-character preview. `save`, `path` and `fail_screenshot` resolve from where `live run` runs.

### Trace

`trace` measures what the viewer sees from timing events that Subline's service worker prints. It runs until `seconds` of playback are covered or the video ends, and `seconds` must be below the check's `budget`. Put `play` before it, so retries keep the video playing and skip ads. On YouTube, Subline reuses the player's own caption request, so the player's captions must be on. Start from `scripts/live/youtube-captions-on.js`, which `scripts/live/worker-trace.json` uses. One click on CC is not enough, because the button can read pressed while the player fetches nothing.

When a check has a `trace`, the holder starts collecting before navigation. It sets `data-subline-trace` on the page's `<html>`, and Subline's content script answers with its extension id in `data-subline-trace-worker`. The holder then attaches to that extension's `background.js` worker and reattaches whenever the worker restarts. It waits up to 20 s for the worker before the first step, so the first Provider batch is seen, and detaches when the check ends, because an attached worker never goes to sleep. Tabs without the attribute send nothing.

The events are defined in `src/shared/trace.ts`. The tab reports video time, overlay state (`empty`, `loading`, `ready`, `timeout` or `error`), and the cue's index, start, end, segment and first 40 characters. It reports on every change and every 2 s while playing. The worker reports each Provider batch by tab and segment number: formed, sent, first item back, and done with `ok`, `invalid`, `timeout`, `error` or `aborted`. Events never carry settings, Provider error messages or queue keys, which contain the API key. Chrome must run a build that has these events, so run `live reload` after `npm run build`.

| Report field                                                         | Meaning                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stats.lag`                                                          | Per caption appearance, the video time from its cue start to the first `ready` state, or 0 when it was ready on arrival. A caption first seen more than 0.5 s after its cue start, after a seek or at the trace start, is measured from when it was first seen. `missed` counts captions that never became ready while shown. |
| `stats.loading`                                                      | `翻译中` episodes of 0.3 s or more, their total and the longest. `flashes` counts shorter ones, where a cached translation was still on its way back.                                                                                                                                                                         |
| `stats.coverage`                                                     | Percent of caption time when the translation was `ready`.                                                                                                                                                                                                                                                                     |
| `stats.batches`                                                      | Count, results, and round-trip seconds from sent to done (`p50`, `p90`, `max`); `firstItemP50` for the first streamed item; `waitMax` from formed to sent.                                                                                                                                                                    |
| `stats.firstCaptionAt`, `stats.firstReadyAt`, `stats.firstReadyWall` | Video time of the first caption and the first ready translation, and wall seconds from the trace start to that translation.                                                                                                                                                                                                   |
| `slowest`                                                            | The five slowest captions, each with the batch that carried its segment.                                                                                                                                                                                                                                                      |
| `longest`                                                            | The five longest `翻译中` episodes.                                                                                                                                                                                                                                                                                           |
| `saved`                                                              | With `save`, the file with `stats`, every caption, episode and batch, and the raw events.                                                                                                                                                                                                                                     |

The step fails at once with `reason: "fail"` when no event arrives in 30 s of playback, or at the end when none arrived; its `value` says how far the holder got. If the budget runs out, the step still reports `stats` up to that point. `stats.truncated` marks a trace that reached the cap of 50,000 events and dropped the rest. If the tab closes or crashes, the step reports the latest 60-second summary as `last`.

Fixed pages, when the change covers that platform:

| Platform | URL                                                                        | Budget |
| -------- | -------------------------------------------------------------------------- | ------ |
| YouTube  | `https://www.youtube.com/watch?v=H14bBuluwB8`                              | 50     |
| HBO      | `https://play.hbomax.com/video/watch/44805ae8-7771-4238-ad89-2c629a30db4d` | 50     |
| X        | `https://x.com/NASA/status/2085101081260904717`                            | 90     |

`.cursor/skills/chrome-debug/checks/smoke.json` plays each page and waits for a translated pair. Use it for a quick pass over all three, or `--only youtube` for one.

## Reports

Each check prints one JSON line, shown here formatted:

```json
{
  "name": "x",
  "ok": true,
  "url": "https://x.com/NASA/status/2085101081260904717",
  "steps": [
    { "action": "play", "ok": true, "video": { "paused": false, "time": 0.4 }, "seconds": 1.2 },
    {
      "action": "wait-overlay",
      "ok": true,
      "pair": { "original": "…", "translation": "…" },
      "time": 21.3,
      "seconds": 20.1
    }
  ],
  "title": "…",
  "captions": ["https://video.twimg.com/subtitles/…"],
  "seconds": 23.4
}
```

`url` is the check's URL as written. `captions` lists requests matching `/api/timedtext`, `.vtt`, `.mpd` or `/subtitles/`, without query strings.

A failed step has `reason` or `error`. `reason: "budget spent"` comes with the last sample (`last`, `page_error`), and `reason: "fail"` with the value that failed. When the tab closes or crashes, the step and the check both get `error`, for example `tab closed at video 63.2 s`, and the check ends at once. A failed check whose tab is still open also reports `on_fail` or `on_fail_error`, and `fail_screenshot`, when the check asks for them.

While checks run, stderr shows each step's start and end, plus a line every 30 s while a step waits, with the video time when known. `live run` ends with a summary. Exit code 1 means a check failed or the holder stopped before finishing, 2 means the check file is invalid.

## When something goes wrong

| Message                                                      | Next step                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DevToolsActivePort has no port`                             | Remote debugging is off. Ask the user to turn it on at `chrome://inspect/#remote-debugging`.                                                                                          |
| `Cannot reach Chrome on port`                                | Chrome is not running. Ask the user to open it; do not launch it yourself.                                                                                                            |
| `Could not click Allow automatically`                        | The terminal lacks Accessibility access, so the user clicks Allow by hand.                                                                                                            |
| `did not accept the connection within 60 s`                  | Nobody clicked Allow. Ask the user, then `live start` again.                                                                                                                          |
| `Holder is not running`                                      | It went idle, Chrome dropped the socket, or the harness killed it. `live start` again; the user allows once more. Log: `~/Library/Caches/subline-chrome-debug/holder.log`.            |
| The holder dies as soon as `live start` returns              | The harness kills detached processes. Run `python3 .cursor/skills/chrome-debug/scripts/holder.py` as a background command instead.                                                    |
| `tab closed at video …`, `tab crashed at video …`            | Someone closed the check's tab mid-step, or its renderer crashed. Rerun once. A second crash is a finding; keep `last` from the report.                                               |
| `reason: "fail"`                                             | The check's own expression returned an object with `fail`, or `trace` stopped early. `value` says why.                                                                                |
| `no answer from Subline in this tab`                         | Subline's content script did not answer the page tag. Subline is off for this site, the page is not one it matches, or Chrome runs a build from before tracing, so run `live reload`. |
| `Subline's service worker never appeared`                    | The content script answered but its worker did not start. Run `live reload`.                                                                                                          |
| `no trace events from Subline`                               | The worker is attached but prints nothing, so Chrome runs a build from before tracing. Run `npm run build` and `live reload`, then rerun.                                             |
| A trace whose `stats.states` is all `empty`, with no batches | The page never showed a caption. On YouTube the player's captions were off; turn them on with `youtube-captions-on.js` before `trace`.                                                |
| `is not Subline, or Chrome did not load it from that folder` | `live reload` found no Subline at the id of that folder. Pass `--path` with the folder Chrome loaded it from, or ask the user to reload it at `chrome://extensions`.                  |
| `cannot write …`                                             | A `screenshot`, `save` or `fail_screenshot` path is not writable.                                                                                                                     |
