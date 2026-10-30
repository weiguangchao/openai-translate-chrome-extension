---
name: debug-chromium
description: Operate Subline through one Chromium debugging session. Use for requested page debugging and trace collection after browser setup, or with an existing browser the user selected.
---

# Debug Chromium

## Connect

Use [setup-headless-chromium](../setup-headless-chromium/SKILL.md) unless the user requested an existing browser. For an existing browser, enable remote debugging at `chrome://inspect/#remote-debugging`. If `start` cannot accept Chrome's Allow dialog, ask the user to accept it once.

For a launched browser, use the `DEBUG_CHROMIUM_PORT_FILE` and `DEBUG_CHROMIUM_STATE` values in its `session.json`. Build with `npm run build` in the repository that owns the loaded extension folder, then run from the repository root:

```bash
python3 .agents/skills/debug-chromium/scripts/live.py start
python3 .agents/skills/debug-chromium/scripts/live.py reload --path "$PWD/dist" --session SESSION
python3 .agents/skills/debug-chromium/scripts/live.py open "URL" --trace --session SESSION
```

Replace `SESSION` with the ID from `start`. Pass it to later commands, or set `DEBUG_CHROMIUM_SESSION` for this task. `reload` prints the build fingerprint but does not build; refresh affected site tabs afterward. Rebuild and reload after source changes.

## Operate

- Use `do TAB STEP` for JSON steps. `do --help` describes `media`, `wait`, `evaluate`, `click`, `screenshot`, `requests`, `overlay`, `trace` and `focus`.
- Use `click` when a control needs trusted pointer input. Wait for ads before checking captions.
- Use `status` to inspect an active command and `run FILE` for repeatable JSON checks. Use `--help` or `run --help` for command options.

For playback measurements, follow [verify-chromium-performance](../verify-chromium-performance/SKILL.md). Open with `--trace` to capture from navigation. A trace's `since: "open"` includes playback from the settled opening position; `since: "seek"` includes playback from the last `media` seek. Without `since`, it starts at the trace step. Use `save` to retain raw events and media observations, including partial evidence.

## Session rules

- From `start` to `stop`, use only `live.py`. Do not open another DevTools connection, read `DevToolsActivePort`, launch or quit this browser.
- Do not enable the page's Runtime domain. Do not evaluate custom code or enable Network in extension contexts. The holder listens to trace logs; reload uses fixed popup expressions.
- Operate only this task's tabs and holder. Do not take another task's session ID or stop its holder. Media stays muted.
- `focus` activates the user's Chrome through AppleScript. Tell the user before using it; omit it for headless runs.
- Preserve failures and retain only needed page text and screenshots. Sanitize network logs before sharing.

## Finish

Use `close TAB` for this task's tabs, then `stop --session SESSION`. This leaves Chrome running. If setup-headless-chromium launched it, follow that skill's cleanup after the holder stops.
