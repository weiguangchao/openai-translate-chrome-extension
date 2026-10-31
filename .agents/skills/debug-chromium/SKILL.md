---
name: debug-chromium
description: Debug Subline pages/traces through one Chromium session.
---

# Debug Chromium

Use [setup](../setup-headless-chromium/SKILL.md), or enable `chrome://inspect/#remote-debugging`; ask for manual Allow once if `start` cannot accept it. Export the launch's `session.json` environment. In the loaded extension's repo:

```bash
npm run build
python3 .agents/skills/debug-chromium/scripts/live.py start
python3 .agents/skills/debug-chromium/scripts/live.py reload --path "$PWD/dist" --session SESSION
python3 .agents/skills/debug-chromium/scripts/live.py open "URL" --trace --session SESSION
```

`SESSION` is `start`'s ID, also accepted as `DEBUG_CHROMIUM_SESSION`. Reload prints a fingerprint, never builds. Rebuild/reload/refresh after source changes. See `do TAB STEP`, `run FILE`, `status`, `--help`; use trusted `click`, wait out ads. Open tabs expire after 15 idle minutes; open/do `--timeout` defaults to 60 wall seconds. `run --only` is repeatable; reload `--from` replaces files in `--path`, default repo `dist`.

For traces follow [performance](../verify-chromium-performance/SKILL.md). `--trace` captures navigation; `since: "open"` uses settled opening, `"seek"` last media seek, omitted starts now. `save` keeps raw/partial events/media.

Start through stop: only `live.py`; no extra DevTools connections/endpoint reads/browser launches/quits/page Runtime/custom extension code or Network. Holder reads logs; reload uses fixed popup expressions. Use only task-owned sessions/holders/muted tabs. Announce AppleScript `focus`; omit headlessly. Preserve failures/needed text/screenshots; sanitize shared logs.

`close TAB`, then `stop --session SESSION` leaves Chrome running. Finish [launcher cleanup](../setup-headless-chromium/SKILL.md#cleanup).
