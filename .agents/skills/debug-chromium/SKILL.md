---
name: debug-chromium
description: Debug Subline pages/traces through one Chromium session.
---

# Debug Chromium

Use [setup](../setup-headless-chromium/SKILL.md). Pass its `session.json` to every command. In the loaded extension's repo:

```bash
npm run build
python3 .agents/skills/debug-chromium/scripts/live.py start --launch-session "$PWD/.artifacts/headless-check/session.json"
python3 .agents/skills/debug-chromium/scripts/live.py reload --path "$PWD/dist" --session SESSION --launch-session "$PWD/.artifacts/headless-check/session.json"
python3 .agents/skills/debug-chromium/scripts/live.py open "URL" --trace --session SESSION --launch-session "$PWD/.artifacts/headless-check/session.json"
```

`SESSION` is `start`'s ID, also accepted as `DEBUG_CHROMIUM_SESSION`. Reload prints a fingerprint, never builds. Rebuild/reload/refresh after source changes. See `do TAB STEP`, `run FILE`, `status`, `--help`; use trusted `click`, wait out ads. Open tabs expire after 15 idle minutes; open/do `--timeout` defaults to 60 wall seconds. `run --only` is repeatable; reload `--from` replaces files in `--path`, default repo `dist`.

Every command requires a browser selection. `--launch-session` derives endpoint/state paths and checks the live isolated launch and holder endpoint before page operations. Missing, stopped or mismatched sessions fail. `stop`/`status` remain available after launcher shutdown. For an explicitly requested existing browser, enable `chrome://inspect/#remote-debugging` and replace `--launch-session` with `--existing-browser "/absolute/path/to/DevToolsActivePort"`; set task-owned `DEBUG_CHROMIUM_STATE`. Only this mode permits system Chrome authorization/focus. Ask for manual Allow once if automatic approval fails.

For traces follow [performance](../verify-chromium-performance/SKILL.md). `--trace` captures navigation; `since: "open"` uses settled opening, `"seek"` last media seek, omitted starts now. `save` keeps raw/partial events/media.

Start through stop: only `live.py`; no extra DevTools connections/endpoint reads/browser launches/quits/page Runtime/custom extension code or Network. Holder reads logs; reload uses fixed popup expressions. Use only task-owned sessions/holders/muted tabs. Announce AppleScript `focus`; omit headlessly. Preserve failures/needed text/screenshots; sanitize shared logs.

`close TAB`, then `stop --session SESSION` leaves Chrome running. Finish [launcher cleanup](../setup-headless-chromium/SKILL.md#cleanup).
