---
name: debug-chromium
description: Debug Subline on real YouTube/X pages and traces through one Chromium session. Use only when the user asks for a real-browser check.
---

# Debug Chromium

`npm run verify` proves functional behavior; this skill debugs real sites and records traces.

For delegated browser work, put the browser-selection rules and chosen launch-session path or explicitly authorized existing-browser endpoint directly in the task brief; do not assume parent instructions are inherited. Default to isolated headless Chromium with a temporary profile. Connect to personal Chrome only when the user explicitly requests it; if isolated setup fails, report the failure without falling back to personal Chrome.

Use [setup](../setup-headless-chromium/SKILL.md). From the loaded extension's repo, pass setup's `session.json` to every command:

```bash
npm run build
python3 .agents/skills/debug-chromium/scripts/live.py start --launch-session .artifacts/headless-check/session.json
python3 .agents/skills/debug-chromium/scripts/live.py reload --session SESSION --launch-session .artifacts/headless-check/session.json
python3 .agents/skills/debug-chromium/scripts/live.py open "URL" --trace --session SESSION --launch-session .artifacts/headless-check/session.json
```

`SESSION` is `start`'s ID, also accepted as `DEBUG_CHROMIUM_SESSION`. Reload prints a fingerprint, never builds; rebuild/reload/refresh after source changes. With `--launch-session`, `status` reports the Provider and `build.stale`, true when the loaded folder changed since launch or the last reload: reload before driving. Optional overall check: `run .agents/skills/debug-chromium/checks/smoke.json` plays YouTube and X until both subtitle lines show; `--only x` (repeatable) picks sites. See `do --help`/`run --help` for actions and caption codes; use trusted `click`, wait out ads. Tabs expire after 15 idle minutes, the holder after 60 (`DEBUG_CHROMIUM_IDLE` seconds); open/do `--timeout` defaults to 60 wall seconds. Reload `--from` replaces files in `--path`, default repo `dist`.

`{"action":"media","play":true,"captions":"en"}` plays and selects English captions; missing tracks report available languages. A media timeout retains page URL/title/loading/player state and the last media sample.

Every command requires a browser selection. `--launch-session` derives endpoint/state paths and checks the live isolated launch and holder endpoint before page operations. Missing, stopped or mismatched sessions fail. `stop`/`status` remain available after launcher shutdown. For an explicitly requested existing browser, enable `chrome://inspect/#remote-debugging` and replace `--launch-session` with `--existing-browser "/absolute/path/to/DevToolsActivePort"`; set task-owned `DEBUG_CHROMIUM_STATE`. Only this mode permits system Chrome authorization/focus. Ask for manual Allow once if automatic approval fails.

For traces follow [performance](../verify-chromium-performance/SKILL.md). `--trace` captures navigation; `since: "open"` uses settled opening, `"seek"` last media seek, omitted starts now. `save` keeps raw/partial events/media.

From start to stop, drive the browser only through `live.py`. Run page JavaScript with its `evaluate` action, never through another DevTools connection, a browser-automation MCP server or injected extension code. Don't read endpoints, launch/quit browsers or watch Network yourself. Use only task-owned sessions/holders/muted tabs. Announce AppleScript `focus`; omit headlessly. Preserve failures/needed text/screenshots; sanitize shared logs.

`close TAB`, then `stop --session SESSION` leaves Chrome running. Finish [launcher cleanup](../setup-headless-chromium/SKILL.md#cleanup).
