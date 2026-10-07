---
name: chrome-debug
description: Chrome commands for Subline checks in the user's signed-in Default profile. Invoke explicitly.
disable-model-invocation: true
---

# Chrome debug

Run from the repository root:

```bash
python3 .cursor/skills/chrome-debug/scripts/live.py --help
python3 .cursor/skills/chrome-debug/scripts/live.py run --help
```

Append a command to `python3 .cursor/skills/chrome-debug/scripts/live.py`:

| Command | Effect |
| --- | --- |
| `start` | Connect to Chrome once, or reuse the holder's existing socket. |
| `status` | Report whether the holder is running. |
| `reload [--path DIR]` | Reload Subline from Chrome's loaded folder, defaulting to this repository's `dist`. Does not build it. |
| `run FILE [FILE ...] [--only NAME]` | Run JSON checks. Each check opens its own tab with muted media, executes its steps, and closes that tab. |
| `stop` | Stop the holder and close its socket and any active check tab. Leaves Chrome running. |

`run --help` describes check fields, composable actions, and return values. Choose URLs, steps, budgets, assertions, and evidence for the user's task. A completed trace is data, not a synchronization verdict.

Chrome must already be open with remote debugging enabled at `chrome://inspect/#remote-debugging`. `start` tries to accept Chrome's Allow dialog; if it remains open, ask the user to click Allow once. `reload` unloads Subline from existing site tabs until they are refreshed.

Before every debugging session, run `npm run build` in the repository that owns Chrome's loaded extension folder. Then `start` and `reload --path /absolute/path/to/that/dist` through the holder's DevTools socket. Run checks only after both build and reload succeed. Rebuild and reload after source changes during the session.

Keep debug tabs' media muted throughout debugging. `run` installs media muting before navigation, covering existing and newly added audio/video elements without forcing playback. This also applies to `evaluate` steps and pause/resume checks.

## Constraints

- Reach this Chrome only through `live.py`. Do not launch or quit it, read `DevToolsActivePort`, or open another DevTools connection.
- Operate only tabs the checks opened. Stop the holder when the task ends.
- Keep only the signed-in page text and screenshots the task needs.
- Do not evaluate custom code or enable Network in extension contexts. The holder only listens to Subline trace logs; `reload` uses fixed popup expressions.
- Do not enable the page's Runtime domain. YouTube stops serving captions. Page `Runtime.evaluate` is supported through `evaluate`.
- Preserve failed checks and report their findings. Do not relax assertions to obtain a pass.
